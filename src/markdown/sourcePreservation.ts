import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import { parseMarkdownToDoc } from "./parser";
import { serializeDocToMarkdown } from "./serializer";

/**
 * D9 fidelity layer — never rewrite untouched lines.
 *
 * The serializer is canonicalizing by design: `*` bullets become `-`,
 * 3/4-space list indents become 2-space, trailing hard-break spaces become
 * `\`, `1)` becomes `1.`. That determinism is what makes the sync loop
 * convergent — but re-emitting a whole document in canonical style rewrites
 * lines the user never touched, producing noisy diffs.
 *
 * mergePreservingUnchangedBlocks() reconciles the two: given the document's
 * current source and a fresh canonical serialization of the edited PM doc,
 * it aligns top-level blocks (heading, paragraph, list, table, code fence,
 * blockquote, html) and substitutes the ORIGINAL source text for every block
 * whose canonical form is unchanged. Only blocks the user actually edited
 * come out in canonical style. A no-edit round trip returns the original
 * text byte-for-byte.
 *
 * Granularity is the top-level block: an edit inside one list item
 * canonicalizes that whole list, nothing else. Degradation is always safe —
 * an unmatched block falls back to its canonical serialization; the merge
 * can never invent or corrupt content because every output byte comes from
 * either the original source or the canonical serialization.
 */

// Must mirror the parser's pipeline so block boundaries agree with it.
const blockProcessor = unified()
  .use(remarkParse)
  .use(remarkGfm, { singleTilde: false })
  .use(remarkMath);

interface Block {
  /** Verbatim source slice for this block. */
  text: string;
  /** Offset of the block start in its document. */
  start: number;
  /** Offset just past the block end in its document. */
  end: number;
}

function splitBlocks(markdown: string): Block[] {
  const root = blockProcessor.parse(markdown);
  const blocks: Block[] = [];
  for (const child of root.children) {
    const start = child.position?.start.offset;
    const end = child.position?.end.offset;
    if (start === undefined || end === undefined) continue;
    blocks.push({ text: markdown.slice(start, end), start, end });
  }
  return blocks;
}

/**
 * Canonical form of one block, via the full engine pipeline so it agrees
 * exactly with what serializeDocToMarkdown emits for the same content.
 * Trailing newlines are stripped for comparison (block slices don't include
 * the inter-block separator; serializer output ends with "\n").
 *
 * Cached: on every debounce tick only blocks not seen before are re-derived,
 * so steady-state cost is proportional to the edit, not the document.
 */
const canonicalCache = new Map<string, string>();
const CANONICAL_CACHE_LIMIT = 10_000;

function canonicalOf(blockText: string): string {
  const cached = canonicalCache.get(blockText);
  if (cached !== undefined) return cached;
  let canonical: string;
  try {
    canonical = serializeDocToMarkdown(parseMarkdownToDoc(blockText)).replace(/\n+$/, "");
  } catch {
    // A block that cannot round-trip in isolation (e.g. depends on document
    // context) simply never matches — safe fallback to canonical output.
    canonical = "\u0000unmatchable\u0000" + blockText;
  }
  if (canonicalCache.size >= CANONICAL_CACHE_LIMIT) canonicalCache.clear();
  canonicalCache.set(blockText, canonical);
  return canonical;
}

/** Longest-common-subsequence pairing of original ↔ canonical blocks. */
function matchBlocks(origCanon: string[], newCanon: string[]): Array<number | null> {
  const n = origCanon.length;
  const m = newCanon.length;

  // Trim the common prefix/suffix first — edits are local, so the LCS then
  // runs only over the changed middle window.
  let prefix = 0;
  while (prefix < n && prefix < m && origCanon[prefix] === newCanon[prefix]) prefix++;
  let suffix = 0;
  while (
    suffix < n - prefix &&
    suffix < m - prefix &&
    origCanon[n - 1 - suffix] === newCanon[m - 1 - suffix]
  ) {
    suffix++;
  }

  const midN = n - prefix - suffix;
  const midM = m - prefix - suffix;
  const dp: Uint32Array[] = Array.from(
    { length: midN + 1 },
    () => new Uint32Array(midM + 1),
  );
  for (let i = midN - 1; i >= 0; i--) {
    for (let j = midM - 1; j >= 0; j--) {
      dp[i][j] =
        origCanon[prefix + i] === newCanon[prefix + j]
          ? dp[i + 1][j + 1] + 1
          : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  /** For each NEW block index: the matching ORIGINAL block index, or null. */
  const match: Array<number | null> = new Array(m).fill(null);
  for (let k = 0; k < prefix; k++) match[k] = k;
  for (let k = 0; k < suffix; k++) match[m - 1 - k] = n - 1 - k;
  let i = 0;
  let j = 0;
  while (i < midN && j < midM) {
    if (origCanon[prefix + i] === newCanon[prefix + j]) {
      match[prefix + j] = prefix + i;
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      i++;
    } else {
      j++;
    }
  }
  return match;
}

/**
 * Merge a canonical serialization with the document's current source,
 * preserving every block whose content did not change. Both inputs are
 * LF-normalized (the engine's canonical form).
 */
export function mergePreservingUnchangedBlocks(
  originalMarkdown: string,
  canonicalMarkdown: string,
): string {
  if (originalMarkdown === canonicalMarkdown) return originalMarkdown;

  const origBlocks = splitBlocks(originalMarkdown);
  const newBlocks = splitBlocks(canonicalMarkdown);
  if (newBlocks.length === 0) return canonicalMarkdown;

  const origCanon = origBlocks.map((b) => canonicalOf(b.text));
  const newCanon = newBlocks.map((b) => b.text.replace(/\n+$/, ""));
  const match = matchBlocks(origCanon, newCanon);

  const parts: string[] = [];
  // Leading text before the first block (serializer emits none, but the
  // original may start with blank lines when its first block is preserved).
  const first = match[0];
  parts.push(
    first !== null && origBlocks[first].start > 0 && first === 0
      ? originalMarkdown.slice(0, origBlocks[0].start)
      : canonicalMarkdown.slice(0, newBlocks[0].start),
  );

  for (let j = 0; j < newBlocks.length; j++) {
    if (j > 0) {
      // Separator before block j: keep the original gap when this block and
      // the previous one are consecutive preserved originals (retains extra
      // blank lines and drops serializer-inserted list separators); otherwise
      // use the canonical serialization's own gap.
      const prev = match[j - 1];
      const cur = match[j];
      if (prev !== null && cur !== null && cur === prev + 1) {
        parts.push(originalMarkdown.slice(origBlocks[prev].end, origBlocks[cur].start));
      } else {
        parts.push(canonicalMarkdown.slice(newBlocks[j - 1].end, newBlocks[j].start));
      }
    }
    const orig = match[j];
    parts.push(orig !== null ? origBlocks[orig].text : newBlocks[j].text);
  }

  // Trailing text after the last block.
  const last = match[newBlocks.length - 1];
  parts.push(
    last === origBlocks.length - 1 && last !== null
      ? originalMarkdown.slice(origBlocks[last].end)
      : canonicalMarkdown.slice(newBlocks[newBlocks.length - 1].end),
  );

  const merged = parts.join("");

  // Safety gate: the merged text must parse to the same content as the
  // canonical serialization. Mixing preserved and canonical neighbors can,
  // in rare layouts, change block boundaries (e.g. two bullet lists becoming
  // adjacent after a deletion and fusing into one). The comparison is made
  // fixed-point-insensitive by re-canonicalizing BOTH sides: a canonical
  // input that is not itself a serializer fixed point (it once happened via
  // empty paragraphs serializing to stray blank lines) must not trip the
  // gate and nuke the whole document's preservation. On any mismatch the
  // preservation is discarded for this pass — the worst case is a canonical
  // rewrite, never corruption.
  try {
    const recanon = (text: string): string =>
      serializeDocToMarkdown(parseMarkdownToDoc(text));
    if (recanon(merged) !== recanon(canonicalMarkdown)) {
      return canonicalMarkdown;
    }
  } catch {
    return canonicalMarkdown;
  }
  return merged;
}
