/**
 * Regression tests for the outline-staleness-after-tab-switch bug.
 *
 * Root cause: OutlinePanel subscribed to editor.on("update", …), but the
 * tab-switch dispatch in App.tsx sets setMeta("preventUpdate", true) to
 * avoid writing back to the store.  TipTap suppresses the `update` event for
 * such transactions, so the outline never updated.
 *
 * Fix: subscribe to `transaction` (fires for all transactions) and guard on
 * tr.docChanged; rebuild immediately for preventUpdate transactions (tab
 * switches), and debounce for normal edits.
 */

import { describe, it, expect, vi } from "vitest";
import { Editor } from "@tiptap/core";
import Document from "@tiptap/extension-document";
import Paragraph from "@tiptap/extension-paragraph";
import Text from "@tiptap/extension-text";
import Heading from "@tiptap/extension-heading";
import type { JSONContent } from "@tiptap/core";
import { deriveOutline } from "@/editor/utils/deriveOutline";

// ── Minimal editor factory ────────────────────────────────────────────────────

function makeEditor(content: JSONContent): Editor {
  return new Editor({
    extensions: [Document, Paragraph, Text, Heading],
    content,
  });
}

function headingDoc(text: string): JSONContent {
  return {
    type: "doc",
    content: [
      {
        type: "heading",
        attrs: { level: 1 },
        content: [{ type: "text", text }],
      },
    ],
  };
}

function emptyDoc(): JSONContent {
  return { type: "doc", content: [{ type: "paragraph" }] };
}

// ── Transaction helpers ───────────────────────────────────────────────────────

/** Mirrors the tab-switch dispatch in App.tsx: docChanged but preventUpdate. */
function tabSwitchDispatch(editor: Editor, content: JSONContent) {
  const newDoc = editor.schema.nodeFromJSON(content);
  const tr = editor.state.tr
    .replaceWith(0, editor.state.doc.content.size, newDoc.content)
    .setMeta("addToHistory", false)
    .setMeta("preventUpdate", true);
  editor.view.dispatch(tr);
}

/** Normal edit — no preventUpdate flag. */
function editDispatch(editor: Editor, content: JSONContent) {
  const newDoc = editor.schema.nodeFromJSON(content);
  const tr = editor.state.tr
    .replaceWith(0, editor.state.doc.content.size, newDoc.content)
    .setMeta("addToHistory", false);
  editor.view.dispatch(tr);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("tab-switch outline staleness — event semantics", () => {
  it("transaction event fires for preventUpdate:true; update does NOT", () => {
    const editor = makeEditor(headingDoc("Tab A"));
    const onTransaction = vi.fn();
    const onUpdate = vi.fn();

    editor.on("transaction", onTransaction);
    editor.on("update", onUpdate);

    tabSwitchDispatch(editor, headingDoc("Tab B"));

    expect(onTransaction).toHaveBeenCalledOnce();
    expect(onUpdate).not.toHaveBeenCalled();

    editor.destroy();
  });

  it("update event fires for a normal (non-preventUpdate) edit", () => {
    const editor = makeEditor(headingDoc("Tab A"));
    const onUpdate = vi.fn();
    editor.on("update", onUpdate);

    editDispatch(editor, headingDoc("Tab B"));

    expect(onUpdate).toHaveBeenCalledOnce();

    editor.destroy();
  });

  it("transaction event carries docChanged=true for content swaps", () => {
    const editor = makeEditor(headingDoc("Tab A"));
    let docChanged = false;
    editor.on("transaction", ({ transaction }) => {
      docChanged = transaction.docChanged;
    });

    tabSwitchDispatch(editor, headingDoc("Tab B"));

    expect(docChanged).toBe(true);

    editor.destroy();
  });

  it("selection-only transaction has docChanged=false", () => {
    const editor = makeEditor(headingDoc("Tab A"));
    let seenDocChanged: boolean[] = [];
    editor.on("transaction", ({ transaction }) => {
      seenDocChanged.push(transaction.docChanged);
    });

    // Selection change only — not a content modification
    const tr = editor.state.tr.setSelection(
      editor.state.selection
    );
    editor.view.dispatch(tr);

    expect(seenDocChanged.every((v) => v === false)).toBe(true);

    editor.destroy();
  });
});

describe("tab-switch outline staleness — deriveOutline after swap", () => {
  it("A headings → switch to B headings → outline shows B", () => {
    const editor = makeEditor(headingDoc("Tab A heading"));
    expect(deriveOutline(editor).map((n) => n.label)).toEqual(["Tab A heading"]);

    tabSwitchDispatch(editor, headingDoc("Tab B heading"));
    expect(deriveOutline(editor).map((n) => n.label)).toEqual(["Tab B heading"]);

    editor.destroy();
  });

  it("B → A switch restores A's outline", () => {
    const docA = headingDoc("A heading");
    const docB = headingDoc("B heading");
    const editor = makeEditor(docA);

    tabSwitchDispatch(editor, docB);
    expect(deriveOutline(editor).map((n) => n.label)).toEqual(["B heading"]);

    tabSwitchDispatch(editor, docA);
    expect(deriveOutline(editor).map((n) => n.label)).toEqual(["A heading"]);

    editor.destroy();
  });

  it("closing active tab (swap to empty doc) clears the outline", () => {
    const editor = makeEditor(headingDoc("Has heading"));
    tabSwitchDispatch(editor, emptyDoc());

    expect(deriveOutline(editor)).toHaveLength(0);

    editor.destroy();
  });

  it("empty doc swap clears stale headings", () => {
    const editor = makeEditor({
      type: "doc",
      content: [
        { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "H1" }] },
        { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "H2" }] },
      ],
    });

    tabSwitchDispatch(editor, emptyDoc());
    expect(deriveOutline(editor)).toHaveLength(0);

    editor.destroy();
  });

  it("editing after tab switch is captured by the normal (debounced) path", () => {
    const editor = makeEditor(headingDoc("Tab A"));

    tabSwitchDispatch(editor, headingDoc("Tab B initial"));
    expect(deriveOutline(editor).map((n) => n.label)).toEqual(["Tab B initial"]);

    // Simulate an edit on the now-active tab (no preventUpdate)
    editDispatch(editor, headingDoc("Tab B edited"));
    expect(deriveOutline(editor).map((n) => n.label)).toEqual(["Tab B edited"]);

    editor.destroy();
  });
});
