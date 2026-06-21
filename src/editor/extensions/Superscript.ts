import { Mark, markInputRule } from "@tiptap/core";

export const Superscript = Mark.create({
  name: "superscript",
  excludes: "subscript",
  inclusive: false,

  parseHTML() {
    return [{ tag: "sup" }];
  },

  renderHTML() {
    return ["sup", {}, 0] as const;
  },

  addInputRules() {
    return [
      // ^content^ auto-applies superscript mark
      markInputRule({ find: /\^([^^\n]+)\^$/, type: this.type }),
    ];
  },
});
