/**
 * MDAST transformer that preserves HTML character-reference spelling through
 * the parse → edit → serialize pipeline.
 *
 * Problem
 * -------
 * remark-parse decodes every character reference it encounters and merges the
 * decoded value into the surrounding text node.  `&amp;` becomes `&`, `&#65;`
 * becomes `A`, `&nbsp;` becomes U+00A0.  The original spelling is permanently
 * discarded; the serializer has no way to reconstruct it.
 *
 * Solution
 * --------
 * Before the MDAST tree is converted to ProseMirror nodes, walk every `text`
 * node that still carries its original source position.  Slice the markdown
 * source at those offsets, scan for character-reference patterns, and split
 * the text node into a sequence of `text` and `html` inline nodes.  Each
 * `html` node carries the verbatim entity spelling (`&amp;`, `&#65;`, …).
 *
 * These `html` nodes flow into `flattenSingleNode`'s existing `case "html"`
 * branch, which maps them to `rawHtmlInline` atoms.  The serializer emits
 * rawHtmlInline atoms verbatim, so the entity spelling is preserved on save.
 *
 * Ordering constraint
 * -------------------
 * Call this transformer BEFORE `transformInlineMarks`.  Text nodes created by
 * `transformInlineMarks` do not carry source positions (they are synthetic
 * slices of decoded text), so they are silently skipped by this transformer.
 * Calling this first ensures all original text nodes are reachable.
 *
 * Entity detection
 * ----------------
 * The regex matches `&name;`, `&#DDD;`, and `&#xHH;` patterns in the raw
 * source slice.  For each match we determine whether remark actually decoded
 * it (valid entity → decoded value is 1 character, different from the source
 * spelling) or left it as-is (unknown/invalid entity → source and decoded text
 * agree at that position).  In both cases we emit a `html` node for the
 * spelling; the decoded-position tracking just needs to advance by 1 vs.
 * entity length accordingly.
 *
 * Entities preceded by an odd number of backslashes (`\&amp;`) are backslash-
 * escaped in CommonMark and were never treated as character references by
 * remark.  They are excluded from replacement.
 */

import type { Root, PhrasingContent } from "mdast";

// ── Patterns ──────────────────────────────────────────────────────────────────

/**
 * Matches any HTML character reference:
 *   &name;    named          e.g. &amp; &lt; &nbsp;
 *   &#DDD;    decimal        e.g. &#65;
 *   &#xHH;   hex            e.g. &#x41; &#xFF;
 */
const ENTITY_RE =
  /&(?:#[xX][0-9a-fA-F]+|#[0-9]+|[a-zA-Z][a-zA-Z0-9]*);/g;

/**
 * ASCII punctuation characters that CommonMark allows to be escaped with `\`.
 * A backslash before one of these characters consumes the backslash and emits
 * the literal character (removing it from entity or markdown interpretation).
 */
const ESCAPABLE = new Set(
  '!"#$%&\'()*+,-./:;<=>?@[\\]^_`{|}~'
);

function isEscapable(ch: string): boolean {
  return ESCAPABLE.has(ch);
}

// ── Core splitting logic ───────────────────────────────────────────────────────

interface Part {
  type: "text" | "html";
  value: string;
}

/**
 * Given the raw source slice corresponding to a text MDAST node and that
 * node's decoded value, find all HTML character references in the source slice
 * and return a sequence of plain-text and html parts.
 *
 * Returns null when no entities are found (caller skips the node unchanged).
 *
 * The parallel (si, di) walk keeps source position and decoded position in
 * sync, correctly accounting for:
 *   - Backslash escapes (\X in source → 1 decoded char, 2 source chars)
 *   - Decoded entities  (&amp; in source → 1 decoded char (&))
 *   - Undecoded entities (&foo; in source → identical chars in decoded text)
 */
function splitAroundEntities(srcSlice: string, decoded: string): Part[] | null {
  // ── Step 1: collect non-escaped entity positions ──────────────────────────
  const entities: Array<{ si: number; entity: string }> = [];
  ENTITY_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = ENTITY_RE.exec(srcSlice)) !== null) {
    // Count consecutive backslashes immediately before the `&`
    let numBs = 0;
    let k = m.index - 1;
    while (k >= 0 && srcSlice[k] === "\\") {
      numBs++;
      k--;
    }
    // Odd number → the `&` is escaped, this is NOT a character reference
    if (numBs % 2 === 0) {
      entities.push({ si: m.index, entity: m[0] });
    }
  }

  if (entities.length === 0) return null;

  // ── Step 2: parallel walk ─────────────────────────────────────────────────
  const parts: Part[] = [];
  let si = 0;        // position in source slice
  let di = 0;        // position in decoded text
  let textStart = 0; // decoded start of the current plain-text segment

  for (const { si: entitySi, entity } of entities) {
    // Advance si → entitySi, tracking di in sync
    while (si < entitySi) {
      if (
        srcSlice[si] === "\\" &&
        si + 1 < srcSlice.length &&
        isEscapable(srcSlice[si + 1])
      ) {
        // Backslash escape: 2 source chars → 1 decoded char
        si += 2;
        di += 1;
      } else {
        si += 1;
        di += 1;
      }
    }

    // Emit any plain text accumulated before this entity
    if (di > textStart) {
      parts.push({ type: "text", value: decoded.slice(textStart, di) });
    }

    // Was this entity decoded by remark?
    // If the entity text appears verbatim in the decoded string at position di,
    // remark left it as-is (invalid/unknown entity → di advances by entity length).
    // Otherwise remark decoded it to exactly 1 character (di advances by 1).
    const entityLen = entity.length;
    const notDecoded =
      decoded.length >= di + entityLen &&
      decoded.slice(di, di + entityLen) === entity;

    parts.push({ type: "html", value: entity });
    si += entityLen;
    di += notDecoded ? entityLen : 1;
    textStart = di;
  }

  // Emit any remaining plain text after the last entity
  if (di < decoded.length) {
    parts.push({ type: "text", value: decoded.slice(di) });
  }

  return parts;
}

// ── MDAST walker ──────────────────────────────────────────────────────────────

/**
 * Node types whose text content is opaque (raw code, math, existing HTML).
 * These nodes must not have their children modified.
 */
const OPAQUE_TYPES = new Set([
  "code", "inlineCode", "math", "inlineMath", "html",
  "image", "imageReference", "linkReference", "definition",
]);

/**
 * Walk an array of phrasing content nodes, splitting text nodes that contain
 * character references and recursing into inline containers (emphasis, strong,
 * link, etc.) so that nested inline HTML is also preserved.
 */
function walkPhrasing(
  nodes: PhrasingContent[],
  source: string
): PhrasingContent[] {
  const result: PhrasingContent[] = [];

  for (const node of nodes) {
    if (OPAQUE_TYPES.has(node.type)) {
      result.push(node);
      continue;
    }

    // Text node with source position → try to split around entities
    if (
      node.type === "text" &&
      node.position?.start.offset !== undefined &&
      node.position?.end.offset !== undefined
    ) {
      const srcStart = node.position.start.offset;
      const srcEnd = node.position.end.offset;
      const srcSlice = source.slice(srcStart, srcEnd);
      const parts = splitAroundEntities(srcSlice, node.value);
      if (parts) {
        for (const p of parts) {
          if (p.type === "text") {
            result.push({ type: "text", value: p.value });
          } else {
            // Inline html node — picked up by flattenSingleNode's case "html"
            // and converted to a rawHtmlInline atom.
            result.push({ type: "html", value: p.value } as PhrasingContent);
          }
        }
        continue;
      }
    }

    // Non-text node or text node without a position: recurse into children
    if ("children" in node && Array.isArray((node as unknown as { children: PhrasingContent[] }).children)) {
      const inner = (node as unknown as { children: PhrasingContent[] }).children;
      const newNode = {
        ...node,
        children: walkPhrasing(inner, source),
      };
      result.push(newNode as PhrasingContent);
    } else {
      result.push(node);
    }
  }

  return result;
}

/**
 * Block-level walker.  Descends into blocks until it reaches a phrasing
 * container (paragraph, heading, table cell) and then calls walkPhrasing.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function walkBlock(node: any, source: string): void {
  if (!node || typeof node !== "object") return;
  if (OPAQUE_TYPES.has(node.type as string)) return;

  if (!Array.isArray(node.children)) return;

  // Phrasing containers: their direct children are phrasing content
  const PHRASING_CONTAINER = new Set([
    "paragraph", "heading", "tableCell",
  ]);

  if (PHRASING_CONTAINER.has(node.type as string)) {
    node.children = walkPhrasing(node.children as PhrasingContent[], source);
    return;
  }

  // Block containers: recurse into children
  for (const child of node.children) {
    walkBlock(child, source);
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Transform HTML character references in MDAST text nodes so they survive the
 * parse → serialize round-trip.
 *
 * Must be called BEFORE transformInlineMarks (which strips position info from
 * text nodes as it creates synthetic split nodes).
 *
 * @param tree   The MDAST root produced by remark-parse.
 * @param source The original markdown source string.
 */
export function transformHtmlEntities(tree: Root, source: string): void {
  for (const child of tree.children) {
    walkBlock(child, source);
  }
}
