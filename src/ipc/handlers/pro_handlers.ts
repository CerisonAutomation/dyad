import { shell } from "electron";
import log from "electron-log";
import { createLoggedHandler } from "./safe_handle";
import { createLoggedTypedHandler } from "./base";
import { readSettings } from "../../main/settings"; // Assuming settings are read this way
import { systemContracts, UserBudgetInfo } from "@/ipc/types";
import { IS_TEST_BUILD } from "../utils/test_utils";
import {
  AUDIO_REQUEST_ID_PATTERN,
  audioContracts,
  MAX_AUDIO_FILENAME_LENGTH,
  MAX_AUDIO_RECORDING_BYTES,
  MAX_AUDIO_REQUEST_ID_LENGTH,
} from "../types/audio";
import type { TranscribeAudioParams } from "../types/audio";
import { transcribeWithDyadEngine } from "../utils/llm_engine_provider";
import { getDyadEngineBaseUrl } from "../utils/dyad_engine_url";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";

export {
  UserInfoResponseSchema,
  type UserInfoResponse,
} from "../services/user_budget_service";

const logger = log.scope("pro_handlers");
const handle = createLoggedHandler(logger);
const typedHandle = createLoggedTypedHandler(logger);

function validateAudioTranscriptionRequest(input: TranscribeAudioParams) {
  if (
    input.audioData.byteLength === 0 ||
    input.audioData.byteLength > MAX_AUDIO_RECORDING_BYTES
  ) {
    throw new DyadError(
      `Audio data must be between 1 and ${MAX_AUDIO_RECORDING_BYTES} bytes`,
      DyadErrorKind.Validation,
    );
  }

  const trimmedFilename = input.filename.trim();
  if (
    trimmedFilename.length === 0 ||
    trimmedFilename.length > MAX_AUDIO_FILENAME_LENGTH ||
    trimmedFilename.includes("/") ||
    trimmedFilename.includes("\\") ||
    trimmedFilename === "." ||
    trimmedFilename === ".."
  ) {
    throw new DyadError("Invalid audio filename", DyadErrorKind.Validation);
  }

  if (
    input.requestId.trim().length === 0 ||
    input.requestId.length > MAX_AUDIO_REQUEST_ID_LENGTH ||
    !AUDIO_REQUEST_ID_PATTERN.test(input.requestId)
  ) {
    throw new DyadError(
      "Invalid transcription request ID",
      DyadErrorKind.Validation,
    );
  }
}

export function parseBillingActionUrl(value: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new DyadError("Invalid billing action URL", DyadErrorKind.Validation);
  }
  if (
    url.protocol !== "https:" ||
    url.hostname !== "academy.dyad.sh" ||
    url.username !== "" ||
    url.password !== "" ||
    url.port !== ""
  ) {
    throw new DyadError("Invalid billing action URL", DyadErrorKind.Validation);
  }
  return url.toString();
}

export function registerProHandlers() {
  // This method should try to avoid throwing errors because this is auxiliary
  // information and isn't critical to using the app
  handle("get-user-budget", async (): Promise<UserBudgetInfo | null> => {
    // Agent2 runs on the user's own provider credentials, so there is no
    // Dyad-side budget to read. Report a permanent zero-used allowance
    // locally instead of calling the hosted service, which keeps every
    // downstream quota check satisfied without a network round trip.
    const budgetResetDate = new Date();
    budgetResetDate.setFullYear(budgetResetDate.getFullYear() + 100);
    return {
      usedCredits: 0,
      totalCredits: 0,
      budgetResetDate,
      redactedUserId: "<local-byok>",
      isTrial: false,
    };
  });

  typedHandle(systemContracts.getSubscriptionStatus, async () => {
    // No hosted subscription service: Agent2 always runs on the user's own
    // provider keys, so there is no remote entitlement to read.
    return null;
  });

  typedHandle(systemContracts.openBillingAction, async (_event, value) => {
    const url = parseBillingActionUrl(value);
    if (IS_TEST_BUILD) {
      logger.debug("E2E test mode: skipped opening billing action URL", url);
      return;
    }
    await shell.openExternal(url);
  });

  typedHandle(
    audioContracts.transcribeAudio,
    async (_event, input: TranscribeAudioParams) => {
      const settings = readSettings();
      const apiKey = settings.providerSettings?.auto?.apiKey?.value;

      if (!apiKey || !settings.enableDyadPro) {
        throw new DyadError(
          "Dyad Pro is not enabled. Voice-to-text requires a Pro subscription.",
          DyadErrorKind.Auth,
        );
      }

      validateAudioTranscriptionRequest(input);

      const audioBuffer = Buffer.from(
        input.audioData.buffer,
        input.audioData.byteOffset,
        input.audioData.byteLength,
      );

      const text = await transcribeWithDyadEngine(
        audioBuffer,
        input.filename,
        input.requestId,
        {
          apiKey,
          baseURL: getDyadEngineBaseUrl(),
          dyadOptions: {},
          settings,
        },
      );

      return { text };
    },
  );
}
