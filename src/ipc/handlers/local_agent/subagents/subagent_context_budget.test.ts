import type { ModelMessage, ToolModelMessage } from "ai";
import { describe, expect, it } from "vitest";

import type { SubagentThreadSummary } from "@/ipc/types";

import {
  MAX_PARENT_REPORT_CHARS,
  MAX_SUBAGENT_ASSIGNMENT_CHARS,
  MAX_SUBAGENT_CURRENT_ASSIGNMENT_CHARS,
  MAX_SUBAGENT_TOTAL_ASSISTANT_TEXT_CHARS,
  MAX_SUBAGENT_TOOL_RESULT_CHARS,
  boundAssignmentForModel,
  boundReportForParent,
  boundSubagentAssignmentsForModel,
  boundSubagentSummariesForParent,
  pruneSubagentAssistantText,
  pruneSubagentMessages,
  pruneSubagentToolResults,
  toolResultOutputToText,
} from "./subagent_context_budget";

function toolMessage(
  toolCallId: string,
  value: string,
  toolName = "read_file",
): ToolModelMessage {
  return {
    role: "tool",
    content: [
      {
        type: "tool-result",
        toolCallId,
        toolName,
        output: { type: "text", value },
      },
    ],
  };
}

function assistantText(text: string): ModelMessage {
  return { role: "assistant", content: [{ type: "text", text }] };
}

function countToolResultParts(messages: ModelMessage[]): number {
  let count = 0;
  for (const message of messages) {
    if (message.role !== "tool") {
      continue;
    }
    const content = (message as ToolModelMessage).content;
    if (!Array.isArray(content)) {
      continue;
    }
    for (const part of content) {
      if (
        typeof part === "object" &&
        part !== null &&
        (part as { type?: unknown }).type === "tool-result"
      ) {
        count += 1;
      }
    }
  }
  return count;
}

function firstToolResultText(message: ModelMessage): string {
  const content = (message as ToolModelMessage).content;
  const part = content[0] as { output: { type: string; value?: string } };
  return part.output.value ?? "";
}

function makeSummary(
  overrides: Partial<SubagentThreadSummary> = {},
): SubagentThreadSummary {
  const now = new Date("2026-01-01T00:00:00.000Z");
  return {
    id: "thread-1",
    chatId: 7,
    persona: "explorer",
    taskName: "Explore",
    assignment: "Look around",
    status: "completed",
    provider: "anthropic",
    model: "claude",
    reasoningEffort: "high",
    result: { report: "short report", extra: "kept" },
    reviewBaseCommit: null,
    reviewTargetCommit: null,
    reviewDiffHash: null,
    sourceMessageId: null,
    invocationSource: "model",
    remediationSource: null,
    autoFixAt: null,
    error: null,
    inputTokens: 0,
    outputTokens: 0,
    toolCallCount: 0,
    createdAt: now,
    startedAt: now,
    completedAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe("sub-agent context budget", () => {
  describe("toolResultOutputToText", () => {
    it("flattens text and error outputs", () => {
      expect(toolResultOutputToText({ type: "text", value: "hello" })).toBe(
        "hello",
      );
      expect(
        toolResultOutputToText({ type: "error-text", value: "boom" }),
      ).toBe("boom");
    });

    it("flattens json outputs", () => {
      expect(
        toolResultOutputToText({ type: "json", value: { a: 1 } }),
      ).toContain('"a":1');
    });

    it("returns an empty string for unknown output shapes", () => {
      expect(toolResultOutputToText(undefined)).toBe("");
    });
  });

  describe("pruneSubagentToolResults", () => {
    it("returns the original array when there is nothing to prune", () => {
      const messages: ModelMessage[] = [toolMessage("1", "small")];
      expect(pruneSubagentToolResults(messages)).toBe(messages);
    });

    it("caps a single oversized tool result", () => {
      const messages: ModelMessage[] = [
        toolMessage("1", "x".repeat(MAX_SUBAGENT_TOOL_RESULT_CHARS + 5_000)),
      ];
      const pruned = pruneSubagentToolResults(messages);
      expect(pruned).not.toBe(messages);
      const text = firstToolResultText(pruned[0]);
      expect(text.length).toBeLessThanOrEqual(MAX_SUBAGENT_TOOL_RESULT_CHARS);
      expect(text).toContain("tool output truncated");
    });

    it("keeps the newest tool result and omits older ones past the budget", () => {
      const messages: ModelMessage[] = [
        toolMessage("old", "a".repeat(400)),
        toolMessage("mid", "b".repeat(400)),
        toolMessage("new", "c".repeat(400)),
      ];
      const pruned = pruneSubagentToolResults(messages, {
        maxToolResultChars: 1_000,
        maxTotalToolResultChars: 500,
      });
      // The newest result survives in full...
      expect(firstToolResultText(pruned[2])).toBe("c".repeat(400));
      // ...while the older ones are replaced by a placeholder, not deleted.
      expect(firstToolResultText(pruned[0])).toContain("omitted");
      expect(firstToolResultText(pruned[1])).toContain("omitted");
      expect(countToolResultParts(pruned)).toBe(countToolResultParts(messages));
    });

    it("never removes tool results so tool-call pairing survives", () => {
      const messages: ModelMessage[] = [
        toolMessage("1", "a".repeat(1_000)),
        toolMessage("2", "b".repeat(1_000)),
        toolMessage("3", "c".repeat(1_000)),
      ];
      const pruned = pruneSubagentToolResults(messages, {
        maxToolResultChars: 100,
        maxTotalToolResultChars: 150,
      });
      expect(countToolResultParts(pruned)).toBe(3);
      const ids = pruned.flatMap((message) => {
        if (message.role !== "tool") {
          return [];
        }
        return (message as ToolModelMessage).content.map(
          (part) => (part as { toolCallId: string }).toolCallId,
        );
      });
      expect(ids).toEqual(["1", "2", "3"]);
    });

    it("does not mutate the input messages", () => {
      const messages: ModelMessage[] = [toolMessage("1", "a".repeat(5_000))];
      const original = firstToolResultText(messages[0]);
      pruneSubagentToolResults(messages);
      expect(firstToolResultText(messages[0])).toBe(original);
    });
  });

  describe("pruneSubagentAssistantText", () => {
    it("keeps the newest assistant text and drops older prose", () => {
      const messages: ModelMessage[] = [
        assistantText("a".repeat(600)),
        assistantText("b".repeat(600)),
      ];
      const pruned = pruneSubagentAssistantText(messages, {
        maxTotalTextChars: 700,
      });
      const newest = pruned[1] as { content: Array<{ text?: string }> };
      expect(newest.content[0].text).toBe("b".repeat(600));
      const oldest = pruned[0] as { content: Array<{ text?: string }> };
      expect(oldest.content[0].text).toContain("omitted");
    });

    it("returns the original array when the budget is not exceeded", () => {
      const messages: ModelMessage[] = [assistantText("short")];
      expect(pruneSubagentAssistantText(messages)).toBe(messages);
    });

    it("does not touch tool-call parts", () => {
      const messages: ModelMessage[] = [
        {
          role: "assistant",
          content: [
            { type: "text", text: "a".repeat(600) },
            {
              type: "tool-call",
              toolCallId: "1",
              toolName: "read_file",
              input: { path: "a.ts" },
            },
          ],
        },
        assistantText("b".repeat(600)),
      ];
      const pruned = pruneSubagentAssistantText(messages, {
        maxTotalTextChars: 700,
      });
      const first = pruned[0] as {
        content: Array<{ type: string; text?: string; input?: unknown }>;
      };
      const toolCall = first.content[1];
      expect(toolCall.type).toBe("tool-call");
      expect(toolCall.input).toEqual({ path: "a.ts" });
    });
  });

  describe("pruneSubagentMessages", () => {
    it("applies both the tool-result and the assistant-text budgets", () => {
      const messages: ModelMessage[] = [
        assistantText("a".repeat(600)),
        toolMessage("1", "b".repeat(1_000)),
        assistantText("c".repeat(600)),
      ];
      const pruned = pruneSubagentMessages(messages, {
        maxToolResultChars: 200,
        maxTotalToolResultChars: 200,
        maxTotalAssistantTextChars: 700,
      });
      expect(countToolResultParts(pruned)).toBe(1);
      const oldest = pruned[0] as { content: Array<{ text?: string }> };
      expect(oldest.content[0].text).toContain("omitted");
    });

    it("uses the default assistant-text budget", () => {
      const messages: ModelMessage[] = [
        assistantText("a".repeat(MAX_SUBAGENT_TOTAL_ASSISTANT_TEXT_CHARS)),
      ];
      expect(pruneSubagentMessages(messages)).toBe(messages);
    });
  });

  describe("boundReportForParent", () => {
    it("returns short reports unchanged", () => {
      expect(boundReportForParent("short")).toBe("short");
    });

    it("bounds long reports while keeping head and tail", () => {
      const report = `${"h".repeat(500)}\n${"t".repeat(500)}`;
      const bounded = boundReportForParent(report, 200);
      expect(bounded.length).toBeLessThanOrEqual(200);
      expect(bounded).toContain("report truncated");
      expect(bounded.startsWith("h")).toBe(true);
      expect(bounded.endsWith("t")).toBe(true);
    });

    it("uses the default cap", () => {
      const bounded = boundReportForParent("x".repeat(50_000));
      expect(bounded.length).toBeLessThanOrEqual(MAX_PARENT_REPORT_CHARS);
    });
  });

  describe("boundSubagentSummariesForParent", () => {
    it("bounds the report but keeps the other result fields", () => {
      const summaries = [
        makeSummary({
          result: { report: "x".repeat(50_000), extra: "kept" },
        }),
      ];
      const bounded = boundSubagentSummariesForParent(summaries);
      const report = bounded[0].result?.report;
      expect(typeof report).toBe("string");
      expect((report as string).length).toBeLessThanOrEqual(
        MAX_PARENT_REPORT_CHARS,
      );
      expect(bounded[0].result?.extra).toBe("kept");
    });

    it("does not mutate the input summaries", () => {
      const summaries = [
        makeSummary({ result: { report: "x".repeat(50_000) } }),
      ];
      const original = summaries[0].result?.report;
      boundSubagentSummariesForParent(summaries);
      expect(summaries[0].result?.report).toBe(original);
    });

    it("enforces a shared total budget across summaries", () => {
      const summaries = [
        makeSummary({ id: "a", result: { report: "a".repeat(5_000) } }),
        makeSummary({ id: "b", result: { report: "b".repeat(5_000) } }),
        makeSummary({ id: "c", result: { report: "c".repeat(5_000) } }),
      ];
      const bounded = boundSubagentSummariesForParent(summaries, {
        perReportChars: 5_000,
        totalReportChars: 6_000,
      });
      const total = bounded.reduce((sum, summary) => {
        const report = summary.result?.report;
        return sum + (typeof report === "string" ? report.length : 0);
      }, 0);
      expect(total).toBeLessThanOrEqual(6_000);
      expect(bounded[2].result?.report).toContain("report omitted");
    });

    it("truncates long assignments and errors", () => {
      const summaries = [
        makeSummary({
          assignment: "a".repeat(10_000),
          error: "e".repeat(10_000),
        }),
      ];
      const bounded = boundSubagentSummariesForParent(summaries);
      expect(bounded[0].assignment.length).toBeLessThan(10_000);
      expect(bounded[0].assignment).toContain("assignment truncated");
      expect(bounded[0].error).toContain("error truncated");
    });

    it("leaves summaries without a report untouched", () => {
      const summaries = [makeSummary({ result: null })];
      const bounded = boundSubagentSummariesForParent(summaries);
      expect(bounded[0].result).toBeNull();
    });
  });

  describe("boundAssignmentForModel", () => {
    it("leaves a short assignment untouched", () => {
      expect(boundAssignmentForModel("Fix the auth flow")).toBe(
        "Fix the auth flow",
      );
    });

    it("bounds a long assignment but keeps the head and the tail", () => {
      const assignment = `${"H".repeat(9_000)}TAIL-MARKER`;
      const bounded = boundAssignmentForModel(assignment);
      expect(bounded.length).toBeLessThanOrEqual(MAX_SUBAGENT_ASSIGNMENT_CHARS);
      expect(bounded).toContain("assignment truncated");
      expect(bounded.startsWith("H")).toBe(true);
      expect(bounded.endsWith("TAIL-MARKER")).toBe(true);
    });

    it("honours a custom cap", () => {
      const bounded = boundAssignmentForModel("z".repeat(1_000), 200);
      expect(bounded.length).toBeLessThanOrEqual(200);
    });
  });

  describe("boundSubagentAssignmentsForModel", () => {
    it("bounds the original assignment harder than the current one", () => {
      const bounded = boundSubagentAssignmentsForModel({
        originalAssignment: "o".repeat(20_000),
        currentAssignment: "c".repeat(90_000),
      });
      expect(bounded.originalAssignment.length).toBeLessThanOrEqual(
        MAX_SUBAGENT_ASSIGNMENT_CHARS,
      );
      expect(bounded.currentAssignment.length).toBeLessThanOrEqual(
        MAX_SUBAGENT_CURRENT_ASSIGNMENT_CHARS,
      );
      expect(bounded.currentAssignment.length).toBeGreaterThan(
        bounded.originalAssignment.length,
      );
    });

    it("leaves small assignments alone", () => {
      expect(
        boundSubagentAssignmentsForModel({
          originalAssignment: "one",
          currentAssignment: "two",
        }),
      ).toEqual({ originalAssignment: "one", currentAssignment: "two" });
    });
  });
});
