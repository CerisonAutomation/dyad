import { describe, expect, it } from "vitest";
import { scrubModelToolMarkup } from "./model_tool_markup";

// The provider control sequence that separates the fields of a mangled tool
// call. Built from codepoints so the test does not depend on how the literal
// is rendered.
const CONTROL = "]" + "<]" + "minimax" + "[>[";

describe("scrubModelToolMarkup", () => {
  it("removes a mangled tool call and the provider control sequence", () => {
    const { emit, pending } = scrubModelToolMarkup(
      `Let me check why.<dyad-git_status">${CONTROL}</dyad-git-status>\nNext.`,
    );
    expect(emit).toBe("Let me check why.\nNext.");
    expect(pending).toBe("");
  });

  it("removes a mangled tool call with argument fields", () => {
    const { emit } = scrubModelToolMarkup(
      `<dyad-mcp-tool-call">${CONTROL}<server>dyad-repair${CONTROL}</server>${CONTROL}<tool>run_gates${CONTROL}</tool>${CONTROL}<call-id>gate-001${CONTROL}</call-id>${CONTROL}</tool_call>\nAfter.`,
    );
    expect(emit).toBe("\nAfter.");
  });

  it("removes the trailing argument tags of a mangled tool call", () => {
    const { emit } = scrubModelToolMarkup(
      `<dyad-add-dependency">${CONTROL}</packages>${CONTROL}</tool_call>`,
    );
    expect(emit).toBe("");
  });

  it("stops at a thinking block instead of swallowing the reasoning", () => {
    const { emit } = scrubModelToolMarkup(
      `<dyad-execute-sandbox-script">"<script>"const s = 1;${"\n"}</script>","description>"Read it"</description><think>Let me continue.`,
    );
    expect(emit).toBe("<think>Let me continue.");
  });

  it("keeps well-formed Dyad output cards untouched", () => {
    const card =
      '<dyad-script description="Inventory docs" state="finished" truncated="false" execution-ms="5">{"script":"x"}</dyad-script>';
    const { emit } = scrubModelToolMarkup(`Done.${card}`);
    expect(emit).toBe(`Done.${card}`);
  });

  it("does not treat a card attribute as a mangled tool tag", () => {
    const { emit } = scrubModelToolMarkup(
      '<dyad-add-dependency packages="clsx@^2.1.1"></dyad-add-dependency>',
    );
    expect(emit).toBe(
      '<dyad-add-dependency packages="clsx@^2.1.1"></dyad-add-dependency>',
    );
  });

  it("holds back a tool tag that is split across two chunks", () => {
    const first = scrubModelToolMarkup("<dyad-git_sta");
    expect(first.emit).toBe("");
    expect(first.pending).toBe("<dyad-git_sta");

    const second = scrubModelToolMarkup(`tus">${CONTROL}</dyad-git-status>`, {
      pending: first.pending,
    });
    expect(second.emit).toBe("");
    expect(second.pending).toBe("");
  });

  it("releases the held back text when the stream is final", () => {
    const held = scrubModelToolMarkup("<dyad-git_sta");
    const final = scrubModelToolMarkup(held.pending, { final: true });
    expect(final.emit).toBe("<dyad-git_sta");
    expect(final.pending).toBe("");
  });

  it("removes a standalone provider control sequence", () => {
    const { emit } = scrubModelToolMarkup(`before${CONTROL}after`);
    expect(emit).toBe("beforeafter");
  });

  it("leaves ordinary prose alone", () => {
    const text = "I will read the file and then update it.\n";
    const { emit } = scrubModelToolMarkup(text);
    expect(emit).toBe(text);
  });
});

// The fixtures below are verbatim excerpts of assistant messages that were
// persisted with the mangled markup visible in the chat (chats 11 and 28,
// model `minimax-m3.1-flash-free` served through the OpenCode Zen gateway).
describe("scrubModelToolMarkup on captured output", () => {
  it("removes a captured web-fetch call", () => {
    const { emit } = scrubModelToolMarkup(
      `pin those to the newest eligible versions.<dyad-web-fetch">https://registry.npmjs.org/lucide-react/1.60.0${CONTROL}</dyad-web-fetch>\n<dyad-web-fetch">https://registry.npmjs.org/openai/7.40.0${CONTROL}</dyad-web-fetch>\n${CONTROL}</tool_call><think>My last tool call was malformed (garbage characters in the web_fetch URLs). Let me redo it properly.`,
    );
    expect(emit).toBe(
      "pin those to the newest eligible versions.\n<think>My last tool call was malformed (garbage characters in the web_fetch URLs). Let me redo it properly.",
    );
  });

  it("removes a captured add-dependency call", () => {
    const { emit } = scrubModelToolMarkup(
      `apply the last four majors and inventory the docs in parallel.<dyad-add-dependency">recharts@^3.10.1 react-day-picker@^10.0.2 react-resizable-panels@^4.14.8 @tanstack/react-table@^9.3.1"]=${CONTROL}</packages>${CONTROL}</tool_call>`,
    );
    expect(emit).toBe(
      "apply the last four majors and inventory the docs in parallel.",
    );
  });

  it("removes a captured mcp tool call with its argument fields", () => {
    const { emit } = scrubModelToolMarkup(
      `Now running the install with the policy satisfied.<dyad-mcp-tool-call">${CONTROL}<server>dyad-repair${CONTROL}</server>${CONTROL}<tool>run_gates${CONTROL}</tool>${CONTROL}<call-id>gate-001${CONTROL}</call-id>${CONTROL}<auto-approved-reason>Runs the repository typecheck gate locally and returns verification evidence.${CONTROL}</auto-approved-reason>${CONTROL}</tool_call><think>Let me re-issue.`,
    );
    expect(emit).toBe(
      "Now running the install with the policy satisfied.<think>Let me re-issue.",
    );
  });

  it("removes a captured sandbox script call but keeps the reasoning", () => {
    const { emit } = scrubModelToolMarkup(
      `Let me check why.<dyad-git_status">${CONTROL}</dyad-git-status>\n<dyad-execute-sandbox-script">"<script>"const s = await read_file("package.json");\nconst j = JSON.parse(s);\n</script>","description>"Read current package.json ranges"</description><think>Let me continue.`,
    );
    expect(emit).toBe("Let me check why.\n<think>Let me continue.");
  });
});
