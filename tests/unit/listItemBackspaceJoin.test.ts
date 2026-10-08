import { describe, it, expect } from "vitest";
import { Editor } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";
import { createCoreExtensions } from "@/editor/extensions/core";
import { parseMarkdownToDoc, serializeDocToMarkdown } from "@/markdown";
import { expandSoftBreaks, collapseSoftBreaks } from "@/markdown/softBreaks";
import { stripEmptyTopLevelParagraphs } from "@/markdown/emptyParagraphs";
import type { PMNode } from "@/markdown/types";

/**
 * Deleting items from the MIDDLE of a list must never split the list.
 *
 * User report (2026-10-07): in "1. 2. 3. 4. 5.", clearing items 2 and 3 and
 * backspacing the empty item left "4." and "5." as a NEW list ("1." / "1. 2.")
 * instead of one list numbered 1-3. Root cause: TipTap's ListKeymap handles
 * Backspace at the start of ANY list item by lifting it out of the list,
 * which splits the list in two around a paragraph. Backspace at the start of
 * a non-first item now joins it into the previous item instead (the first
 * item keeps the lift, which is how you leave a list at the top).
 */

function makeEditor(markdown: string): Editor {
  return new Editor({
    extensions: createCoreExtensions(),
    content: expandSoftBreaks(parseMarkdownToDoc(markdown)),
  });
}

function toMarkdown(editor: Editor): string {
  return serializeDocToMarkdown(
    stripEmptyTopLevelParagraphs(collapseSoftBreaks(editor.getJSON() as PMNode)),
  );
}

/** Caret at the start of the text of the n-th (0-based) top-level list item. */
function caretAtItemStart(editor: Editor, itemIndex: number): void {
  const list = editor.state.doc.child(0);
  let pos = 1; // inside the list
  for (let i = 0; i < itemIndex; i++) pos += list.child(i).nodeSize;
  // +1 enters the listItem, +1 enters its paragraph
  editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, pos + 2)));
}

function listCount(editor: Editor, type: string): number {
  let n = 0;
  editor.state.doc.descendants((node) => {
    if (node.type.name === type) n++;
  });
  return n;
}

const FIVE = "1. one\n2. two\n3. three\n4. four\n5. five\n";

describe("Backspace at the start of a non-first list item joins, never splits", () => {
  it("removes an emptied middle item and renumbers the remaining items 1..n", () => {
    const editor = makeEditor(FIVE);
    // Select the text of items 2 and 3 and delete it → one empty item remains.
    const list = editor.state.doc.child(0);
    const item2Start = 1 + list.child(0).nodeSize + 2;
    const item3End = 1 + list.child(0).nodeSize + list.child(1).nodeSize + list.child(2).nodeSize - 2;
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, item2Start, item3End)));
    expect(editor.commands.keyboardShortcut("Backspace")).toBe(true);
    expect(editor.state.doc.child(0).childCount).toBe(4);
    expect(editor.state.doc.child(0).child(1).textContent).toBe("");

    // Backspace on the empty item: it must disappear INTO the list, not out of it.
    expect(editor.commands.keyboardShortcut("Backspace")).toBe(true);
    expect(listCount(editor, "orderedList")).toBe(1);
    expect(editor.state.doc.child(0).childCount).toBe(3);
    expect(toMarkdown(editor)).toBe("1. one\n2. four\n3. five\n");
    editor.destroy();
  });

  it("joins a non-empty middle item into the previous one (no new list)", () => {
    const editor = makeEditor(FIVE);
    caretAtItemStart(editor, 2); // start of "three"
    expect(editor.commands.keyboardShortcut("Backspace")).toBe(true);
    expect(listCount(editor, "orderedList")).toBe(1);
    expect(toMarkdown(editor)).toBe("1. one\n2. twothree\n3. four\n4. five\n");
    editor.destroy();
  });

  it("still lifts the FIRST item out of the list (leaving a list is unchanged)", () => {
    const editor = makeEditor(FIVE);
    caretAtItemStart(editor, 0);
    expect(editor.commands.keyboardShortcut("Backspace")).toBe(true);
    expect(editor.state.doc.child(0).type.name).toBe("paragraph");
    expect(editor.state.doc.child(0).textContent).toBe("one");
    editor.destroy();
  });

  it("bullet lists: an emptied middle item is removed without splitting the list", () => {
    const editor = makeEditor("- a\n- b\n- c\n");
    caretAtItemStart(editor, 1);
    editor.view.dispatch(editor.state.tr.delete(editor.state.selection.from, editor.state.selection.from + 1));
    expect(editor.state.doc.child(0).child(1).textContent).toBe("");
    expect(editor.commands.keyboardShortcut("Backspace")).toBe(true);
    expect(listCount(editor, "bulletList")).toBe(1);
    expect(toMarkdown(editor)).toBe("- a\n- c\n");
    editor.destroy();
  });

  it("task lists: same join behaviour", () => {
    const editor = makeEditor("- [ ] a\n- [x] b\n- [ ] c\n");
    caretAtItemStart(editor, 1);
    editor.view.dispatch(editor.state.tr.delete(editor.state.selection.from, editor.state.selection.from + 1));
    expect(editor.commands.keyboardShortcut("Backspace")).toBe(true);
    expect(listCount(editor, "taskList")).toBe(1);
    expect(toMarkdown(editor)).toBe("- [ ] a\n- [ ] c\n");
    editor.destroy();
  });

  it("previous item with a nested sub-list: backspace on an emptied item still keeps one list", () => {
    const editor = makeEditor("1. one\n   - nested\n2. two\n3. three\n");
    caretAtItemStart(editor, 1);
    editor.view.dispatch(editor.state.tr.delete(editor.state.selection.from, editor.state.selection.from + 3));
    expect(editor.state.doc.child(0).child(1).textContent).toBe("");
    editor.commands.keyboardShortcut("Backspace");
    expect(listCount(editor, "orderedList")).toBe(1);
    expect(toMarkdown(editor)).toBe("1. one\n   - nested\n2. three\n");
    editor.destroy();
  });
});
