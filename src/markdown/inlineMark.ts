/**
 * MDAST transformer for ==highlight==, ^superscript^, and ~subscript~ syntax.
 *
 * Called AFTER `processor.parse()` because remark transformer plugins don't
 * run when using `processor.parse()` directly. This function walks the MDAST
 * manually and converts text nodes that match these patterns into custom inline
 * node types ("mark", "superscript", "subscript").
 *
 * Because remark-parse, remark-gfm, and remark-math have already tokenized code
 * spans, code fences, math, links, etc. into their own MDAST nodes, the text
 * nodes we visit here are guaranteed to be plain text — no need to guard against
 * those contexts.
 *
 * Conflict notes:
 * - ~~strikethrough~~ → already a `delete` MDAST node; our walker never sees it
 * - $x^2$ math → already an `inlineMath` node; skipped by the walker
 * - `code` spans → already `inlineCode` nodes; skipped by the walker
 */

import type { PhrasingContent, Root } from "mdast";

// ── Pattern definitions ────────────────────────────────────────────────────────

type InlineMarkNodeType = "mark" | "superscript" | "subscript";

const PATTERNS: ReadonlyArray<{ regex: RegExp; nodeType: InlineMarkNodeType }> = [
  { regex: /==([^=\n]+)==/g, nodeType: "mark" },
  { regex: /\^([^^\n]+)\^/g, nodeType: "superscript" },
  // ~text~ but skip ~~text~~ (handled as strikethrough by remark-gfm)
  { regex: /(?<!~)~([^~\n]+)~(?!~)/g, nodeType: "subscript" },
];

// ── Text splitting ─────────────────────────────────────────────────────────────

function splitOn(
  text: string,
  regex: RegExp,
  nodeType: InlineMarkNodeType
): PhrasingContent[] {
  const result: PhrasingContent[] = [];
  let last = 0;
  regex.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = regex.exec(text)) !== null) {
    if (m.index > last) result.push({ type: "text", value: text.slice(last, m.index) });
    result.push({
      type: nodeType,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      children: [{ type: "text", value: m[1] }],
    } as unknown as PhrasingContent);
    last = m.index + m[0].length;
  }
  if (last < text.length) result.push({ type: "text", value: text.slice(last) });
  return result;
}

/** Apply all patterns sequentially, recursing into text parts after each split. */
function applyPatterns(text: string): PhrasingContent[] {
  for (const { regex, nodeType } of PATTERNS) {
    const parts = splitOn(text, regex, nodeType);
    if (parts.length > 1 || (parts.length === 1 && parts[0].type !== "text")) {
      return parts.flatMap((part) =>
        part.type === "text"
          ? applyPatterns((part as { type: "text"; value: string }).value)
          : [part]
      );
    }
  }
  return [{ type: "text", value: text }];
}

// ── MDAST walker ──────────────────────────────────────────────────────────────

// Nodes whose children are phrasing content (inline)
const PHRASING_PARENTS = new Set([
  "paragraph", "heading", "tableCell", "tableHeader",
  // also apply inside delete/emphasis/strong/link so nested marks work
  "delete", "emphasis", "strong", "link",
]);

// Nodes that are opaque — their text content must not be transformed
const OPAQUE = new Set([
  "code", "inlineCode", "inlineMath", "math", "html",
  "image", "imageReference", "linkReference",
]);

function transformChildren(nodes: PhrasingContent[]): PhrasingContent[] {
  const result: PhrasingContent[] = [];
  for (const node of nodes) {
    if (OPAQUE.has(node.type)) {
      result.push(node);
      continue;
    }
    if (node.type === "text") {
      result.push(...applyPatterns((node as { type: "text"; value: string }).value));
      continue;
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if ("children" in node && Array.isArray((node as any).children)) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (node as any).children = transformChildren((node as any).children);
    }
    result.push(node);
  }
  return result;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function walkBlock(node: any): void {
  if (!node || typeof node !== "object") return;
  if (OPAQUE.has(node.type)) return;

  if (PHRASING_PARENTS.has(node.type) && Array.isArray(node.children)) {
    node.children = transformChildren(node.children);
    return; // don't double-recurse — transformChildren already handled descendants
  }

  if (Array.isArray(node.children)) {
    for (const child of node.children) walkBlock(child);
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

export function transformInlineMarks(tree: Root): void {
  for (const child of tree.children) walkBlock(child);
}
