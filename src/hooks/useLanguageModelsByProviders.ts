import { rankModelCatalog } from "@/lib/modelCatalogPolicy";
import { useQuery } from "@tanstack/react-query";
import { ipc, type LanguageModel } from "@/ipc/types";
import { queryKeys } from "@/lib/queryKeys";

/**
 * Fetches all available language models grouped by their provider IDs.
 *
 * @returns TanStack Query result object for the language models organized by provider.
 */
export function useLanguageModelsByProviders() {
  return useQuery<Record<string, LanguageModel[]>, Error>({
    queryKey: queryKeys.languageModels.byProviders,
    staleTime: 60_000,
    refetchInterval: 5 * 60_000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    retry: 2,
    queryFn: async () => {
      return rankModelCatalog(await ipc.languageModel.getModelsByProviders());
    },
  });
}
