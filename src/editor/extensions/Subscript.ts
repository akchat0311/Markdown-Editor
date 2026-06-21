import { Mark, markInputRule } from "@tiptap/core";

export const Subscript = Mark.create({
  name: "subscript",
  excludes: "superscript",
  inclusive: false,

  parseHTML() {
    return [{ tag: "sub" }];
  },

  renderHTML() {
    return ["sub", {}, 0] as const;
  },

  addInputRules() {
    return [
      // ~content~ auto-applies subscript mark; (?<!~) prevents firing on ~~strikethrough~~
      markInputRule({ find: /(?<!~)~([^~\n]+)~$/, type: this.type }),
    ];
  },
});
