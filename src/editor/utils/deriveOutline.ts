import type { Editor } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import type { OutlineNode } from "@/types/outline";

/**
 * Derives a heading-only outline tree from the live Tiptap editor.
 *
 * Uses doc.forEach() (direct children) as the primary scan, and recurses one
 * level into blockquote / callout nodes to find headings inside them.
 *
 * Two distinct positions per node:
 *   pmPos  — ProseMirror absolute offset of the heading, used for navigation
 *   index  — 0-based index in doc.content[] of the heading or its container,
 *            used for structural ops (moveSectionBefore, deleteSection, etc.)
 *
 * Headings inside containers use the container's top-level index so that
 * structural ops (move, delete, duplicate) act on the whole blockquote section.
 */
export function deriveOutline(editor: Editor | null): OutlineNode[] {
  if (!editor) return [];

  const roots: OutlineNode[] = [];
  const stack: OutlineNode[] = [];

  function pushHeading(
    node: PMNode,
    pmPos: number,
    topLevelIndex: number,
    readonly?: true,
  ) {
    const level = (node.attrs.level as number) ?? 1;
    const outlineNode: OutlineNode = {
      key: `heading:${pmPos}`,
      type: "heading",
      level,
      label: node.textContent || "Untitled",
      pmPos,
      index: topLevelIndex,
      children: [],
      ...(readonly ? { readonly } : {}),
    };
    while (stack.length && (stack[stack.length - 1].level ?? 0) >= level) {
      stack.pop();
    }
    (stack.length ? stack[stack.length - 1].children : roots).push(outlineNode);
    stack.push(outlineNode);
  }

  editor.state.doc.forEach((node: PMNode, offset: number, index: number) => {
    if (node.type.name === "heading") {
      pushHeading(node, offset, index);
    } else if (node.type.name === "blockquote" || node.type.name === "callout") {
      // One level deep: find headings directly inside blockquotes / callouts.
      node.forEach((child: PMNode, childOffset: number) => {
        if (child.type.name === "heading") {
          // offset + 1: skip the container's opening token to get the child's absolute pos
          pushHeading(child, offset + 1 + childOffset, index);
        }
      });
    }
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
