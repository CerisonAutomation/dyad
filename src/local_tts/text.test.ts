import { expect, it } from "vitest";
import { splitSpeechText } from "./text";
it("chunks long speech without dropping text", () => {
  const text = Array.from({ length: 300 }, () => "word").join(" ");
  const chunks = splitSpeechText(text);
  expect(chunks.every((chunk) => chunk.length <= 240)).toBe(true);
  expect(chunks.join(" ")).toBe(text);
});
it("preserves unbroken words and surrogate pairs", () => {
  const text = "a".repeat(239) + "😀" + "b".repeat(500);
  const chunks = splitSpeechText(text);
  expect(chunks.join("")).toBe(text);
  expect(chunks.every((chunk) => !/[\uD800-\uDBFF]$/.test(chunk))).toBe(true);
});
it("rejects input outside the bounded speech allowance", () => {
  expect(() => splitSpeechText(" ")).toThrow();
  expect(() => splitSpeechText("x".repeat(4001))).toThrow();
});
