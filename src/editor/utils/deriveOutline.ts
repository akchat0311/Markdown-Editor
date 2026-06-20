import type { Editor } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import type { OutlineNode } from "@/types/outline";

/**
 * Derives a heading-only outline tree from the live Tiptap editor.
 *
 * Uses doc.forEach() (direct children only, which is where headings always live)
 * to capture two distinct positions per node:
 *   pmPos  — ProseMirror absolute offset, used for setTextSelection / scrollIntoView
 *   index  — 0-based index in doc.content[], used for structural operations
 *            (moveSectionBefore, deleteSection, etc.)
 *
 * Intentionally heading-only. For static JSON-based extraction that also covers
 * tables and images, use extractOutline() instead.
 */
export function deriveOutline(editor: Editor | null): OutlineNode[] {
  if (!editor) return [];

  const roots: OutlineNode[] = [];
  const stack: OutlineNode[] = [];

  editor.state.doc.forEach((node: PMNode, offset: number, index: number) => {
    if (node.type.name !== "heading") return;

    const level = (node.attrs.level as number) ?? 1;
    const label = node.textContent || "Untitled";

    const outlineNode: OutlineNode = {
      key: `heading:${offset}`,
      type: "heading",
      level,
      label,
      pmPos: offset,
      index,
      children: [],
    };

    while (stack.length && (stack[stack.length - 1].level ?? 0) >= level) {
      stack.pop();
    }
    (stack.length ? stack[stack.length - 1].children : roots).push(outlineNode);
    stack.push(outlineNode);
  });

  return roots;
}

/** Flattens a nested outline tree into document order. */
export function flattenOutline(nodes: OutlineNode[]): OutlineNode[] {
  return nodes.flatMap((n) => [n, ...flattenOutline(n.children)]);
}

/**
 * Returns the key of the heading whose section contains cursorPos.
 * Returns null when the cursor precedes all headings.
 */
export function findActiveHeadingKey(
  flat: OutlineNode[],
  cursorPos: number
): string | null {
  let activeKey: string | null = null;
  for (const node of flat) {
    if (node.pmPos <= cursorPos) {
      activeKey = node.key;
    } else {
      break;
    }
  }
  return activeKey;
}

/**
 * Finds the sibling list for a node by key.
 * Root-level nodes return the roots array itself.
 */
export function findSiblings(
  roots: OutlineNode[],
  key: string
): OutlineNode[] {
  if (roots.some((n) => n.key === key)) return roots;
  for (const node of roots) {
    const found = findSiblings(node.children, key);
    if (found.length > 0) return found;
  }
  return [];
}
