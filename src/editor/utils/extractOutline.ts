import type { JSONContent } from "@tiptap/core";
import type { OutlineNode } from "@/types/outline";

function textContent(node: JSONContent): string {
  if (node.type === "text") return node.text ?? "";
  return (node.content ?? []).map(textContent).join("");
}

export function extractOutline(doc: JSONContent): OutlineNode[] {
  const topLevel = doc.content ?? [];
  const roots: OutlineNode[] = [];
  const stack: OutlineNode[] = [];

  topLevel.forEach((node, index) => {
    if (node.type === "heading") {
      const level = (node.attrs?.level as number) ?? 1;
      const label = textContent(node) || "Untitled";
      const outlineNode: OutlineNode = {
        key: `heading:${index}`,
        type: "heading",
        level,
        label,
        pmPos: index,
        index,
        children: [],
      };
      while (stack.length > 0 && (stack[stack.length - 1].level ?? 0) >= level) {
        stack.pop();
      }
      (stack.length === 0 ? roots : stack[stack.length - 1].children).push(outlineNode);
      stack.push(outlineNode);
    } else if (node.type === "table" || node.type === "image") {
      const type = node.type as "table" | "image";
      const label =
        type === "table"
          ? "Table"
          : String(node.attrs?.alt ?? node.attrs?.src ?? "Image");
      const outlineNode: OutlineNode = {
        key: `${type}:${index}`,
        type,
        label,
        pmPos: index,
        index,
        children: [],
      };
      (stack.length === 0 ? roots : stack[stack.length - 1].children).push(outlineNode);
    }
  });

  return roots;
}
