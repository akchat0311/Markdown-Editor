import { Extension } from "@tiptap/core";

export const CustomKeymap = Extension.create({
  name: "customKeymap",
  addKeyboardShortcuts() {
    return {
      "Mod-Shift-9": () => this.editor.commands.toggleTaskList(),

      // Block Enter inside table cells: ProseMirror's default Enter handler
      // (splitBlock) creates a second paragraph inside the cell, which the
      // GFM serializer concatenates without a separator — silent data loss.
      // Shift-Enter (hardBreak) remains the correct path for line breaks in cells.
      "Enter": () => this.editor.isActive("table"),

      // Mod-Enter inserts a row below while inside a table.
      // Outside tables, Mod-Enter falls through to prosemirror-commands' exitCode
      // which only runs inside code blocks — no conflict.
      "Mod-Enter": () => {
        if (!this.editor.isActive("table")) return false;
        return this.editor.commands.addRowAfter();
      },
    };
  },
});
