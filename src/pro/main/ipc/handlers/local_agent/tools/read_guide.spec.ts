import { describe, expect, it, vi } from "vitest";
import { readSettings } from "@/main/settings";
import type { UserSettings } from "@/lib/schemas";
import type { AgentContext } from "./types";
import { readGuideTool } from "./read_guide";

vi.mock("@/main/settings", () => ({
  readSettings: vi.fn(),
}));

describe("readGuideTool", () => {
  it.each(["nextjs", "vite-nitro", null] as const)(
    "loads custom Supabase fixture guidance for %s",
    async (frameworkType) => {
      vi.mocked(readSettings).mockReturnValue({} as UserSettings);
      const guide = await readGuideTool.execute(
        { guide: "custom-supabase-test-fixtures" },
        { frameworkType } as AgentContext,
      );

      expect(guide).toContain("process.env.SUPABASE_SECRET_KEY");
      expect(guide).toContain("supabase.auth.admin.createUser");
      expect(guide).toContain("test.beforeEach");
      expect(guide).toContain("test.afterEach");
      expect(guide).toContain("attempt all remaining cleanup");
      expect(guide).not.toContain("${");
    },
  );

  it.each([true, false, undefined])(
    "uses the preview domains setting (%s) for authentication guidance",
    async (enableAppPreviewDomains) => {
      vi.mocked(readSettings).mockReturnValue({
        enableAppPreviewDomains,
      } as UserSettings);

      const guide = await readGuideTool.execute(
        { guide: "add-authentication" },
        { frameworkType: "vite-nitro" } as AgentContext,
      );

      expect(guide.includes("app-<numeric app ID>.localhost")).toBe(
        enableAppPreviewDomains === true,
      );
      expect(guide.includes("shared cookies across ports")).toBe(
        enableAppPreviewDomains !== true,
      );
      expect(guide).not.toContain("[[PREVIEW_COOKIE_GUIDANCE]]");
      expect(guide).not.toContain("Path: Neon Auth API (Next.js)");
      expect(guide).toContain("MUST be discarded unconditionally");
      expect(guide).toContain("forward at most the first occurrence");
    },
  );

  it("omits Nitro preview guidance for Next.js", async () => {
    vi.mocked(readSettings).mockReturnValue({
      enableAppPreviewDomains: true,
    } as UserSettings);

    const guide = await readGuideTool.execute({ guide: "add-authentication" }, {
      frameworkType: "nextjs",
    } as AgentContext);

    expect(guide).toContain("Path: Neon Auth API (Next.js)");
    expect(guide).not.toContain("Path: Neon Auth (Vite + Nitro)");
    expect(guide).not.toContain("app-<numeric app ID>.localhost");
    expect(guide).not.toContain("[[PREVIEW_COOKIE_GUIDANCE]]");
  });
});

describe("framework and Context7 guides", () => {
  const titles = [
    ["framework-rust", "# Rust application engineering"],
    ["framework-svelte", "# Svelte and SvelteKit application engineering"],
    ["framework-flutter", "# Flutter and Dart application engineering"],
    ["framework-tauri", "# Tauri desktop migration and security"],
    [
      "framework-selection",
      "# Technology selection: evidence, not framework hype",
    ],
    ["context7-reference", "# Context7 reference retrieval"],
    ["ui-registries", "# Six-source React UI registries"],
  ];
  it.each(titles)(
    "loads %s independently of web-framework filters/settings",
    async (guide, title) => {
      vi.mocked(readSettings).mockClear();
      for (const frameworkType of [
        "nextjs",
        "vite",
        "vite-nitro",
        null,
      ] as const) {
        const content = await readGuideTool.execute({ guide }, {
          frameworkType,
        } as AgentContext);
        expect(content).toContain(title);
        expect(content).toContain("https://context7.com/");
      }
      expect(readSettings).not.toHaveBeenCalled();
    },
  );
  it("records redirects, stale results and separate research/app reachability", async () => {
    const content = await readGuideTool.execute(
      { guide: "context7-reference" },
      {} as AgentContext,
    );
    for (const term of [
      "SSL_ERROR_SYSCALL",
      "/flutter/website",
      "legacy example",
      "untrusted data",
      "Never send private source",
      "not an enforceable response-size ceiling",
      "does NOT certify reachability",
    ])
      expect(content).toContain(term);
  });
  it.each(["__proto__", "constructor", "toString", "missing-guide"])(
    "rejects unknown guide %s",
    async (guide) => {
      await expect(
        readGuideTool.execute({ guide }, {} as AgentContext),
      ).rejects.toThrow("not found");
    },
  );
});
