import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

const logMocks = vi.hoisted(() => ({
  scope: vi.fn(() => ({
    warn: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  })),
}));

vi.mock("electron-log", () => ({
  default: {
    scope: (...args: unknown[]) => logMocks.scope(...(args as [])),
  },
}));

import {
  addPreventionRule,
  buildPreventionPromptBlock,
  getPreventionPath,
  loadPreventionRules,
} from "./prevention";

const tempDirs: string[] = [];

async function makeAppPath(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "dyad-prevention-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(
    tempDirs
      .splice(0)
      .map((dir) => fs.rm(dir, { recursive: true, force: true })),
  );
});

describe("buildPreventionPromptBlock", () => {
  it("returns an empty string when there are no rules", async () => {
    const appPath = await makeAppPath();
    await expect(buildPreventionPromptBlock(appPath)).resolves.toBe("");
  });

  it("renders the rule text and the source signature", async () => {
    const appPath = await makeAppPath();
    await addPreventionRule(appPath, {
      title: "Resolve app-relative paths",
      rule: "List the directory and re-resolve; never repeat the same path.",
      sourceSignature: "read_file|not_found|path:.ts|<path>",
      occurrences: 3,
    });

    const block = await buildPreventionPromptBlock(appPath);
    expect(block).toContain("Resolve app-relative paths");
    expect(block).toContain("never repeat the same path");
    expect(block).toContain("read_file|not_found|path:.ts|<path>");
    expect(block).toContain("seen 3x");
  });

  it("renders at most the 20 most recent rules", async () => {
    const appPath = await makeAppPath();
    for (let index = 0; index < 25; index++) {
      await addPreventionRule(appPath, {
        title: `Rule ${index}`,
        rule: `Do not repeat failure ${index}.`,
        sourceSignature: `sig-${index}`,
        occurrences: 1,
      });
    }
    const block = await buildPreventionPromptBlock(appPath);
    const rendered = block
      .split("\n")
      .filter((line) => line.startsWith("- Rule "));
    expect(rendered).toHaveLength(20);
    // The newest rules win.
    expect(block).toContain("- Rule 24:");
    expect(block).not.toContain("- Rule 0:");
  });
});

describe("addPreventionRule", () => {
  it("stores the rule under .dyad/self-heal", async () => {
    const appPath = await makeAppPath();
    const created = await addPreventionRule(appPath, {
      title: "Never repeat a failed call",
      rule: "Change the input before retrying.",
      sourceSignature: "sig-1",
    });
    expect(created.id).toBe("never-repeat-a-failed-call");
    expect(getPreventionPath(appPath)).toBe(
      path.join(appPath, ".dyad", "self-heal", "prevention.json"),
    );
    const raw = JSON.parse(
      await fs.readFile(getPreventionPath(appPath), "utf-8"),
    );
    expect(raw.version).toBe(1);
    expect(raw.rules).toHaveLength(1);
  });

  it("refreshes the rule for the same source signature instead of duplicating it", async () => {
    const appPath = await makeAppPath();
    await addPreventionRule(appPath, {
      title: "Rule A",
      rule: "First wording.",
      sourceSignature: "sig-1",
      occurrences: 1,
    });
    await addPreventionRule(appPath, {
      title: "Rule A",
      rule: "Second wording.",
      sourceSignature: "sig-1",
      occurrences: 4,
    });
    const rules = await loadPreventionRules(appPath);
    expect(rules).toHaveLength(1);
    expect(rules[0].rule).toBe("Second wording.");
    expect(rules[0].occurrences).toBe(4);
  });

  it("gives colliding titles distinct ids", async () => {
    const appPath = await makeAppPath();
    const first = await addPreventionRule(appPath, {
      title: "Same title",
      rule: "one",
      sourceSignature: "sig-1",
    });
    const second = await addPreventionRule(appPath, {
      title: "Same title",
      rule: "two",
      sourceSignature: "sig-2",
    });
    expect(first.id).toBe("same-title");
    expect(second.id).toBe("same-title-2");
  });
});

describe("loadPreventionRules", () => {
  it("returns no rules for a corrupt file", async () => {
    const appPath = await makeAppPath();
    await fs.mkdir(path.join(appPath, ".dyad", "self-heal"), {
      recursive: true,
    });
    await fs.writeFile(getPreventionPath(appPath), "not json", "utf-8");
    await expect(loadPreventionRules(appPath)).resolves.toEqual([]);
  });
});
