import { describe, expect, it } from "vitest";
import { shouldShowCloudSandboxOption } from "./RuntimeModeSelector";

describe("shouldShowCloudSandboxOption", () => {
  it("hides cloud sandbox when the experiment is off and cloud is not active", () => {
    expect(
      shouldShowCloudSandboxOption({
        runtimeMode: "host",
        cloudSandboxExperimentEnabled: false,
      }),
    ).toBe(false);
  });

  it("keeps the retired cloud sandbox hidden even when the experiment is enabled", () => {
    expect(
      shouldShowCloudSandboxOption({
        runtimeMode: "host",
        cloudSandboxExperimentEnabled: true,
      }),
    ).toBe(false);
  });

  it("keeps the retired cloud sandbox hidden for saved legacy cloud settings", () => {
    expect(
      shouldShowCloudSandboxOption({
        runtimeMode: "cloud",
        cloudSandboxExperimentEnabled: false,
      }),
    ).toBe(false);
  });
});
