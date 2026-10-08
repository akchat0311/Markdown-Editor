import { Node } from "@tiptap/core";

/**
 * Soft line break — a markdown "lazy wrap" (`\n` inside a paragraph).
 *
 * Raw `\n` inside ProseMirror text nodes is hazardous in real Chromium:
 * contentEditable rewrites the newlines into `<br>` elements while executing
 * ordinary edits elsewhere in the paragraph, and the DOM re-read then maps
 * those through HardBreak's `br` rule — silently turning soft wraps into
 * hard breaks (serialized as trailing `\`). Verified in a Playwright repro
 * against the built webview bundle (2026-08-30).
 *
 * SoftBreak eliminates raw `\n` from the editable DOM: the webview expands
 * text newlines into these nodes after parsing (expandSoftBreaks) and
 * collapses them back to `\n` before serializing (collapseSoftBreaks).
 * The tagged `<br data-soft-break>` wins over HardBreak's plain `br` rule
 * via priority, so DOM re-reads are lossless.
 */
export const SoftBreak = Node.create({
  name: "softBreak",
  inline: true,
  group: "inline",
  selectable: false,

  parseHTML() {
    return [{ tag: "br[data-soft-break]", priority: 60 }];
  },

  renderHTML() {
    return ["br", { "data-soft-break": "" }];
  },

  // editor.getText() (status-bar word count and other plain-text consumers)
  // treats a soft wrap as a line break, exactly like HardBreak does.
  renderText() {
    return "\n";
  },
});
