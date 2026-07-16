import { describe, it, expect, afterEach } from "vitest";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { TableKit } from "@tiptap/extension-table";
import { CustomKeymap } from "@/editor/extensions/CustomKeymap";
import { serializeDocToMarkdown, parseMarkdownToDoc } from "@/markdown";
import type { JSONContent } from "@tiptap/core";

// Minimal extension set that avoids Placeholder's elementFromPoint dependency
// while exercising the real CustomKeymap and TableKit behaviour.
function makeTestExtensions() {
  return [
    StarterKit.configure({ codeBlock: false }),
    TableKit.configure({ table: { resizable: false } }),
    CustomKeymap,
  ];
}

function makeTableDoc(cellText = "Line one"): JSONContent {
  return {
    type: "doc",
    content: [{
      type: "table",
      content: [
        {
          type: "tableRow",
          content: [
            {
              type: "tableHeader",
              attrs: { align: null },
              content: [{ type: "paragraph", content: [{ type: "text", text: "Header" }] }],
            },
          ],
        },
        {
          type: "tableRow",
          content: [
            {
              type: "tableCell",
              attrs: { align: null },
              content: [{ type: "paragraph", content: [{ type: "text", text: cellText }] }],
            },
          ],
        },
      ],
    }],
  };
}

/** Position of the end of the first body cell's text. */
function bodyCellTextEnd(editor: Editor): number {
  let pos = -1;
  editor.state.doc.descendants((node, nodePos) => {
    if (node.type.name === "tableCell") {
      pos = nodePos + node.nodeSize - 2;
      return false;
    }
  });
  return pos;
}

/** Number of paragraph nodes inside the first body tableCell. */
function bodyCellParaCount(editor: Editor): number {
  let count = 0;
  editor.state.doc.descendants((node) => {
    if (node.type.name === "tableCell") {
      node.forEach((child) => {
        if (child.type.name === "paragraph") count++;
      });
      return false;
    }
  });
  return count;
}

/** Collect node type names from inside the first body cell's paragraph. */
function bodyCellInlineTypes(editor: Editor): string[] {
  const types: string[] = [];
  editor.state.doc.descendants((node) => {
    if (node.type.name === "tableCell") {
      node.forEach((para) => {
        if (para.type.name === "paragraph") {
          para.forEach((inline) => types.push(inline.type.name));
        }
      });
      return false;
    }
  });
  return types;
}

function dispatchKey(editor: Editor, key: string, modifiers: { shift?: boolean; mod?: boolean } = {}) {
  // jsdom navigator.platform is non-Mac, so prosemirror-keymap maps ctrlKey → "Mod-".
  // Setting metaKey alongside ctrlKey would produce "Meta-Mod-Enter" (wrong).
  // Use ctrlKey only to produce "Mod-" prefix reliably in the test environment.
  const event = new KeyboardEvent("keydown", {
    key,
    code: key,
    shiftKey: !!modifiers.shift,
    ctrlKey: !!modifiers.mod,
    bubbles: true,
    cancelable: true,
  });
  editor.view.dom.dispatchEvent(event);
}

// ── Enter inside table cell ────────────────────────────────────────────────────

describe("table: Enter inside table cell", () => {
  let editor: Editor;
  afterEach(() => editor?.destroy());

  it("Enter is handled (does not fall through to default paragraph split)", () => {
    editor = new Editor({ extensions: makeTestExtensions(), content: makeTableDoc() });
    const pos = bodyCellTextEnd(editor);
    editor.commands.setTextSelection(pos);

    // Before: one paragraph
    expect(bodyCellParaCount(editor)).toBe(1);

    dispatchKey(editor, "Enter");

    // The keymap returns true, consuming the event.
    // The cell must still have exactly one paragraph.
    expect(bodyCellParaCount(editor)).toBe(1);
  });

  it("Enter does not alter the cell text content", () => {
    editor = new Editor({ extensions: makeTestExtensions(), content: makeTableDoc() });
    const pos = bodyCellTextEnd(editor);
    editor.commands.setTextSelection(pos);

    dispatchKey(editor, "Enter");

    const textAfter = editor.state.doc.textContent;
    expect(textAfter).toContain("Line one");
  });

  it("Enter does not delete any cell content", () => {
    editor = new Editor({ extensions: makeTestExtensions(), content: makeTableDoc() });
    const pos = bodyCellTextEnd(editor);
    editor.commands.setTextSelection(pos);

    // Capture cell content node size before — this is what must not shrink.
    let cellSizeBefore = 0;
    editor.state.doc.descendants((node) => {
      if (node.type.name === "tableCell") { cellSizeBefore = node.nodeSize; return false; }
    });

    dispatchKey(editor, "Enter");

    let cellSizeAfter = 0;
    editor.state.doc.descendants((node) => {
      if (node.type.name === "tableCell") { cellSizeAfter = node.nodeSize; return false; }
    });

    expect(cellSizeAfter).toBe(cellSizeBefore);
  });
});

// ── Shift+Enter inside table cell ─────────────────────────────────────────────

describe("table: Shift+Enter inside table cell", () => {
  let editor: Editor;
  afterEach(() => editor?.destroy());

  it("Shift+Enter inserts a hardBreak node", () => {
    editor = new Editor({ extensions: makeTestExtensions(), content: makeTableDoc() });
    const pos = bodyCellTextEnd(editor);
    editor.commands.setTextSelection(pos);

    dispatchKey(editor, "Enter", { shift: true });

    const inlineTypes = bodyCellInlineTypes(editor);
    expect(inlineTypes).toContain("hardBreak");
  });

  it("Shift+Enter keeps content inside a single paragraph", () => {
    editor = new Editor({ extensions: makeTestExtensions(), content: makeTableDoc() });
    const pos = bodyCellTextEnd(editor);
    editor.commands.setTextSelection(pos);

    dispatchKey(editor, "Enter", { shift: true });

    expect(bodyCellParaCount(editor)).toBe(1);
  });

  it("hardBreak serializes as <br> in GFM Markdown", () => {
    editor = new Editor({ extensions: makeTestExtensions(), content: makeTableDoc() });
    const pos = bodyCellTextEnd(editor);
    editor.commands.setTextSelection(pos);
    dispatchKey(editor, "Enter", { shift: true });
    editor.commands.insertContent({ type: "text", text: "Line two" });

    const md = serializeDocToMarkdown(editor.state.doc.toJSON() as JSONContent);
    expect(md).toContain("<br>");
    expect(md).toContain("Line one");
    expect(md).toContain("Line two");
  });

  it("save → parse preserves hardBreak and surrounding text", () => {
    editor = new Editor({ extensions: makeTestExtensions(), content: makeTableDoc() });
    const pos = bodyCellTextEnd(editor);
    editor.commands.setTextSelection(pos);
    dispatchKey(editor, "Enter", { shift: true });
    editor.commands.insertContent({ type: "text", text: "Line two" });

    const md = serializeDocToMarkdown(editor.state.doc.toJSON() as JSONContent);
    // Round-trip
    const reparsed = serializeDocToMarkdown(parseMarkdownToDoc(md));
    expect(reparsed).toBe(md);
    expect(reparsed).toContain("Line one<br>Line two");
  });
});

// ── Mod+Enter inside table cell ───────────────────────────────────────────────

describe("table: Mod+Enter inside table cell", () => {
  let editor: Editor;
  afterEach(() => editor?.destroy());

  function tableRowCount(e: Editor): number {
    let rows = 0;
    e.state.doc.descendants((n) => { if (n.type.name === "tableRow") rows++; });
    return rows;
  }

  function tableColCount(e: Editor): number {
    let cols = 0;
    e.state.doc.descendants((n) => {
      if (n.type.name === "tableRow") { cols = n.childCount; return false; }
    });
    return cols;
  }

  it("Mod+Enter adds a row after the current row", () => {
    editor = new Editor({ extensions: makeTestExtensions(), content: makeTableDoc() });
    const pos = bodyCellTextEnd(editor);
    editor.commands.setTextSelection(pos);

    const rowsBefore = tableRowCount(editor);
    dispatchKey(editor, "Enter", { mod: true });
    expect(tableRowCount(editor)).toBe(rowsBefore + 1);
  });

  it("existing row content is unchanged after Mod+Enter", () => {
    editor = new Editor({ extensions: makeTestExtensions(), content: makeTableDoc() });
    const pos = bodyCellTextEnd(editor);
    editor.commands.setTextSelection(pos);

    dispatchKey(editor, "Enter", { mod: true });

    expect(editor.state.doc.textContent).toContain("Line one");
  });

  it("table column count is unchanged after Mod+Enter", () => {
    editor = new Editor({ extensions: makeTestExtensions(), content: makeTableDoc() });
    const colsBefore = tableColCount(editor);
    const pos = bodyCellTextEnd(editor);
    editor.commands.setTextSelection(pos);

    dispatchKey(editor, "Enter", { mod: true });

    expect(tableColCount(editor)).toBe(colsBefore);
  });

  it("Mod+Enter produces valid GFM Markdown that parses back correctly", () => {
    editor = new Editor({ extensions: makeTestExtensions(), content: makeTableDoc() });
    const pos = bodyCellTextEnd(editor);
    editor.commands.setTextSelection(pos);
    dispatchKey(editor, "Enter", { mod: true });

    const md = serializeDocToMarkdown(editor.state.doc.toJSON() as JSONContent);
    const reparsed = serializeDocToMarkdown(parseMarkdownToDoc(md));
    expect(reparsed).toBe(md);
    expect(md).toContain("Line one");
  });
});
