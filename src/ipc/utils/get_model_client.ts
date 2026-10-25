import { freeAutoCandidates } from "@/lib/modelCatalogPolicy";
import { withAnthropicPreservedThinking } from "./anthropic_preserved_thinking";
import type { ExternalModelAdmission } from "../services/external_model_admission";
import {
  AUTO_DYAD_PRO_MODEL_ALIASES,
  AUTO_BALANCED_ALIAS,
  type AutoModelCandidates,
} from "../services/auto_model_candidates";
import { providerOnlyInferenceSettings } from "@/lib/providerOnlyInference";
import { createOpenAI } from "@ai-sdk/openai";
import { createGoogleGenerativeAI as createGoogle } from "@ai-sdk/google";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createXai } from "@ai-sdk/xai";
import { createVertex as createGoogleVertex } from "@ai-sdk/google-vertex";
import { createAzure } from "@ai-sdk/azure";
import type { LanguageModel } from "ai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { createAmazonBedrock } from "@ai-sdk/amazon-bedrock";
import type { FetchFunction } from "@ai-sdk/provider-utils";
import type {
  LargeLanguageModel,
  ModelSelection,
  UserSettings,
  VertexProviderSetting,
  AzureProviderSetting,
} from "../../lib/schemas";
import { getEnvVar } from "./read_env";
import log from "electron-log";
import { FREE_OPENROUTER_MODEL_NAMES } from "../shared/language_model_constants";
import {
  getLanguageModelProviders,
  getLanguageModels,
} from "../shared/language_model_helpers";
import { resolveBuiltinModelAlias } from "../shared/remote_language_model_catalog";
import { LanguageModelProvider } from "@/ipc/types";

import { getLmStudioBaseUrl } from "./lm_studio_utils";
import { createOllamaProvider } from "./ollama_provider";
import { getOllamaApiUrl } from "../handlers/local_model_ollama_handler";
import { createFallback } from "./fallback_ai_model";
import { getTestFetchOption } from "./test_fetch_override";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import {
  findInvalidProviderApiKeyCharacter,
  formatInvalidProviderApiKeyMessage,
  normalizeProviderApiKeyInput,
} from "@/lib/providerApiKey";
import { isFreeProModel } from "@/lib/freeProModel";
import { getOpenRouterAppAttributionHeaders } from "./openrouter_attribution";
import { resolveModelSelection } from "./model_effort";
import { getModelPreferenceKey } from "@/lib/modelEffort";
import { getAutoSidekickRuntimeModel } from "@/lib/autoSidekick";
import { createCodexSubscriptionModel } from "./codex_subscription_provider";
import { ClaudeCodeModel } from "../services/claude_code/model";
import { resolveSubscriptionModel } from "../services/resolve_subscription_model";
import { subscriptionBillingKey } from "../services/subscription_billing";

// The test-only fetch seam lives in ./test_fetch_override (dependency-free,
// so secondary factories can use it without import cycles). Re-exported here
// for existing importers.
export { setModelClientFetchForTesting } from "./test_fetch_override";

function getModelClientFetchOption(): { fetch?: FetchFunction } {
  return getTestFetchOption();
}

const AUTO_MODEL_ALIASES = [
  ...AUTO_DYAD_PRO_MODEL_ALIASES,
  "dyad/auto/openrouter",
] as const;

const OPENROUTER_FREE_MODEL_NAME = "openrouter/free";
const AUTO_BALANCED_MODEL_NAME = "balanced";

export interface ModelClient {
  model: LanguageModel;
  builtinProviderId?: string;
  reasoningEffortProviderId?: string;
  /** Actual source, including the active candidate of an Auto fallback chain. */
  getRuntimeModel?: () => ModelSelection;
}

// Providers whose APIs reject or silently drop inline PDF file parts.
const PDF_UNSUPPORTED_PROVIDERS = new Set(["xai", "ollama", "lmstudio"]);

/**
 * Whether this client can send inline PDF file parts. Unknown providers are
 * assumed to support them; their API errors surface like any other.
 */
export function modelClientSupportsPdfInput(modelClient: ModelClient) {
  return !PDF_UNSUPPORTED_PROVIDERS.has(modelClient.builtinProviderId ?? "");
}

export interface ModelClientResult {
  modelClient: ModelClient;
  runtimeModel: LargeLanguageModel;
  isEngineEnabled?: boolean;
  isSmartContextEnabled?: boolean;
}

const logger = log.scope("getModelClient");
export async function getModelClient(
  selectedModel: LargeLanguageModel,
  settings: UserSettings,
  modelSelectionOverride?: ModelSelection,
  context?: {
    chatId: number;
    autoModelCandidates?: AutoModelCandidates;
    externalModelAdmission?: ExternalModelAdmission;
  },
  // files?: File[],
): Promise<ModelClientResult> {
  // An accepted per-turn source is authoritative. Never create a hosted
  // engine transport or wrap direct/local usage in application-credit billing.
  if (modelSelectionOverride?.connection === "pro")
    throw new DyadError(
      "Select API keys or a connected provider account before continuing this chat.",
      DyadErrorKind.Precondition,
    );
  const acceptedSource = modelSelectionOverride?.connection;
  settings = providerOnlyInferenceSettings(
    acceptedSource === "api-key" || acceptedSource === "subscription"
      ? { ...settings, proModelUsage: acceptedSource }
      : settings,
  );
  if (
    selectedModel.connection === "pro" &&
    !settings.proModelUsage &&
    !acceptedSource
  )
    throw new DyadError(
      "Select API keys or a connected provider account before continuing this chat.",
      DyadErrorKind.Precondition,
    );
  const selectedModelSelection =
    modelSelectionOverride ??
    (await resolveModelSelection({
      model: selectedModel,
      preferredEffortLevel:
        settings.modelEffortPreferences?.[getModelPreferenceKey(selectedModel)],
    }));
  const model = getAutoSidekickRuntimeModel(selectedModel);
  // A supplied connection is the source already accepted for this turn.
  // Auxiliary callers without one resolve their own concrete model here.
  const modelSelection = getAutoSidekickRuntimeModel(
    modelSelectionOverride?.connection
      ? selectedModelSelection
      : await resolveSubscriptionModel(selectedModelSelection, settings),
  );
  const connection = modelSelection.connection;
  if (
    connection === "api-key" &&
    model.provider === "auto" &&
    ["value", "free-pro"].includes(model.name)
  )
    throw new DyadError(
      "This hosted model option is unavailable. Select a configured API-key or local model.",
      DyadErrorKind.Validation,
    );
  if (connection === "subscription") {
    if (modelSelection.provider === "claude-code") {
      return {
        modelClient: {
          model: new ClaudeCodeModel(
            modelSelection.name,
            subscriptionBillingKey(settings),
            context?.externalModelAdmission,
          ),
          getRuntimeModel: () => modelSelection,
        },
        runtimeModel: modelSelection,
        isEngineEnabled: false,
      };
    }
    if (modelSelection.provider !== "openai")
      throw new DyadError(
        "Subscription supports OpenAI models only. Choose a ChatGPT model.",
        DyadErrorKind.Validation,
      );
    return {
      modelClient: {
        model: await createCodexSubscriptionModel(
          modelSelection.name,
          subscriptionBillingKey(settings),
          context,
          settings.chatgptFastMode,
        ),
        builtinProviderId: "openai",
        getRuntimeModel: () => modelSelection,
      },
      runtimeModel: modelSelection,
      isEngineEnabled: false,
    };
  }
  const allProviders = await getLanguageModelProviders();

  const providerConfig = allProviders.find(
    (provider) => provider.id === model.provider,
  );
  if (!providerConfig)
    throw new DyadError(
      `Configuration not found for provider: ${model.provider}`,
      DyadErrorKind.NotFound,
    );
  if (isFreeProModel(model))
    throw new DyadError(
      "This hosted model option is unavailable. Select a configured API-key or local model.",
      DyadErrorKind.Precondition,
    );

  // Handle 'auto' provider by trying each model in AUTO_MODELS until one works
  if (model.provider === "auto") {
    if (model.name === "free") {
      const openRouterProvider = allProviders.find(
        (p) => p.id === "openrouter",
      );
      if (!openRouterProvider) {
        throw new DyadError(
          "OpenRouter provider not found",
          DyadErrorKind.NotFound,
        );
      }
      return {
        modelClient: {
          model: createFallback({
            models: await Promise.all(
              freeAutoCandidates(
                await getLanguageModels({ providerId: "openrouter" }),
                FREE_OPENROUTER_MODEL_NAMES,
              ).map(
                async (name: string) =>
                  (
                    await getModelClient(
                      { provider: "openrouter", name },
                      settings,
                      {
                        ...modelSelection,
                        provider: "openrouter",
                        name,
                        connection: "api-key",
                      },
                      context,
                    )
                  ).modelClient.model,
              ),
            ),
          }),
          builtinProviderId: "openrouter",
        },
        runtimeModel: model,
        isEngineEnabled: false,
      };
    }
    const aliases =
      model.name === AUTO_BALANCED_MODEL_NAME
        ? [AUTO_BALANCED_ALIAS]
        : AUTO_MODEL_ALIASES;
    const candidateProviders = new Set<string>();
    for (const autoModelAlias of aliases) {
      const resolvedModel = await resolveBuiltinModelAlias(autoModelAlias);
      if (!resolvedModel) {
        continue;
      }

      const providerInfo = allProviders.find(
        (p) => p.id === resolvedModel.providerId,
      );
      const envVarName = providerInfo?.envVarName;
      candidateProviders.add(providerInfo?.name ?? resolvedModel.providerId);

      const apiKey = getProviderApiKeyForRequest(
        settings.providerSettings?.[resolvedModel.providerId]?.apiKey?.value ||
          (envVarName ? getEnvVar(envVarName) : undefined),
        providerInfo?.name ?? resolvedModel.providerId,
      );

      if (apiKey) {
        logger.log(
          `Using provider: ${resolvedModel.providerId} model: ${resolvedModel.apiName}`,
        );
        if (resolvedModel.providerId === "openrouter" && providerInfo) {
          return {
            modelClient: getOpenRouterAutoFallbackModelClient({
              primaryModelName: resolvedModel.apiName,
              settings,
              providerConfig: providerInfo,
            }),
            runtimeModel: {
              provider: resolvedModel.providerId,
              name: resolvedModel.apiName,
            },
            isEngineEnabled: false,
          };
        }
        // Recursively call with the specific model found
        return await getModelClient(
          {
            provider: resolvedModel.providerId,
            name: resolvedModel.apiName,
            ...(connection ? { connection } : {}),
          },
          settings,
          {
            ...modelSelection,
            provider: resolvedModel.providerId,
            name: resolvedModel.apiName,
          },
          context,
        );
      }
    }
    // If no models have API keys, throw an error
    throw new DyadError(
      `No API key is available for ${model.name === AUTO_BALANCED_MODEL_NAME ? "Auto (balanced)" : "Auto"}. Configure an API key for ${[...candidateProviders].join(" or ") || "a supported provider"} in Settings.`,
      DyadErrorKind.Validation,
    );
  }
  const regular = getRegularModelClient(model, settings, providerConfig);
  return {
    ...regular,
    runtimeModel: model,
    isEngineEnabled: false,
  };
}

function getOpenRouterAutoFallbackModelClient({
  primaryModelName,
  settings,
  providerConfig,
}: {
  primaryModelName: string;
  settings: UserSettings;
  providerConfig: LanguageModelProvider;
}): ModelClient {
  const modelNames = Array.from(
    new Set([primaryModelName, OPENROUTER_FREE_MODEL_NAME]),
  );

  return {
    model: createFallback({
      models: modelNames.map(
        (name) =>
          getRegularModelClient(
            { provider: "openrouter", name },
            settings,
            providerConfig,
          ).modelClient.model,
      ),
    }),
    builtinProviderId: "openrouter",
  };
}

function getRegularModelClient(
  model: LargeLanguageModel,
  settings: UserSettings,
  providerConfig: LanguageModelProvider,
  includeUsage = false,
): {
  modelClient: ModelClient;
  backupModelClients: ModelClient[];
} {
  const providerId = providerConfig.id;
  // Get API key for the specific provider. Azure is handled in its own branch
  // because it has additional config and test-mode bypass behavior.
  const apiKey =
    providerId === "azure"
      ? undefined
      : getProviderApiKeyForRequest(
          settings.providerSettings?.[model.provider]?.apiKey?.value ||
            (providerConfig.envVarName
              ? getEnvVar(providerConfig.envVarName)
              : undefined),
          providerConfig.name ?? providerConfig.id,
        );
  // Create client based on provider ID or type
  switch (providerId) {
    case "openai": {
      const provider = createOpenAI({
        apiKey,
        ...getModelClientFetchOption(),
      });
      return {
        modelClient: {
          model: provider.responses(model.name),
          builtinProviderId: providerId,
        },
        backupModelClients: [],
      };
    }
    case "anthropic": {
      const provider = createAnthropic({
        apiKey,
        fetch: withAnthropicPreservedThinking(
          getModelClientFetchOption().fetch,
        ),
      });
      return {
        modelClient: {
          model: provider(model.name),
          builtinProviderId: providerId,
        },
        backupModelClients: [],
      };
    }
    case "xai": {
      const provider = createXai({
        apiKey,
        ...getModelClientFetchOption(),
      });
      return {
        modelClient: {
          model: provider(model.name),
          builtinProviderId: providerId,
        },
        backupModelClients: [],
      };
    }
    case "google": {
      const provider = createGoogle({
        apiKey,
        ...getModelClientFetchOption(),
      });
      return {
        modelClient: {
          model: provider(model.name),
          builtinProviderId: providerId,
        },
        backupModelClients: [],
      };
    }
    case "vertex": {
      // Vertex uses Google service account credentials with project/location
      const vertexSettings = settings.providerSettings?.[
        model.provider
      ] as VertexProviderSetting;
      const project = vertexSettings?.projectId;
      const location = vertexSettings?.location;
      const serviceAccountKey = vertexSettings?.serviceAccountKey?.value;

      // Use a baseURL that does NOT pin to publishers/google so that
      // full publisher model IDs (e.g. publishers/deepseek-ai/models/...) work.
      const regionHost = `${location === "global" ? "" : `${location}-`}aiplatform.googleapis.com`;
      const baseURL = `https://${regionHost}/v1/projects/${project}/locations/${location}`;
      const provider = createGoogleVertex({
        project,
        location,
        baseURL,
        ...getModelClientFetchOption(),
        googleAuthOptions: serviceAccountKey
          ? {
              // Expecting the user to paste the full JSON of the service account key
              credentials: JSON.parse(serviceAccountKey),
            }
          : undefined,
      });
      return {
        modelClient: {
          // For built-in Google models on Vertex, the path must include
          // publishers/google/models/<model>. For partner MaaS models the
          // full publisher path is already included.
          model: provider(
            model.name.includes("/")
              ? model.name
              : `publishers/google/models/${model.name}`,
          ),
          builtinProviderId: providerId,
        },
        backupModelClients: [],
      };
    }
    case "openrouter": {
      const provider = createOpenAICompatible({
        name: "openrouter",
        includeUsage,
        baseURL: "https://openrouter.ai/api/v1",
        apiKey,
        headers: getOpenRouterAppAttributionHeaders(),
        ...getModelClientFetchOption(),
      });
      return {
        modelClient: {
          model: provider(model.name),
          builtinProviderId: providerId,
        },
        backupModelClients: [],
      };
    }
    case "azure": {
      // Check if we're in e2e testing mode
      const testAzureBaseUrl = getEnvVar("TEST_AZURE_BASE_URL");

      if (testAzureBaseUrl) {
        // Use fake server for e2e testing
        logger.info(`Using test Azure base URL: ${testAzureBaseUrl}`);
        const provider = createOpenAICompatible({
          name: "azure-test",
          includeUsage,
          baseURL: testAzureBaseUrl,
          apiKey: "fake-api-key-for-testing",
          ...getModelClientFetchOption(),
        });
        return {
          modelClient: {
            model: provider(model.name),
            builtinProviderId: providerId,
          },
          backupModelClients: [],
        };
      }

      const azureSettings = settings.providerSettings?.azure as
        | AzureProviderSetting
        | undefined;
      const azureApiKeyFromSettings = normalizeProviderApiKeyInput(
        azureSettings?.apiKey?.value,
      );
      const azureResourceNameFromSettings = (
        azureSettings?.resourceName ?? ""
      ).trim();
      const envResourceName = (getEnvVar("AZURE_RESOURCE_NAME") ?? "").trim();
      const envAzureApiKey = normalizeProviderApiKeyInput(
        getEnvVar("AZURE_API_KEY"),
      );

      const resourceName = azureResourceNameFromSettings || envResourceName;
      const azureApiKey = getProviderApiKeyForRequest(
        azureApiKeyFromSettings || envAzureApiKey,
        providerConfig.name ?? providerConfig.id,
      );

      if (!resourceName) {
        throw new Error(
          "Azure OpenAI resource name is required. Provide it in Settings or set the AZURE_RESOURCE_NAME environment variable.",
        );
      }

      if (!azureApiKey) {
        throw new Error(
          "Azure OpenAI API key is required. Provide it in Settings or set the AZURE_API_KEY environment variable.",
        );
      }

      const provider = createAzure({
        resourceName,
        apiKey: azureApiKey,
        ...getModelClientFetchOption(),
      });

      return {
        modelClient: {
          model: provider(model.name),
          builtinProviderId: providerId,
          reasoningEffortProviderId: "azure",
        },
        backupModelClients: [],
      };
    }
    case "ollama": {
      const provider = createOllamaProvider({
        baseURL: getOllamaApiUrl(),
        includeUsage,
        ...getModelClientFetchOption(),
      });
      return {
        modelClient: {
          model: provider(model.name),
          builtinProviderId: providerId,
          reasoningEffortProviderId: "ollama",
        },
        backupModelClients: [],
      };
    }
    case "lmstudio": {
      // LM Studio uses OpenAI compatible API
      const baseURL = providerConfig.apiBaseUrl || getLmStudioBaseUrl() + "/v1";
      const provider = createOpenAICompatible({
        name: "lmstudio",
        includeUsage,
        baseURL,
        ...getModelClientFetchOption(),
      });
      return {
        modelClient: {
          model: provider(model.name),
          builtinProviderId: providerId,
          reasoningEffortProviderId: "lmstudio",
        },
        backupModelClients: [],
      };
    }
    case "bedrock": {
      // AWS Bedrock supports API key authentication using AWS_BEARER_TOKEN_BEDROCK
      // See: https://sdk.vercel.ai/providers/ai-sdk-providers/amazon-bedrock#api-key-authentication
      const provider = createAmazonBedrock({
        apiKey: apiKey,
        region: getEnvVar("AWS_REGION") || "us-east-1",
        ...getModelClientFetchOption(),
      });
      return {
        modelClient: {
          model: provider(model.name),
          builtinProviderId: providerId,
        },
        backupModelClients: [],
      };
    }
    case "minimax": {
      const provider = createOpenAICompatible({
        name: "minimax",
        includeUsage,
        baseURL: "https://api.minimax.io/v1",
        apiKey,
        ...getModelClientFetchOption(),
      });
      return {
        modelClient: {
          model: provider(model.name),
          builtinProviderId: providerId,
        },
        backupModelClients: [],
      };
    }
    default: {
      // Handle custom providers
      if (providerConfig.type === "custom") {
        if (!providerConfig.apiBaseUrl) {
          throw new Error(
            `Custom provider ${model.provider} is missing the API Base URL.`,
          );
        }
        // Assume custom providers are OpenAI compatible for now
        const provider = createOpenAICompatible({
          name: providerConfig.id,
          includeUsage,
          baseURL: providerConfig.apiBaseUrl,
          apiKey,
          ...getModelClientFetchOption(),
        });
        return {
          modelClient: {
            model: provider(model.name),
            builtinProviderId: providerConfig.id,
            reasoningEffortProviderId: providerConfig.id,
          },
          backupModelClients: [],
        };
      }
      // If it's not a known ID and not type 'custom', it's unsupported
      throw new DyadError(
        `Unsupported model provider: ${model.provider}`,
        DyadErrorKind.Validation,
      );
    }
  }
}

function getProviderApiKeyForRequest(
  value: string | null | undefined,
  providerDisplayName: string,
): string | undefined {
  const normalizedValue = normalizeProviderApiKeyInput(value);
  if (!normalizedValue) {
    return undefined;
  }
  const invalidCharacter = findInvalidProviderApiKeyCharacter(normalizedValue);
  if (invalidCharacter) {
    throw new DyadError(
      formatInvalidProviderApiKeyMessage(providerDisplayName, invalidCharacter),
      DyadErrorKind.Validation,
    );
  }
  return normalizedValue;
}
