import { toMarkdown, defaultHandlers } from "mdast-util-to-markdown";
import { gfmTaskListItemToMarkdown } from "mdast-util-gfm-task-list-item";
import { gfmToMarkdown } from "mdast-util-gfm";
import { mathToMarkdown } from "mdast-util-math";
import type {
  BlockContent,
  Blockquote,
  Break,
  Code,
  Definition,
  Delete,
  Emphasis,
  Heading,
  Html,
  Image,
  InlineCode,
  Link,
  List,
  ListItem,
  Parents,
  Paragraph,
  PhrasingContent,
  Root,
  Strong,
  Table,
  TableCell,
  TableRow,
  Text as MdastText,
  ThematicBreak,
} from "mdast";
import type { Info, State } from "mdast-util-to-markdown";
import { DEFAULT_CALLOUT_TYPE, formatCalloutMarker, type CalloutType } from "./calloutSyntax";
import type { PMMark, PMNode } from "./types";

// The GFM extension registers its own `listItem` handler (via extensions array)
// that adds the `[x]` / `[ ]` checkbox prefix for task list items. Our top-level
// `handlers` option is applied AFTER extensions and would clobber the GFM handler,
// breaking task list serialization. We hold a direct reference to the GFM handler
// so we can delegate to it for all non-per-item cases.
const gfmListItemHandler = gfmTaskListItemToMarkdown().handlers!.listItem!;

/**
 * Custom listItem handler that emits the per-item marker value stored in
 * `node.value` (a non-standard MDAST extension field) instead of the
 * sequential numbering that mdast-util-to-markdown normally computes.
 *
 * For ordered list items that carry an explicit `value`, we temporarily
 * patch `parent.start = node.value` and disable `incrementListMarker` so
 * the built-in handler computes `parent.start + 0 = node.value`.
 * The patch is restored synchronously before returning.
 *
 * For all other items (unordered lists, task lists, or ordered items
 * without a stored value), we delegate to the GFM handler which handles
 * the task-list checkbox and falls through to `defaultHandlers.listItem`.
 */
function listItemHandler(
  node: ListItem & { value?: number },
  parent: Parents | undefined,
  state: State,
  info: Info,
): string {
  if (parent?.type === "list" && (parent as List).ordered && typeof node.value === "number") {
    const list = parent as List;
    const savedStart = list.start;
    const savedIncrement = state.options.incrementListMarker;
    list.start = node.value;
    state.options.incrementListMarker = false;
    const result = defaultHandlers.listItem(node, parent, state, info);
    list.start = savedStart;
    state.options.incrementListMarker = savedIncrement;
    return result;
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return gfmListItemHandler(node as any, parent as any, state, info);
}

const TO_MARKDOWN_OPTIONS = {
  // singleTilde: false — ensures ~~text~~ for strikethrough, leaving ~text~ clean for subscript.
  // gfmToMarkdown passes the option through to mdast-util-gfm-strikethrough at runtime but the
  // public TypeScript types don't expose it, hence the cast.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  extensions: [gfmToMarkdown({ tablePipeAlign: false, singleTilde: false } as any), mathToMarkdown()],
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
  handlers: { listItem: listItemHandler },
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
 * mdast-util-to-markdown's built-in unsafe list escapes `_` and `[` in
 * phrasing context (the list is additive-only; entries can't be removed).
 *
 * `\_` → `_`: underscores in plain text like `REQ_001` never form emphasis
 * because we use `*` for emphasis.
 *
 * `\[text]` → `[text]`: square brackets that don't start a link or reference
 * (i.e. `]` is NOT followed by `(` or `[`) are safe unescaped. Requirement
 * status markers like `[Draft]` fall into this category.
 *
 * Both transforms are skipped inside code fences and display-math blocks
 * ($$…$$) where content is verbatim, and inside inline math ($…$) where
 * backslash is LaTeX syntax, not a markdown escape character.
 */
function unescapeUnderscores(md: string): string {
  const lines = md.split("\n");
  let fenceMarker = "";
  return lines
    .map((line) => {
      if (!fenceMarker) {
        // Detect block-level verbatim regions: backtick/tilde fences AND $$
        const m = line.match(/^(`{3,}|~{3,}|\$\$)/);
        if (m) {
          fenceMarker = m[1];
          return line;
        }
        return unescapeLineSkippingInlineMath(line);
      }
      if (line.startsWith(fenceMarker) && line.slice(fenceMarker.length).trim() === "") {
        fenceMarker = "";
      }
      return line;
    })
    .join("\n");
}

/**
 * Apply `\_` → `_` and `\[…]` → `[…]` to a single line, but skip content
 * inside `$…$` inline-math spans where `\` is LaTeX syntax.
 *
 * The line is split into alternating outside/inside segments via a capturing
 * split on `$…$`. Odd-indexed parts are math spans and are returned verbatim.
 */
function unescapeLineSkippingInlineMath(line: string): string {
  const parts = line.split(/(\$[^$]+\$)/);
  return parts
    .map((part, i) =>
      i % 2 === 0
        ? part
            .replace(/\\_/g, "_")
            // Unescape \[text] → [text] ONLY when bracket does not start a
            // callout marker (\[!TYPE]) and ] is not followed by ( or [.
            .replace(/\\\[(?!!)([^\]]*)\](?![(\[])/g, "[$1]")
        : part // math span — preserve LaTeX source verbatim
    )
    .join("");
}

function blockToMdast(node: PMNode): BlockContent | Definition {
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
        spread: Boolean(node.attrs?.spread),
        children: (node.content ?? []).map((li) => listItemToMdast(li, null)),
      } satisfies List;

    case "orderedList":
      return {
        type: "list",
        ordered: true,
        start: typeof node.attrs?.start === "number" ? node.attrs.start : 1,
        spread: Boolean(node.attrs?.spread),
        children: (node.content ?? []).map((li) => listItemToMdast(li, null)),
      } satisfies List;

    case "taskList":
      return {
        type: "list",
        ordered: false,
        spread: Boolean(node.attrs?.spread),
        children: (node.content ?? []).map((li) =>
          listItemToMdast(li, Boolean(li.attrs?.checked))
        ),
      } satisfies List;

    case "blockquote":
      return {
        type: "blockquote",
        // linkDefinition never appears inside blockquotes; cast is safe.
        children: (node.content ?? []).map(blockToMdast) as BlockContent[],
      } satisfies Blockquote;

    case "callout":
      return calloutToMdast(node);

    case "codeBlock":
      if (node.attrs?.language === "$$") {
        // Block math: serialize as $$...$$, not as a fenced code block
        return {
          type: "math",
          value: flattenPlainText(node.content ?? []),
          meta: null,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any;
      }
      return {
        type: "code",
        lang: (node.attrs?.language as string) || null,
        meta: (node.attrs?.metadata as string | null) ?? null,
        value: flattenPlainText(node.content ?? []),
      } satisfies Code;

    case "horizontalRule":
      return { type: "thematicBreak" } satisfies ThematicBreak;

    case "image":
      return { type: "paragraph", children: [imageToMdast(node)] } satisfies Paragraph;

    case "table":
      return tableToMdast(node);

    case "rawHtmlBlock":
      return { type: "html", value: (node.attrs?.html as string) ?? "" } satisfies Html;

    case "linkDefinition": {
      const label = (node.attrs?.label as string) ?? "";
      return {
        type: "definition",
        // identifier is the normalized (lowercased) form used for lookup;
        // label is the original form that appears in the serialized output.
        identifier: label.toLowerCase(),
        label,
        url: (node.attrs?.url as string) ?? "",
        title: (node.attrs?.title as string | null) ?? null,
      } satisfies Definition;
    }

    default:
      if (import.meta.env.DEV) {
        console.warn(`[serializer] unrecognized node type "${node.type}", dropped`);
      }
      return { type: "paragraph", children: [] } satisfies Paragraph;
  }
}

function listItemToMdast(node: PMNode, checked: boolean | null): ListItem & { value?: number } {
  const base: ListItem & { value?: number } = {
    type: "listItem",
    checked,
    spread: Boolean(node.attrs?.spread),
    // linkDefinition never appears inside list items; cast is safe.
    children: (node.content ?? []).map(blockToMdast) as BlockContent[],
  };
  if (typeof node.attrs?.value === "number") base.value = node.attrs.value;
  return base;
}

function calloutToMdast(node: PMNode): Blockquote {
  const type = (node.attrs?.type as CalloutType) || DEFAULT_CALLOUT_TYPE;
  // Use the original marker word if stored; fall back to canonical uppercase.
  const rawMarker = node.attrs?.marker as string | null | undefined;
  const markerText = rawMarker ? `[!${rawMarker}]` : formatCalloutMarker(type);
  const markerPara: Paragraph = {
    type: "paragraph",
    children: [{ type: "text", value: markerText }],
  };
  // linkDefinition never appears inside callouts; cast is safe.
  const body = (node.content ?? []).map(blockToMdast) as BlockContent[];
  return { type: "blockquote", children: [markerPara, ...body] };
}

type GfmAlign = "left" | "center" | "right" | null;

function tableToMdast(node: PMNode): Table {
  const rows = node.content ?? [];
  // Derive GFM column alignment from the first row's cell attrs
  const headerCells = rows[0]?.content ?? [];
  const align: GfmAlign[] = headerCells.map((cell) => {
    const a = cell.attrs?.align;
    return a === "left" || a === "center" || a === "right" ? a : null;
  });

  return {
    type: "table",
    align,
    children: rows.map(
      (row): TableRow => ({
        type: "tableRow",
        children: (row.content ?? []).map(
          (cell): TableCell => ({
            type: "tableCell",
            children: inlineToMdast(extractCellInline(cell), true),
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

// ── Mark-group inline serialization ──────────────────────────────────────────
//
// Problem this replaces: the old node-centric design processed each PM node
// independently. Every text node wrapped itself in its own mark stack, so
// consecutive nodes sharing a link mark each produced a separate <a>:
//
//   [H<sub>2</sub>O](url)  →  [H](url)<sub>[2](url)</sub>[O](url)
//
// This broke accessibility (1 link → N links) and caused mark normalizations
// like **<kbd>Ctrl</kbd>** → <kbd>**Ctrl**</kbd>.
//
// Fix: group consecutive nodes that share the same outermost mark, recurse
// with that mark stripped, then wrap the group's children in one MDAST node.
// rawHtmlInline atoms participate in groups via the marks inherited at parse
// time (the parser now passes its `inherited` context to rawHtmlInline nodes).
//
// Recursion terminates because `stripped` grows by one mark per level and
// MARK_PRIORITY is finite (8 elements). Maximum recursion depth = 8.

const MARK_PRIORITY = [
  "link",
  "bold",
  "italic",
  "highlight",
  "superscript",
  "subscript",
  "underline",
  "strike",
] as const;

type WrapperMark = (typeof MARK_PRIORITY)[number];

function pickOuterMark(activeMarks: PMMark[]): WrapperMark | null {
  for (const name of MARK_PRIORITY) {
    if (activeMarks.some((m) => m.type === name)) return name;
  }
  return null;
}

/** Two link marks group together only when their href AND title are identical. */
function markAttrsEqual(a: PMMark, b: PMMark): boolean {
  if (a.type !== b.type) return false;
  if (a.type === "link") {
    return (
      String(a.attrs?.href ?? "") === String(b.attrs?.href ?? "") &&
      String(a.attrs?.title ?? "") === String(b.attrs?.title ?? "")
    );
  }
  return true;
}

function inlineToMdast(nodes: PMNode[], inTable = false): PhrasingContent[] {
  return nodesWithMarks(nodes, new Set<string>(), inTable);
}

/**
 * Recursively serialize a flat list of PM inline nodes into MDAST phrasing
 * content, grouping by outermost mark.
 *
 * @param nodes   - PM nodes to serialize (text, rawHtmlInline, hardBreak, …)
 * @param stripped - Mark type names already handled by ancestor calls.
 *                  Grows by one per recursion level. Used to compute
 *                  "activeMarks" = marks still needing a wrapper.
 * @param inTable  - When true, hardBreak emits {html:"<br>"} instead of
 *                  {break} because mdast-util-gfm collapses break in cells.
 */
function nodesWithMarks(
  nodes: PMNode[],
  stripped: Set<string>,
  inTable: boolean,
): PhrasingContent[] {
  const result: PhrasingContent[] = [];
  let i = 0;

  while (i < nodes.length) {
    const node = nodes[i];

    // ── hardBreak: never carries marks; always emitted immediately ────────
    if (node.type === "hardBreak") {
      result.push(
        inTable
          ? ({ type: "html", value: "<br>" } satisfies Html)
          : ({ type: "break" } satisfies Break),
      );
      i++;
      continue;
    }

    // ── Compute which marks still need handling at this recursion level ───
    const activeMarks = (node.marks ?? []).filter((m) => !stripped.has(m.type));
    const outerMark = pickOuterMark(activeMarks);

    // ── rawHtmlInline base case ───────────────────────────────────────────
    if (node.type === "rawHtmlInline") {
      if (outerMark === null) {
        result.push({ type: "html", value: (node.attrs?.html as string) ?? "" } satisfies Html);
        i++;
        continue;
      }
      // outerMark !== null → fall through to grouping
    }

    // ── text base cases ───────────────────────────────────────────────────
    if (node.type === "text") {
      if (outerMark === null) {
        // No wrapper marks remain. Exclusive marks (inlineMath, code) take effect.
        // code/inlineMath are deliberately excluded from MARK_PRIORITY so they
        // are only emitted here, as leaf nodes inside any wrapper marks that
        // have already been handled by ancestor calls (e.g. link > code gives
        // [`code`](url) correctly rather than dropping the link).
        if (activeMarks.some((m) => m.type === "inlineMath")) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          result.push({ type: "inlineMath", value: node.text ?? "" } as any);
        } else if (activeMarks.some((m) => m.type === "code")) {
          result.push({ type: "inlineCode", value: node.text ?? "" } satisfies InlineCode);
        } else {
          result.push({ type: "text", value: node.text ?? "" } satisfies MdastText);
        }
        i++;
        continue;
      }
      // outerMark !== null → fall through to grouping
    }

    // ── Skip unrecognized node types ──────────────────────────────────────
    if (node.type !== "text" && node.type !== "rawHtmlInline") {
      i++;
      continue;
    }

    // ── Mark grouping ─────────────────────────────────────────────────────
    // Reaching here means: node is text or rawHtmlInline, outerMark is set.
    // TypeScript cannot infer the non-null from the control flow above.
    if (outerMark === null) { i++; continue; } // unreachable; guards the cast below

    const outerMarkObj = activeMarks.find((m) => m.type === outerMark)!;

    // Collect consecutive nodes that all carry outerMark with compatible attrs.
    // Stop at: a node lacking the mark, a hardBreak (never carries marks), end.
    let j = i;
    while (j < nodes.length) {
      const jn = nodes[j];
      if (jn.type === "hardBreak") break;
      const jActive = (jn.marks ?? []).filter((m) => !stripped.has(m.type));
      const jMark = jActive.find(
        (m) => m.type === outerMark && markAttrsEqual(m, outerMarkObj),
      );
      if (!jMark) break;
      j++;
    }

    // Recurse: process the group with outerMark stripped.
    const newStripped = new Set([...stripped, outerMark]);
    const children = nodesWithMarks(nodes.slice(i, j), newStripped, inTable);
    result.push(...applyMark(outerMark, outerMarkObj, children));
    i = j;
  }

  return result;
}

/** Wrap a list of MDAST children in the MDAST structure for a single mark. */
function applyMark(name: WrapperMark, mark: PMMark, children: PhrasingContent[]): PhrasingContent[] {
  switch (name) {
    case "link":
      return [
        {
          type: "link",
          url: String(mark.attrs?.href ?? ""),
          title: mark.attrs?.title ? String(mark.attrs.title) : null,
          children,
        } satisfies Link,
      ];
    case "bold":
      return [{ type: "strong", children } satisfies Strong];
    case "italic":
      return [{ type: "emphasis", children } satisfies Emphasis];
    case "strike":
      return [{ type: "delete", children } satisfies Delete];
    // Delimiter-style marks: the mark is represented as a pair of html sibling
    // nodes flanking the children, matching the existing serializer convention
    // used before this change and preserved here for idempotency.
    case "underline":
      return [
        { type: "html", value: "<u>" } satisfies Html,
        ...children,
        { type: "html", value: "</u>" } satisfies Html,
      ];
    case "subscript":
      return [
        { type: "html", value: "~" } satisfies Html,
        ...children,
        { type: "html", value: "~" } satisfies Html,
      ];
    case "superscript":
      return [
        { type: "html", value: "^" } satisfies Html,
        ...children,
        { type: "html", value: "^" } satisfies Html,
      ];
    case "highlight":
      return [
        { type: "html", value: "==" } satisfies Html,
        ...children,
        { type: "html", value: "==" } satisfies Html,
      ];
  }
}
