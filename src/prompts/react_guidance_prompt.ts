/**
 * React guidance for the local agent, encoded from the `how-to-use-react`
 * skill (masseater/skills), which is itself a reading of the React 19.3
 * guidance from vercel-labs/agent-skills and modern-react-guidance.
 *
 * Why this exists: React can express the same screen many ways, and all of
 * them work at first. The differences only appear when data grows, the
 * network is slow, and actions overlap - at which point serial fetching
 * becomes a waterfall, synchronous updates freeze input, and state ends up
 * scattered across \`useState\`, context, and copies of server responses.
 *
 * Adapted to Dyad's stack: the original mandates Effect Atom and TanStack
 * Query. Dyad apps use TanStack Query for server data and Jotai for shared
 * client state, so the routing table below names Jotai where the original
 * names Effect Atom.
 */

/** The state-routing table. One row per kind of state. */
export const REACT_STATE_PLACEMENT_BLOCK = `<react_state_placement>
Decide where each piece of state lives before you write it. Do not scatter it.

| What you need | Use | Not |
| --- | --- | --- |
| Transient screen state, form values, anything shared across the tree | Jotai atom (\`atom\`, \`useAtom\`, \`useAtomValue\`) | \`useState\`/\`useReducer\`, a new Context, storing a copy of a server response in state |
| Server data | TanStack Query (\`useQuery\`/\`useSuspenseQuery\`) | \`useEffect\` + \`fetch\`, a \`use(promise)\` call, an atom holding a server response |
| Mutation pending state and errors | TanStack Query \`useMutation\` | a hand-rolled \`isPending\` flag, \`useActionState\`, \`useFormStatus\` |
| Mutations whose order is part of the spec | \`useMutation\` with the same \`scope: { id }\` | a hand-rolled queue, disabling the button to stop the sequence |
| Optimistic updates | \`useOptimistic\` | a hand-rolled rollback state |
| Non-urgent updates, expensive derivations | \`useTransition\` / \`startTransition\` / \`useDeferredValue\` | a timer debounce |
| A ref | a function prop | \`forwardRef\`, a string ref |
| Hiding a view while keeping its state | \`<Activity mode="hidden">\` | conditionally unmounting and losing the state |
| Transition animation | \`<ViewTransition>\` | a hand-rolled animation |
| Reading the latest props inside an effect | \`useEffectEvent\` (do not put it in the dependency array) | adding that function to the dependency array and re-subscribing on every change |

If two rows in this table appear to fit the same piece of state, it is server data - use TanStack Query.
</react_state_placement>`;

/** Async waterfalls and concurrency. */
export const REACT_ASYNC_BLOCK = `<react_async>
Fix async waterfalls before you optimise anything else about React.

- Independent work starts at the same time. Use \`Promise.all\` for promises outside React, and \`Effect.all\`/\`Effect.forEach\` with \`{ concurrency: "unbounded" }\` inside React 19 effects.
- When the order is part of the specification, say so explicitly with \`{ concurrency: 1 }\` rather than relying on the default.
- Only wait at the branch that actually needs the earlier result. Fetching the second thing only after the first resolves is a waterfall.
- Check the condition you already have before starting a request at all.
- Render-time derivations of props and state do not belong in an effect. Compute them during render.
</react_async>`;

/** Component API shape. */
export const REACT_COMPONENT_API_BLOCK = `<react_component_api>
Shape the props so the call site reads as the intent.

- Events are named \`onXxxChange\` for a controlled value and \`onXxx\` for an action.
- A boolean prop is named without \`is\`/\`has\`/\`should\` and defaults to false when omitted.
- Visual branching is closed over \`variant\` and \`size\`, not a dozen one-off booleans.
- Prefer a discriminated union over a bag of optional props when exactly one combination is valid.
- The props type is the component's public contract: changing it is a breaking change for every caller.
</react_component_api>`;

/** Concurrent UI, deferred consistency, and memoisation. */
export const REACT_CONCURRENT_UX_BLOCK = `<react_concurrent_ux>
React guarantees consistency and immediacy. Relax them only through an API that declares the relaxation.

- Consistency means the old UI and the new UI are never on screen together. Immediacy means a state update paints before anything else. Only an update that reconciles React's state with an external change that already happened needs to be urgent.
- Put enter/exit transitions on \`<ViewTransition>\`, use \`<Activity>\` for a view the user moves between and expects to keep its state, and move a value that need not be current on every subscription into \`useEffectEvent\`.
- A heavy list rendered from the same input as a text field delays the field. Write the input to its atom immediately, pass the list through \`useDeferredValue\`, and show \`useTransition\`'s pending state to explain the delay.
- Do not write \`useMemo\`, \`useCallback\`, or \`memo\` by default. React Compiler removes the need for them, and hand-written memoisation is easy to get wrong. Add it only after a measurement shows a specific slow path. A \`useMemo\` whose dependency array does not match what it reads is a stale-value bug, not a performance bug.
</react_concurrent_ux>`;

/** Effects and data. */
export const REACT_EFFECTS_BLOCK = `<react_effects>
An effect is for synchronising with something React does not know about.

- Write to the DOM, start measurements, mount a third-party widget, or subscribe to something that is not data - those belong in an effect, and the effect returns the cleanup.
- A value computable from props and state is computed during render, not in an effect.
- Fetching data is not an effect - it is TanStack Query.
- Every subscription returns its cleanup, and every timer is cleared, or it leaks on every remount.
</react_effects>`;
