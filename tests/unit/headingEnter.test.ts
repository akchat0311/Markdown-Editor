import { describe, it, expect } from "vitest";
import { Editor } from "@tiptap/core";
import { createCoreExtensions } from "@/editor/extensions/core";
import { parseMarkdownToDoc, serializeDocToMarkdown } from "@/markdown";

/**
 * Enter inside a heading never splits it (user report, 2026-09-01): after a
 * slash-insert the caret sits before " [Draft]"; a split dragged the status
 * bracket down into the body text. Enter now finishes the heading and opens
 * a paragraph below, from any caret position inside it.
 */
describe("Enter inside a heading", () => {
  function run(caretAfter: string) {
    const editor = new Editor({
      element: document.createElement("div"),
      extensions: createCoreExtensions(),
      content: parseMarkdownToDoc("### TRANS_feat_011 [Draft]\n\nExisting body.\n"),
    });
    let pos = -1;
    editor.state.doc.descendants((n, p) => {
      if (n.isText && n.text!.includes(caretAfter)) {
        pos = p + n.text!.indexOf(caretAfter) + caretAfter.length;
      }
    });
    editor.commands.setTextSelection(pos);
    // Real keydown (commands.keyboardShortcut does not route selection the
    // same way as the live keymap path).
    editor.view.dom.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }),
    );
    editor.commands.insertContent("some text");
    const out = serializeDocToMarkdown(editor.getJSON() as never);
    editor.destroy();
    return out;
  }

  it("mid-heading (before the status bracket): heading stays intact", () => {
    expect(run("TRANS_feat_011")).toBe(
      "### TRANS_feat_011 [Draft]\n\nsome text\n\nExisting body.\n",
    );
  });

  it("at heading end: same result", () => {
    expect(run("[Draft]")).toBe(
      "### TRANS_feat_011 [Draft]\n\nsome text\n\nExisting body.\n",
    );
  });
});
