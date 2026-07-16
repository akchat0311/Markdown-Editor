import { describe, it, expect, afterEach } from "vitest";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { SpreadBulletList, SpreadOrderedList, SpreadListItem } from "@/editor/extensions/SpreadLists";
import { serializeDocToMarkdown, parseMarkdownToDoc } from "@/markdown";
import type { JSONContent } from "@tiptap/core";

// Regression coverage for the Windows ordered-list paste bug: a clipboard
// fragment carrying `<li value="N">` (or `<ol start="N">`) must never leave a
// lasting `value` attr on the pasted item or propagate one onto items created
// afterwards via Enter. See src/editor/extensions/SpreadLists.ts.

function makeTestExtensions() {
  return [
    StarterKit.configure({ codeBlock: false, bulletList: false, orderedList: false, listItem: false }),
    SpreadBulletList,
    SpreadOrderedList,
    SpreadListItem,
  ];
}

function orderedListDoc(items: string[]): JSONContent {
  return {
    type: "doc",
    content: [
      {
        type: "orderedList",
        content: items.map((text) => ({
          type: "listItem",
          content: [{ type: "paragraph", content: [{ type: "text", text }] }],
        })),
      },
    ],
  };
}

function listItemValues(editor: Editor): (number | null)[] {
  const values: (number | null)[] = [];
  editor.state.doc.descendants((node) => {
    if (node.type.name === "listItem") values.push((node.attrs.value as number | null) ?? null);
  });
  return values;
}

/** Position immediately after the first text node matching `text`. */
function textEndPos(editor: Editor, text: string): number {
  let pos = -1;
  editor.state.doc.descendants((node, nodePos) => {
    if (pos > -1) return false;
    if (node.isText && node.text === text) {
      pos = nodePos + node.nodeSize;
      return false;
    }
    return true;
  });
  if (pos === -1) throw new Error(`text not found: ${text}`);
  return pos;
}

describe("ordered list: clipboard-sourced numbering must not become persistent state", () => {
  let editor: Editor;
  afterEach(() => editor?.destroy());

  // ── paste within same list ──────────────────────────────────────────────

  it("paste within same list: a <li value> fragment does not set attrs.value", () => {
    editor = new Editor({ extensions: makeTestExtensions(), content: orderedListDoc(["A", "B", "C"]) });
    editor.commands.setTextSelection(textEndPos(editor, "A"));

    // Simulates copying item "B" (position 2) and pasting it back into the
    // same list right after item "A" — the clipboard fragment the browser
    // hands back carries the source ordinal baked in.
    editor.commands.insertContent('<li value="2">B (pasted)</li>');

    expect(listItemValues(editor)).toEqual([null, null, null, null]);
    const md = serializeDocToMarkdown(editor.state.doc.toJSON() as JSONContent);
    expect(md.trim()).toBe("1. A\n2. B (pasted)\n3. B\n4. C");
  });

  // ── paste into another list ─────────────────────────────────────────────

  it("paste into another list: pasted item adopts its new ordinal, not the source list's", () => {
    editor = new Editor({
      extensions: makeTestExtensions(),
      content: {
        type: "doc",
        content: [
          orderedListDoc(["A", "B", "C"]).content![0] as JSONContent,
          orderedListDoc(["X", "Y", "Z"]).content![0] as JSONContent,
        ],
      },
    });
    // Paste the copied "B" (originally ordinal 2 in the first list) at the
    // end of the second list's first item — exactly the reported repro.
    editor.commands.setTextSelection(textEndPos(editor, "X"));
    editor.commands.insertContent('<li value="2">B</li>');

    expect(listItemValues(editor)).toEqual([null, null, null, null, null, null, null]);
    const md = serializeDocToMarkdown(editor.state.doc.toJSON() as JSONContent);
    // Adjacent top-level ordered lists serialize with alternating `.`/`)`
    // delimiters (GFM disambiguation, unrelated to this bug) — what matters
    // here is the second list's positional numbering: 1, 2, 3, 4.
    expect(md).toContain("1) X\n2) B\n3) Y\n4) Z");
  });

  // ── Enter after pasted item ─────────────────────────────────────────────

  it("Enter after the pasted item continues sequential numbering, not the stale value", () => {
    editor = new Editor({ extensions: makeTestExtensions(), content: orderedListDoc(["X", "Y", "Z"]) });
    editor.commands.setTextSelection(textEndPos(editor, "X"));
    editor.commands.insertContent('<li value="2">B</li>');

    editor.commands.setTextSelection(textEndPos(editor, "B"));
    editor.commands.splitListItem("listItem");
    editor.commands.insertContent("New");

    expect(listItemValues(editor)).toEqual([null, null, null, null, null]);
    const md = serializeDocToMarkdown(editor.state.doc.toJSON() as JSONContent);
    expect(md.trim()).toBe("1. X\n2. B\n3. New\n4. Y\n5. Z");
    // Guards against the exact reported failure mode.
    expect(md).not.toMatch(/2\.\s*New/);
  });

  it("a legitimately-parsed value is NOT inherited by a new item created via Enter", () => {
    // `value: 2` here simulates the one legitimate producer of this attr —
    // the markdown parser (parser.ts) constructing PM JSON directly from a
    // source file with a non-sequential marker.
    editor = new Editor({
      extensions: makeTestExtensions(),
      content: {
        type: "doc",
        content: [
          {
            type: "orderedList",
            content: [
              { type: "listItem", attrs: { value: 2 }, content: [{ type: "paragraph", content: [{ type: "text", text: "B" }] }] },
            ],
          },
        ],
      },
    });
    editor.commands.setTextSelection(textEndPos(editor, "B"));
    editor.commands.splitListItem("listItem");

    expect(listItemValues(editor)).toEqual([2, null]);
  });

  // ── nested lists ─────────────────────────────────────────────────────────

  it("nested lists: pasted value inside a nested list does not leak to the parent item or siblings", () => {
    editor = new Editor({
      extensions: makeTestExtensions(),
      content: {
        type: "doc",
        content: [
          {
            type: "orderedList",
            content: [
              {
                type: "listItem",
                content: [
                  { type: "paragraph", content: [{ type: "text", text: "Parent" }] },
                  {
                    type: "orderedList",
                    content: [
                      { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "Child 1" }] }] },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
    });

    editor.commands.setTextSelection(textEndPos(editor, "Child 1"));
    editor.commands.insertContent('<li value="9">Child (pasted)</li>');

    expect(listItemValues(editor)).toEqual([null, null, null]);
    const md = serializeDocToMarkdown(editor.state.doc.toJSON() as JSONContent);
    expect(md).toContain("1. Parent");
    expect(md).toContain("1. Child 1");
    expect(md).toContain("2. Child (pasted)");

    // Enter after the nested pasted item must also stay positional, and must
    // not disturb the parent item's own numbering.
    editor.commands.setTextSelection(textEndPos(editor, "Child (pasted)"));
    editor.commands.splitListItem("listItem");
    editor.commands.insertContent("Child 3");
    expect(listItemValues(editor)).toEqual([null, null, null, null]);
  });

  // ── markdown round-trip ──────────────────────────────────────────────────

  it("markdown round-trip: intentional non-sequential markers still round-trip losslessly", () => {
    const md = "4. A\n7. B\n1. C\n";
    const doc = parseMarkdownToDoc(md);
    expect(serializeDocToMarkdown(doc)).toBe(md);
  });

  it("markdown round-trip: a paste-then-Enter document serializes with correct positional numbers and re-parses stably", () => {
    editor = new Editor({ extensions: makeTestExtensions(), content: orderedListDoc(["A"]) });
    editor.commands.setTextSelection(textEndPos(editor, "A"));
    editor.commands.insertContent('<li value="5">B</li>');
    editor.commands.setTextSelection(textEndPos(editor, "B"));
    editor.commands.splitListItem("listItem");
    editor.commands.insertContent("C");

    const md = serializeDocToMarkdown(editor.state.doc.toJSON() as JSONContent);
    expect(md.trim()).toBe("1. A\n2. B\n3. C");

    const reparsed = serializeDocToMarkdown(parseMarkdownToDoc(md));
    expect(reparsed).toBe(md);
  });

  // ── undo/redo ────────────────────────────────────────────────────────────

  it("undo/redo: undoing a paste removes the pasted item cleanly, redo restores it without resurrecting a stale value", () => {
    editor = new Editor({ extensions: makeTestExtensions(), content: orderedListDoc(["X", "Y", "Z"]) });
    editor.commands.setTextSelection(textEndPos(editor, "X"));
    editor.commands.insertContent('<li value="2">B</li>');
    expect(listItemValues(editor)).toEqual([null, null, null, null]);

    editor.commands.undo();
    expect(listItemValues(editor)).toEqual([null, null, null]);
    expect(serializeDocToMarkdown(editor.state.doc.toJSON() as JSONContent).trim()).toBe("1. X\n2. Y\n3. Z");

    editor.commands.redo();
    expect(listItemValues(editor)).toEqual([null, null, null, null]);
    expect(serializeDocToMarkdown(editor.state.doc.toJSON() as JSONContent)).toContain("1. X\n2. B\n3. Y\n4. Z");
  });

  it("undo/redo: full undo returns to the pre-paste doc, full redo restores it with no stale values", () => {
    editor = new Editor({ extensions: makeTestExtensions(), content: orderedListDoc(["X"]) });
    // Compare via serialized markdown rather than raw doc JSON — the
    // TrailingNode extension (bundled in StarterKit) appends a cosmetic
    // trailing empty paragraph after the first transaction and re-adds it
    // outside the undo stack, which would make a raw-JSON comparison flaky
    // for reasons unrelated to this bug.
    const originalMd = serializeDocToMarkdown(editor.state.doc.toJSON() as JSONContent);

    editor.commands.setTextSelection(textEndPos(editor, "X"));
    editor.commands.insertContent('<li value="2">B</li>');
    editor.commands.setTextSelection(textEndPos(editor, "B"));
    editor.commands.splitListItem("listItem");
    editor.commands.insertContent("New");
    expect(listItemValues(editor)).toEqual([null, null, null]);
    expect(listItemValues(editor).some((v) => v !== null)).toBe(false);

    // Don't assume a specific number of history steps (prosemirror-history
    // groups transactions issued in quick succession) — just drive undo to
    // exhaustion and check the invariant that matters: no step along the way
    // resurrects a stale numeric value, and the doc fully reverts.
    let guard = 0;
    while (editor.can().undo() && guard++ < 20) {
      editor.commands.undo();
      expect(listItemValues(editor).every((v) => v === null)).toBe(true);
    }
    expect(serializeDocToMarkdown(editor.state.doc.toJSON() as JSONContent).trim()).toBe(originalMd.trim());

    guard = 0;
    while (editor.can().redo() && guard++ < 20) {
      editor.commands.redo();
      expect(listItemValues(editor).every((v) => v === null)).toBe(true);
    }
    expect(listItemValues(editor)).toEqual([null, null, null]);
    expect(serializeDocToMarkdown(editor.state.doc.toJSON() as JSONContent).trim()).toBe("1. X\n2. B\n3. New");
  });
});
