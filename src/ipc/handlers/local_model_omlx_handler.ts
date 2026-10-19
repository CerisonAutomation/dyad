import log from "electron-log";
import { getOmlxBaseUrl } from "../utils/omlx_utils";
import { createTypedHandler } from "./base";
import { languageModelContracts } from "../types/language-model";
import type { LocalModel } from "../types/language-model";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";

const logger = log.scope("omlx_handler");

interface OmlxModel {
  id: string;
  object: string;
}

export async function fetchOmlxModels(): Promise<{ models: LocalModel[] }> {
  const modelsResponse: Response = await fetch(`${getOmlxBaseUrl()}/v1/models`);
  if (!modelsResponse.ok) {
    throw new DyadError(
      "Failed to fetch models from oMLX",
      DyadErrorKind.External,
    );
  }
  const modelsJson = await modelsResponse.json();
  const servedModels = modelsJson.data as OmlxModel[];
  const models: LocalModel[] = servedModels.map((model) => ({
    modelName: model.id,
    displayName: model.id,
    provider: "omlx",
  }));

  logger.info(`Successfully fetched ${models.length} models from oMLX`);
  return { models };
}

export function registerOmlxHandlers() {
  createTypedHandler(languageModelContracts.listOmlxModels, async () => {
    return fetchOmlxModels();
  });
}
