import { describe, expect, it } from "vitest";
import { redactSecretsForRenderer } from "../redact_settings";

/**
 * Regression guard for the credential-exposure finding: decrypted secrets must
 * never cross the IPC boundary into the renderer. The renderer only needs to
 * know whether a key is configured.
 */
describe("redactSecretsForRenderer", () => {
  it("removes provider API key values but records that they are set", () => {
    const settings = {
      providerSettings: {
        anthropic: {
          apiKey: { value: "sk-ant-CANARY", encryptionType: "dyad-file-key" },
        },
      },
    };

    const out = redactSecretsForRenderer(settings);

    expect(JSON.stringify(out)).not.toContain("sk-ant-CANARY");
    expect(
      out.providerSettings.anthropic.apiKey.value,
    ).toBe("");
    expect(out.providerSettings.anthropic.apiKey.isSet).toBe(true);
  });

  it("keeps non-secret settings untouched", () => {
    const settings = {
      enableAgent2: true,
      selectedModel: { name: "stealth/space-bunny-alpha", provider: "kilocode" },
      recentModels: [{ name: "a", provider: "openrouter" }],
      zoom: 1.25,
    };
    expect(redactSecretsForRenderer(settings)).toEqual(settings);
  });

  it("redacts tokens and passwords anywhere in the tree", () => {
    const settings = {
      githubAccessToken: { value: "ghp-CANARY" },
      providerSettings: {
        coolify: { adminPassword: { value: "pw-CANARY" } },
        supabase: {
          organizations: [
            { accessToken: { value: "sb-CANARY" } },
            { accessToken: { value: "sb-CANARY-2" } },
          ],
        },
      },
    };

    const out = redactSecretsForRenderer(settings);
    const serialised = JSON.stringify(out);

    for (const canary of ["ghp-CANARY", "pw-CANARY", "sb-CANARY-2"]) {
      expect(serialised).not.toContain(canary);
    }
    expect(out.githubAccessToken.isSet).toBe(true);
    expect(
      out.providerSettings.supabase.organizations.every(
        (org) => org.accessToken.isSet,
      ),
    ).toBe(true);
  });

  it("reports isSet false for an empty secret", () => {
    const out = redactSecretsForRenderer({
      providerSettings: { openai: { apiKey: { value: "" } } },
    });
    expect(out.providerSettings.openai.apiKey.isSet).toBe(false);
  });

  it("terminates on a self-referential object instead of overflowing", () => {
    const cyclic: Record<string, unknown> = { nested: {} };
    (cyclic.nested as Record<string, unknown>).self = cyclic;
    // Settings come from JSON and cannot cycle, but a stack overflow here
    // would take down the whole main process, so termination is worth pinning.
    expect(() =>
      redactSecretsForRenderer({ providerSettings: { x: cyclic } }),
    ).not.toThrow();
  });
});
