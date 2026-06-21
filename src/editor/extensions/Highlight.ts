import { Mark, markInputRule } from "@tiptap/core";

export const Highlight = Mark.create({
  name: "highlight",
  inclusive: false,

  parseHTML() {
    return [{ tag: "mark" }];
  },

  renderHTML() {
    return ["mark", {}, 0] as const;
  },

  addInputRules() {
    return [
      // ==content== auto-applies highlight mark (removes the == delimiters)
      markInputRule({ find: /==([^=\n]+)==$/, type: this.type }),
    ];
  },

  addKeyboardShortcuts() {
    return {
      "Mod-Shift-h": () => this.editor.commands.toggleMark(this.name),
    };
  },
});
