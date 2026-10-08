import type { PMNode } from "./types";

/**
 * Webview-side transforms between the parser/serializer representation of
 * soft line breaks (raw `\n` inside text nodes — what parseMarkdownToDoc
 * emits and serializeDocToMarkdown expects) and the editor representation
 * (explicit `softBreak` inline nodes — safe in Chromium contentEditable).
 * See SoftBreak.ts for why raw `\n` cannot live in the editable DOM.
 *
 * Both transforms are pure and return new trees; marks carry across so a
 * wrap inside e.g. bold stays inside the bold group when serialized.
 */

/**
 * Nodes whose text content is literal — a `\n` there is real content, not a
 * soft wrap, and the schema would silently drop inline softBreak nodes
 * (observed: mermaid/code fences losing their newlines).
 */
const LITERAL_TEXT_NODES = new Set(["codeBlock"]);

export function expandSoftBreaks(node: PMNode): PMNode {
  if (node.type !== undefined && LITERAL_TEXT_NODES.has(node.type)) return node;
  const out: PMNode = { ...node };
  if (node.content) {
    // Soft breaks belong to PARAGRAPHS only. Headings are single-line
    // constructs — a newline there (e.g. an &#xA; entity in a damaged file)
    // is normalized to a space, never a softBreak node (a break inside a
    // heading broke status detection and triggered a runaway [Draft]
    // auto-insert loop; user report 2026-09-01).
    const isParagraph = node.type === "paragraph";
    const children: PMNode[] = [];
    for (const child of node.content) {
      if (child.type === "text" && typeof child.text === "string" && child.text.includes("\n")) {
        if (!isParagraph) {
          children.push({ ...child, text: child.text.replace(/\n+/g, " ") });
          continue;
        }
        const segments = child.text.split("\n");
        segments.forEach((segment, i) => {
          if (segment.length > 0) children.push({ ...child, text: segment });
          if (i < segments.length - 1) {
            children.push({ type: "softBreak", ...(child.marks ? { marks: child.marks } : {}) });
          }
        });
      } else {
        children.push(expandSoftBreaks(child));
      }
    }
    out.content = children;
  }
  return out;
}

export function collapseSoftBreaks(node: PMNode): PMNode {
  if (node.type !== undefined && LITERAL_TEXT_NODES.has(node.type)) return node;
  const out: PMNode = { ...node };
  if (node.content) {
    // A soft break is only meaningful BETWEEN two runs of text. Editing can
    // strand one at a block edge (splitting a paragraph at a wrap point puts
    // the softBreak at the new paragraph's head) — serialized, that becomes
    // a stray newline: a phantom blank line above the user's new line
    // (user report, 2026-09-01). Trim edge softBreaks and collapse runs.
    const children = [...node.content];
    while (children.length > 0 && children[0].type === "softBreak") children.shift();
    while (children.length > 0 && children[children.length - 1].type === "softBreak") {
      children.pop();
    }
    const deduped = children.filter(
      (child, i) => !(child.type === "softBreak" && children[i - 1]?.type === "softBreak"),
    );
    // In a paragraph a softBreak collapses to "\n"; anywhere else (a heading
    // that acquired one through editing) it collapses to a space — headings
    // must stay single-line in markdown.
    const lineBreakText = node.type === "paragraph" ? "\n" : " ";
    out.content = deduped.map((child) =>
      child.type === "softBreak"
        ? ({ type: "text", text: lineBreakText, ...(child.marks ? { marks: child.marks } : {}) } as PMNode)
        : collapseSoftBreaks(child),
    );
  }
  return out;
}
