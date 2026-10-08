import { describe, it, expect, afterEach } from "vitest";
import { Editor } from "@tiptap/core";
import { createCoreExtensions } from "@/editor/extensions/core";
import { SoftBreak } from "@/editor/extensions/SoftBreak";
import { parseMarkdownToDoc, serializeDocToMarkdown } from "@/markdown";
import { expandSoftBreaks, collapseSoftBreaks } from "@/markdown/softBreaks";
import { useEditorBehaviorStore } from "@/stores/editorBehaviorStore";
import type { PMNode } from "@/markdown/types";

/**
 * Enter semantics (design change, user request 2026-09-01): in "line" mode
 * (the default) Enter in a top-level paragraph writes ONE newline to the
 * file — no blank line; Enter again on the empty line upgrades it to a
 * paragraph break. "paragraph" mode keeps classic markdown behavior.
 */

function makeEditor(md: string): Editor {
  return new Editor({
    element: document.createElement("div"),
    extensions: [...createCoreExtensions(), SoftBreak],
    content: expandSoftBreaks(parseMarkdownToDoc(md)),
  });
}

function pressEnter(editor: Editor): void {
  editor.view.dom.dispatchEvent(
    new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }),
  );
}

function out(editor: Editor): string {
  return serializeDocToMarkdown(collapseSoftBreaks(editor.getJSON() as PMNode));
}

function caretToEndOf(editor: Editor, needle: string): void {
  let pos = -1;
  editor.state.doc.descendants((n, p) => {
    if (n.isText && n.text!.includes(needle)) pos = p + n.text!.indexOf(needle) + needle.length;
  });
  editor.commands.setTextSelection(pos);
}

afterEach(() => useEditorBehaviorStore.getState().setEnterMode("line"));

describe("Enter in line mode (default)", () => {
  it("single Enter writes one newline, not a blank line", () => {
    const editor = makeEditor("hgfhjhg.\n");
    caretToEndOf(editor, "hgfhjhg.");
    pressEnter(editor);
    editor.commands.insertContent("line2");
    expect(out(editor)).toBe("hgfhjhg.\nline2\n");
    editor.destroy();
  });

  it("Enter twice makes a paragraph break (blank line)", () => {
    const editor = makeEditor("hgfhjhg.\n");
    caretToEndOf(editor, "hgfhjhg.");
    pressEnter(editor);
    pressEnter(editor);
    editor.commands.insertContent("para2");
    expect(out(editor)).toBe("hgfhjhg.\n\npara2\n");
    editor.destroy();
  });

  it("Enter mid-line splits the line with a single newline", () => {
    const editor = makeEditor("aaabbb\n");
    caretToEndOf(editor, "aaa");
    pressEnter(editor);
    expect(out(editor)).toBe("aaa\nbbb\n");
    editor.destroy();
  });

  it("lists keep their native Enter (new item)", () => {
    const editor = makeEditor("- item one\n");
    caretToEndOf(editor, "item one");
    pressEnter(editor);
    editor.commands.insertContent("item two");
    expect(out(editor)).toContain("- item one\n- item two");
    editor.destroy();
  });
});

describe("Enter in paragraph mode", () => {
  it("single Enter makes a paragraph break (classic markdown)", () => {
    useEditorBehaviorStore.getState().setEnterMode("paragraph");
    const editor = makeEditor("hgfhjhg.\n");
    caretToEndOf(editor, "hgfhjhg.");
    pressEnter(editor);
    editor.commands.insertContent("line2");
    expect(out(editor)).toBe("hgfhjhg.\n\nline2\n");
    editor.destroy();
  });
});
