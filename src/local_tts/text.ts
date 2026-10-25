/** Bounded chunks prevent the speech tokenizer silently truncating long messages. */
export function splitSpeechText(text: string): string[] {
  if (!text.trim() || text.length > 4000)
    throw new Error("Local speech accepts 1–4000 characters at a time.");
  const chunks: string[] = [];
  let rest = text.trim();
  while (rest.length) {
    let end = Math.min(240, rest.length);
    if (end < rest.length) {
      const boundary = rest.lastIndexOf(" ", end);
      if (boundary > 120) end = boundary;
      const code = rest.charCodeAt(end - 1);
      if (code >= 0xd800 && code <= 0xdbff) end -= 1;
    }
    chunks.push(rest.slice(0, end));
    rest = rest.slice(end).trimStart();
  }
  return chunks;
}
