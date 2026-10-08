import type { Editor, Range } from "@tiptap/core";
import type { JSONContent } from "@tiptap/core";
import { useConfigStore } from "@/stores/configStore";
import { deriveOutline, flattenOutline } from "@/editor/utils/deriveOutline";
import { compileRequirementPattern, analyzeRequirements, nextAvailableId, nextAvailableIdForStem, collectDocumentVariants } from "@/editor/utils/requirementOps";

export interface SlashCommandItem {
  id: string;
  label: string;
  description: string;
  icon: string;
  keywords: string[];
  command: (editor: Editor, range: Range) => void;
}

function makeRequirementSlashItem(): SlashCommandItem | null {
  const { requirementPattern } = useConfigStore.getState();
  // Regex-mode patterns can match IDs but can't *generate* a new one (a
  // regex describes matching, not construction), so this command — which
  // needs to synthesize the next ID — is only offered in simple mode.
  // Simple mode can always generate the next ID; regex mode can generate
  // within an existing ID's stem group (per-feature numbering), so the item
  // shows whenever a pattern is configured — the command itself bails when
  // no stem is derivable (e.g. an empty document in regex mode).
  if (!compileRequirementPattern(requirementPattern)) return null;

  return {
    id: "requirement",
    label: "New Requirement",
    description: "Insert requirement after current position",
    icon: ">H#",
    keywords: ["req", "requirement", "new req", "insert req"],
    command: (editor: Editor, range: Range) => {
      const { requirementPattern: pattern } = useConfigStore.getState();
      const compiled = compileRequirementPattern(pattern);
      if (!compiled) return;

      // The new requirement is created AT THE CURSOR: the block where the
      // user typed "/" becomes the requirement heading (VS Code-era design
      // change, 2026-08-30 — the browser app spliced it after the current
      // section, which surprised users; see e2e scenarios 15/16).
      const cursorPos = range.from;
      const flat = flattenOutline(deriveOutline(editor));
      const analysis = analyzeRequirements(
        flat,
        editor.state.doc.content.toJSON() as JSONContent[],
        pattern,
      );
      const existingReqs = analysis?.requirements ?? [];

      // ID context: nearest requirement before the cursor supplies the regex
      // stem (per-feature numbering) and the heading level to mirror.
      const reqsBefore = existingReqs.filter((r) => r.node.pmPos <= cursorPos);
      const idAnchor =
        reqsBefore.length > 0 ? reqsBefore[reqsBefore.length - 1] : existingReqs[0];

      const newId = compiled.supportsNumbering
        ? nextAvailableId(existingReqs, compiled.prefix ?? "", compiled.digits ?? 3)
        : idAnchor
          ? nextAvailableIdForStem(existingReqs, idAnchor.id)
          : null;
      // Regex mode with no stem context (empty document): bail without
      // deleting, leaving the user's typed "/" intact.
      if (!newId) return;

      const level = idAnchor?.node.level ?? 3;

      // Variant inheritance (user request, 2026-09-02): when the document's
      // requirements use exactly ONE distinct variant, a new requirement
      // gets it by default. With several variants in play nothing is
      // guessed — the "+ Variant" chip offers them as a dropdown instead.
      const docVariants = collectDocumentVariants(editor.state.doc);
      const inheritedVariant = docVariants.length === 1 ? docVariants[0] : null;

      editor.chain().focus().deleteRange(range).run();
      const headingContent = [
        { type: "text", text: `${newId} [` },
        { type: "text", text: "Draft", marks: [{ type: "italic" }] },
        { type: "text", text: inheritedVariant ? `] [${inheritedVariant}]` : "]" },
      ];
      const parentEmpty = editor.state.selection.$from.parent.content.size === 0;
      if (parentEmpty) {
        // "/" on a fresh line: convert the empty block in place.
        editor.chain().focus().setNode("heading", { level }).insertContent(headingContent).run();
        const suffixLen =
          " [Draft]".length + (inheritedVariant ? ` [${inheritedVariant}]`.length : 0);
        editor
          .chain()
          .setTextSelection(editor.state.selection.from - suffixLen)
          .scrollIntoView()
          .run();
      } else {
        // Non-empty block: NEVER convert it (any remainder — text, soft
        // breaks — would become heading content; a soft break inside a
        // heading corrupted status detection, user report 2026-09-01).
        // Split at the caret and insert a standalone heading between the
        // halves.
        editor.chain().focus().splitBlock().run();
        const boundary = editor.state.selection.$from.before();
        editor
          .chain()
          .insertContentAt(boundary, {
            type: "heading",
            attrs: { level },
            content: headingContent,
          })
          .setTextSelection(boundary + 1 + `${newId}`.length)
          .scrollIntoView()
          .run();
      }
    },
  };
}

export const SLASH_COMMAND_ITEMS: SlashCommandItem[] = [
  {
    id: "heading1",
    label: "Heading 1",
    description: "Big section heading",
    icon: "H1",
    keywords: ["h1", "heading", "title"],
    command: (editor, range) =>
      editor.chain().focus().deleteRange(range).setNode("heading", { level: 1 }).run(),
  },
  {
    id: "heading2",
    label: "Heading 2",
    description: "Medium section heading",
    icon: "H2",
    keywords: ["h2", "heading", "subtitle"],
    command: (editor, range) =>
      editor.chain().focus().deleteRange(range).setNode("heading", { level: 2 }).run(),
  },
  {
    id: "heading3",
    label: "Heading 3",
    description: "Small section heading",
    icon: "H3",
    keywords: ["h3", "heading"],
    command: (editor, range) =>
      editor.chain().focus().deleteRange(range).setNode("heading", { level: 3 }).run(),
  },
  {
    id: "heading4",
    label: "Heading 4",
    description: "Sub-section heading",
    icon: "H4",
    keywords: ["h4", "heading"],
    command: (editor, range) =>
      editor.chain().focus().deleteRange(range).setNode("heading", { level: 4 }).run(),
  },
  {
    id: "heading5",
    label: "Heading 5",
    description: "Minor heading",
    icon: "H5",
    keywords: ["h5", "heading"],
    command: (editor, range) =>
      editor.chain().focus().deleteRange(range).setNode("heading", { level: 5 }).run(),
  },
  {
    id: "heading6",
    label: "Heading 6",
    description: "Smallest heading",
    icon: "H6",
    keywords: ["h6", "heading"],
    command: (editor, range) =>
      editor.chain().focus().deleteRange(range).setNode("heading", { level: 6 }).run(),
  },
  {
    id: "bulletList",
    label: "Bullet list",
    description: "Unordered list",
    icon: "•",
    keywords: ["bullet", "list", "ul"],
    command: (editor, range) =>
      editor.chain().focus().deleteRange(range).toggleBulletList().run(),
  },
  {
    id: "orderedList",
    label: "Numbered list",
    description: "Ordered list",
    icon: "1.",
    keywords: ["ordered", "number", "list", "ol"],
    command: (editor, range) =>
      editor.chain().focus().deleteRange(range).toggleOrderedList().run(),
  },
  {
    id: "checklist",
    label: "Checklist",
    description: "Task list with checkboxes",
    icon: "☑",
    keywords: ["task", "todo", "checklist", "checkbox"],
    command: (editor, range) =>
      editor.chain().focus().deleteRange(range).toggleTaskList().run(),
  },
  {
    id: "table",
    label: "Table",
    description: "Insert a 3x3 table",
    icon: "▦",
    keywords: ["table", "grid"],
    command: (editor, range) =>
      editor
        .chain()
        .focus()
        .deleteRange(range)
        .insertTable({ rows: 3, cols: 4, withHeaderRow: true })
        .run(),
  },
  {
    id: "image",
    label: "Image",
    description: "Insert an image from a URL",
    icon: "🖼",
    keywords: ["image", "picture", "img"],
    command: (editor, range) => {
      const src = window.prompt("Image URL");
      const chain = editor.chain().focus().deleteRange(range);
      if (src) chain.setImage({ src }).run();
      else chain.run();
    },
  },
  {
    id: "code",
    label: "Code block",
    description: "Fenced code block",
    icon: "</>",
    keywords: ["code", "snippet", "fence"],
    command: (editor, range) => editor.chain().focus().deleteRange(range).setCodeBlock().run(),
  },
  {
    id: "mermaid",
    label: "Mermaid diagram",
    description: "Flowchart, sequence, Gantt, and more",
    icon: "⬡",
    keywords: ["mermaid", "diagram", "flowchart", "chart", "graph", "sequence", "gantt"],
    command: (editor, range) =>
      editor.chain().focus().deleteRange(range).setCodeBlock({ language: "mermaid" }).run(),
  },
  {
    id: "math",
    label: "Math block",
    description: "LaTeX display equation (KaTeX)",
    icon: "∑",
    keywords: ["math", "latex", "equation", "katex", "formula"],
    command: (editor, range) =>
      editor.chain().focus().deleteRange(range).setCodeBlock({ language: "$$" }).run(),
  },
  {
    id: "blockquote",
    label: "Quote",
    description: "Blockquote",
    icon: "❝",
    keywords: ["quote", "blockquote"],
    command: (editor, range) => editor.chain().focus().deleteRange(range).toggleBlockquote().run(),
  },
  {
    id: "callout",
    label: "Callout",
    description: "Info / warning / success / danger box",
    icon: "▣",
    keywords: ["callout", "info", "warning", "note", "alert"],
    command: (editor, range) =>
      editor.chain().focus().deleteRange(range).setCallout({ type: "info" }).run(),
  },
  {
    id: "divider",
    label: "Divider",
    description: "Horizontal rule",
    icon: "—",
    keywords: ["divider", "hr", "rule", "separator"],
    command: (editor, range) => editor.chain().focus().deleteRange(range).setHorizontalRule().run(),
  },
];

export function filterSlashCommandItems(query: string): SlashCommandItem[] {
  const reqItem = makeRequirementSlashItem();
  const allItems = reqItem ? [reqItem, ...SLASH_COMMAND_ITEMS] : SLASH_COMMAND_ITEMS;

  const q = query.trim().toLowerCase();
  if (!q) return allItems;
  return allItems.filter(
    (item) =>
      item.label.toLowerCase().includes(q) || item.keywords.some((k) => k.includes(q)),
  );
}
