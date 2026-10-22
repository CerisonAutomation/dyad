import { describe, expect, it, vi } from "vitest";
import {
  estimateToolResultTokens,
  jsonSerializedLength,
  jsonStringLength,
} from "@/ipc/utils/token_utils";

/**
 * `jsonSerializedLength` must agree with `JSON.stringify(...).length`
 * exactly, because `estimateToolResultTokens` is compared against the
 * serialized form in the existing suite and because a drift would silently
 * change when compaction triggers.
 */
describe("jsonSerializedLength", () => {
  it("matches JSON.stringify for primitives", () => {
    const values = [
      null,
      true,
      false,
      0,
      -0,
      1,
      -1,
      3.5,
      1e21,
      1e-7,
      Number.MAX_SAFE_INTEGER,
      "",
      "hello",
      'quote " backslash \\ newline \n tab \t',
      "\u0000\u001f",
      "emoji 😀 and 中文",
      Number.NaN,
      Number.POSITIVE_INFINITY,
    ];
    for (const value of values) {
      expect(jsonSerializedLength(value)).toBe(JSON.stringify(value).length);
    }
  });

  it("matches JSON.stringify for strings with control characters and quotes", () => {
    const samples = [
      'a"b',
      "a\\b",
      "line1\nline2",
      "\u0000",
      "\u001f",
      'mixed "quotes" and \\slashes\\ and \ttabs',
      "\ud800", // lone high surrogate
      "\udc00", // lone low surrogate
      "😀", // valid surrogate pair
      "a😀b",
    ];
    for (const sample of samples) {
      expect(jsonStringLength(sample)).toBe(JSON.stringify(sample).length);
    }
  });

  it("matches JSON.stringify for nested structures", () => {
    const values: unknown[] = [
      [],
      {},
      [1, 2, 3],
      { a: 1, b: "two", c: [3, { d: null }] },
      { nested: { deeper: { deepest: ["x", { y: true }] } } },
      [null, true, false, 0, "", {}],
      { "key with spaces": 'value with "quotes"' },
      { "": "" },
      [{ a: [1, [2, [3]]] }],
    ];
    for (const value of values) {
      expect(jsonSerializedLength(value)).toBe(JSON.stringify(value).length);
    }
  });

  it("omits undefined object properties exactly like JSON.stringify", () => {
    const value = { a: undefined, b: 1, c: undefined };
    expect(jsonSerializedLength(value)).toBe(JSON.stringify(value).length);
    expect(jsonSerializedLength(value)).toBe(JSON.stringify({ b: 1 }).length);
  });

  it("treats undefined array entries as null exactly like JSON.stringify", () => {
    const value = [1, undefined, 2];
    expect(jsonSerializedLength(value)).toBe(JSON.stringify(value).length);
  });

  it("matches JSON.stringify for random generated values", () => {
    let seed = 12345;
    const random = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    const build = (depth: number): unknown => {
      const roll = random();
      if (depth > 3 || roll < 0.35) {
        const pick = Math.floor(random() * 6);
        if (pick === 0) return null;
        if (pick === 1) return random() < 0.5;
        if (pick === 2) return Math.floor(random() * 1000) - 500;
        if (pick === 3) return "";
        if (pick === 4) return 'text "q" \\ \n \t ' + random();
        return Math.random() < 0.5 ? 0 : -0;
      }
      if (roll < 0.7) {
        const length = Math.floor(random() * 4);
        return Array.from({ length }, () => build(depth + 1));
      }
      const length = Math.floor(random() * 4);
      const record: Record<string, unknown> = {};
      for (let i = 0; i < length; i++) {
        record[`k${i}`] = build(depth + 1);
      }
      return record;
    };

    for (let i = 0; i < 500; i++) {
      const value = build(0);
      expect(jsonSerializedLength(value)).toBe(JSON.stringify(value).length);
    }
  });
});

describe("estimateToolResultTokens", () => {
  it("measures the payload without serializing it", () => {
    const stringifySpy = vi.spyOn(JSON, "stringify");
    try {
      const tokens = estimateToolResultTokens([
        {
          toolCallId: "call-1",
          toolName: "read_file",
          output: "x".repeat(2_000_000),
        },
      ]);
      expect(tokens).toBeGreaterThan(0);
      // The old implementation JSON.stringify'd the whole payload just to
      // take its `.length`, allocating megabytes per step.
      expect(stringifySpy).not.toHaveBeenCalled();
    } finally {
      stringifySpy.mockRestore();
    }
  });
});
