import StarterKit from "@tiptap/starter-kit";
import { TableKit } from "@tiptap/extension-table";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import Image from "@tiptap/extension-image";
import Placeholder from "@tiptap/extension-placeholder";
import type { Extensions } from "@tiptap/core";
import { Callout } from "./Callout";
import { SlashCommand } from "./SlashCommand";
import { CustomKeymap } from "./CustomKeymap";

export function createEditorExtensions(): Extensions {
  return [
    StarterKit.configure({
      link: { openOnClick: false, autolink: true, linkOnPaste: true },
      heading: { levels: [1, 2, 3, 4, 5, 6] },
    }),
    TableKit.configure({ table: { resizable: true } }),
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
  ];
}
