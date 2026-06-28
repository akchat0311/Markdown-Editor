import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import type {
  Blockquote,
  Definition,
  Image as MdastImage,
  List,
  ListItem,
  PhrasingContent,
  Root,
  RootContent,
  Table,
} from "mdast";
import type { PMMark, PMNode } from "./types";
import { parseCalloutFull } from "./calloutSyntax";
import { transformInlineMarks } from "./inlineMark";
import { transformHtmlEntities } from "./entityPreservation";

// singleTilde: false — prevents ~text~ from being parsed as strikethrough so
// our custom subscript syntax (~text~) can coexist with ~~strikethrough~~
const processor = unified().use(remarkParse).use(remarkGfm, { singleTilde: false }).use(remarkMath);

export function parseMarkdownToDoc(markdown: string): PMNode {
  const tree = processor.parse(markdown) as Root;
  // Entity preservation must run FIRST — text nodes still have source positions.
  // transformInlineMarks creates synthetic nodes without positions, which would
  // make entities invisible to the source-slice lookup.
  transformHtmlEntities(tree, markdown);
  // Apply ==highlight==, ^sup^, ~sub~ transformations.
  // Must run after processor.parse() because transformer plugins don't run when
  // using parse() directly (they require process() or run()).
  transformInlineMarks(tree);
  // Attach per-item marker values to ordered list items using source positions.
  // Must run before blockToPM because MDAST only stores List.start (the first
  // item's value); items 2+ are silently discarded by mdast-util-from-markdown.
  attachOrderedListItemValues(tree, markdown);
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
        attrs: { language: node.lang ?? null, metadata: node.meta ?? null },
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

    case "definition":
      return {
        type: "linkDefinition",
        attrs: {
          label: (node as Definition).label ?? (node as Definition).identifier,
          url: (node as Definition).url,
          title: (node as Definition).title ?? null,
        },
      };

    default:
      return { type: "paragraph", content: [] };
  }
}

function blocksOrEmpty(nodes: RootContent[]): PMNode[] {
  const blocks = nodes.map(blockToPM);
  return blocks.length ? blocks : [{ type: "paragraph" }];
}

/**
 * Walk the MDAST and attach the original marker number to each ordered list
 * item as `(li as any).value`.
 *
 * Remark only stores the first item's number in `List.start`; items 2+ are
 * discarded by `onenterlistitemvalue`. The source position of each listItem
 * still points at the marker digit(s), so we recover them directly.
 */
function attachOrderedListItemValues(root: Root, source: string): void {
  function walk(nodes: RootContent[]): void {
    for (const node of nodes) {
      if (node.type === "list") {
        if (node.ordered) {
          for (const li of node.children) {
            const offset = li.position?.start?.offset;
            if (typeof offset === "number") {
              const m = /^(\d+)[.)]/.exec(source.slice(offset));
              if (m) (li as ListItem & { value?: number }).value = parseInt(m[1], 10);
            }
            walk(li.children as RootContent[]);
          }
        } else {
          for (const li of node.children) {
            walk(li.children as RootContent[]);
          }
        }
      } else if ("children" in node && Array.isArray((node as { children?: unknown[] }).children)) {
        walk((node as { children: RootContent[] }).children);
      }
    }
  }
  walk(root.children);
}

function listNodeToPM(node: List): PMNode {
  const isTaskList = node.children.some(
    (li) => li.checked !== null && li.checked !== undefined
  );

  if (isTaskList) {
    return {
      type: "taskList",
      attrs: { spread: Boolean(node.spread) },
      content: node.children.map((li) => ({
        type: "taskItem",
        attrs: { checked: Boolean(li.checked), spread: Boolean(li.spread) },
        content: blocksOrEmpty(li.children),
      })),
    };
  }

  if (node.ordered) {
    return {
      type: "orderedList",
      attrs: { start: node.start ?? 1, spread: Boolean(node.spread) },
      content: node.children.map((li) => {
        const itemValue = (li as ListItem & { value?: number }).value;
        return {
          type: "listItem",
          attrs: {
            spread: Boolean(li.spread),
            value: typeof itemValue === "number" ? itemValue : null,
          },
          content: blocksOrEmpty(li.children),
        };
      }),
    };
  }

  return {
    type: "bulletList",
    attrs: { spread: Boolean(node.spread) },
    content: node.children.map((li) => ({
      type: "listItem",
      attrs: { spread: Boolean(li.spread) },
      content: blocksOrEmpty(li.children),
    })),
  };
}

function blockquoteToPM(node: Blockquote): PMNode {
  const [first, ...rest] = node.children;
  if (first?.type === "paragraph") {
    const parsed = parseCalloutFull(flattenMdastPlainText(first.children));
    if (parsed) {
      return {
        type: "callout",
        attrs: { type: parsed.type, marker: parsed.marker },
        content: blocksOrEmpty(rest),
      };
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
    case "linkReference": {
      // Reconstruct the raw markdown text and store as an opaque rawHtmlInline
      // atom. toMarkdown emits html-type nodes verbatim, so the text survives
      // the serialization pass intact. On re-parse, remark sees [text][ref]
      // alongside its definition and recreates the linkReference node.
      const content = mdastPhrasingToMarkdown(node.children);
      const raw =
        node.referenceType === "collapsed" ? `[${content}][]` :
        node.referenceType === "shortcut"  ? `[${content}]` :
                                             `[${content}][${node.label ?? node.identifier}]`;
      return raw ? [{ type: "rawHtmlInline", attrs: { html: raw }, marks: inherited }] : [];
    }
    case "imageReference": {
      const alt = node.alt ?? "";
      const raw =
        node.referenceType === "collapsed" ? `![${alt}][]` :
        node.referenceType === "shortcut"  ? `![${alt}]` :
                                             `![${alt}][${node.label ?? node.identifier}]`;
      return raw ? [{ type: "rawHtmlInline", attrs: { html: raw }, marks: inherited }] : [];
    }
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

/**
 * Serialize MDAST phrasing content back to raw markdown text.
 *
 * Used exclusively to reconstruct the textual form of a linkReference or
 * imageReference node's inner content so the whole reference (`[text][id]`)
 * can be stored as an opaque rawHtmlInline atom.
 *
 * This is called AFTER transformInlineMarks has already run on the tree, so
 * the custom `mark` / `superscript` / `subscript` node types may appear among
 * the children and are handled in the default branch.
 */
function mdastPhrasingToMarkdown(nodes: PhrasingContent[]): string {
  return nodes.map(phrasingNodeToMarkdown).join("");
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function phrasingNodeToMarkdown(node: PhrasingContent): string {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const n = node as any;
  switch (node.type) {
    case "text":        return node.value;
    case "inlineCode":  return `\`${node.value}\``;
    case "html":        return node.value;
    case "break":       return "\\\n";
    case "inlineMath":  return `$${n.value}$`;
    case "strong":      return `**${mdastPhrasingToMarkdown(node.children)}**`;
    case "emphasis":    return `*${mdastPhrasingToMarkdown(node.children)}*`;
    case "delete":      return `~~${mdastPhrasingToMarkdown(node.children)}~~`;
    case "link":
      return `[${mdastPhrasingToMarkdown(node.children)}](${node.url}${node.title ? ` "${node.title}"` : ""})`;
    case "image":
      return `![${node.alt ?? ""}](${node.url}${node.title ? ` "${node.title}"` : ""})`;
    case "linkReference": {
      const content = mdastPhrasingToMarkdown(node.children);
      return node.referenceType === "collapsed" ? `[${content}][]` :
             node.referenceType === "shortcut"  ? `[${content}]` :
                                                  `[${content}][${node.label ?? node.identifier}]`;
    }
    case "imageReference": {
      const alt = n.alt ?? "";
      return n.referenceType === "collapsed" ? `![${alt}][]` :
             n.referenceType === "shortcut"  ? `![${alt}]` :
                                               `![${alt}][${n.label ?? n.identifier}]`;
    }
    default:
      // Handle custom types produced by transformInlineMarks:
      // "mark" → ==…==, "superscript" → ^…^, "subscript" → ~…~
      if (n.type === "mark" && Array.isArray(n.children))
        return `==${mdastPhrasingToMarkdown(n.children)}==`;
      if (n.type === "superscript" && Array.isArray(n.children))
        return `^${mdastPhrasingToMarkdown(n.children)}^`;
      if (n.type === "subscript" && Array.isArray(n.children))
        return `~${mdastPhrasingToMarkdown(n.children)}~`;
      return "";
  }
}
