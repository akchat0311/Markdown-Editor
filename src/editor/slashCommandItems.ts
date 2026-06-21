import type { Editor, Range } from "@tiptap/core";

export interface SlashCommandItem {
  id: string;
  label: string;
  description: string;
  icon: string;
  keywords: string[];
  command: (editor: Editor, range: Range) => void;
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
        .insertTable({ rows: 3, cols: 3, withHeaderRow: true })
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
  const q = query.trim().toLowerCase();
  if (!q) return SLASH_COMMAND_ITEMS;
  return SLASH_COMMAND_ITEMS.filter(
    (item) =>
      item.label.toLowerCase().includes(q) || item.keywords.some((k) => k.includes(q)),
  );
}
