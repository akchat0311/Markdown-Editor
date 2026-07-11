import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { Editor, Extension } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { TableKit } from "@tiptap/extension-table";
import { findReplacePlugin, findReplaceKey, setFindQuery, navigateToMatch } from "@/editor/plugins/findReplace";
import type { JSONContent } from "@tiptap/core";

// Regression coverage for: Next/Previous/Enter navigation updated the PM
// selection and decorations correctly, but never scrolled the active match
// into view. Root cause: ProseMirror's built-in scroll-to-selection
// machinery (triggered by tr.scrollIntoView()) is gated on the real DOM
// selection living inside view.dom (selectionToDOM()/scrollToSelection()
// both no-op via their hasFocus()/editorOwnsSelection() checks otherwise).
// The find bar deliberately keeps focus in its <input> during navigation, so
// that gate was never satisfied. The fix in navigateToMatch() briefly
// focuses the view before dispatching, then restores focus to wherever it
// was — these tests verify that mechanism engages (view.dom is focused
// during the call) and that focus doesn't leak (it's restored afterward).
//
// jsdom has no real layout engine (all rects are zero), so it cannot verify
// an actual pixel scroll offset. Asserting that ProseMirror's focus
// precondition is satisfied is the most precise thing verifiable at this
// level — see the manual verification note in the audit report for the
// real-browser check.

const FindReplaceExtension = Extension.create({
  name: "findReplace",
  addProseMirrorPlugins() {
    return [findReplacePlugin];
  },
});

function makeTestExtensions() {
  return [
    StarterKit.configure({ codeBlock: false }),
    TableKit.configure({ table: { resizable: false } }),
    FindReplaceExtension,
  ];
}

function paragraphDoc(texts: string[]): JSONContent {
  return {
    type: "doc",
    content: texts.map((text) => ({ type: "paragraph", content: text ? [{ type: "text", text }] : [] })),
  };
}

function tableDoc(rows: string[]): JSONContent {
  return {
    type: "doc",
    content: [
      {
        type: "table",
        content: rows.map((text) => ({
          type: "tableRow",
          content: [
            {
              type: "tableCell",
              attrs: { align: null },
              content: [{ type: "paragraph", content: [{ type: "text", text }] }],
            },
          ],
        })),
      },
    ],
  };
}

function query(editor: Editor, q: string) {
  setFindQuery(editor.view, { query: q, caseSensitive: false, wholeWord: false, useRegex: false });
}

function matches(editor: Editor) {
  return findReplaceKey.getState(editor.state)?.matches ?? [];
}

function currentIndex(editor: Editor) {
  return findReplaceKey.getState(editor.state)?.currentMatchIndex ?? -1;
}

/** Records every element `.focus()` is called on, without disturbing real jsdom focus behavior. */
function trackFocusCalls() {
  const calls: HTMLElement[] = [];
  const original = HTMLElement.prototype.focus;
  HTMLElement.prototype.focus = function (this: HTMLElement, ...args: unknown[]) {
    calls.push(this);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (original as any).apply(this, args);
  };
  return {
    calls,
    restore: () => {
      HTMLElement.prototype.focus = original;
    },
  };
}

describe("find/replace: active match is scrolled into view on navigation", () => {
  let editor: Editor;
  let searchInput: HTMLInputElement;
  let focusTracker: ReturnType<typeof trackFocusCalls>;

  beforeEach(() => {
    searchInput = document.createElement("input");
    document.body.appendChild(searchInput);
    focusTracker = trackFocusCalls();
  });

  afterEach(() => {
    editor?.destroy();
    searchInput.remove();
    focusTracker.restore();
  });

  function focusSearchInput() {
    searchInput.focus();
    focusTracker.calls.length = 0; // ignore the setup focus() call itself
  }

  it("Next match: navigating engages the editor's scroll-into-view precondition and restores focus to the search input", () => {
    editor = new Editor({ extensions: makeTestExtensions(), content: paragraphDoc(["foo", "foo", "foo"]) });
    query(editor, "foo");
    focusSearchInput();

    navigateToMatch(editor.view, 1); // "Next" from match 0 → match 1

    expect(currentIndex(editor)).toBe(1);
    expect(editor.state.selection.from).toBe(matches(editor)[1].from);
    // The fix's core mechanism: view.dom must have been focused at some
    // point during navigation, or PM's native scrollToSelection() is a
    // silent no-op (this is exactly the bug being regression-tested).
    expect(focusTracker.calls).toContain(editor.view.dom);
    // ...but focus must not be left inside the editor — it belongs back in
    // the search input so repeated Enter/typing keeps working.
    expect(document.activeElement).toBe(searchInput);
  });

  it("Previous match: navigating backward also engages scroll-into-view and restores focus", () => {
    editor = new Editor({ extensions: makeTestExtensions(), content: paragraphDoc(["foo", "foo", "foo"]) });
    query(editor, "foo");
    navigateToMatch(editor.view, 1);
    focusSearchInput();

    navigateToMatch(editor.view, 0); // "Previous" from match 1 → match 0

    expect(currentIndex(editor)).toBe(0);
    expect(editor.state.selection.from).toBe(matches(editor)[0].from);
    expect(focusTracker.calls).toContain(editor.view.dom);
    expect(document.activeElement).toBe(searchInput);
  });

  it("first and last match both scroll into view (wraparound boundaries)", () => {
    editor = new Editor({ extensions: makeTestExtensions(), content: paragraphDoc(["foo", "x", "foo", "x", "foo"]) });
    query(editor, "foo");
    const all = matches(editor);
    expect(all).toHaveLength(3);

    focusSearchInput();
    navigateToMatch(editor.view, 0); // first
    expect(editor.state.selection.from).toBe(all[0].from);
    expect(focusTracker.calls).toContain(editor.view.dom);
    expect(document.activeElement).toBe(searchInput);

    focusSearchInput();
    navigateToMatch(editor.view, all.length - 1); // last
    expect(editor.state.selection.from).toBe(all[all.length - 1].from);
    expect(focusTracker.calls).toContain(editor.view.dom);
    expect(document.activeElement).toBe(searchInput);
  });

  it("long document: a match far below the fold still scrolls into view", () => {
    const paragraphs = Array.from({ length: 500 }, (_, i) => (i === 499 ? "needle" : `filler paragraph ${i}`));
    editor = new Editor({ extensions: makeTestExtensions(), content: paragraphDoc(paragraphs) });
    query(editor, "needle");
    focusSearchInput();

    navigateToMatch(editor.view, 0);

    expect(editor.state.selection.from).toBe(matches(editor)[0].from);
    expect(focusTracker.calls).toContain(editor.view.dom);
    expect(document.activeElement).toBe(searchInput);
  });

  it("long tables: a match inside a deeply-nested table cell still scrolls into view", () => {
    const rows = Array.from({ length: 200 }, (_, i) => (i === 150 ? "needle" : `row ${i}`));
    editor = new Editor({ extensions: makeTestExtensions(), content: tableDoc(rows) });
    query(editor, "needle");
    focusSearchInput();

    navigateToMatch(editor.view, 0);

    expect(editor.state.selection.from).toBe(matches(editor)[0].from);
    expect(focusTracker.calls).toContain(editor.view.dom);
    expect(document.activeElement).toBe(searchInput);
  });

  it("repeated navigation: every step in a full cycle through all matches scrolls into view and returns focus", () => {
    editor = new Editor({ extensions: makeTestExtensions(), content: paragraphDoc(["foo", "foo", "foo", "foo"]) });
    query(editor, "foo");
    const all = matches(editor);

    // Simulate pressing Enter repeatedly past the end and back around twice.
    for (let step = 0; step < all.length * 2; step++) {
      focusSearchInput();
      const idx = step % all.length;
      navigateToMatch(editor.view, idx);

      expect(editor.state.selection.from).toBe(all[idx].from);
      expect(focusTracker.calls).toContain(editor.view.dom);
      expect(document.activeElement).toBe(searchInput);
    }
  });

  it("editor does not retain focus after search navigation — it goes back to the search input", () => {
    editor = new Editor({ extensions: makeTestExtensions(), content: paragraphDoc(["foo", "foo"]) });
    query(editor, "foo");
    focusSearchInput();

    navigateToMatch(editor.view, 1);

    // The core regression risk introduced by this fix: view.focus() is
    // called to satisfy PM's scroll precondition, but must not leak — the
    // user should still be able to type in the search box immediately after.
    expect(document.activeElement).not.toBe(editor.view.dom);
    expect(document.activeElement).toBe(searchInput);
  });
});
