import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import type {
  Blockquote,
  Image as MdastImage,
  List,
  PhrasingContent,
  Root,
  RootContent,
  Table,
} from "mdast";
import type { PMMark, PMNode } from "./types";
import { parseCalloutMarker } from "./calloutSyntax";
import { transformInlineMarks } from "./inlineMark";

// singleTilde: false — prevents ~text~ from being parsed as strikethrough so
// our custom subscript syntax (~text~) can coexist with ~~strikethrough~~
const processor = unified().use(remarkParse).use(remarkGfm, { singleTilde: false }).use(remarkMath);

export function parseMarkdownToDoc(markdown: string): PMNode {
  const tree = processor.parse(markdown) as Root;
  // Apply ==highlight==, ^sup^, ~sub~ transformations.
  // Must run after processor.parse() because transformer plugins don't run when
  // using parse() directly (they require process() or run()).
  transformInlineMarks(tree);
  const content = tree.children.map(blockToPM);
  return { type: "doc", content: content.length ? content : [{ type: "paragraph" }] };
}

function blockToPM(node: RootContent): PMNode {
  switch (node.type) {
    case "heading":
      return {
        type: "heading",
        attrs: { level: node.depth },
        content: flattenInline(node.children),
      };

    case "paragraph": {
      if (node.children.length === 1 && node.children[0].type === "image") {
        return imageNodeToPM(node.children[0]);
      }
      return { type: "paragraph", content: flattenInline(node.children) };
    }

    case "list":
      return listNodeToPM(node);

    case "blockquote":
      return blockquoteToPM(node);

    case "code":
      return {
        type: "codeBlock",
        attrs: { language: node.lang ?? null },
        content: node.value ? [{ type: "text", text: node.value }] : [],
      };

    // remark-math: block math ($$...$$) → codeBlock with sentinel language "$$"
    case "math":
      return {
        type: "codeBlock",
        attrs: { language: "$$" },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        content: (node as any).value ? [{ type: "text", text: (node as any).value }] : [],
      };

    case "thematicBreak":
      return { type: "horizontalRule" };

    case "table":
      return tableNodeToPM(node);

    case "html":
      return { type: "rawHtmlBlock", attrs: { html: node.value } };

    default:
      return { type: "paragraph", content: [] };
  }
}

function blocksOrEmpty(nodes: RootContent[]): PMNode[] {
  const blocks = nodes.map(blockToPM);
  return blocks.length ? blocks : [{ type: "paragraph" }];
}

function listNodeToPM(node: List): PMNode {
  const isTaskList = node.children.some(
    (li) => li.checked !== null && li.checked !== undefined
  );

  if (isTaskList) {
    return {
      type: "taskList",
      content: node.children.map((li) => ({
        type: "taskItem",
        attrs: { checked: Boolean(li.checked) },
        content: blocksOrEmpty(li.children),
      })),
    };
  }

  if (node.ordered) {
    return {
      type: "orderedList",
      attrs: { start: node.start ?? 1 },
      content: node.children.map((li) => ({
        type: "listItem",
        content: blocksOrEmpty(li.children),
      })),
    };
  }

  return {
    type: "bulletList",
    content: node.children.map((li) => ({
      type: "listItem",
      content: blocksOrEmpty(li.children),
    })),
  };
}

function blockquoteToPM(node: Blockquote): PMNode {
  const [first, ...rest] = node.children;
  if (first?.type === "paragraph") {
    const calloutType = parseCalloutMarker(flattenMdastPlainText(first.children));
    if (calloutType) {
      return { type: "callout", attrs: { type: calloutType }, content: blocksOrEmpty(rest) };
    }
  }
  return { type: "blockquote", content: blocksOrEmpty(node.children) };
}

function tableNodeToPM(node: Table): PMNode {
  // GFM stores alignment per column in node.align; propagate to each cell's attrs
  const columnAlign = node.align ?? [];
  return {
    type: "table",
    content: node.children.map((row, rowIndex) => ({
      type: "tableRow",
      content: row.children.map((cell, colIndex) => ({
        type: rowIndex === 0 ? "tableHeader" : "tableCell",
        attrs: { align: columnAlign[colIndex] ?? null },
        content: [{ type: "paragraph", content: flattenInline(cell.children) }],
      })),
    })),
  };
}

function imageNodeToPM(node: MdastImage): PMNode {
  return {
    type: "image",
    attrs: { src: node.url, alt: node.alt ?? null, title: node.title ?? null },
  };
}

function flattenMdastPlainText(nodes: PhrasingContent[]): string {
  return nodes.map(plainTextOfNode).join("");
}

function plainTextOfNode(node: PhrasingContent): string {
  switch (node.type) {
    case "text":
    case "inlineCode":
    case "html":
      return node.value;
    case "break":
      return "\n";
    case "strong":
    case "emphasis":
    case "delete":
    case "link":
      return flattenMdastPlainText(node.children);
    case "image":
      return node.alt ?? "";
    default:
      return "";
  }
}

type UnderlineGroup =
  | { kind: "underline"; children: PhrasingContent[] }
  | { kind: "node"; node: PhrasingContent };

function groupUnderlinePairs(nodes: PhrasingContent[]): UnderlineGroup[] {
  const result: UnderlineGroup[] = [];
  let i = 0;
  while (i < nodes.length) {
    const node = nodes[i];
    if (isHtmlTag(node, "<u>")) {
      const closeIndex = nodes.findIndex(
        (n, idx) => idx > i && isHtmlTag(n, "</u>")
      );
      if (closeIndex !== -1) {
        result.push({ kind: "underline", children: nodes.slice(i + 1, closeIndex) });
        i = closeIndex + 1;
        continue;
      }
    }
    result.push({ kind: "node", node });
    i += 1;
  }
  return result;
}

function isHtmlTag(node: PhrasingContent, tag: string): boolean {
  return node.type === "html" && node.value.trim().toLowerCase() === tag;
}

function flattenInline(nodes: PhrasingContent[], inherited: PMMark[] = []): PMNode[] {
  const groups = groupUnderlinePairs(nodes);
  const result: PMNode[] = [];
  for (const group of groups) {
    if (group.kind === "underline") {
      result.push(
        ...flattenInline(group.children, addMark(inherited, { type: "underline" }))
      );
    } else {
      result.push(...flattenSingleNode(group.node, inherited));
    }
  }
  return result;
}

function flattenSingleNode(node: PhrasingContent, inherited: PMMark[]): PMNode[] {
  switch (node.type) {
    case "text":
      return node.value ? [{ type: "text", text: node.value, marks: inherited }] : [];
    case "break":
      return [{ type: "hardBreak" }];
    case "strong":
      return flattenInline(node.children, addMark(inherited, { type: "bold" }));
    case "emphasis":
      return flattenInline(node.children, addMark(inherited, { type: "italic" }));
    case "delete":
      return flattenInline(node.children, addMark(inherited, { type: "strike" }));
    case "inlineCode":
      return node.value
        ? [{ type: "text", text: node.value, marks: addMark(inherited, { type: "code" }) }]
        : [];

    // remark-math: inline math ($...$) → text with inlineMath mark (no $ delimiters stored)
    case "inlineMath":
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (node as any).value
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ? [{ type: "text", text: (node as any).value, marks: addMark(inherited, { type: "inlineMath" }) }]
        : [];
    case "link":
      return flattenInline(
        node.children,
        addMark(inherited, {
          type: "link",
          attrs: { href: node.url, title: node.title ?? undefined },
        }),
      );
    case "image":
      return node.alt ? [{ type: "text", text: node.alt, marks: inherited }] : [];
    case "html":
      // <br> variants become hardBreak for visual line-break rendering in the editor.
      if (/^<br\s*\/?>$/i.test(node.value.trim())) {
        return [{ type: "hardBreak" }];
      }
      // All other inline HTML becomes a rawHtmlInline atom. Atoms are not text
      // nodes, so ProseMirror cannot merge them with adjacent text, preserving
      // the tag boundaries required for correct serialization.
      //
      // Inherited marks are passed through so the serializer can coalesce
      // consecutive nodes sharing a mark (e.g. link) into a single MDAST
      // wrapper, preserving accessibility semantics ([H<sub>2</sub>O](url)
      // must produce one <a> element, not three).
      return node.value ? [{ type: "rawHtmlInline", attrs: { html: node.value }, marks: inherited }] : [];
    default: {
      // Handle custom MDAST node types produced by transformInlineMarks:
      // "mark" → highlight, "superscript" → superscript, "subscript" → subscript
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const n = node as any;
      const markType =
        n.type === "mark" ? "highlight" :
        n.type === "superscript" ? "superscript" :
        n.type === "subscript" ? "subscript" : null;
      if (markType && Array.isArray(n.children)) {
        return flattenInline(n.children, addMark(inherited, { type: markType }));
      }
      return [];
    }
  }
}

function addMark(marks: PMMark[], mark: PMMark): PMMark[] {
  return [...marks.filter((m) => m.type !== mark.type), mark];
}
