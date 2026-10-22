/**
 * The self-improvement surface (surface B).
 *
 * This file wires the three pieces the self-heal module needs in order to be
 * reachable from the app:
 *
 *  1. the always-open self-improvement chat (the synthetic app that points at
 *     the Dyad source root, plus the PINNED chat that is always open),
 *  2. the auto-trigger scheduler that enqueues a run of that chat when the
 *     failure ledger has open entries, and
 *  3. the IPC handlers the renderer uses to surface the chat and to request a
 *     run.
 *
 * The agent may ONLY touch the Dyad repository: the scope guard lives in the
 * self-heal module (`assertSelfHealScope` / `assertDyadSourceRoot`) and is not
 * duplicated here.
 *
 * Everything here is FAIL-CLOSED: a failing self-heal hook must never break a
 * normal chat turn or the app startup, so every failure is logged and ignored.
 */

import fs from "node:fs";
import path from "node:path";
import log from "electron-log";
import { and, eq } from "drizzle-orm";

import { db } from "@/db";
import { chatTurnIntents } from "@/db/schema";
import { createTypedHandler } from "./base";
import { selfHealContracts, selfHealEvents } from "../types/self_heal";
import { broadcastToAllWindows } from "../utils/window_broadcast";
import { isGitStatusClean } from "../utils/git_utils";
import {
  SELF_IMPROVE_APP_NAME,
  SELF_IMPROVE_CHAT_TITLE,
  buildSelfImproveRunPrompt,
  createDrizzleSelfImproveChatStore,
  ensureSelfImproveChat,
  resolveDyadSourceRoot,
  type SelfImproveChatRef,
} from "./local_agent/self_heal";
import {
  createAutoTriggerScheduler,
  readOpenSignatures,
  type AutoTriggerScheduler,
  type AutoTriggerState,
} from "./local_agent/self_heal";

const logger = log.scope("self_heal_handlers");

/** The store the self-improvement chat is persisted in. */
const chatStore = createDrizzleSelfImproveChatStore();

/** The scheduler handle, once it has been started. */
let scheduler: AutoTriggerScheduler | undefined;

/** Guards against starting the surface twice in one process. */
let startup: Promise<void> | undefined;

/**
 * Finds the self-improvement chat WITHOUT creating anything.
 *
 * The chat list uses this to decide whether the always-open entry should be
 * rendered, so it must never write.
 */
async function findSelfImproveChat(): Promise<SelfImproveChatRef | undefined> {
  const app = await chatStore.findAppByName(SELF_IMPROVE_APP_NAME);
  if (!app) return undefined;
  const chat = await chatStore.findChatByTitle(app.id, SELF_IMPROVE_CHAT_TITLE);
  if (!chat) return undefined;
  return {
    appId: app.id,
    chatId: chat.id,
    appPath: app.path,
    created: false,
  };
}

/**
 * Whether a chat turn is currently running for the given chat.
 *
 * A turn that was claimed but has not reached a terminal state is still
 * running, so the auto-trigger must not start a second one.
 */
async function hasActiveChatTurn(chatId: number): Promise<boolean> {
  const active = await db.query.chatTurnIntents.findFirst({
    where: and(
      eq(chatTurnIntents.chatId, chatId),
      eq(chatTurnIntents.recovery, "started"),
    ),
    columns: { intentId: true },
  });
  return active !== undefined;
}

/** Path of the file that remembers when the auto-trigger last ran. */
function getAutoTriggerStatePath(dyadRoot: string): string {
  return path.join(dyadRoot, ".dyad", "self-heal", "auto-trigger.json");
}

/**
 * Reads the timestamp of the last auto-triggered run.
 *
 * A missing or unreadable file yields no timestamp: the rate limit then
 * simply does not apply yet, which is the safe direction (one extra run at
 * most, never a storm).
 */
async function loadLastRunAt(dyadRoot: string): Promise<number | undefined> {
  try {
    const raw = await fs.promises.readFile(
      getAutoTriggerStatePath(dyadRoot),
      "utf-8",
    );
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return undefined;
    const lastRunAt = (parsed as { lastRunAt?: unknown }).lastRunAt;
    return typeof lastRunAt === "number" ? lastRunAt : undefined;
  } catch {
    return undefined;
  }
}

/** Persists the timestamp of the last auto-triggered run. */
async function saveLastRunAt(
  dyadRoot: string,
  timestamp: number,
): Promise<void> {
  const filePath = getAutoTriggerStatePath(dyadRoot);
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.tmp`;
  await fs.promises.writeFile(
    tmpPath,
    JSON.stringify({ lastRunAt: timestamp }, null, 2),
    "utf-8",
  );
  await fs.promises.rename(tmpPath, filePath);
}

/**
 * Enqueues one run of the self-improvement chat.
 *
 * The run IS a chat turn, and a chat turn is submitted by the renderer into
 * the main-owned chat stream actor. Main decides that the run should happen
 * and broadcasts the request; the renderer submits it.
 */
async function enqueueSelfImproveRun(context: {
  openSignatures: string[];
}): Promise<void> {
  const ref = await ensureSelfImproveChat();
  const prompt = buildSelfImproveRunPrompt({
    openSignatures: context.openSignatures,
  });
  broadcastToAllWindows(selfHealEvents.runRequested.channel, {
    chatId: ref.chatId,
    appId: ref.appId,
    prompt,
  });
  logger.info("Requested a self-improvement run", {
    chatId: ref.chatId,
    openSignatures: context.openSignatures.length,
  });
}

/**
 * Reads the state the auto-trigger decides on.
 *
 * Everything here can fail; the failure propagates to `runAutoTrigger`, which
 * turns it into a "state-unavailable" refusal instead of a run.
 */
async function readAutoTriggerState(): Promise<
  Omit<AutoTriggerState, "lastRunAt">
> {
  const ref = await findSelfImproveChat();
  if (!ref) {
    return {
      chatAvailable: false,
      openSignatures: [],
      workingTreeClean: false,
      chatTurnActive: false,
    };
  }
  const openSignatures = await readOpenSignatures(ref.appPath);
  const workingTreeClean = await isGitStatusClean({ path: ref.appPath });
  const chatTurnActive = await hasActiveChatTurn(ref.chatId);
  return {
    chatAvailable: true,
    openSignatures,
    workingTreeClean,
    chatTurnActive,
  };
}

/**
 * Starts the self-improvement surface.
 *
 * Called once after the database is initialized. It creates the always-open
 * chat and starts the auto-trigger scheduler. Every failure is logged and
 * swallowed: a broken self-heal must never keep the app from starting.
 */
export function startSelfHealSurface(): Promise<void> {
  if (!startup) {
    startup = startupSelfHealSurface();
  }
  return startup;
}

async function startupSelfHealSurface(): Promise<void> {
  const dyadRoot = resolveDyadSourceRoot();

  try {
    const ref = await ensureSelfImproveChat({ dyadRoot });
    logger.info("The self-improvement chat is ready", {
      chatId: ref.chatId,
      created: ref.created,
    });
  } catch (error) {
    // The self-improvement agent may only improve a real Dyad checkout, so a
    // missing source root is a normal outcome (a packaged build, for example)
    // and not an error worth surfacing.
    logger.warn("The self-improvement chat is not available:", error);
    return;
  }

  try {
    scheduler = createAutoTriggerScheduler({
      getState: readAutoTriggerState,
      enqueueRun: enqueueSelfImproveRun,
      loadLastRunAt: () => loadLastRunAt(dyadRoot),
      saveLastRunAt: (timestamp) => saveLastRunAt(dyadRoot, timestamp),
    });
    scheduler.start();
    logger.info("The self-improvement auto-trigger is scheduled");
  } catch (error) {
    logger.warn("Failed to schedule the self-improvement auto-trigger:", error);
  }
}

/**
 * Stops the self-improvement auto-trigger.
 *
 * Called when the app quits so the scheduler never outlives the process.
 */
export function stopSelfHealSurface(): void {
  try {
    scheduler?.stop();
  } catch (error) {
    logger.warn("Failed to stop the self-improvement auto-trigger:", error);
  }
  scheduler = undefined;
}

export function registerSelfHealHandlers(): void {
  createTypedHandler(selfHealContracts.getSelfImproveChat, async () => {
    const ref = await findSelfImproveChat();
    if (!ref) return null;
    return {
      appId: ref.appId,
      chatId: ref.chatId,
      title: SELF_IMPROVE_CHAT_TITLE,
      appPath: ref.appPath,
    };
  });

  createTypedHandler(selfHealContracts.ensureSelfImproveChat, async () => {
    const ref = await ensureSelfImproveChat();
    return {
      appId: ref.appId,
      chatId: ref.chatId,
      title: SELF_IMPROVE_CHAT_TITLE,
      appPath: ref.appPath,
    };
  });

  createTypedHandler(selfHealContracts.runSelfImproveNow, async () => {
    const ref = await ensureSelfImproveChat();
    const openSignatures = await readOpenSignatures(ref.appPath);
    await enqueueSelfImproveRun({ openSignatures });
    return { ran: true, reason: "requested" };
  });
}
