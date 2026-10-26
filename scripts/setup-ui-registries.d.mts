export function mergeUiRegistries<T>(config: T): {
  config: T & { registries: Record<string, unknown> };
  preserved: string[];
};
export function setupUiRegistries(
  cwd: string,
  options?: { check?: boolean },
): {
  changed: boolean;
  preserved: string[];
  registries: Record<string, unknown>;
};
