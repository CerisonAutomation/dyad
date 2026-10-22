/**
 * The engineering and communication discipline shared by every Dyad prompt.
 *
 * The individual blocks come from the masseater skills
 * (`poteto-principles`, `dont-it-yourself`, `integrate`, `measure-dont-guess`,
 * `how-to-use-react`, `writing`, `humanity-and-humanness`), encoded as prompt
 * text in:
 * - `engineering_principles_prompt.ts`
 * - `react_guidance_prompt.ts`
 * - `communication_prompt.ts`
 *
 * They are assembled here, once, so the local-agent prompts and the legacy
 * chat-mode prompts cannot drift apart.
 */

import {
  ENGINEERING_PRINCIPLES_BLOCK,
  INTEGRATION_MIGRATION_BLOCK,
  MEASUREMENT_DISCIPLINE_BLOCK,
  REUSE_BEFORE_WRITING_BLOCK,
} from "./engineering_principles_prompt";
import {
  REACT_ASYNC_BLOCK,
  REACT_COMPONENT_API_BLOCK,
  REACT_CONCURRENT_UX_BLOCK,
  REACT_EFFECTS_BLOCK,
  REACT_STATE_PLACEMENT_BLOCK,
} from "./react_guidance_prompt";
import {
  HUMAN_READING_BLOCK,
  WRITING_RULES_BLOCK,
} from "./communication_prompt";

/**
 * How the agent reasons about and changes code.
 *
 * Applies to every mode that writes or reviews code: Pro agent, Basic
 * agent, Build mode, and the Implementer sub-agent.
 */
export const ENGINEERING_DISCIPLINE_BLOCK = `${ENGINEERING_PRINCIPLES_BLOCK}

${REUSE_BEFORE_WRITING_BLOCK}

${INTEGRATION_MIGRATION_BLOCK}

${MEASUREMENT_DISCIPLINE_BLOCK}`;

/**
 * How the agent places and manages React state.
 *
 * Only relevant when the app is a React app, so it is injected separately
 * from the discipline block.
 */
export const REACT_GUIDANCE_BLOCK = `${REACT_STATE_PLACEMENT_BLOCK}

${REACT_ASYNC_BLOCK}

${REACT_EFFECTS_BLOCK}

${REACT_COMPONENT_API_BLOCK}

${REACT_CONCURRENT_UX_BLOCK}`;

/**
 * How the agent writes for the human reading it: chat replies, explanations,
 * comments, and documentation.
 */
export const COMMUNICATION_BLOCK = `${HUMAN_READING_BLOCK}

${WRITING_RULES_BLOCK}`;
