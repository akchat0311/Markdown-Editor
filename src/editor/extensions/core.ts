import StarterKit from "@tiptap/starter-kit";
import Image from "@tiptap/extension-image";
import { TableKit } from "@tiptap/extension-table";
import type { Extensions } from "@tiptap/core";
import { RawHtmlBlock } from "./RawHtmlBlock";
import { SoftBreak } from "./SoftBreak";
import { RawHtmlInline } from "./RawHtmlInline";
import { Callout } from "./Callout";
import { CustomKeymap } from "./CustomKeymap";
import { MathMark } from "./MathMark";
import { Highlight } from "./Highlight";
import { Superscript } from "./Superscript";
import { Subscript } from "./Subscript";
import { TableColumnAlign } from "./TableColumnAlign";
import { LinkDefinition } from "./LinkDefinition";
import {
  SpreadBulletList,
  SpreadOrderedList,
  SpreadListItem,
  SpreadTaskList,
  SpreadTaskItem,
} from "./SpreadLists";

/**
 * Schema-complete extension set with no React, store, or UI-chrome
 * dependencies. Covers every node/mark type the parser can emit, so any
 * document that parses can be loaded and re-serialized losslessly.
 *
 * Ported from the VS Code extension's engine, where the webview runs on it.
 * In the browser app it is a headless test harness: the keymap, list,
 * soft-break and heading-field suites build a plain `new Editor()` on it.
 * Differences from createEditorExtensions():
 * - undoRedo disabled (the extension delegates undo to the host document)
 * - StarterKit's plain codeBlock instead of MermaidCodeBlock (same
 *   "codeBlock" schema name)
 * - plain Image instead of WorkspaceImage (same "image" schema name)
 * - no SlashCommand / Placeholder / badge decorations (UI layers)
 */
export function createCoreExtensions(): Extensions {
  return [
    StarterKit.configure({
      link: { openOnClick: false, autolink: true, linkOnPaste: true },
      heading: { levels: [1, 2, 3, 4, 5, 6] },
      undoRedo: false,
      bulletList: false,
      orderedList: false,
      listItem: false,
    }),
    SpreadBulletList,
    SpreadOrderedList,
    SpreadListItem,
    MathMark,
    Highlight,
    Superscript,
    Subscript,
    TableKit.configure({ table: { resizable: false } }),
    TableColumnAlign,
    SpreadTaskList,
    SpreadTaskItem.configure({ nested: true }),
    Image.configure({ inline: false }),
    RawHtmlBlock,
    RawHtmlInline,
    SoftBreak,
    Callout,
    CustomKeymap,
    LinkDefinition,
  ];
}
