import StarterKit from "@tiptap/starter-kit";
import { TableKit } from "@tiptap/extension-table";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import Image from "@tiptap/extension-image";
import Placeholder from "@tiptap/extension-placeholder";
import { Extension } from "@tiptap/core";
import type { Extensions } from "@tiptap/core";
import { Callout } from "./Callout";
import { SlashCommand } from "./SlashCommand";
import { CustomKeymap } from "./CustomKeymap";
import { MermaidCodeBlock } from "./MermaidCodeBlock";
import { MathMark } from "./MathMark";
import { Highlight } from "./Highlight";
import { Superscript } from "./Superscript";
import { Subscript } from "./Subscript";
import { TableAlignment } from "./TableAlignment";
import { RequirementStatus } from "./RequirementStatus";
import { ReviewCommentBadge } from "./ReviewCommentBadge";
import { LinkNavigation } from "./LinkNavigation";
import { findReplacePlugin } from "@/editor/plugins/findReplace";

const FindReplaceExtension = Extension.create({
  name: "findReplace",
  addProseMirrorPlugins() {
    return [findReplacePlugin];
  },
});

export function createEditorExtensions(): Extensions {
  return [
    StarterKit.configure({
      link: { openOnClick: false, autolink: true, linkOnPaste: true },
      heading: { levels: [1, 2, 3, 4, 5, 6] },
      // Disable StarterKit's plain codeBlock — MermaidCodeBlock replaces it
      codeBlock: false,
    }),
    MermaidCodeBlock,
    MathMark,
    Highlight,
    Superscript,
    Subscript,
    TableKit.configure({ table: { resizable: true } }),
    TableAlignment,
    TaskList,
    TaskItem.configure({ nested: true }),
    Image.configure({ inline: false }),
    Placeholder.configure({
      placeholder: ({ node }) =>
        node.type.name === "heading" ? "Heading" : 'Type "/" for commands…',
    }),
    Callout,
    SlashCommand,
    CustomKeymap,
    FindReplaceExtension,
    RequirementStatus,
    ReviewCommentBadge,
    LinkNavigation,
  ];
}
