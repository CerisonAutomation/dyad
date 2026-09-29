import { describe, expect, it } from "vitest";

import { extractReviewJson } from "./review_result";

const VALID = {
  status: "no_findings",
  findings: [],
  summary: "looks fine",
};

describe("extractReviewJson", () => {
  it("returns raw JSON unchanged", () => {
    expect(extractReviewJson(JSON.stringify(VALID))).toBe(JSON.stringify(VALID));
  });

  it("unwraps a fenced block", () => {
    const raw = "```json\n" + JSON.stringify(VALID) + "\n```";
    expect(extractReviewJson(raw)).toBe(JSON.stringify(VALID));
  });

  it("finds JSON after a prose preamble", () => {
    // The model routinely narrates before answering. The old extractor was
    // anchored to ^```...```$ so anything around the fence discarded the whole
    // result, which surfaced as "the reviewer returned an invalid structured
    // result".
    const raw = `Here's my review of the diff.\n\n\`\`\`json\n${JSON.stringify(VALID)}\n\`\`\``;
    expect(() => JSON.parse(extractReviewJson(raw))).not.toThrow();
    expect(JSON.parse(extractReviewJson(raw))).toEqual(VALID);
  });

  it("finds bare JSON embedded in prose", () => {
    const raw = `Review complete: ${JSON.stringify(VALID)} — let me know if you want detail.`;
    expect(JSON.parse(extractReviewJson(raw))).toEqual(VALID);
  });

  it("does not stop at a brace inside a string value", () => {
    const payload = {
      status: "findings",
      findings: [
        {
          severity: "low",
          path: "a.ts",
          title: 'brace " in a title } {',
          impact: "x",
          remediation: "y",
        },
      ],
      summary: "s",
    };
    const raw = `preamble ${JSON.stringify(payload)}`;
    expect(JSON.parse(extractReviewJson(raw))).toEqual(payload);
  });

  it("respects escaped quotes", () => {
    const payload = { ...VALID, summary: 'has \\"quotes\\" and } brace' };
    const raw = `text ${JSON.stringify(payload)} more text`;
    expect(JSON.parse(extractReviewJson(raw))).toEqual(payload);
  });

  it("returns the input when nothing parses, rather than throwing", () => {
    const raw = "I could not review the diff, the tool timed out.";
    expect(extractReviewJson(raw)).toBe(raw);
  });
});
