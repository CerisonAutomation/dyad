/**
 * The dedicated self-improvement chat (surface B).
 *
 * The chat lives on a SYNTHETIC app whose path is the Dyad source root: it
 * is the only chat that is allowed to change Dyad itself, and every mutation
 * it makes is checked against that root by the scope guard.
 *
 * The app row and the chat row are created lazily, on first use, so a fresh
 * install has no self-improvement chat until something asks for one.
 *
 * The chat is PINNED (`chats.is_favorite`) and carries a stable title that
 * marks it as the always-open self-improvement chat, so the chat list can
 * surface it without a schema change.
 *
 * The system prompt is an ARCHITECT-DESIGNER prompt. Because the architect /
 * editor split measurably helps, the architect is PLAN-ONLY: it emits the
 * plan and the reproduction test, and a separate implementer step emits the
 * patch.
 */

import fs from "node:fs";
import path from "node:path";
import log from "electron-log";
import { and, eq } from "drizzle-orm";

import { db } from "@/db";
import { apps, chats } from "@/db/schema";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import type { StoredChatMode } from "@/lib/schemas";

import { buildArchitectDesignerPrompt } from "./prompts";
import { loadPreventionRules } from "./prevention";
import type { PreventionRule } from "./types";

const logger = log.scope("self_heal_chat");

/** The name of the synthetic app that points at the Dyad repository. */
export const SELF_IMPROVE_APP_NAME = "Dyad (self-improvement)";

/**
 * The title of the self-improvement chat.
 *
 * The title is the always-open marker: the chat list can recognise it
 * without a schema change.
 */
export const SELF_IMPROVE_CHAT_TITLE = "Dyad self-improvement (always open)";

/** The chat mode the self-improvement chat runs in. */
export const SELF_IMPROVE_CHAT_MODE: StoredChatMode = "local-agent";

/** Whether the given app name is the self-improvement app. */
export function isSelfImproveAppName(name: string | null | undefined): boolean {
  return (name ?? "").trim() === SELF_IMPROVE_APP_NAME;
}

/** Whether the given chat title is the self-improvement chat. */
export function isSelfImproveChatTitle(
  title: string | null | undefined,
): boolean {
  return (title ?? "").trim() === SELF_IMPROVE_CHAT_TITLE;
}

/**
 * Resolves the Dyad source root: the checkout Dyad is running from.
 *
 * `DYAD_SOURCE_ROOT` overrides it (tests, forks, a checkout somewhere else).
 */
export function resolveDyadSourceRoot(
  env: NodeJS.ProcessEnv = process.env,
): string {
  const override = env.DYAD_SOURCE_ROOT?.trim();
  if (override) return path.resolve(override);
  // `src/ipc/handlers/local_agent/self_heal` -> the repository root.
  return path.resolve(__dirname, "..", "..", "..", "..", "..");
}

/**
 * Asserts that the given path really is a Dyad source root.
 *
 * @throws DyadError (Precondition) when the path is not a Dyad checkout.
 */
export function assertDyadSourceRoot(dyadRoot: string): void {
  const root = (dyadRoot ?? "").trim();
  if (root.length === 0) {
    throw new DyadError(
      "The self-improvement agent needs a Dyad source root.",
      DyadErrorKind.Precondition,
    );
  }
  let stats: ReturnType<typeof fs.statSync>;
  try {
    stats = fs.statSync(root);
  } catch {
    throw new DyadError(
      `The Dyad source root does not exist: ${root}`,
      DyadErrorKind.Precondition,
    );
  }
  if (!stats.isDirectory()) {
    throw new DyadError(
      `The Dyad source root is not a directory: ${root}`,
      DyadErrorKind.Precondition,
    );
  }
  if (!fs.existsSync(path.join(root, "package.json"))) {
    throw new DyadError(
      `The Dyad source root is not a Dyad checkout (no package.json): ${root}`,
      DyadErrorKind.Precondition,
    );
  }
}

/**
 * The architect block: the self-improvement chat is PLAN-ONLY.
 *
 * The architect diagnoses and plans; a separate implementer step applies the
 * patch. Everything the base prompt calls APPLY, VERIFY and CRITIQUE is
 * executed by that implementer step.
 */
export const ARCHITECT_ROLE_BLOCK = [
  "## ROLE: ARCHITECT (PLAN ONLY)",
  "You are the ARCHITECT. You never edit a file, never run a mutating command and never apply a patch yourself.",
  "Your deliverable is a PLAN plus the REPRODUCTION TEST for exactly ONE failure class.",
  "A separate IMPLEMENTER step (the `implementer` sub-agent) turns your plan into the patch. The harness runs that step, not you.",
  "Everything the METHOD section below calls APPLY, VERIFY and CRITIQUE is executed by that implementer step, and its report comes back to you.",
  "You MAY spawn read-only `explorer` sub-agents: that is how the 3-oracle consensus is produced.",
  "",
  "The plan contains, in this order:",
  "1. CLASS - the failure class, its ledger signature and the exact error text.",
  "2. ROOT CAUSE - the concrete code path, with file and line.",
  "3. REPRODUCTION TEST - the fail-to-pass test, written BEFORE the fix: the exact file, the exact test name, and the command that runs it. It must fail before the patch and pass after it.",
  "4. FIX - the smallest change that makes the reproduction test pass, with the file paths it touches.",
  "5. PREVENTION RULE - the title and the rule text, in the shape the prevention store expects.",
  "6. RESEARCH - the libraries you resolved and the documented practice the fix follows.",
  "7. ORACLE CONSENSUS - the 3 oracle framings, each oracle's root cause and score, the merged consensus score, and how many oracles agreed. Fewer than 2 agreeing oracles or a consensus score below 7 means: re-diagnose, do not implement.",
  "8. VERIFICATION PLAN - the exact commands that must pass (fmt, ts, lint and the reproduction test) and what passing means for each.",
  "",
  "Emit the plan as structured text. Do not apply it.",
].join("\n");

/**
 * The research contract: Context7 is called in exactly one way, and only when
 * it is worth calling.
 */
export const RESEARCH_CONTRACT_BLOCK = [
  "## RESEARCH CONTRACT",
  "Research is CONDITIONAL. Only research a library the request actually touches, and never a library the model already knows cold: a doc lookup that is not needed costs a round trip and adds noise.",
  "When you do research, call the Context7 MCP tools in this order and no other:",
  "1. `resolve-library-id` with the library name. Take the VERSION-PINNED id it returns. An unpinned id is not acceptable.",
  "2. `query-docs` with that version-pinned id. ONE concept per call: a single API, a single option, a single error code. Never ask for everything about a library.",
  "Ask for CODE EXAMPLES, not prose. A snippet that shows the call is worth ten paragraphs.",
  "Check the skill catalog for a matching skill before inventing a procedure. Advertise a skill by its name and its description only; the body arrives when the skill is invoked.",
].join("\n");

/**
 * Builds the system prompt of the self-improvement chat.
 *
 * It is the architect-designer prompt with the plan-only role and the
 * research contract in front of it.
 */
export function buildSelfImproveSystemPrompt(options: {
  /** The Dyad source root: the only writable scope. */
  appPath: string;
  /** The active prevention rules. */
  preventionRules: PreventionRule[];
}): string {
  return [
    ARCHITECT_ROLE_BLOCK,
    RESEARCH_CONTRACT_BLOCK,
    buildArchitectDesignerPrompt({
      appPath: options.appPath,
      preventionRules: options.preventionRules,
    }),
  ].join("\n\n");
}

/**
 * Builds the prompt of one auto-triggered run.
 *
 * The run works on ONE failure class: the most severe open one.
 */
export function buildSelfImproveRunPrompt(options: {
  /** The open ledger signatures, most severe first. */
  openSignatures: readonly string[];
}): string {
  const signatures = options.openSignatures ?? [];
  if (signatures.length === 0) {
    return [
      "There are no open failure classes. Do not change anything.",
      "Report that there is nothing to do and stop.",
    ].join("\n");
  }
  return [
    "Work on the Dyad repository itself. There is nothing to do when the failure ledger is empty.",
    "",
    `Open failure classes (${signatures.length}), most severe first:`,
    ...signatures.map((signature, index) => `${index + 1}. ${signature}`),
    "",
    "Take the FIRST class only. Diagnose it, produce the plan and the reproduction test, and let the implementer step apply the patch.",
    "Do not start a second class in this run.",
  ].join("\n");
}

/** The store the self-improvement chat is persisted in. */
export interface SelfImproveChatStore {
  findAppByName(
    name: string,
  ): Promise<{ id: number; path: string } | undefined>;
  insertApp(app: {
    name: string;
    path: string;
    isFavorite: boolean;
  }): Promise<{ id: number }>;
  updateAppPath(appId: number, path: string): Promise<void>;
  findChatByTitle(
    appId: number,
    title: string,
  ): Promise<{ id: number; isFavorite: boolean } | undefined>;
  insertChat(chat: {
    appId: number;
    title: string;
    chatMode: StoredChatMode;
    isFavorite: boolean;
  }): Promise<{ id: number }>;
  setChatFavorite(chatId: number, isFavorite: boolean): Promise<void>;
}

/**
 * The Drizzle-backed store. The self-improvement chat is the only chat that
 * points at a path outside the apps folder, so it is written directly.
 */
export function createDrizzleSelfImproveChatStore(): SelfImproveChatStore {
  return {
    async findAppByName(name) {
      const row = await db.query.apps.findFirst({
        where: eq(apps.name, name),
        columns: { id: true, path: true },
      });
      return row ? { id: row.id, path: row.path } : undefined;
    },
    async insertApp(app) {
      const [row] = await db
        .insert(apps)
        .values({
          name: app.name,
          path: app.path,
          isFavorite: app.isFavorite,
          needsAppBlueprint: false,
          testingEnabled: false,
        })
        .returning({ id: apps.id });
      if (!row) {
        throw new DyadError(
          "Failed to create the self-improvement app.",
          DyadErrorKind.Internal,
        );
      }
      return { id: row.id };
    },
    async updateAppPath(appId, path) {
      await db.update(apps).set({ path }).where(eq(apps.id, appId));
    },
    async findChatByTitle(appId, title) {
      const row = await db.query.chats.findFirst({
        where: and(eq(chats.appId, appId), eq(chats.title, title)),
        columns: { id: true, isFavorite: true },
      });
      return row ? { id: row.id, isFavorite: row.isFavorite } : undefined;
    },
    async insertChat(chat) {
      const [row] = await db
        .insert(chats)
        .values({
          appId: chat.appId,
          title: chat.title,
          chatMode: chat.chatMode,
          isFavorite: chat.isFavorite,
        })
        .returning({ id: chats.id });
      if (!row) {
        throw new DyadError(
          "Failed to create the self-improvement chat.",
          DyadErrorKind.Internal,
        );
      }
      return { id: row.id };
    },
    async setChatFavorite(chatId, isFavorite) {
      await db.update(chats).set({ isFavorite }).where(eq(chats.id, chatId));
    },
  };
}

/** A reference to the self-improvement chat. */
export interface SelfImproveChatRef {
  appId: number;
  chatId: number;
  /** The Dyad source root: the app's path. */
  appPath: string;
  /** True when this call created the app or the chat. */
  created: boolean;
}

let pendingEnsure: Promise<SelfImproveChatRef> | undefined;

/**
 * Returns the self-improvement chat, creating the synthetic app and the chat
 * on first use.
 *
 * The app row points at the Dyad source root, so the chat is scoped to Dyad
 * itself. The chat is pinned, and the app is pinned too, so the self-
 * improvement surface is visible instead of buried in the app list.
 */
export async function ensureSelfImproveChat(options?: {
  /** The store to persist in. Defaults to the Drizzle store. */
  store?: SelfImproveChatStore;
  /** The Dyad source root. Defaults to the running checkout. */
  dyadRoot?: string;
}): Promise<SelfImproveChatRef> {
  if (options?.store) {
    return ensureSelfImproveChatWithStore(options.store, options.dyadRoot);
  }
  if (!pendingEnsure) {
    pendingEnsure = ensureSelfImproveChatWithStore(
      createDrizzleSelfImproveChatStore(),
      options?.dyadRoot,
    ).finally(() => {
      pendingEnsure = undefined;
    });
  }
  return pendingEnsure;
}

async function ensureSelfImproveChatWithStore(
  store: SelfImproveChatStore,
  dyadRoot?: string,
): Promise<SelfImproveChatRef> {
  const appPath = dyadRoot ?? resolveDyadSourceRoot();
  assertDyadSourceRoot(appPath);

  let created = false;
  const existingApp = await store.findAppByName(SELF_IMPROVE_APP_NAME);
  let appId: number;
  if (existingApp) {
    appId = existingApp.id;
    // The checkout can move. A stale path would scope every later mutation
    // to a directory that no longer exists.
    if (existingApp.path !== appPath) {
      await store.updateAppPath(appId, appPath);
    }
  } else {
    const inserted = await store.insertApp({
      name: SELF_IMPROVE_APP_NAME,
      path: appPath,
      isFavorite: true,
    });
    appId = inserted.id;
    created = true;
  }

  const existingChat = await store.findChatByTitle(
    appId,
    SELF_IMPROVE_CHAT_TITLE,
  );
  if (existingChat) {
    if (!existingChat.isFavorite) {
      await store.setChatFavorite(existingChat.id, true);
    }
    return { appId, chatId: existingChat.id, appPath, created };
  }

  const inserted = await store.insertChat({
    appId,
    title: SELF_IMPROVE_CHAT_TITLE,
    chatMode: SELF_IMPROVE_CHAT_MODE,
    isFavorite: true,
  });
  created = true;
  logger.info("Created the self-improvement chat", inserted.id);
  return { appId, chatId: inserted.id, appPath, created };
}

/**
 * Builds the system prompt of the self-improvement chat from the current
 * prevention rules.
 */
export async function buildSelfImproveChatSystemPrompt(
  appPath: string,
): Promise<string> {
  const preventionRules = await loadPreventionRules(appPath);
  return buildSelfImproveSystemPrompt({ appPath, preventionRules });
}
