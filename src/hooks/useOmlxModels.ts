import { useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { ipc, type LocalModel } from "@/ipc/types";
import { queryKeys } from "@/lib/queryKeys";

export function useOmlxModels() {
  const { data, isFetching, error, refetch } = useQuery<LocalModel[], Error>({
    queryKey: queryKeys.languageModels.omlxLocal,
    queryFn: async () => {
      const { models } = await ipc.languageModel.listOmlxModels();
      return models;
    },
    enabled: false,
  });

  const loadModels = useCallback(async () => {
    const result = await refetch();
    if (result.error) {
      console.error("Error loading local oMLX models:", result.error);
      return [];
    }
    return result.data ?? [];
  }, [refetch]);

  return {
    models: data ?? [],
    loading: isFetching,
    error: error ?? null,
    loadModels,
  };
}
