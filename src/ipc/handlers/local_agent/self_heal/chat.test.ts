import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

// The Drizzle store is never used in this test: the chat is persisted through
// the injected store, so no database is needed.
vi.mock("@/db", () => ({ db: {} }));

import {
  ARCHITECT_ROLE_BLOCK,
  RESEARCH_CONTRACT_BLOCK,
  SELF_IMPROVE_APP_NAME,
  SELF_IMPROVE_CHAT_MODE,
  SELF_IMPROVE_CHAT_TITLE,
  assertDyadSourceRoot,
  buildSelfImproveRunPrompt,
  buildSelfImproveSystemPrompt,
  ensureSelfImproveChat,
  isSelfImproveAppName,
  isSelfImproveChatTitle,
  resolveDyadSourceRoot,
  type SelfImproveChatStore,
} from "./chat";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import type { PreventionRule } from "./types";

const preventionRules: PreventionRule[] = [
  {
    id: "read-file-app-relative-path",
    title: "Resolve app-relative paths before reporting a missing file",
    rule: "When a path is not found, list the directory and re-resolve.",
    createdAt: 1,
    sourceSignature: "read_file|NotFound|path:.ts|not found",
    occurrences: 3,
  },
];

function createFakeStore(): SelfImproveChatStore & {
  apps: { id: number; name: string; path: string; isFavorite: boolean }[];
  chats: {
    id: number;
    appId: number;
    title: string;
    chatMode: string;
    isFavorite: boolean;
  }[];
} {
  const apps: {
    id: number;
    name: string;
    path: string;
    isFavorite: boolean;
  }[] = [];
  const chats: {
    id: number;
    appId: number;
    title: string;
    chatMode: string;
    isFavorite: boolean;
  }[] = [];
  let nextAppId = 1;
  let nextChatId = 1;

  return {
    apps,
    chats,
    async findAppByName(name) {
      const row = apps.find((app) => app.name === name);
      return row ? { id: row.id, path: row.path } : undefined;
    },
    async insertApp(app) {
      const id = nextAppId++;
      apps.push({ id, ...app });
      return { id };
    },
    async updateAppPath(appId, path) {
      const row = apps.find((app) => app.id === appId);
      if (row) row.path = path;
    },
    async findChatByTitle(appId, title) {
      const row = chats.find(
        (chat) => chat.appId === appId && chat.title === title,
      );
      if (!row) return undefined;
      return { id: row.id, isFavorite: row.isFavorite };
    },
    async insertChat(chat) {
      const id = nextChatId++;
      chats.push({ id, ...chat });
      return { id };
    },
    async setChatFavorite(chatId, isFavorite) {
      const row = chats.find((chat) => chat.id === chatId);
      if (row) row.isFavorite = isFavorite;
    },
  };
}

describe("self-improvement identifiers", () => {
  it("recognises the app and the chat", () => {
    expect(isSelfImproveAppName(SELF_IMPROVE_APP_NAME)).toBe(true);
    expect(isSelfImproveAppName("My app")).toBe(false);
    expect(isSelfImproveChatTitle(SELF_IMPROVE_CHAT_TITLE)).toBe(true);
    expect(isSelfImproveChatTitle(null)).toBe(false);
  });

  it("marks the chat as the always-open one through its title", () => {
    expect(SELF_IMPROVE_CHAT_TITLE).toContain("always open");
  });
});

describe("resolveDyadSourceRoot", () => {
  it("honours the environment override", () => {
    expect(
      resolveDyadSourceRoot({ DYAD_SOURCE_ROOT: "/tmp/dyad-checkout" }),
    ).toBe(path.resolve("/tmp/dyad-checkout"));
  });

  it("defaults to the running checkout", () => {
    const root = resolveDyadSourceRoot({});
    expect(fs.existsSync(path.join(root, "package.json"))).toBe(true);
  });
});

describe("assertDyadSourceRoot", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "dyad-source-root-"));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("accepts a Dyad checkout", () => {
    fs.writeFileSync(path.join(tempDir, "package.json"), "{}");
    expect(() => assertDyadSourceRoot(tempDir)).not.toThrow();
  });

  it("rejects a directory that is not a checkout", () => {
    expect(() => assertDyadSourceRoot(tempDir)).toThrow(DyadError);
  });

  it("rejects a missing directory", () => {
    expect(() => assertDyadSourceRoot(path.join(tempDir, "nope"))).toThrow(
      DyadError,
    );
  });

  it("throws a precondition error", () => {
    try {
      assertDyadSourceRoot(tempDir);
      throw new Error("expected a rejection");
    } catch (error) {
      expect(error).toBeInstanceOf(DyadError);
      expect((error as DyadError).kind).toBe(DyadErrorKind.Precondition);
    }
  });
});

describe("buildSelfImproveSystemPrompt", () => {
  it("is plan-only and states the research contract", () => {
    const prompt = buildSelfImproveSystemPrompt({
      appPath: "/tmp/dyad",
      preventionRules,
    });
    expect(prompt).toContain("PLAN ONLY");
    expect(prompt).toContain("REPRODUCTION TEST");
    expect(prompt).toContain("IMPLEMENTER");
    expect(prompt).toContain("resolve-library-id");
    expect(prompt).toContain("VERSION-PINNED");
    expect(prompt).toContain("CODE EXAMPLES");
    expect(prompt).toContain("ONE concept per call");
  });

  it("carries the scope and the prevention rules", () => {
    const prompt = buildSelfImproveSystemPrompt({
      appPath: "/tmp/dyad",
      preventionRules,
    });
    expect(prompt).toContain("/tmp/dyad");
    expect(prompt).toContain(
      "Resolve app-relative paths before reporting a missing file",
    );
    expect(prompt).toContain(ARCHITECT_ROLE_BLOCK);
    expect(prompt).toContain(RESEARCH_CONTRACT_BLOCK);
  });
});

describe("buildSelfImproveRunPrompt", () => {
  it("works on the first open class only", () => {
    const prompt = buildSelfImproveRunPrompt({
      openSignatures: ["read_file|not-found", "write_file|denied"],
    });
    expect(prompt).toContain("read_file|not-found");
    expect(prompt).toContain("FIRST class only");
  });

  it("says there is nothing to do when the ledger is empty", () => {
    const prompt = buildSelfImproveRunPrompt({ openSignatures: [] });
    expect(prompt).toContain("no open failure classes");
  });
});

describe("ensureSelfImproveChat", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "dyad-self-heal-"));
    fs.writeFileSync(path.join(tempDir, "package.json"), "{}");
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("creates the synthetic app and the pinned chat on first use", async () => {
    const store = createFakeStore();
    const ref = await ensureSelfImproveChat({ store, dyadRoot: tempDir });

    expect(ref.appPath).toBe(tempDir);
    expect(ref.created).toBe(true);
    expect(store.apps).toHaveLength(1);
    expect(store.apps[0].name).toBe(SELF_IMPROVE_APP_NAME);
    expect(store.apps[0].path).toBe(tempDir);
    expect(store.apps[0].isFavorite).toBe(true);
    expect(store.chats).toHaveLength(1);
    expect(store.chats[0].title).toBe(SELF_IMPROVE_CHAT_TITLE);
    expect(store.chats[0].chatMode).toBe(SELF_IMPROVE_CHAT_MODE);
    expect(store.chats[0].isFavorite).toBe(true);
  });

  it("is idempotent", async () => {
    const store = createFakeStore();
    const first = await ensureSelfImproveChat({ store, dyadRoot: tempDir });
    const second = await ensureSelfImproveChat({ store, dyadRoot: tempDir });

    expect(second.chatId).toBe(first.chatId);
    expect(second.created).toBe(false);
    expect(store.apps).toHaveLength(1);
    expect(store.chats).toHaveLength(1);
  });

  it("re-pins a chat that was unpinned", async () => {
    const store = createFakeStore();
    await ensureSelfImproveChat({ store, dyadRoot: tempDir });
    store.chats[0].isFavorite = false;

    await ensureSelfImproveChat({ store, dyadRoot: tempDir });
    expect(store.chats[0].isFavorite).toBe(true);
  });

  it("refuses a root that is not a Dyad checkout", async () => {
    const store = createFakeStore();
    const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), "dyad-empty-"));
    try {
      await expect(
        ensureSelfImproveChat({ store, dyadRoot: emptyDir }),
      ).rejects.toThrow(DyadError);
    } finally {
      fs.rmSync(emptyDir, { recursive: true, force: true });
    }
  });

  it("repoints the app when the checkout moved", async () => {
    const store = createFakeStore();
    await ensureSelfImproveChat({ store, dyadRoot: tempDir });

    const movedDir = fs.mkdtempSync(path.join(os.tmpdir(), "dyad-moved-"));
    fs.writeFileSync(path.join(movedDir, "package.json"), "{}");
    try {
      const ref = await ensureSelfImproveChat({ store, dyadRoot: movedDir });
      expect(ref.appPath).toBe(movedDir);
      expect(store.apps[0].path).toBe(movedDir);
    } finally {
      fs.rmSync(movedDir, { recursive: true, force: true });
    }
  });
});
