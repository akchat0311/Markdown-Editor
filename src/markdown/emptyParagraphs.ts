import type { PMNode } from "./types";

/**
 * Drop empty top-level paragraphs before serialization.
 *
 * An empty paragraph is real to ProseMirror (pressing Enter creates one) but
 * has no markdown representation: serializing it produces stray blank lines
 * that disappear again on re-parse. Letting them through desynchronizes the
 * editor from the file (invisible-in-editor blank lines on disk) and breaks
 * the D9 merge's fixed-point assumption. Treat them as ephemeral UI state:
 * the editor keeps the node (the caret needs somewhere to sit), the file
 * never sees it; the paragraph starts serializing the moment it gets text.
 *
 * Applies to top-level paragraphs and, recursively, to paragraphs inside
 * blockquotes/callouts (Enter there left stray ">" lines in the file).
 * Never the last remaining child; list items and table cells are left
 * untouched — their empty paragraphs are structural.
 */
const CONTAINER_NODES = new Set(["blockquote", "callout"]);

function isEmptyParagraph(node: PMNode): boolean {
  return (
    node.type === "paragraph" && (node.content === undefined || node.content.length === 0)
  );
}

function stripIn(node: PMNode): PMNode {
  if (!node.content) return node;
  const kept = node.content
    .filter((child) => !isEmptyParagraph(child))
    .map((child) =>
      child.type !== undefined && CONTAINER_NODES.has(child.type) ? stripIn(child) : child,
    );
  if (kept.length === node.content.length && kept.every((c, i) => c === node.content![i])) {
    return node;
  }
  return { ...node, content: kept.length > 0 ? kept : [{ type: "paragraph" }] };
}

export function stripEmptyTopLevelParagraphs(doc: PMNode): PMNode {
  return stripIn(doc);
}
