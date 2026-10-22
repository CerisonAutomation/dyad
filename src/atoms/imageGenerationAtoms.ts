import { atom } from "jotai";

/**
 * Cap on remembered dismissals. A dismissed job id that is no longer on
 * screen serves no purpose, so keeping it forever only grows the set.
 */
const MAX_DISMISSED_JOB_IDS = 200;

/** Tracks dismissed job IDs globally so dismissals persist across mounts. */
export const dismissedImageGenerationJobIdsAtom = atom<Set<string>>(
  new Set<string>(),
);

/**
 * Dismiss an image-generation job, remembering it across mounts.
 *
 * The set is bounded: the oldest dismissal is dropped once the cap is
 * reached, so a long session cannot grow it without limit.
 */
export const dismissImageGenerationJobAtom = atom(
  null,
  (get, set, jobId: string) => {
    const current = get(dismissedImageGenerationJobIdsAtom);
    if (current.has(jobId)) return;
    const next = new Set(current);
    next.add(jobId);
    while (next.size > MAX_DISMISSED_JOB_IDS) {
      const oldest = next.values().next().value;
      if (oldest === undefined) break;
      next.delete(oldest);
    }
    set(dismissedImageGenerationJobIdsAtom, next);
  },
);
