/**
 * Table Markdown round-trip contract tests (Phase E).
 *
 * Core invariant: S(P(S(P(md)))) === S(P(md))
 *
 * i.e. the serializer's output is idempotent under repeated parse→serialize
 * cycles.  Tests here do NOT assert that the output matches a hand-written
 * fixture exactly — they assert that whatever the serializer produces, a
 * second cycle returns the identical string.  Content-level assertions (cell
 * count, alignment marker presence) are made against the canonical output.
 */

import { describe, it, expect, afterEach } from "vitest";
import { serializeDocToMarkdown, parseMarkdownToDoc } from "@/markdown";
import type { JSONContent } from "@tiptap/core";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { TableKit } from "@tiptap/extension-table";
import { TableColumnAlign } from "@/editor/extensions/TableColumnAlign";
import { CustomKeymap } from "@/editor/extensions/CustomKeymap";

// ── helpers ───────────────────────────────────────────────────────────────────

/** Serialize → parse → serialize (one round-trip). */
function roundTrip(md: string): string {
  return serializeDocToMarkdown(parseMarkdownToDoc(md));
}

/** Return the canonical output and assert it is stable on a second pass. */
function assertStable(input: string): string {
  const canonical = roundTrip(input);
  expect(roundTrip(canonical)).toBe(canonical);
  return canonical;
}

/** Parse the separator row cells from the serialized Markdown. */
function separatorCells(md: string): string[] {
  const sep = md.split("\n").find((l) => /^\|\s*:?-+:?\s*\|/.test(l));
  if (!sep) return [];
  return sep.split("|").map((c) => c.trim()).filter(Boolean);
}

/** Count pipe-delimited cells by reading the separator row.
 *  The separator row is unambiguous — all cells are dashes/colons, never empty.
 *  Using the header row with filter(Boolean) would miscount columns that have
 *  empty content (e.g. the new column added by addColumnAfter). */
function headerColCount(md: string): number {
  const sep = md.split("\n").find((l) => /^\|\s*:?-+:?\s*\|/.test(l));
  if (!sep) return 0;
  // "| - | - | - |".split("|") = ['', ' - ', ' - ', ' - ', '']
  // subtract the 2 boundary empty strings
  return sep.split("|").length - 2;
}

function makeEditorExtensions() {
  return [
    StarterKit.configure({ codeBlock: false }),
    TableKit.configure({ table: { resizable: false } }),
    TableColumnAlign,
    CustomKeymap,
  ];
}

// ── Basic GFM table ───────────────────────────────────────────────────────────

describe("basic GFM table", () => {
  it("round-trip is stable", () => {
    assertStable("| A | B |\n| --- | --- |\n| 1 | 2 |\n");
  });

  it("canonical output has 2 columns", () => {
    const canonical = roundTrip("| A | B |\n| --- | --- |\n| 1 | 2 |\n");
    expect(headerColCount(canonical)).toBe(2);
  });

  it("canonical output preserves cell text", () => {
    const canonical = roundTrip("| Foo | Bar |\n| --- | --- |\n| baz | qux |\n");
    expect(canonical).toContain("Foo");
    expect(canonical).toContain("Bar");
    expect(canonical).toContain("baz");
    expect(canonical).toContain("qux");
  });
});

// ── 3×4 default table (new /table default) ────────────────────────────────────

describe("3×4 table (new /table default)", () => {
  it("round-trip is stable", () => {
    assertStable("| A | B | C | D |\n| --- | --- | --- | --- |\n| 1 | 2 | 3 | 4 |\n| 5 | 6 | 7 | 8 |\n");
  });

  it("canonical output has 4 columns", () => {
    const canonical = roundTrip("| A | B | C | D |\n| --- | --- | --- | --- |\n| 1 | 2 | 3 | 4 |\n| 5 | 6 | 7 | 8 |\n");
    expect(headerColCount(canonical)).toBe(4);
  });
});

// ── Structural operations via headless editor ─────────────────────────────────

describe("row / column structural operations", () => {
  let editor: Editor;
  afterEach(() => editor?.destroy());

  function makeDoc(rows: number, cols: number): JSONContent {
    const makeCell = (text: string, type = "tableCell"): JSONContent => ({
      type,
      attrs: { align: null },
      content: [{ type: "paragraph", content: [{ type: "text", text }] }],
    });

    const header: JSONContent = {
      type: "tableRow",
      content: Array.from({ length: cols }, (_, c) => makeCell(`H${c + 1}`, "tableHeader")),
    };
    const bodyRows: JSONContent[] = Array.from({ length: rows }, (_, r) => ({
      type: "tableRow",
      content: Array.from({ length: cols }, (_, c) => makeCell(`R${r + 1}C${c + 1}`)),
    }));

    return { type: "doc", content: [{ type: "table", content: [header, ...bodyRows] }] };
  }

  function firstBodyCellPos(e: Editor): number {
    let pos = -1;
    e.state.doc.descendants((n, p) => {
      if (n.type.name === "tableCell" && pos === -1) {
        // End of the cell's inline content (same pattern as Phase A tests).
        // p + 1 (paragraph opening) is a block boundary — prosemirror-tables
        // addColumnAfter needs a cursor firmly inside inline content.
        pos = p + n.nodeSize - 2;
        return false;
      }
    });
    return pos;
  }

  it("add row after → round-trip stable and row count increases", () => {
    editor = new Editor({ extensions: makeEditorExtensions(), content: makeDoc(2, 3) });
    editor.commands.setTextSelection(firstBodyCellPos(editor));
    editor.commands.addRowAfter();

    const md = serializeDocToMarkdown(editor.state.doc.toJSON() as JSONContent);
    assertStable(md);
    // 1 header + separator + 3 body rows = 5 pipe rows
    const pipeRows = md.split("\n").filter((l) => l.trim().startsWith("|"));
    expect(pipeRows.length).toBe(5);
  });

  it("delete row → round-trip stable and row count decreases", () => {
    editor = new Editor({ extensions: makeEditorExtensions(), content: makeDoc(3, 2) });
    editor.commands.setTextSelection(firstBodyCellPos(editor));
    editor.commands.deleteRow();

    const md = serializeDocToMarkdown(editor.state.doc.toJSON() as JSONContent);
    assertStable(md);
    const pipeRows = md.split("\n").filter((l) => l.trim().startsWith("|"));
    expect(pipeRows.length).toBe(4); // header + separator + 2 body rows
  });

  it("add column after → round-trip stable and column count increases", () => {
    editor = new Editor({ extensions: makeEditorExtensions(), content: makeDoc(2, 3) });
    editor.commands.setTextSelection(firstBodyCellPos(editor));
    editor.commands.addColumnAfter();

    const md = serializeDocToMarkdown(editor.state.doc.toJSON() as JSONContent);
    assertStable(md);
    expect(headerColCount(md)).toBe(4);
  });

  it("delete column → round-trip stable and column count decreases", () => {
    editor = new Editor({ extensions: makeEditorExtensions(), content: makeDoc(2, 4) });
    editor.commands.setTextSelection(firstBodyCellPos(editor));
    editor.commands.deleteColumn();

    const md = serializeDocToMarkdown(editor.state.doc.toJSON() as JSONContent);
    assertStable(md);
    expect(headerColCount(md)).toBe(3);
  });

  it("delete table → document has no table rows", () => {
    editor = new Editor({ extensions: makeEditorExtensions(), content: makeDoc(2, 3) });
    editor.commands.setTextSelection(firstBodyCellPos(editor));
    editor.commands.deleteTable();

    const md = serializeDocToMarkdown(editor.state.doc.toJSON() as JSONContent);
    expect(md).not.toContain("|");
  });
});

// ── Column alignment (GFM separator-row encoding) ─────────────────────────────

describe("column alignment round-trips", () => {
  it("left-aligned column → stable and separator has leading colon", () => {
    const canonical = assertStable("| A | B |\n| :--- | --- |\n| 1 | 2 |\n");
    const cells = separatorCells(canonical);
    expect(cells[0]).toMatch(/^:-/); // starts with ':'
    expect(cells[0]).not.toMatch(/:$/); // does not end with ':'
  });

  it("center-aligned column → stable and separator has colons on both sides", () => {
    const canonical = assertStable("| A | B |\n| :---: | --- |\n| 1 | 2 |\n");
    const cells = separatorCells(canonical);
    expect(cells[0]).toMatch(/^:-/);
    expect(cells[0]).toMatch(/:$/);
  });

  it("right-aligned column → stable and separator has trailing colon", () => {
    const canonical = assertStable("| A | B |\n| --- | ---: |\n| 1 | 2 |\n");
    const cells = separatorCells(canonical);
    expect(cells[0]).not.toMatch(/^:/);  // plain first column
    expect(cells[1]).toMatch(/:$/);      // right-aligned second column
  });

  it("mixed alignment across all three types → stable", () => {
    assertStable("| A | B | C |\n| :--- | :---: | ---: |\n| 1 | 2 | 3 |\n");
  });

  it("setColumnAlign applies alignment to every cell in the column", () => {
    editor = new Editor({
      extensions: makeEditorExtensions(),
      content: {
        type: "doc",
        content: [{
          type: "table",
          content: [
            {
              type: "tableRow",
              content: [
                { type: "tableHeader", attrs: { align: null }, content: [{ type: "paragraph", content: [{ type: "text", text: "H1" }] }] },
                { type: "tableHeader", attrs: { align: null }, content: [{ type: "paragraph", content: [{ type: "text", text: "H2" }] }] },
              ],
            },
            {
              type: "tableRow",
              content: [
                { type: "tableCell", attrs: { align: null }, content: [{ type: "paragraph", content: [{ type: "text", text: "R1C1" }] }] },
                { type: "tableCell", attrs: { align: null }, content: [{ type: "paragraph", content: [{ type: "text", text: "R1C2" }] }] },
              ],
            },
          ],
        }],
      },
    });

    let headerPos = -1;
    editor.state.doc.descendants((n, pos) => {
      if (n.type.name === "tableHeader" && headerPos === -1) { headerPos = pos + 1; return false; }
    });
    editor.commands.setTextSelection(headerPos);
    editor.commands.setColumnAlign("right");

    // Both cells in column 0 must carry align="right"
    const aligns: (string | null)[] = [];
    editor.state.doc.descendants((n) => {
      if (n.type.name === "tableHeader" || n.type.name === "tableCell") {
        aligns.push(n.attrs.align ?? null);
      }
    });
    expect(aligns).toEqual(["right", null, "right", null]);

    const md = serializeDocToMarkdown(editor.state.doc.toJSON() as JSONContent);
    const cells = separatorCells(md);
    expect(cells[0]).toMatch(/:$/); // right-aligned: ends with ':'
    assertStable(md);

    editor.destroy();
    editor = undefined as unknown as Editor;
  });

  it("setColumnAlign(null) removes alignment marker from separator", () => {
    const withAlign = "| A | B |\n| :---: | ---: |\n| 1 | 2 |\n";
    const doc = parseMarkdownToDoc(withAlign);
    editor = new Editor({ extensions: makeEditorExtensions(), content: doc });

    let pos = -1;
    editor.state.doc.descendants((n, p) => {
      if (n.type.name === "tableHeader" && pos === -1) { pos = p + 1; return false; }
    });
    editor.commands.setTextSelection(pos);
    editor.commands.setColumnAlign(null);

    const md = serializeDocToMarkdown(editor.state.doc.toJSON() as JSONContent);
    const cells = separatorCells(md);
    // First column (was center) should now be plain — no colons
    expect(cells[0]).not.toMatch(/:/);
    assertStable(md);

    editor.destroy();
    editor = undefined as unknown as Editor;
  });

  let editor: Editor;
  afterEach(() => editor?.destroy());
});

// ── Inline content inside cells ───────────────────────────────────────────────

describe("inline marks inside table cells", () => {
  it("bold text in cell → stable", () => {
    const canonical = assertStable("| A |\n| --- |\n| **bold** |\n");
    expect(canonical).toContain("**bold**");
  });

  it("italic text in cell → stable", () => {
    const canonical = assertStable("| A |\n| --- |\n| *italic* |\n");
    expect(canonical).toContain("*italic*");
  });

  it("inline code in cell → stable", () => {
    const canonical = assertStable("| A |\n| --- |\n| `code` |\n");
    expect(canonical).toContain("`code`");
  });

  it("link in cell → stable", () => {
    const canonical = assertStable("| A |\n| --- |\n| [text](https://example.com) |\n");
    expect(canonical).toContain("[text](https://example.com)");
  });

  it("mixed marks in cell → stable", () => {
    const canonical = assertStable("| A |\n| --- |\n| **bold** and *italic* and `code` |\n");
    expect(canonical).toContain("**bold**");
    expect(canonical).toContain("*italic*");
    expect(canonical).toContain("`code`");
  });
});

// ── Inline math in table cells ───────────────────────────────────────────────

describe("inline math in table cells", () => {
  it("simple expression in body cell → stable", () => {
    const canonical = assertStable("| Header | Formula |\n| --- | --- |\n| Mass-energy | $E = mc^2$ |\n");
    expect(canonical).toContain("$E = mc^2$");
  });

  it("header cell with math → stable", () => {
    const canonical = assertStable("| $\\alpha$ | Value |\n| --- | --- |\n| 1 | 2 |\n");
    expect(canonical).toContain("$\\alpha$");
  });

  it("backslash commands survive round-trip", () => {
    const canonical = assertStable("| Command | Result |\n| --- | --- |\n| frac | $\\frac{1}{2}$ |\n");
    expect(canonical).toContain("$\\frac{1}{2}$");
  });

  it("parser places inlineMath mark on text node inside tableCell > paragraph", () => {
    const doc = parseMarkdownToDoc("| A | B |\n| --- | --- |\n| plain | $x^2$ |\n");
    const table = doc.content?.[0];
    const dataRow = table?.content?.[1];
    const cell = dataRow?.content?.[1];
    expect(cell?.type).toBe("tableCell");
    const mathNode = cell?.content?.[0]?.content?.find(
      (n: any) => n.type === "text" && n.marks?.some((m: any) => m.type === "inlineMath")
    );
    expect(mathNode).toBeDefined();
    expect((mathNode as any).text).toBe("x^2");
  });
});

// ── Wide inline math — overflow regression ────────────────────────────────────
//
// These expressions are wider than a narrow table cell (3–5 columns at 640px
// document width) and triggered the overflow audit.  The CSS fix is visual-only;
// this suite guards the data path: every expression must survive parse→serialize
// unchanged and be idempotent on a second pass.

describe("wide inline math in narrow table cells — overflow regression", () => {
  const WIDE: { name: string; src: string }[] = [
    { name: "nested fraction + sum",  src: "\\frac{\\sum_{i=0}^{n} x_i^2}{\\sqrt{n \\cdot \\sigma^2}}" },
    { name: "3×3 matrix",             src: "\\begin{pmatrix} a_{11} & a_{12} & a_{13} \\\\ a_{21} & a_{22} & a_{23} \\\\ a_{31} & a_{32} & a_{33} \\end{pmatrix}" },
    { name: "nested subscripts",      src: "x_{i_{j_{k_{l}}}}" },
    { name: "long integral",          src: "\\int_{-\\infty}^{+\\infty} e^{-\\frac{x^2}{2\\sigma^2}} \\, dx" },
    { name: "multi-term product",     src: "\\prod_{k=1}^{n} \\left(1 + \\frac{1}{k^2}\\right)^{2k}" },
  ];

  for (const { name, src } of WIDE) {
    it(`${name} → stable and preserved verbatim`, () => {
      const canonical = assertStable(`| Formula | Value | Unit |\n| --- | --- | --- |\n| $${src}$ | 1.23 | m/s |\n`);
      expect(canonical).toContain(src);
    });
  }

  it("wide math mixed with plain text → stable", () => {
    const src = "\\sum_{i=1}^{N} w_i \\cdot f(x_i)";
    const canonical = assertStable(`| Header |\n| --- |\n| Value is $${src}$ here |\n`);
    expect(canonical).toContain(src);
  });

  it("two wide expressions in the same cell → both preserved", () => {
    const a = "\\frac{a}{b}";
    const b = "\\sum_{i}^{n} x_i";
    const canonical = assertStable(`| A |\n| --- |\n| $${a}$ and $${b}$ |\n`);
    expect(canonical).toContain(a);
    expect(canonical).toContain(b);
  });

  it("wide expression in header cell → stable", () => {
    const src = "\\int_0^\\infty f(x) dx";
    const canonical = assertStable(`| $${src}$ | Value |\n| --- | --- |\n| x | y |\n`);
    expect(canonical).toContain(src);
  });
});

// ── Empty cells ───────────────────────────────────────────────────────────────

describe("empty cells", () => {
  it("empty body cell → stable", () => {
    // The canonical form may normalize whitespace inside the empty cell
    assertStable("| A | B |\n| --- | --- |\n| 1 |  |\n");
  });

  it("empty body cell preserves 2-column structure", () => {
    const canonical = roundTrip("| A | B |\n| --- | --- |\n| 1 |  |\n");
    expect(headerColCount(canonical)).toBe(2);
  });
});

// ── hardBreak / <br> inside cells ────────────────────────────────────────────

describe("hardBreak / <br> inside cells", () => {
  it("<br> in cell body → stable", () => {
    const canonical = assertStable("| A |\n| --- |\n| line one<br>line two |\n");
    expect(canonical).toContain("line one<br>line two");
  });

  it("<br> in header cell → stable", () => {
    const canonical = assertStable("| head one<br>head two |\n| --- |\n| value |\n");
    expect(canonical).toContain("head one<br>head two");
  });
});

// ── Enter behavior (regression) ───────────────────────────────────────────────

describe("Enter behavior regression (serializer perspective)", () => {
  it("single paragraph in cell serializes without separator", () => {
    const doc: JSONContent = {
      type: "doc",
      content: [{
        type: "table",
        content: [
          {
            type: "tableRow",
            content: [{ type: "tableHeader", attrs: { align: null }, content: [{ type: "paragraph", content: [{ type: "text", text: "H" }] }] }],
          },
          {
            type: "tableRow",
            content: [{ type: "tableCell", attrs: { align: null }, content: [{ type: "paragraph", content: [{ type: "text", text: "line one" }] }] }],
          },
        ],
      }],
    };
    const md = serializeDocToMarkdown(doc);
    expect(md).toContain("line one");
    assertStable(md);
  });
});

// ── Engineering table examples ────────────────────────────────────────────────

describe("engineering table examples", () => {
  it("signal table → stable and column count preserved", () => {
    // Use the canonical output form (serializer normalizes separators and escaping)
    const input = [
      "| Signal | Type | Direction | Description |",
      "| --- | --- | --- | --- |",
      "| clk | wire | input | System clock |",
      "| rst_n | wire | input | Active-low reset |",
      "| data | logic[7:0] | input | Data bus |",
      "| valid | logic | output | Data valid strobe |",
      "",
    ].join("\n");
    const canonical = assertStable(input);
    expect(headerColCount(canonical)).toBe(4);
    expect(canonical).toContain("clk");
    expect(canonical).toContain("rst");
    expect(canonical).toContain("logic");
  });

  it("parameter table with center-aligned values → stable and alignment preserved", () => {
    const input = [
      "| Parameter | Min | Typ | Max | Unit |",
      "| --- | :---: | :---: | :---: | --- |",
      "| V_DD | 1.7 | 1.8 | 1.9 | V |",
      "| t_su | 2 | — | — | ns |",
      "",
    ].join("\n");
    const canonical = assertStable(input);
    const cells = separatorCells(canonical);
    // Columns 1-3 should be center-aligned (colon on both sides)
    expect(cells[1]).toMatch(/^:-/);
    expect(cells[1]).toMatch(/:$/);
    expect(cells[2]).toMatch(/^:-/);
    expect(cells[2]).toMatch(/:$/);
  });
});
