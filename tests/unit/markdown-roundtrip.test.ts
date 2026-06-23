import { describe, expect, it } from "vitest";
import { parseMarkdownToDoc, serializeDocToMarkdown } from "@/markdown";
import corpusRaw from "../fixtures/corpus.md?raw";

/** Runs markdown -> doc -> markdown and returns the regenerated markdown. */
function roundtrip(markdown: string): string {
  const doc = parseMarkdownToDoc(markdown);
  return serializeDocToMarkdown(doc);
}

/** Asserts that re-serializing already-canonical markdown reproduces it
 *  exactly, and that a second pass through the pipeline is a no-op
 *  (idempotency is the real bar for "stable formatting", since import of
 *  hand-written markdown is allowed to normalize once). */
function expectStableRoundtrip(markdown: string) {
  const once = roundtrip(markdown);
  expect(once).toBe(markdown);
  const twice = roundtrip(once);
  expect(twice).toBe(once);
}

describe("markdown roundtrip: headings", () => {
  it.each([1, 2, 3, 4, 5, 6])("preserves heading level %i", (level) => {
    const hashes = "#".repeat(level);
    expectStableRoundtrip(`${hashes} Section Title\n`);
  });
});

describe("markdown roundtrip: text marks", () => {
  it("preserves bold", () => {
    expectStableRoundtrip("**Bold Text**\n");
  });

  it("preserves italic", () => {
    expectStableRoundtrip("*Italic Text*\n");
  });

  it("preserves strikethrough", () => {
    expectStableRoundtrip("~~Strikethrough~~\n");
  });

  it("preserves inline code", () => {
    expectStableRoundtrip("`inline code`\n");
  });

  it("preserves underline via raw HTML", () => {
    const md = "<u>Underlined</u>\n";
    expectStableRoundtrip(md);
  });

  it("preserves combined bold+italic", () => {
    expectStableRoundtrip("***Bold Italic***\n");
  });

  it("preserves links", () => {
    expectStableRoundtrip("[Anthropic](https://anthropic.com)\n");
  });

  it("does not lose text when marks combine in any order", () => {
    const doc = parseMarkdownToDoc("**_~~Combined~~_**\n");
    const md = serializeDocToMarkdown(doc);
    expect(md).toContain("Combined");
    // Re-parsing must recover all three marks regardless of nesting order.
    const reparsed = parseMarkdownToDoc(md);
    const textNode = findFirstText(reparsed);
    const markTypes = (textNode?.marks ?? []).map((m) => m.type).sort();
    expect(markTypes).toEqual(["bold", "italic", "strike"]);
  });
});

describe("markdown roundtrip: lists", () => {
  it("preserves bullet lists", () => {
    expectStableRoundtrip("- First item\n- Second item\n");
  });

  it("preserves ordered lists", () => {
    expectStableRoundtrip("1. First\n2. Second\n3. Third\n");
  });

  it("preserves task lists with mixed checked state", () => {
    expectStableRoundtrip("- [ ] Todo item\n- [x] Done item\n");
  });

  it("preserves nested bullet lists", () => {
    expectStableRoundtrip("- Parent\n  - Child\n");
  });
});

describe("markdown roundtrip: blocks", () => {
  it("preserves blockquotes", () => {
    expectStableRoundtrip("> A quoted line.\n");
  });

  it("preserves fenced code blocks with language", () => {
    expectStableRoundtrip("```ts\nconst x = 1;\n```\n");
  });

  it("preserves fenced code blocks without language", () => {
    expectStableRoundtrip("```\nplain text\n```\n");
  });

  it("preserves horizontal rules", () => {
    expectStableRoundtrip("---\n");
  });

  it("preserves images", () => {
    expectStableRoundtrip("![Diagram](assets/diagram.png)\n");
  });

  it("preserves tables", () => {
    expectStableRoundtrip("| ID | Status |\n| - | - |\n| 1 | Draft |\n");
  });
});

describe("markdown roundtrip: callouts", () => {
  for (const type of ["INFO", "WARNING", "SUCCESS", "DANGER"]) {
    it(`preserves a ${type} callout`, () => {
      // The leading `[` is backslash-escaped on export so it can never be
      // misread as the start of a link/reference on re-import; this is
      // standard CommonMark-safe-serialization behavior.
      const md = `> \\[!${type}]\n>\n> Body text for the callout.\n`;
      expectStableRoundtrip(md);

      const doc = parseMarkdownToDoc(md);
      const callout = doc.content?.find((n) => n.type === "callout");
      expect(callout?.attrs?.type).toBe(type.toLowerCase());
    });
  }
});

describe("markdown roundtrip: headings treated as plain headings (no special ID parsing)", () => {
  it("treats REQ_001-style heading text as a normal heading", () => {
    const md = "### REQ_001 [Draft]\n\nSystem shall authenticate users.\n";
    expectStableRoundtrip(md);
    const doc = parseMarkdownToDoc(md);
    expect(doc.content?.[0].type).toBe("heading");
  });

  it("does not produce requirementBlock nodes", () => {
    const md = "### REQ_001 [Draft]\n\nBody.\n";
    const doc = parseMarkdownToDoc(md);
    const hasReqBlock = (doc.content ?? []).some((n) => n.type === "requirementBlock");
    expect(hasReqBlock).toBe(false);
  });
});

describe("markdown roundtrip: full composite document", () => {
  it("round-trips a realistic document without data loss", () => {
    const md = [
      "# Document Title",
      "",
      "## Introduction",
      "",
      "This document describes the **system** features.",
      "",
      "## Details",
      "",
      "A paragraph with *italic* and `code`.",
      "",
      "## Traceability",
      "",
      "| From | To |",
      "| - | - |",
      "| A | B |",
      "",
    ].join("\n");

    expectStableRoundtrip(md);
  });
});

describe("markdown roundtrip: highlight / superscript / subscript (M4.3)", () => {
  // ── Highlight ==...== ──────────────────────────────────────────────────
  it("preserves ==highlight==", () => {
    expectStableRoundtrip("This is ==highlighted== text.\n");
  });

  it("parses ==highlight== into a text node with highlight mark", () => {
    const doc = parseMarkdownToDoc("==hello==\n");
    const para = doc.content?.find((n) => n.type === "paragraph");
    const node = para?.content?.find(
      (n) => n.type === "text" && n.marks?.some((m) => m.type === "highlight")
    );
    expect(node).toBeDefined();
    expect(node?.text).toBe("hello");
  });

  it("preserves ==highlight== combined with bold", () => {
    expectStableRoundtrip("**==bold highlight==**\n");
  });

  // ── Superscript ^...^ ──────────────────────────────────────────────────
  it("preserves ^superscript^", () => {
    expectStableRoundtrip("E = mc^2^ is Einstein.\n");
  });

  it("parses ^super^ into a text node with superscript mark", () => {
    const doc = parseMarkdownToDoc("x^n^\n");
    const para = doc.content?.find((n) => n.type === "paragraph");
    const node = para?.content?.find(
      (n) => n.type === "text" && n.marks?.some((m) => m.type === "superscript")
    );
    expect(node).toBeDefined();
    expect(node?.text).toBe("n");
  });

  it("preserves superscript in a realistic formula", () => {
    expectStableRoundtrip("The area is r^2^π.\n");
  });

  // ── Subscript ~...~ ────────────────────────────────────────────────────
  it("preserves ~subscript~", () => {
    expectStableRoundtrip("Water is H~2~O.\n");
  });

  it("parses ~sub~ into a text node with subscript mark", () => {
    const doc = parseMarkdownToDoc("CO~2~ is a gas.\n");
    const para = doc.content?.find((n) => n.type === "paragraph");
    const node = para?.content?.find(
      (n) => n.type === "text" && n.marks?.some((m) => m.type === "subscript")
    );
    expect(node).toBeDefined();
    expect(node?.text).toBe("2");
  });

  it("does not treat ~~strikethrough~~ as subscript", () => {
    const doc = parseMarkdownToDoc("~~removed~~\n");
    const para = doc.content?.find((n) => n.type === "paragraph");
    const subNode = para?.content?.find(
      (n) => n.type === "text" && n.marks?.some((m) => m.type === "subscript")
    );
    expect(subNode).toBeUndefined();
    // Must parse as strikethrough (strike mark)
    const strikeNode = para?.content?.find(
      (n) => n.type === "text" && n.marks?.some((m) => m.type === "strike")
    );
    expect(strikeNode).toBeDefined();
  });

  // ── Mixed ──────────────────────────────────────────────────────────────
  it("round-trips a paragraph with all three marks", () => {
    expectStableRoundtrip(
      "Use ==highlight==, x^2^, and H~2~O in the same paragraph.\n"
    );
  });

  it("does not transform content inside code spans", () => {
    const doc = parseMarkdownToDoc("`==not highlighted==`\n");
    const para = doc.content?.find((n) => n.type === "paragraph");
    const highlightNode = para?.content?.find(
      (n) => n.type === "text" && n.marks?.some((m) => m.type === "highlight")
    );
    expect(highlightNode).toBeUndefined();
    // Content should be inside a code mark
    const codeNode = para?.content?.find(
      (n) => n.type === "text" && n.marks?.some((m) => m.type === "code")
    );
    expect(codeNode).toBeDefined();
  });
});

describe("markdown roundtrip: math (M4.2)", () => {
  // ── Block math ──────────────────────────────────────────────────────────
  it("preserves a simple block math expression", () => {
    expectStableRoundtrip("$$\nx = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}\n$$\n");
  });

  it("preserves multi-line block math", () => {
    expectStableRoundtrip("$$\n\\begin{align}\na &= b \\\\\nc &= d\n\\end{align}\n$$\n");
  });

  it("parses block math into a codeBlock node with language '$$'", () => {
    const doc = parseMarkdownToDoc("$$\nE = mc^2\n$$\n");
    const block = doc.content?.find((n) => n.type === "codeBlock");
    expect(block).toBeDefined();
    expect(block?.attrs?.language).toBe("$$");
    expect(block?.content?.[0].text).toBe("E = mc^2");
  });

  it("round-trips block math in a document with other content", () => {
    const md = "# Math Section\n\nSome text.\n\n$$\nF = ma\n$$\n\nMore text.\n";
    expectStableRoundtrip(md);
  });

  // ── Inline math ─────────────────────────────────────────────────────────
  it("preserves simple inline math", () => {
    expectStableRoundtrip("The formula $F = ma$ is Newton's second law.\n");
  });

  it("preserves inline math with LaTeX commands", () => {
    expectStableRoundtrip("The value $\\frac{1}{2}$ is one half.\n");
  });

  it("parses inline math into a text node with inlineMath mark", () => {
    const doc = parseMarkdownToDoc("Use $E = mc^2$ in the equation.\n");
    const para = doc.content?.find((n) => n.type === "paragraph");
    const mathNode = para?.content?.find(
      (n) => n.type === "text" && n.marks?.some((m) => m.type === "inlineMath")
    );
    expect(mathNode).toBeDefined();
    expect(mathNode?.text).toBe("E = mc^2");
  });

  it("does not treat a single dollar sign as math", () => {
    // mathToMarkdown escapes lone $ as \$ on first pass for safety; the rendered
    // output is identical and the second pass is stable (one-time normalization).
    const doc = parseMarkdownToDoc("The price is $100.\n");
    const para = doc.content?.find((n) => n.type === "paragraph");
    // Must parse as plain text, not as an inlineMath mark
    const mathNode = para?.content?.find(
      (n) => n.type === "text" && n.marks?.some((m) => m.type === "inlineMath")
    );
    expect(mathNode).toBeUndefined();
    // Serialized form is stable after one normalization pass
    const once = roundtrip("The price is $100.\n");
    const twice = roundtrip(once);
    expect(twice).toBe(once);
  });

  it("preserves inline math adjacent to other marks", () => {
    expectStableRoundtrip("See **equation** $x^2$.\n");
  });

  it("round-trips a paragraph with multiple inline math expressions", () => {
    expectStableRoundtrip("Both $a$ and $b$ are constants.\n");
  });

  // ── Combined ─────────────────────────────────────────────────────────────
  it("round-trips a document with both inline and block math", () => {
    const md = [
      "# Quadratic Formula",
      "",
      "For $ax^2 + bx + c = 0$, the roots are:",
      "",
      "$$",
      "x = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}",
      "$$",
      "",
      "where $a \\neq 0$.",
      "",
    ].join("\n");
    expectStableRoundtrip(md);
  });
});

// ── Block-level HTML preservation (rawHtmlBlock) ──────────────────────────────
//
// These tests guard the block HTML path: remark "html" block nodes must survive
// the full parse → editor → serialize pipeline without being escaped, dropped,
// or converted to paragraph/text nodes.
//
// The companion inline fix (<br> in table cells) is also covered here so that
// a single test file covers all HTML fidelity regression scenarios.

describe("markdown roundtrip: block HTML preservation", () => {
  // ── Node type checks ────────────────────────────────────────────────────────

  it("parses a block HTML comment into a rawHtmlBlock node (not a paragraph)", () => {
    const doc = parseMarkdownToDoc("<!-- review note -->\n");
    expect(doc.content?.[0].type).toBe("rawHtmlBlock");
    expect(doc.content?.[0].attrs?.html).toBe("<!-- review note -->");
  });

  it("parses a <details> block into a rawHtmlBlock node", () => {
    const doc = parseMarkdownToDoc(
      "<details>\n<summary>More</summary>\nContent\n</details>\n"
    );
    expect(doc.content?.[0].type).toBe("rawHtmlBlock");
    expect(doc.content?.[0].attrs?.html).toContain("<details>");
  });

  it("parses a standalone <img> block into a rawHtmlBlock node", () => {
    const doc = parseMarkdownToDoc('<img src="x.png" alt="y">\n');
    expect(doc.content?.[0].type).toBe("rawHtmlBlock");
  });

  // ── Exact round-trip ────────────────────────────────────────────────────────

  it("preserves HTML comments verbatim", () => {
    expectStableRoundtrip("<!-- review note -->\n");
  });

  it("preserves multi-word HTML comments verbatim", () => {
    expectStableRoundtrip("<!-- TODO: verify this requirement against SRS-4.2 -->\n");
  });

  it("preserves a compact <details> block verbatim", () => {
    expectStableRoundtrip(
      "<details>\n<summary>More info</summary>\nContent here.\n</details>\n"
    );
  });

  it("preserves a <div> with a class attribute verbatim", () => {
    expectStableRoundtrip('<div class="warning">\nWarning content.\n</div>\n');
  });

  it("preserves a standalone block-level <img> tag verbatim", () => {
    expectStableRoundtrip('<img src="assets/diagram.png" alt="Diagram">\n');
  });

  it("preserves a <figure> block verbatim", () => {
    expectStableRoundtrip(
      "<figure>\n<img src=\"x.png\">\n<figcaption>Caption</figcaption>\n</figure>\n"
    );
  });

  // ── No escaping ─────────────────────────────────────────────────────────────

  it("does not escape angle brackets in block HTML", () => {
    const md = "<div class=\"warning\">\nContent.\n</div>\n";
    const out = roundtrip(md);
    expect(out).not.toContain("\\<");
    expect(out).not.toContain("\\>");
  });

  it("does not escape angle brackets in HTML comments", () => {
    const out = roundtrip("<!-- <internal> -->\n");
    expect(out).not.toContain("\\<");
    expect(out).toBe("<!-- <internal> -->\n");
  });

  // ── Mixed markdown + HTML ───────────────────────────────────────────────────

  it("preserves block HTML adjacent to headings and paragraphs", () => {
    const md = [
      "## Section",
      "",
      "<!-- annotated section -->",
      "",
      "Some text.",
      "",
    ].join("\n");
    expectStableRoundtrip(md);
  });

  it("preserves multiple HTML blocks in the same document", () => {
    const md = [
      "# Title",
      "",
      "<!-- start review -->",
      "",
      "Content paragraph.",
      "",
      "<!-- end review -->",
      "",
    ].join("\n");
    expectStableRoundtrip(md);
  });

  it("preserves a document mixing headings, lists, and block HTML", () => {
    const md = [
      "## Requirements",
      "",
      "<div class=\"note\">",
      "All requirements are normative.",
      "</div>",
      "",
      "- REQ_001: The system shall do X.",
      "- REQ_002: The system shall do Y.",
      "",
    ].join("\n");
    expectStableRoundtrip(md);
  });
});

// ── Table cell inline HTML fidelity (<br>) ────────────────────────────────────
//
// Separate describe block so failures are reported against the correct feature.

describe("markdown roundtrip: table cell inline HTML fidelity", () => {
  it("preserves <br> in a table cell verbatim", () => {
    expectStableRoundtrip("| col |\n| - |\n| line1<br>line2 |\n");
  });

  it("preserves multiple <br> tags in the same table cell", () => {
    expectStableRoundtrip("| col |\n| - |\n| line1<br>line2<br>line3 |\n");
  });

  it("preserves <br> in a multi-column table", () => {
    expectStableRoundtrip(
      "| A | B |\n| - | - |\n| row1a<br>row1b | plain |\n"
    );
  });

  it("does not escape <br> in a table cell", () => {
    const out = roundtrip("| col |\n| - |\n| a<br>b |\n");
    expect(out).not.toContain("\\<");
    expect(out).toContain("<br>");
  });
});

// ── Underline HTML fidelity ───────────────────────────────────────────────────

describe("markdown roundtrip: underline HTML fidelity", () => {
  it("preserves <u>text</u> verbatim", () => {
    expectStableRoundtrip("<u>Underlined</u>\n");
  });

  it("preserves <u> combined with bold", () => {
    expectStableRoundtrip("**<u>Bold underline</u>**\n");
  });

  it("preserves <u> inside a paragraph with surrounding text", () => {
    expectStableRoundtrip("Some <u>underlined</u> text here.\n");
  });
});

// ── Corpus round-trip ─────────────────────────────────────────────────────────
//
// Runs the full parse → serialize pipeline against a realistic technical
// document that exercises every major inline HTML path:
//
//   • rawHtmlInline atoms in paragraphs, headings, list items, blockquotes
//   • atoms inside mark wrappers (bold, italic, bold+italic)
//   • atoms inside link display text — the accessibility invariant test
//   • atoms in table cells
//   • code inside link and bold
//   • block HTML (rawHtmlBlock), inline math, block math
//   • custom marks (==highlight==, ^sup^, ~sub~) combined with marks
//
// The corpus must produce an EXACT round-trip on the first pass. If this test
// fails, the serializer has a regression — do not relax it to idempotency-only.

describe("markdown roundtrip: corpus document", () => {
  // corpusRaw is loaded via Vite's ?raw import — no fs module needed.
  // The trailing newline that editors add is preserved by the ?raw transform.
  const corpus = corpusRaw;

  it("round-trips the corpus exactly on first pass", () => {
    const out = serializeDocToMarkdown(parseMarkdownToDoc(corpus));
    expect(out).toBe(corpus);
  });

  it("corpus is idempotent on second pass", () => {
    const once = serializeDocToMarkdown(parseMarkdownToDoc(corpus));
    const twice = serializeDocToMarkdown(parseMarkdownToDoc(once));
    expect(twice).toBe(once);
  });
});

// Minimal local PM JSON node walker for assertions above.
interface PMNodeLike {
  type?: string;
  text?: string;
  marks?: Array<{ type: string }>;
  content?: PMNodeLike[];
}

function findFirstText(node: PMNodeLike): PMNodeLike | null {
  if (node.type === "text") return node;
  for (const child of node.content ?? []) {
    const found = findFirstText(child);
    if (found) return found;
  }
  return null;
}
