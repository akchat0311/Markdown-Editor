import { Mark, markInputRule } from "@tiptap/core";
import { inlineMathPlugin } from "@/editor/plugins/inlineMathDecorations";

/**
 * Inline math mark. The LaTeX source is stored as text content; the `$` delimiters
 * exist only in the markdown file (added/removed by parser/serializer).
 *
 * Rendering: a ProseMirror decoration plugin overlays a KaTeX widget when the cursor
 * is outside the mark range, and hides the source text. When the cursor is inside,
 * the raw LaTeX is shown for editing.
 *
 * Input rule: typing `$content$` in the editor auto-applies this mark and removes
 * the `$` delimiters, matching standard markdown authoring UX.
 */
export const MathMark = Mark.create({
  name: "inlineMath",

  // Math is exclusive — no other inline marks can coexist with it
  excludes: "_",
  spanning: false,
  inclusive: false, // typing at the end of math exits it

  parseHTML() {
    return [{ tag: "span[data-inline-math]" }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["span", { "data-inline-math": "", ...HTMLAttributes }, 0];
  },

  addInputRules() {
    return [
      // Matches $content$ at the cursor position.
      // Fires when the user types the closing $, converting the delimited span
      // into text with the inlineMath mark applied (delimiters are removed).
      markInputRule({
        find: /(?<![\\])\$([^$\s][^$]*?)\$$/,
        type: this.type,
      }),
    ];
  },

  addProseMirrorPlugins() {
    return [inlineMathPlugin];
  },
});
