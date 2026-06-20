import { toMarkdown } from "mdast-util-to-markdown";
import { gfmToMarkdown } from "mdast-util-gfm";
import type {
  BlockContent,
  Blockquote,
  Break,
  Code,
  Heading,
  Image,
  InlineCode,
  Link,
  List,
  ListItem,
  Paragraph,
  PhrasingContent,
  Root,
  Table,
  TableCell,
  TableRow,
  Text as MdastText,
  ThematicBreak,
} from "mdast";
import { DEFAULT_CALLOUT_TYPE, formatCalloutMarker, type CalloutType } from "./calloutSyntax";
import type { PMMark, PMNode } from "./types";

const TO_MARKDOWN_OPTIONS = {
  extensions: [gfmToMarkdown({ tablePipeAlign: false })],
  bullet: "-" as const,
  bulletOther: "*" as const,
  emphasis: "*" as const,
  strong: "*" as const,
  fence: "`" as const,
  fences: true,
  incrementListMarker: true,
  listItemIndent: "one" as const,
  rule: "-" as const,
  ruleSpaces: false,
  tightDefinitions: true,
};

export function serializeDocToMarkdown(doc: PMNode): string {
  if (!doc || doc.type !== "doc") {
    throw new Error("serializeDocToMarkdown expects a PM node of type 'doc'");
  }
  const root: Root = {
    type: "root",
    children: (doc.content ?? []).map(blockToMdast),
  };
  const md = unescapeUnderscores(
    toMarkdown(root, TO_MARKDOWN_OPTIONS)
      .replace(/&#x20;/g, " ")      // mdast-util-to-markdown encodes trailing spaces as HTML entities; restore them
      .replace(/[^\S\r\n]+$/gm, "") // trim trailing horizontal whitespace from every line
  ).replace(/\n+$/, "");
  return md ? `${md}\n` : "";
}

/**
 * mdast-util-to-markdown's built-in unsafe list always escapes `_` in phrasing
 * context (the list is additive-only; it can't be removed via options).
 * Since we use `*` for emphasis, underscores in plain text like `REQ_001` never
 * form emphasis and don't need escaping. This strips `\_` → `_` everywhere
 * EXCEPT inside code fences, where content is verbatim and `\_` would be
 * literal user-typed characters.
 */
function unescapeUnderscores(md: string): string {
  const lines = md.split("\n");
  let fenceMarker = "";
  return lines
    .map((line) => {
      if (!fenceMarker) {
        const m = line.match(/^(`{3,}|~{3,})/);
        if (m) {
          fenceMarker = m[1];
          return line;
        }
        return line.replace(/\\_/g, "_");
      }
      if (line.startsWith(fenceMarker) && line.slice(fenceMarker.length).trim() === "") {
        fenceMarker = "";
      }
      return line;
    })
    .join("\n");
}

function blockToMdast(node: PMNode): BlockContent {
  switch (node.type) {
    case "paragraph":
      return { type: "paragraph", children: inlineToMdast(node.content ?? []) } satisfies Paragraph;

    case "heading":
      return {
        type: "heading",
        depth: clampHeadingDepth(node.attrs?.level),
        children: inlineToMdast(node.content ?? []),
      } satisfies Heading;

    case "bulletList":
      return {
        type: "list",
        ordered: false,
        spread: false,
        children: (node.content ?? []).map((li) => listItemToMdast(li, null)),
      } satisfies List;

    case "orderedList":
      return {
        type: "list",
        ordered: true,
        start: typeof node.attrs?.start === "number" ? node.attrs.start : 1,
        spread: false,
        children: (node.content ?? []).map((li) => listItemToMdast(li, null)),
      } satisfies List;

    case "taskList":
      return {
        type: "list",
        ordered: false,
        spread: false,
        children: (node.content ?? []).map((li) =>
          listItemToMdast(li, Boolean(li.attrs?.checked))
        ),
      } satisfies List;

    case "blockquote":
      return {
        type: "blockquote",
        children: (node.content ?? []).map(blockToMdast),
      } satisfies Blockquote;

    case "callout":
      return calloutToMdast(node);

    case "codeBlock":
      return {
        type: "code",
        lang: (node.attrs?.language as string) || null,
        value: flattenPlainText(node.content ?? []),
      } satisfies Code;

    case "horizontalRule":
      return { type: "thematicBreak" } satisfies ThematicBreak;

    case "image":
      return { type: "paragraph", children: [imageToMdast(node)] } satisfies Paragraph;

    case "table":
      return tableToMdast(node);

    default:
      if (import.meta.env.DEV) {
        console.warn(`[serializer] unrecognized node type "${node.type}", dropped`);
      }
      return { type: "paragraph", children: [] } satisfies Paragraph;
  }
}

function listItemToMdast(node: PMNode, checked: boolean | null): ListItem {
  return {
    type: "listItem",
    checked,
    spread: false,
    children: (node.content ?? []).map(blockToMdast),
  };
}

function calloutToMdast(node: PMNode): Blockquote {
  const type = (node.attrs?.type as CalloutType) || DEFAULT_CALLOUT_TYPE;
  const markerPara: Paragraph = {
    type: "paragraph",
    children: [{ type: "text", value: formatCalloutMarker(type) }],
  };
  const body = (node.content ?? []).map(blockToMdast);
  return { type: "blockquote", children: [markerPara, ...body] };
}

function tableToMdast(node: PMNode): Table {
  const rows = node.content ?? [];
  const firstRowCellCount = rows[0]?.content?.length ?? 0;
  return {
    type: "table",
    align: Array.from({ length: firstRowCellCount }, () => null),
    children: rows.map(
      (row): TableRow => ({
        type: "tableRow",
        children: (row.content ?? []).map(
          (cell): TableCell => ({
            type: "tableCell",
            children: inlineToMdast(extractCellInline(cell)),
          })
        ),
      })
    ),
  };
}

function extractCellInline(cell: PMNode): PMNode[] {
  const content = cell.content ?? [];
  return content.flatMap((n) => (n.type === "paragraph" ? n.content ?? [] : [n]));
}

function imageToMdast(node: PMNode): Image {
  return {
    type: "image",
    url: String(node.attrs?.src ?? ""),
    alt: node.attrs?.alt ? String(node.attrs.alt) : null,
    title: node.attrs?.title ? String(node.attrs.title) : null,
  };
}

function clampHeadingDepth(level: unknown): Heading["depth"] {
  const n = typeof level === "number" ? level : 1;
  return Math.min(6, Math.max(1, n)) as Heading["depth"];
}

function flattenPlainText(nodes: PMNode[]): string {
  return nodes.map((n) => (n.type === "text" ? n.text ?? "" : "")).join("");
}

function inlineToMdast(nodes: PMNode[]): PhrasingContent[] {
  const result: PhrasingContent[] = [];
  for (const node of nodes) {
    if (node.type === "hardBreak") {
      result.push({ type: "break" } satisfies Break);
      continue;
    }
    if (node.type !== "text" || typeof node.text !== "string") continue;
    result.push(...textNodeToMdast(node));
  }
  return result;
}

function textNodeToMdast(node: PMNode): PhrasingContent[] {
  const marks: PMMark[] = node.marks ?? [];
  const text = node.text ?? "";
  const hasMark = (type: string) => marks.some((m) => m.type === type);

  if (hasMark("code")) {
    return [{ type: "inlineCode", value: text } satisfies InlineCode];
  }

  let phrasing: PhrasingContent[] = [{ type: "text", value: text } satisfies MdastText];

  if (hasMark("strike")) {
    phrasing = [{ type: "delete", children: phrasing }];
  }
  if (hasMark("underline")) {
    phrasing = [{ type: "html", value: "<u>" }, ...phrasing, { type: "html", value: "</u>" }];
  }
  if (hasMark("italic")) {
    phrasing = [{ type: "emphasis", children: phrasing }];
  }
  if (hasMark("bold")) {
    phrasing = [{ type: "strong", children: phrasing }];
  }
  const link = marks.find((m) => m.type === "link");
  if (link) {
    phrasing = [
      {
        type: "link",
        url: String(link.attrs?.href ?? ""),
        title: link.attrs?.title ? String(link.attrs.title) : null,
        children: phrasing,
      } satisfies Link,
    ];
  }
  return phrasing;
}
