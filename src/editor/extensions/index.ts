import StarterKit from "@tiptap/starter-kit";
import { TableKit } from "@tiptap/extension-table";
import { WorkspaceImage } from "./WorkspaceImage";
import { RawHtmlBlock } from "./RawHtmlBlock";
import { RawHtmlInline } from "./RawHtmlInline";
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
import { TableColumnAlign } from "./TableColumnAlign";
import { RequirementStatus } from "./RequirementStatus";
import { ReviewCommentBadge } from "./ReviewCommentBadge";
import { TraceabilityBadge } from "./TraceabilityBadge";
import { RequirementIdMigration } from "./RequirementIdMigration";
import { LinkNavigation } from "./LinkNavigation";
import { LinkDefinition } from "./LinkDefinition";
import {
  SpreadBulletList,
  SpreadOrderedList,
  SpreadListItem,
  SpreadTaskList,
  SpreadTaskItem,
} from "./SpreadLists";
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
      // Disable built-in list extensions — SpreadBulletList / SpreadOrderedList /
      // SpreadListItem replace them with an added `spread` attr for loose-list
      // fidelity. Names stay the same so all commands and keymaps continue to work.
      bulletList: false,
      orderedList: false,
      listItem: false,
    }),
    SpreadBulletList,
    SpreadOrderedList,
    SpreadListItem,
    MermaidCodeBlock,
    MathMark,
    Highlight,
    Superscript,
    Subscript,
    TableKit.configure({ table: { resizable: false } }),
    TableColumnAlign,
    SpreadTaskList,
    SpreadTaskItem.configure({ nested: true }),
    WorkspaceImage.configure({ inline: false }),
    RawHtmlBlock,
    RawHtmlInline,
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
    TraceabilityBadge,
    RequirementIdMigration,
    LinkNavigation,
    LinkDefinition,
  ];
}
