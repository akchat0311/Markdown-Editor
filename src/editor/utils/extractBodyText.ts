import type { JSONContent } from "@tiptap/core";

// Excluded nodes return " " (not "") to prevent adjacent tokens from
// concatenating into a synthetic uppercase match (e.g. ECU`V`CAN → "ECU CAN").
export function extractBodyText(node: JSONContent): string {
  if (node.type === "codeBlock") return " ";
  if (typeof node.text === "string") {
    const marks = node.marks ?? [];
    if (marks.some((m) => m.type === "code")) return " ";
    return node.text;
  }
  if (!Array.isArray(node.content)) return "";
  return node.content.map(extractBodyText).join("");
}
