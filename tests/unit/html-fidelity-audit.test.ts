/**
 * HTML Fidelity Audit — Regression Test Suite
 *
 * Tests every HTML construct that passes through the
 *   Markdown → parseMarkdownToDoc → serializeDocToMarkdown → Markdown
 * pipeline.
 *
 * Pass  = exact round-trip: output === input.
 * Fail  = corruption: output ≠ input (commonly angle-bracket escaping).
 *
 * All groups PASS. History: this file was written as desired-behaviour
 * assertions before the fixes existed (Groups C, D, E were red). The fixes
 * are now merged; all 52 tests are green.
 *
 * If a regression is found, add a new test immediately — do not delete
 * existing tests, and do not use skip().
 */

import { describe, it, expect } from "vitest";
import { parseMarkdownToDoc, serializeDocToMarkdown } from "@/markdown";

function roundtrip(md: string): string {
  return serializeDocToMarkdown(parseMarkdownToDoc(md));
}

/** Assert byte-for-byte round-trip AND idempotency. */
function expectExact(md: string) {
  const once = roundtrip(md);
  expect(once, `first pass`).toBe(md);
  expect(roundtrip(once), `second pass (idempotency)`).toBe(once);
}

/** Assert that the output does not introduce \< or \> escaping. */
function expectNoEscape(md: string) {
  const out = roundtrip(md);
  expect(out, "must not escape <").not.toContain("\\<");
  expect(out, "must not escape >").not.toContain("\\>");
}

// ────────────────────────────────────────────────────────────────────────────
// GROUP A: Block-level HTML — rawHtmlBlock (introduced in last session)
// Expected: ALL PASS
// ────────────────────────────────────────────────────────────────────────────

describe("html-audit: block HTML (rawHtmlBlock — should PASS)", () => {
  it("HTML comment block", () => {
    expectExact("<!-- review note -->\n");
  });

  it("HTML comment with angle brackets inside value", () => {
    expectExact("<!-- <internal marker> -->\n");
  });

  it("<details> block (compact — single html node)", () => {
    expectExact("<details>\n<summary>More</summary>\nContent\n</details>\n");
  });

  it("<div> with class attribute", () => {
    expectExact('<div class="warning">\nText\n</div>\n');
  });

  it("standalone <img> block", () => {
    expectExact('<img src="images/foo.png" alt="Diagram">\n');
  });

  it("<figure> block", () => {
    expectExact(
      '<figure>\n<img src="x.png">\n<figcaption>Caption</figcaption>\n</figure>\n'
    );
  });

  it("block HTML comment adjacent to headings", () => {
    expectExact("## Section A\n\n<!-- note -->\n\n## Section B\n");
  });

  it("block HTML comment adjacent to paragraph and heading", () => {
    expectExact("## Title\n\nParagraph text.\n\n<!-- comment -->\n\nMore text.\n");
  });

  it("block HTML + bullet list", () => {
    expectExact('<div class="note">\nNote text.\n</div>\n\n- Item one\n- Item two\n');
  });

  it("multiple block HTML nodes in same document", () => {
    expectExact("<!-- start -->\n\nParagraph.\n\n<!-- end -->\n");
  });
});

// ────────────────────────────────────────────────────────────────────────────
// GROUP B: Table cell <br> — fixed in prior session
// Expected: ALL PASS
// ────────────────────────────────────────────────────────────────────────────

describe("html-audit: <br> in table cells (fixed — should PASS)", () => {
  it("<br> single line break in cell", () => {
    expectExact("| col |\n| - |\n| line1<br>line2 |\n");
  });

  it("multiple <br> in one cell", () => {
    expectExact("| col |\n| - |\n| a<br>b<br>c |\n");
  });

  it("<br> in multi-column table", () => {
    expectExact("| A | B |\n| - | - |\n| r1a<br>r1b | plain |\n");
  });

  it("<br> alongside bold in same cell", () => {
    expectExact("| Notes |\n| - |\n| **Warning**<br>See spec |\n");
  });

  it("no \\< escaping of <br> in table cell", () => {
    expectNoEscape("| col |\n| - |\n| a<br>b |\n");
  });
});

// ────────────────────────────────────────────────────────────────────────────
// GROUP C: Inline HTML in paragraphs — rawHtmlInline atom node
// All PASS. Fix: inline html MDAST nodes → rawHtmlInline atom → serialized
// back verbatim via mdast html node (no angle-bracket escaping).
// ────────────────────────────────────────────────────────────────────────────

describe("html-audit: inline HTML tags in paragraphs", () => {
  it("<sub> tag: H<sub>2</sub>O", () => {
    expectExact("H<sub>2</sub>O\n");
  });

  it("<sup> tag: E=mc<sup>2</sup>", () => {
    expectExact("E=mc<sup>2</sup>\n");
  });

  it("<kbd> tag: Press <kbd>Ctrl</kbd>+C", () => {
    expectExact("Press <kbd>Ctrl</kbd>+C\n");
  });

  it("<span> tag with class: <span class=\"x\">text</span>", () => {
    expectExact('<span class="x">text</span>\n');
  });

  it("<span> tag without attrs: <span>text</span>", () => {
    expectExact("<span>text</span>\n");
  });

  it("nested <span>: <span class=\"a\"><span class=\"b\">text</span></span>", () => {
    expectExact('<span class="a"><span class="b">nested</span></span>\n');
  });

  it("inline HTML comment: text <!-- comment --> more", () => {
    expectExact("text <!-- comment --> more\n");
  });

  it("<abbr> tag: <abbr title=\"HyperText\">HTML</abbr>", () => {
    expectExact('<abbr title="HyperText">HTML</abbr>\n');
  });

  it("<mark> tag: <mark>highlighted</mark>", () => {
    expectExact("<mark>highlighted</mark>\n");
  });

  it("<s> tag: <s>struck</s>", () => {
    expectExact("<s>struck</s>\n");
  });

  it("<cite> tag: <cite>Author, 2024</cite>", () => {
    expectExact("<cite>Author, 2024</cite>\n");
  });
});

// ────────────────────────────────────────────────────────────────────────────
// GROUP D: Inline HTML mixed with markdown marks
// All PASS. Fix: rawHtmlInline atoms inherit the parser's `inherited` mark
// context; the mark-group serializer (nodesWithMarks) groups atoms sharing
// a mark into a single MDAST wrapper, producing exact round-trips.
// ────────────────────────────────────────────────────────────────────────────

describe("html-audit: inline HTML mixed with markdown marks", () => {
  it("sub adjacent to plain text: Voltage<sub>max</sub> and Voltage<sub>min</sub>", () => {
    expectExact("Voltage<sub>max</sub> and Voltage<sub>min</sub>\n");
  });

  it("kbd inside bold: exact round-trip **<kbd>Ctrl</kbd>**", () => {
    // rawHtmlInline atoms now inherit marks from their parse context.
    // The serializer groups all nodes sharing the bold mark into one <strong>
    // child, so the atoms stay inside the mark wrapper rather than migrating.
    expectExact("**<kbd>Ctrl</kbd>**\n");
  });

  it("sub inside italic: exact round-trip *H<sub>2</sub>O*", () => {
    // The sub atoms inherit the italic mark; all five nodes (text, atom, text,
    // atom, text) are grouped under one <emphasis> wrapper.
    expectExact("*H<sub>2</sub>O*\n");
  });

  it("sup inside bold: exact round-trip **E=mc<sup>2</sup>**", () => {
    expectExact("**E=mc<sup>2</sup>**\n");
  });

  it("bold text followed by sub: **bold** and H<sub>2</sub>O", () => {
    expectExact("**bold** and H<sub>2</sub>O\n");
  });

  it("link followed by sub: [link](https://x.com) with H<sub>2</sub>O", () => {
    expectExact("[link](https://x.com) with H<sub>2</sub>O\n");
  });

  it("inline code followed by sub: `code` and H<sub>2</sub>O", () => {
    expectExact("`code` and H<sub>2</sub>O\n");
  });

  it("sub inside a blockquote", () => {
    expectExact("> The formula is H<sub>2</sub>O.\n");
  });

  it("sup inside a heading", () => {
    expectExact("## Area = r<sup>2</sup>π\n");
  });

  it("kbd inside a list item", () => {
    expectExact("- Press <kbd>Ctrl+C</kbd> to copy.\n");
  });
});

// ────────────────────────────────────────────────────────────────────────────
// GROUP E: Inline HTML in table cells (not <br>)
// All PASS. Same rawHtmlInline fix as Group C; inTable=true path uses
// html("<br>") node for hardBreak to avoid GFM cell line-break collapse.
// ────────────────────────────────────────────────────────────────────────────

describe("html-audit: inline HTML in table cells", () => {
  it("<sub> in table cell: H<sub>2</sub>O", () => {
    expectExact("| Formula |\n| - |\n| H<sub>2</sub>O |\n");
  });

  it("<sup> in table cell: E=mc<sup>2</sup>", () => {
    expectExact("| Formula |\n| - |\n| E=mc<sup>2</sup> |\n");
  });

  it("<kbd> in table cell", () => {
    expectExact("| Action | Keys |\n| - | - |\n| Copy | <kbd>Ctrl+C</kbd> |\n");
  });

  it("<span> in table cell", () => {
    expectExact('| Status |\n| - |\n| <span class="ok">OK</span> |\n');
  });

  it("no \\< escaping of <sub> in table cell", () => {
    expectNoEscape("| col |\n| - |\n| H<sub>2</sub>O |\n");
  });
});

// ────────────────────────────────────────────────────────────────────────────
// GROUP F: <br> in paragraph — syntax normalization (not corruption)
// Expected: FAIL on exact round-trip but NO angle-bracket escaping
// The output is semantically equivalent (hard break → same visual rendering)
// but the markdown syntax changes: <br> → backslash+newline
// These are documented as normalization, not bugs. Fix is optional.
// ────────────────────────────────────────────────────────────────────────────

describe("html-audit: <br> in paragraph (syntax normalization — output changes but no corruption)", () => {
  it("<br> is converted to hard break syntax (no \\< escaping)", () => {
    // Output changes: <br> → backslash+newline. Not corruption, but noted.
    expectNoEscape("before<br>after\n");
  });

  it("<br/> is converted to hard break syntax (no \\< escaping)", () => {
    expectNoEscape("A<br/>B\n");
  });

  it("<br /> is converted to hard break syntax (no \\< escaping)", () => {
    expectNoEscape("A<br />B\n");
  });

  it("<br> in paragraph produces hard break output", () => {
    // Document the actual normalized form
    const out = roundtrip("before<br>after\n");
    expect(out).toBe("before\\\nafter\n");
  });

  it("<br/> and <br /> normalize to same output as <br>", () => {
    const outBr   = roundtrip("A<br>B\n");
    const outBrS  = roundtrip("A<br/>B\n");
    const outBrSp = roundtrip("A<br />B\n");
    expect(outBrS).toBe(outBr);
    expect(outBrSp).toBe(outBr);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// GROUP G: Escape-safety assertions — cross-category
// These verify that the corruption is angle-bracket escaping specifically,
// not some other form of damage. Useful for verifying partial fixes.
// ────────────────────────────────────────────────────────────────────────────

describe("html-audit: escape-safety cross-checks", () => {
  it("inline <sub> does NOT escape angle brackets", () => {
    const out = roundtrip("H<sub>2</sub>O\n");
    expect(out).not.toContain("\\<");
    expect(out).toBe("H<sub>2</sub>O\n");
  });

  it("inline <kbd> does NOT escape angle brackets", () => {
    const out = roundtrip("Press <kbd>Ctrl</kbd>+C\n");
    expect(out).not.toContain("\\<");
    expect(out).toBe("Press <kbd>Ctrl</kbd>+C\n");
  });

  it("inline <span> does NOT escape angle brackets", () => {
    const out = roundtrip('<span class="x">text</span>\n');
    expect(out).not.toContain("\\<");
    expect(out).toBe('<span class="x">text</span>\n');
  });

  it("inline HTML comment does NOT escape angle brackets", () => {
    const out = roundtrip("text <!-- comment --> more\n");
    expect(out).not.toContain("\\<");
    expect(out).toBe("text <!-- comment --> more\n");
  });

  it("block HTML comment does NOT escape (rawHtmlBlock working)", () => {
    const out = roundtrip("<!-- review note -->\n");
    expect(out).not.toContain("\\<");
    expect(out).toBe("<!-- review note -->\n");
  });

  it("<br> in table cell does NOT escape (fixed)", () => {
    const out = roundtrip("| col |\n| - |\n| a<br>b |\n");
    expect(out).not.toContain("\\<");
    expect(out).toContain("<br>");
  });
});
