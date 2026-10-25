import { assertDyadCloudAllowed } from "@/main/dyad_cloud_policy";

export function getDyadEngineBaseUrl(): string {
  const url = process.env.DYAD_ENGINE_URL ?? "https://engine.dyad.sh/v1";
  assertDyadCloudAllowed(url);
  return url;
}
