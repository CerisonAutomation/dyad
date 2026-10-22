import { z } from "zod";
import {
  createClient,
  createEventClient,
  defineContract,
  defineEvent,
} from "../contracts/core";

// =============================================================================
// Self-heal (self-improvement) schemas
// =============================================================================

/**
 * The always-open self-improvement chat.
 *
 * It lives on a SYNTHETIC app whose path is the Dyad source root, so it is the
 * only chat that is allowed to change Dyad itself.
 */
export const SelfImproveChatSchema = z.object({
  /** The synthetic app row that points at the Dyad source root. */
  appId: z.number(),
  /** The pinned, always-open chat. */
  chatId: z.number(),
  /** The stable title of the always-open chat. */
  title: z.string(),
  /** The Dyad source root: the only scope the agent may touch. */
  appPath: z.string(),
});

export type SelfImproveChat = z.infer<typeof SelfImproveChatSchema>;

/** The outcome of a requested self-improvement run. */
export const SelfImproveRunResultSchema = z.object({
  /** Whether a run was enqueued. */
  ran: z.boolean(),
  /** Why it was (or was not) enqueued. */
  reason: z.string(),
});

export type SelfImproveRunResult = z.infer<typeof SelfImproveRunResultSchema>;

/**
 * The payload of the "a self-improvement run was requested" event.
 *
 * Main decides WHEN a run happens; the renderer submits the turn, because the
 * chat stream is owned by the main-side actor and entered from the renderer.
 */
export const SelfImproveRunRequestedPayloadSchema = z.object({
  chatId: z.number(),
  appId: z.number(),
  /** The prompt of the run: the open failure classes, most severe first. */
  prompt: z.string(),
});

export type SelfImproveRunRequestedPayload = z.infer<
  typeof SelfImproveRunRequestedPayloadSchema
>;

// =============================================================================
// Self-heal Contracts
// =============================================================================

export const selfHealContracts = {
  /**
   * Returns the always-open self-improvement chat, or null when it does not
   * exist yet. Read-only: it never creates anything.
   */
  getSelfImproveChat: defineContract({
    channel: "self-heal:get-self-improve-chat",
    input: z.void(),
    output: SelfImproveChatSchema.nullable(),
  }),

  /**
   * Returns the always-open self-improvement chat, creating the synthetic app
   * and the pinned chat on first use.
   */
  ensureSelfImproveChat: defineContract({
    channel: "self-heal:ensure-self-improve-chat",
    input: z.void(),
    output: SelfImproveChatSchema,
    // Creating the app/chat rows changes what the app and chat lists show.
    invalidates: () => [{ family: "apps" }, { family: "chats" }],
  }),

  /**
   * Requests one run of the self-improvement chat right now.
   *
   * The run is a chat turn, so it is submitted by the renderer; main only
   * decides that it should happen.
   */
  runSelfImproveNow: defineContract({
    channel: "self-heal:run-now",
    input: z.void(),
    output: SelfImproveRunResultSchema,
  }),
} as const;

// =============================================================================
// Self-heal Event Contracts
// =============================================================================

export const selfHealEvents = {
  runRequested: defineEvent({
    channel: "self-heal:run-requested",
    payload: SelfImproveRunRequestedPayloadSchema,
  }),
} as const;

// =============================================================================
// Self-heal Clients
// =============================================================================

export const selfHealClient = createClient(selfHealContracts);
export const selfHealEventClient = createEventClient(selfHealEvents);
