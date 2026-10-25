import nodeFetch from "node-fetch";
import {
  assertDyadCloudAllowed,
  isDyadCloudAllowed,
} from "./dyad_cloud_policy";

/** Legacy node-fetch users do not pass through globalThis.fetch.
 * These are API/signed-upload requests, not general browser navigation: require
 * canonical URLs instead of following an unchecked redirect in provider-only mode.
 */
const providerOnlyLegacyFetch = (
  input: Parameters<typeof nodeFetch>[0],
  init?: Parameters<typeof nodeFetch>[1],
): ReturnType<typeof nodeFetch> => {
  const url =
    typeof input === "string" ? input : "url" in input ? input.url : input.href;
  assertDyadCloudAllowed(url);
  return nodeFetch(
    input,
    isDyadCloudAllowed()
      ? init
      : {
          ...init,
          redirect: init?.redirect === "manual" ? "manual" : "error",
        },
  );
};
export default providerOnlyLegacyFetch;
