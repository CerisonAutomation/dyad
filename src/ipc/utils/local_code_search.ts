import Fuse from "fuse.js";

export interface SearchableCodeFile {
  path: string;
  content: string;
}
export interface LocalCodeSearchResult {
  path: string;
  score: number;
  match: "lexical" | "fuzzy";
}
const MAX_FILES = 10_000;
const MAX_FILE_CHARS = 100_000;
const MAX_TOTAL_CHARS = 8_000_000;

/** Local retrieval, not embedding/semantic search. Never sends source to a server.
 * Work is bounded and results deterministic. Existing codebase extraction owns
 * Git ignore/path safety; additionally exclude credential-like paths here.
 */
export function searchLocalCode(
  query: string,
  files: readonly SearchableCodeFile[],
  limit = 20,
) {
  const normalized = query.trim().toLowerCase().slice(0, 2000);
  const terms = [...new Set(normalized.match(/[\p{L}\p{N}_$]+/gu) ?? [])];
  if (!terms.length)
    return {
      results: [] as LocalCodeSearchResult[],
      indexedFiles: 0,
      truncated: false,
    };
  const candidates: { path: string; symbols: string; score: number }[] = [];
  let chars = 0;
  let truncated = false;
  const sorted = [...files].sort((a, b) => a.path.localeCompare(b.path));
  for (const file of sorted) {
    if (
      /(^|[/\\])(\.git|\.env[^/\\]*)([/\\]|$)|\.(pem|key|p12)$/i.test(file.path)
    )
      continue;
    if (candidates.length >= MAX_FILES || chars >= MAX_TOTAL_CHARS) {
      truncated = true;
      break;
    }
    const content = file.content.slice(
      0,
      Math.min(MAX_FILE_CHARS, MAX_TOTAL_CHARS - chars),
    );
    chars += content.length;
    if (content.length < file.content.length) truncated = true;
    const name = file.path.toLowerCase();
    const lower = content.toLowerCase();
    const matched = terms.filter(
      (term) => name.includes(term) || lower.includes(term),
    );
    const score = matched.length
      ? matched.length / terms.length +
        terms.filter((term) => name.includes(term)).length / terms.length +
        (name.includes(normalized) ? 2 : 0) +
        (lower.includes(normalized) ? 1 : 0)
      : 0;
    const symbols = [
      ...content.matchAll(
        /\b(?:function|class|interface|type|const|let|def|fn)\s+([\w$]+)/g,
      ),
    ]
      .slice(0, 300)
      .map((match) => match[1])
      .join(" ");
    candidates.push({ path: file.path, symbols, score });
  }
  const ranked: LocalCodeSearchResult[] = candidates
    .filter((file) => file.score > 0)
    .map(({ path, score }) => ({ path, score, match: "lexical" }));
  const seen = new Set(ranked.map((file) => file.path));
  const fuzzy = new Fuse(candidates, {
    keys: ["path", "symbols"],
    includeScore: true,
    threshold: 0.4,
    ignoreLocation: true,
  });
  for (const hit of fuzzy.search(normalized, { limit: 20 })) {
    if (!seen.has(hit.item.path)) {
      ranked.push({
        path: hit.item.path,
        score: 0.5 * (1 - (hit.score ?? 1)),
        match: "fuzzy",
      });
      seen.add(hit.item.path);
    }
  }
  ranked.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));
  return {
    results: ranked.slice(0, Math.max(1, Math.min(100, limit))),
    indexedFiles: candidates.length,
    truncated,
  };
}
