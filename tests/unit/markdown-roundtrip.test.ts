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

  // ── BUG-10: fenced code block metadata (info string after the language) ──

  it("preserves a single metadata token after the language", () => {
    expectStableRoundtrip("```python linenums\nprint('hello')\n```\n");
  });

  it("preserves multiple metadata tokens after the language", () => {
    expectStableRoundtrip("```ts title=\"Example\" {2-4}\nconst x = 1;\n```\n");
  });

  it("preserves curly-brace line-highlight syntax", () => {
    expectStableRoundtrip("```js {1,3-5}\ncode\n```\n");
  });

  it("preserves single-quoted metadata tokens", () => {
    expectStableRoundtrip("```sh title='build script'\necho hi\n```\n");
  });

  it("preserves metadata with an underscore (not mangled by unescapeUnderscores)", () => {
    expectStableRoundtrip("```ts class_name=\"foo\"\ncode\n```\n");
  });

  it("stores language and metadata as separate PM attrs", () => {
    const doc = parseMarkdownToDoc("```ts title=\"Example\" {2-4}\nconst x = 1;\n```\n");
    const block = doc.content?.find((n) => n.type === "codeBlock");
    expect(block?.attrs?.language).toBe("ts");
    expect(block?.attrs?.metadata).toBe('title="Example" {2-4}');
  });

  it("stores null metadata when no meta is present", () => {
    const doc = parseMarkdownToDoc("```ts\ncode\n```\n");
    const block = doc.content?.find((n) => n.type === "codeBlock");
    expect(block?.attrs?.language).toBe("ts");
    expect(block?.attrs?.metadata).toBeNull();
  });

  it("does not change mermaid blocks (no metadata, language preserved)", () => {
    expectStableRoundtrip("```mermaid\ngraph TD\n  A --> B\n```\n");
  });

  it("does not change block math ($$) through the code-block path", () => {
    expectStableRoundtrip("$$\nE = mc^2\n$$\n");
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
  // ── Canonical forms (backward compatibility) ────────────────────────────────
  // The stable on-disk form uses \[ because mdast-util-to-markdown escapes `[`
  // in phrasing content to prevent misinterpretation as a link start.

  for (const type of ["INFO", "WARNING", "SUCCESS", "DANGER"]) {
    it(`preserves a ${type} callout (canonical form)`, () => {
      const md = `> \\[!${type}]\n>\n> Body text for the callout.\n`;
      expectStableRoundtrip(md);
      const doc = parseMarkdownToDoc(md);
      const callout = doc.content?.find((n) => n.type === "callout");
      expect(callout?.attrs?.type).toBe(type.toLowerCase());
      expect(callout?.attrs?.marker).toBe(type);
    });
  }

  // ── Alias markers — must round-trip using original spelling (BUG-08) ────────

  it("preserves NOTE alias (not normalized to INFO)", () => {
    const md = `> \\[!NOTE]\n>\n> Content\n`;
    expectStableRoundtrip(md);
    const doc = parseMarkdownToDoc(md);
    const callout = doc.content?.find((n) => n.type === "callout");
    expect(callout?.attrs?.type).toBe("info");    // canonical for rendering
    expect(callout?.attrs?.marker).toBe("NOTE");   // original preserved
  });

  it("preserves CAUTION alias (not normalized to WARNING)", () => {
    const md = `> \\[!CAUTION]\n>\n> Content\n`;
    expectStableRoundtrip(md);
    const doc = parseMarkdownToDoc(md);
    const callout = doc.content?.find((n) => n.type === "callout");
    expect(callout?.attrs?.type).toBe("warning");
    expect(callout?.attrs?.marker).toBe("CAUTION");
  });

  it("preserves TIP alias (not normalized to SUCCESS)", () => {
    const md = `> \\[!TIP]\n>\n> Content\n`;
    expectStableRoundtrip(md);
    const doc = parseMarkdownToDoc(md);
    const callout = doc.content?.find((n) => n.type === "callout");
    expect(callout?.attrs?.type).toBe("success");
    expect(callout?.attrs?.marker).toBe("TIP");
  });

  it("preserves ERROR alias (not normalized to DANGER)", () => {
    const md = `> \\[!ERROR]\n>\n> Content\n`;
    expectStableRoundtrip(md);
    const doc = parseMarkdownToDoc(md);
    const callout = doc.content?.find((n) => n.type === "callout");
    expect(callout?.attrs?.type).toBe("danger");
    expect(callout?.attrs?.marker).toBe("ERROR");
  });

  // ── Lowercase markers ─────────────────────────────────────────────────────

  it("preserves lowercase note marker", () => {
    const md = `> \\[!note]\n>\n> Content\n`;
    expectStableRoundtrip(md);
    const doc = parseMarkdownToDoc(md);
    const callout = doc.content?.find((n) => n.type === "callout");
    expect(callout?.attrs?.type).toBe("info");
    expect(callout?.attrs?.marker).toBe("note");
  });

  it("preserves lowercase caution marker", () => {
    const md = `> \\[!caution]\n>\n> Content\n`;
    expectStableRoundtrip(md);
    const doc = parseMarkdownToDoc(md);
    const callout = doc.content?.find((n) => n.type === "callout");
    expect(callout?.attrs?.type).toBe("warning");
    expect(callout?.attrs?.marker).toBe("caution");
  });

  it("preserves lowercase info marker", () => {
    const md = `> \\[!info]\n>\n> Content\n`;
    expectStableRoundtrip(md);
    const doc = parseMarkdownToDoc(md);
    const callout = doc.content?.find((n) => n.type === "callout");
    expect(callout?.attrs?.type).toBe("info");
    expect(callout?.attrs?.marker).toBe("info");
  });

  it("preserves lowercase warning marker", () => {
    const md = `> \\[!warning]\n>\n> Content\n`;
    expectStableRoundtrip(md);
  });

  // ── Mixed-case markers ────────────────────────────────────────────────────

  it("preserves mixed-case Note marker exactly", () => {
    const md = `> \\[!Note]\n>\n> Content\n`;
    expectStableRoundtrip(md);
    const doc = parseMarkdownToDoc(md);
    const callout = doc.content?.find((n) => n.type === "callout");
    expect(callout?.attrs?.marker).toBe("Note");
  });

  it("preserves mixed-case Caution marker exactly", () => {
    const md = `> \\[!Caution]\n>\n> Content\n`;
    expectStableRoundtrip(md);
    const doc = parseMarkdownToDoc(md);
    const callout = doc.content?.find((n) => n.type === "callout");
    expect(callout?.attrs?.marker).toBe("Caution");
  });

  // ── First-pass normalization ([ → \[) ────────────────────────────────────
  // Input with raw `[!NOTE]` normalizes to `\[!NOTE]` on first save (CommonMark
  // safe-serialization), then becomes stable. The original alias is preserved.

  it("converts [!NOTE] to \\[!NOTE] on first save and stays stable", () => {
    const firstPass = roundtrip("> [!NOTE]\n>\n> Content\n");
    expect(firstPass).toBe("> \\[!NOTE]\n>\n> Content\n");
    expect(roundtrip(firstPass)).toBe(firstPass);
  });

  it("converts [!note] to \\[!note] on first save and stays stable", () => {
    const firstPass = roundtrip("> [!note]\n>\n> Content\n");
    expect(firstPass).toBe("> \\[!note]\n>\n> Content\n");
    expect(roundtrip(firstPass)).toBe(firstPass);
  });

  it("converts [!CAUTION] to \\[!CAUTION] on first save (not \\[!WARNING])", () => {
    const firstPass = roundtrip("> [!CAUTION]\n>\n> Content\n");
    expect(firstPass).toBe("> \\[!CAUTION]\n>\n> Content\n");
    expect(roundtrip(firstPass)).toBe(firstPass);
  });

  it("converts [!TIP] to \\[!TIP] on first save (not \\[!SUCCESS])", () => {
    const firstPass = roundtrip("> [!TIP]\n>\n> Content\n");
    expect(firstPass).toBe("> \\[!TIP]\n>\n> Content\n");
    expect(roundtrip(firstPass)).toBe(firstPass);
  });

  it("converts [!ERROR] to \\[!ERROR] on first save (not \\[!DANGER])", () => {
    const firstPass = roundtrip("> [!ERROR]\n>\n> Content\n");
    expect(firstPass).toBe("> \\[!ERROR]\n>\n> Content\n");
    expect(roundtrip(firstPass)).toBe(firstPass);
  });

  // ── Nested callout ────────────────────────────────────────────────────────

  it("preserves NOTE marker in a callout with nested blockquote content", () => {
    const md = `> \\[!NOTE]\n>\n> First paragraph.\n>\n> Second paragraph.\n`;
    expectStableRoundtrip(md);
    const doc = parseMarkdownToDoc(md);
    const callout = doc.content?.find((n) => n.type === "callout");
    expect(callout?.attrs?.marker).toBe("NOTE");
  });

  // ── Callouts with title-like text on a separate line ────────────────────

  it("preserves CAUTION callout with a heading inside the body", () => {
    const md = `> \\[!CAUTION]\n>\n> ## Warning Title\n>\n> Body text.\n`;
    expectStableRoundtrip(md);
    const doc = parseMarkdownToDoc(md);
    const callout = doc.content?.find((n) => n.type === "callout");
    expect(callout?.attrs?.marker).toBe("CAUTION");
  });
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

  // ── LaTeX source fidelity: backslash sequences must survive unescapeUnderscores ──
  //
  // `unescapeUnderscores` strips `\_` from plain text (where mdast-util-to-markdown
  // added it defensively). It must NOT strip `\_` inside math spans, where the
  // backslash is LaTeX subscript syntax, not a markdown escape character.

  it("preserves \\_ in inline math (subscript syntax)", () => {
    // $A\_B$ — the backslash is LaTeX subscript, not a markdown escape
    expectStableRoundtrip("The tensor $A\\_B$ has two indices.\n");
  });

  it("preserves \\_ in block math", () => {
    expectStableRoundtrip("$$\nA\\_B = C\\_D\n$$\n");
  });

  it("preserves \\_ in multi-line block math", () => {
    expectStableRoundtrip("$$\n\\sum_{i\\_j} a\\_i\n$$\n");
  });

  it("preserves \\% in inline math (percent literal)", () => {
    expectStableRoundtrip("The ratio $x\\%y$ is interesting.\n");
  });

  it("preserves \\& in inline math (ampersand literal)", () => {
    expectStableRoundtrip("The formula $A \\& B$ uses an ampersand.\n");
  });

  it("preserves escaped braces in inline math", () => {
    expectStableRoundtrip("Use $\\{x \\mid x > 0\\}$ for the set.\n");
  });

  it("preserves LaTeX spacing commands in inline math", () => {
    expectStableRoundtrip("The value $a\\,b\\;c$ uses spacing commands.\n");
  });

  it("preserves \\_ in block math while still unescaping \\_ in plain text", () => {
    // REQ_001 in a heading: the _ is plain text, serializer should NOT have \_ there
    // but within math the \_ must be kept.
    const md = "## REQ_001\n\n$$\nA\\_B\n$$\n";
    expectStableRoundtrip(md);
  });

  it("preserves \\_ in inline math mixed with plain text containing underscores", () => {
    // Plain text `_` never needs escaping (we use * for emphasis), so REQ_001
    // round-trips as REQ_001. But $A\_B$ must keep its backslash.
    expectStableRoundtrip("See REQ_001 and the formula $A\\_B$.\n");
  });

  it("parses inline math with \\_ into a text node preserving the backslash", () => {
    const doc = parseMarkdownToDoc("The variable $A\\_B$ is a tensor.\n");
    const para = doc.content?.find((n) => n.type === "paragraph");
    const mathNode = para?.content?.find(
      (n) => n.type === "text" && n.marks?.some((m) => m.type === "inlineMath")
    );
    expect(mathNode).toBeDefined();
    expect(mathNode?.text).toBe("A\\_B");
  });

  it("parses block math with \\_ into a codeBlock preserving the backslash", () => {
    const doc = parseMarkdownToDoc("$$\nA\\_B\n$$\n");
    const block = doc.content?.find(
      (n) => n.type === "codeBlock" && n.attrs?.language === "$$"
    );
    expect(block).toBeDefined();
    expect(block?.content?.[0].text).toBe("A\\_B");
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

// ── Reference-style links and definitions (BUG-01, BUG-02) ───────────────────
//
// Both bugs caused silent data loss: reference links disappeared and link
// definitions were dropped. The fixes:
//  - linkReference  → rawHtmlInline atom (reconstructed raw text)
//  - imageReference → rawHtmlInline atom (same approach)
//  - definition     → linkDefinition PM block node (new TipTap extension)

describe("markdown roundtrip: reference links (BUG-01)", () => {
  it("preserves a full reference link [text][ref]", () => {
    expectStableRoundtrip("[text][ref]\n\n[ref]: https://example.com\n");
  });

  it("preserves a full reference link with title on the definition", () => {
    expectStableRoundtrip("[text][ref]\n\n[ref]: https://example.com \"Example\"\n");
  });

  it("preserves a collapsed reference link [text][]", () => {
    expectStableRoundtrip("[text][]\n\n[text]: https://example.com\n");
  });

  it("preserves a shortcut reference link [text]", () => {
    expectStableRoundtrip("[text]\n\n[text]: https://example.com\n");
  });

  it("preserves multiple reference links using the same definition", () => {
    expectStableRoundtrip("[a][ref] and [b][ref]\n\n[ref]: https://example.com\n");
  });

  it("preserves a reference link with bold content in the label", () => {
    expectStableRoundtrip("[**bold**][ref]\n\n[ref]: url\n");
  });

  it("preserves a reference link with italic content in the label", () => {
    expectStableRoundtrip("[*italic*][ref]\n\n[ref]: url\n");
  });

  it("preserves a reference link with inline code in the label", () => {
    expectStableRoundtrip("[`code`][ref]\n\n[ref]: url\n");
  });

  it("preserves mixed inline and reference links in the same document", () => {
    expectStableRoundtrip("[inline](url) and [ref][id]\n\n[id]: https://example.com\n");
  });

  it("definition stays before text that references it", () => {
    expectStableRoundtrip("[ref]: url\n\n[text][ref]\n");
  });

  it("definition stays after text that references it", () => {
    expectStableRoundtrip("[text][ref]\n\n[ref]: url\n");
  });

  it("parses a linkReference into a rawHtmlInline node", () => {
    const doc = parseMarkdownToDoc("[text][ref]\n\n[ref]: url\n");
    const para = doc.content?.find((n) => n.type === "paragraph");
    const atom = para?.content?.find((n) => n.type === "rawHtmlInline");
    expect(atom).toBeDefined();
    expect(atom?.attrs?.html).toBe("[text][ref]");
  });

  it("parses a collapsed reference into a rawHtmlInline node", () => {
    const doc = parseMarkdownToDoc("[text][]\n\n[text]: url\n");
    const para = doc.content?.find((n) => n.type === "paragraph");
    const atom = para?.content?.find((n) => n.type === "rawHtmlInline");
    expect(atom?.attrs?.html).toBe("[text][]");
  });

  it("parses a shortcut reference into a rawHtmlInline node", () => {
    const doc = parseMarkdownToDoc("[text]\n\n[text]: url\n");
    const para = doc.content?.find((n) => n.type === "paragraph");
    const atom = para?.content?.find((n) => n.type === "rawHtmlInline");
    expect(atom?.attrs?.html).toBe("[text]");
  });
});

describe("markdown roundtrip: image reference links (BUG-01)", () => {
  it("preserves a full image reference ![alt][ref]", () => {
    expectStableRoundtrip("![alt][ref]\n\n[ref]: image.png\n");
  });

  it("preserves a full image reference with title", () => {
    expectStableRoundtrip("![alt][ref]\n\n[ref]: image.png \"Caption\"\n");
  });

  it("preserves a collapsed image reference ![alt][]", () => {
    expectStableRoundtrip("![alt][]\n\n[alt]: image.png\n");
  });

  it("preserves a shortcut image reference ![alt]", () => {
    expectStableRoundtrip("![alt]\n\n[alt]: image.png\n");
  });

  it("preserves a document with both link and image references", () => {
    expectStableRoundtrip("[a][ref1]\n\n![b][ref2]\n\n[ref1]: url1\n[ref2]: url2\n");
  });

  it("parses an imageReference into a rawHtmlInline node", () => {
    const doc = parseMarkdownToDoc("![logo][ref]\n\n[ref]: logo.png\n");
    const para = doc.content?.find((n) => n.type === "paragraph");
    const atom = para?.content?.find((n) => n.type === "rawHtmlInline");
    expect(atom).toBeDefined();
    expect(atom?.attrs?.html).toBe("![logo][ref]");
  });
});

describe("markdown roundtrip: standalone link definitions (BUG-02)", () => {
  it("preserves a standalone definition with no references", () => {
    expectStableRoundtrip("[ref]: https://example.com\n");
  });

  it("preserves a definition with a double-quoted title", () => {
    expectStableRoundtrip("[ref]: https://example.com \"My Title\"\n");
  });

  it("preserves an unused definition in a document with text", () => {
    expectStableRoundtrip("Some text.\n\n[ref]: https://example.com\n");
  });

  it("preserves a definition that appears before any referencing text", () => {
    expectStableRoundtrip("[ref]: url\n\nSome text.\n");
  });

  it("preserves multiple adjacent definitions (tight, no blank line between)", () => {
    // tightDefinitions:true is set in TO_MARKDOWN_OPTIONS; adjacent definitions
    // are always serialized without a blank line between them.
    expectStableRoundtrip("[ref1]: url1\n[ref2]: url2\n");
  });

  it("normalizes blank line between adjacent definitions to tight on first save", () => {
    const input = "[ref1]: url1\n\n[ref2]: url2\n";
    const once  = roundtrip(input);
    // tightDefinitions:true removes the blank line
    expect(once).toBe("[ref1]: url1\n[ref2]: url2\n");
    // stable thereafter
    expect(roundtrip(once)).toBe(once);
  });

  it("preserves duplicate definitions (both lines survive)", () => {
    expectStableRoundtrip("[ref]: url1\n[ref]: url2\n");
  });

  it("preserves a definition with a URL containing spaces (angle-bracket form)", () => {
    expectStableRoundtrip("[ref]: <url with spaces>\n");
  });

  it("preserves a definition with an underscore in the label", () => {
    // The label text contains _ which toMarkdown may escape to \_ then
    // unescapeUnderscores restores it.
    expectStableRoundtrip("[my_ref]: url\n");
  });

  it("preserves a reference link whose label has an underscore", () => {
    expectStableRoundtrip("[text][my_ref]\n\n[my_ref]: url\n");
  });

  it("parses a definition into a linkDefinition PM node", () => {
    const doc = parseMarkdownToDoc("[ref]: https://example.com \"Title\"\n");
    const defNode = doc.content?.find((n) => n.type === "linkDefinition");
    expect(defNode).toBeDefined();
    expect(defNode?.attrs?.label).toBe("ref");
    expect(defNode?.attrs?.url).toBe("https://example.com");
    expect(defNode?.attrs?.title).toBe("Title");
  });

  it("parses a definition without title with title attr null", () => {
    const doc = parseMarkdownToDoc("[ref]: url\n");
    const defNode = doc.content?.find((n) => n.type === "linkDefinition");
    expect(defNode?.attrs?.title).toBeNull();
  });
});

// ── Loose vs tight list preservation (BUG-04) ────────────────────────────────

describe("markdown roundtrip: loose vs tight lists (BUG-04)", () => {
  // ── tight (no blank lines) ────────────────────────────────────────────────

  it("preserves a tight bullet list", () => {
    expectStableRoundtrip("- A\n- B\n- C\n");
  });

  it("preserves a tight ordered list", () => {
    expectStableRoundtrip("1. A\n2. B\n3. C\n");
  });

  it("preserves a tight task list", () => {
    expectStableRoundtrip("- [x] Done\n- [ ] Not done\n");
  });

  // ── loose (blank lines between items) ────────────────────────────────────

  it("preserves a loose bullet list (blank lines between items)", () => {
    expectStableRoundtrip("- A\n\n- B\n\n- C\n");
  });

  it("preserves a two-item loose bullet list", () => {
    expectStableRoundtrip("- A\n\n- B\n");
  });

  it("preserves a loose ordered list", () => {
    expectStableRoundtrip("1. First\n\n2. Second\n\n3. Third\n");
  });

  it("preserves a loose task list", () => {
    expectStableRoundtrip("- [x] Done\n\n- [ ] Not done\n");
  });

  // ── multi-block items (blank lines within items) ──────────────────────────

  it("preserves a list item containing a paragraph and a code block", () => {
    expectStableRoundtrip("- Item\n\n  ```js\n  code\n  ```\n");
  });

  it("preserves a list item containing two paragraphs", () => {
    expectStableRoundtrip("- First para\n\n  Second para\n");
  });

  it("preserves a loose list where one item has a multi-block body", () => {
    expectStableRoundtrip("- A\n\n  ```js\n  code\n  ```\n\n- B\n");
  });

  it("preserves tight list with a multi-block item (spread on item only)", () => {
    // list.spread=false (no blank line between items) but the single item
    // has listItem.spread=true (blank line before the code block).
    // Note: a one-item list with no adjacent items has no "between" blank.
    expectStableRoundtrip("- Item\n\n  ```js\n  code\n  ```\n");
  });

  // ── PM node attrs ─────────────────────────────────────────────────────────

  it("stores spread=true on a loose bulletList PM node", () => {
    const doc = parseMarkdownToDoc("- A\n\n- B\n");
    const list = doc.content?.find((n) => n.type === "bulletList");
    expect(list?.attrs?.spread).toBe(true);
  });

  it("stores spread=false on a tight bulletList PM node", () => {
    const doc = parseMarkdownToDoc("- A\n- B\n");
    const list = doc.content?.find((n) => n.type === "bulletList");
    expect(list?.attrs?.spread).toBe(false);
  });

  it("stores spread=true on a listItem that contains multiple blocks", () => {
    const doc = parseMarkdownToDoc("- Item\n\n  ```js\n  code\n  ```\n");
    const list = doc.content?.find((n) => n.type === "bulletList");
    const item = list?.content?.[0];
    expect(item?.attrs?.spread).toBe(true);
  });

  it("stores spread=false on a listItem in a tight list", () => {
    const doc = parseMarkdownToDoc("- A\n- B\n");
    const list = doc.content?.find((n) => n.type === "bulletList");
    const item = list?.content?.[0];
    expect(item?.attrs?.spread).toBe(false);
  });

  it("stores spread=true on a loose orderedList PM node", () => {
    const doc = parseMarkdownToDoc("1. A\n\n2. B\n");
    const list = doc.content?.find((n) => n.type === "orderedList");
    expect(list?.attrs?.spread).toBe(true);
  });

  it("stores spread=true on a loose taskList PM node", () => {
    const doc = parseMarkdownToDoc("- [x] Done\n\n- [ ] Not done\n");
    const list = doc.content?.find((n) => n.type === "taskList");
    expect(list?.attrs?.spread).toBe(true);
  });
});

// ── HTML entity fidelity (BUG-05) ────────────────────────────────────────────

describe("markdown roundtrip: HTML entity fidelity (BUG-05)", () => {
  // ── Named entities ─────────────────────────────────────────────────────────

  it("preserves &amp; verbatim", () => {
    expectStableRoundtrip("A &amp; B\n");
  });

  it("preserves &lt; verbatim", () => {
    expectStableRoundtrip("A &lt; B\n");
  });

  it("preserves &gt; verbatim", () => {
    expectStableRoundtrip("A &gt; B\n");
  });

  it("preserves &nbsp; verbatim", () => {
    expectStableRoundtrip("A&nbsp;B\n");
  });

  it("preserves &mdash; verbatim", () => {
    expectStableRoundtrip("A &mdash; B\n");
  });

  it("preserves &ndash; verbatim", () => {
    expectStableRoundtrip("A &ndash; B\n");
  });

  it("preserves &copy; verbatim", () => {
    expectStableRoundtrip("&copy; 2024\n");
  });

  // ── Numeric decimal entities ───────────────────────────────────────────────

  it("preserves &#65; (decimal numeric) verbatim", () => {
    expectStableRoundtrip("A&#65;B\n");
  });

  it("preserves &#160; (non-breaking space, decimal) verbatim", () => {
    expectStableRoundtrip("A&#160;B\n");
  });

  it("preserves &#8212; (em dash, decimal) verbatim", () => {
    expectStableRoundtrip("A &#8212; B\n");
  });

  // ── Hexadecimal numeric entities ───────────────────────────────────────────

  it("preserves &#x41; (hex numeric) verbatim", () => {
    expectStableRoundtrip("A&#x41;B\n");
  });

  it("preserves &#xFF; (hex) verbatim", () => {
    expectStableRoundtrip("A&#xFF;B\n");
  });

  it("preserves &#xA0; (non-breaking space, hex) verbatim", () => {
    expectStableRoundtrip("A&#xA0;B\n");
  });

  // ── Multiple entities in one paragraph ─────────────────────────────────────

  it("preserves multiple entities in one paragraph", () => {
    expectStableRoundtrip("A &amp; B &lt; C\n");
  });

  it("preserves mixed named and numeric entities", () => {
    expectStableRoundtrip("A &amp; &#65; B\n");
  });

  // ── Plain text that resembles entities must NOT be re-encoded ──────────────

  it("does not encode a plain & followed by a space", () => {
    expectStableRoundtrip("Fish & Chips\n");
  });

  it("does not encode a plain < in the middle of a paragraph", () => {
    expectStableRoundtrip("A < B\n");
  });

  it("does not encode a plain > in the middle of a paragraph", () => {
    expectStableRoundtrip("A > B\n");
  });

  // ── Entities inside structural contexts ────────────────────────────────────

  it("preserves an entity inside a heading", () => {
    expectStableRoundtrip("## A &amp; B\n");
  });

  it("preserves an entity inside bold", () => {
    expectStableRoundtrip("**A &amp; B**\n");
  });

  it("preserves an entity inside italic", () => {
    expectStableRoundtrip("*A &amp; B*\n");
  });

  it("preserves an entity inside link text", () => {
    expectStableRoundtrip("[A &amp; B](https://example.com)\n");
  });

  it("preserves an entity inside a blockquote paragraph", () => {
    expectStableRoundtrip("> A &amp; B\n");
  });

  it("preserves an entity inside a list item", () => {
    expectStableRoundtrip("- A &amp; B\n");
  });

  it("preserves an entity inside a table cell", () => {
    // Table separator is normalized on first pass (|---| → | - |); the entity itself survives.
    const once = roundtrip("| A &amp; B |\n|---|\n| val |\n");
    expect(once).toContain("A &amp; B");
    expect(roundtrip(once)).toBe(once);
  });

  // ── Entities adjacent to raw inline HTML ───────────────────────────────────

  it("preserves an entity adjacent to a raw HTML tag", () => {
    expectStableRoundtrip("text &amp; <b>bold</b>\n");
  });

  it("preserves an entity adjacent to a <br> tag", () => {
    // <br> normalizes to `\` + newline (hardBreak); the entity &amp; survives.
    const once = roundtrip("line1 &amp;<br>line2\n");
    expect(once).toContain("&amp;");
    expect(roundtrip(once)).toBe(once);
  });

  // ── Unknown (unrecognized) named entities ──────────────────────────────────

  it("preserves an unknown named entity &foo; verbatim (no backslash escaping)", () => {
    // Without entity preservation, mdast-util-to-markdown would produce \&foo;
    // on the first save. With it, &foo; is stored as rawHtmlInline and round-trips exactly.
    expectStableRoundtrip("A &foo; B\n");
  });

  // ── PM node structure assertions ───────────────────────────────────────────

  it("stores an entity as a rawHtmlInline PM node", () => {
    const doc = parseMarkdownToDoc("A &amp; B\n");
    const para = doc.content?.[0];
    const entity = para?.content?.find((n) => n.type === "rawHtmlInline");
    expect(entity).toBeDefined();
    expect(entity?.attrs?.html).toBe("&amp;");
  });

  it("stores the text around an entity as separate text PM nodes", () => {
    const doc = parseMarkdownToDoc("A &amp; B\n");
    const para = doc.content?.[0];
    const types = para?.content?.map((n) => n.type);
    expect(types).toEqual(["text", "rawHtmlInline", "text"]);
  });

  it("stores a numeric entity as a rawHtmlInline PM node", () => {
    const doc = parseMarkdownToDoc("&#65;\n");
    const para = doc.content?.[0];
    const entity = para?.content?.find((n) => n.type === "rawHtmlInline");
    expect(entity?.attrs?.html).toBe("&#65;");
  });

  it("leaves plain ampersand as text (not rawHtmlInline)", () => {
    const doc = parseMarkdownToDoc("Fish & Chips\n");
    const para = doc.content?.[0];
    const hasRaw = para?.content?.some((n) => n.type === "rawHtmlInline");
    expect(hasRaw).toBeFalsy();
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

// ── BUG-09: ordered list marker preservation ────────────────────────────────

describe("markdown roundtrip: ordered list marker fidelity (BUG-09)", () => {
  // ── Sequential markers ────────────────────────────────────────────────────

  it("preserves sequential 1-2-3 markers", () => {
    expectStableRoundtrip("1. First\n2. Second\n3. Third\n");
  });

  it("preserves all-ones markers (1. 1. 1.)", () => {
    expectStableRoundtrip("1. First\n1. Second\n1. Third\n");
  });

  it("preserves non-sequential markers (2. 4. 6.)", () => {
    expectStableRoundtrip("2. First\n4. Second\n6. Third\n");
  });

  it("preserves arbitrary numbering (5. 1. 99.)", () => {
    expectStableRoundtrip("5. First\n1. Second\n99. Third\n");
  });

  it("preserves reverse counting (3. 2. 1.)", () => {
    expectStableRoundtrip("3. First\n2. Second\n1. Third\n");
  });

  it("preserves a list starting from a number other than 1", () => {
    expectStableRoundtrip("5. First\n6. Second\n7. Third\n");
  });

  it("preserves a single-item list with non-1 start", () => {
    expectStableRoundtrip("42. Only item\n");
  });

  // ── Multi-digit markers ────────────────────────────────────────────────────

  it("preserves multi-digit markers", () => {
    expectStableRoundtrip("10. First\n20. Second\n30. Third\n");
  });

  it("preserves large non-sequential multi-digit markers", () => {
    expectStableRoundtrip("100. A\n200. B\n300. C\n");
  });

  // ── PM schema attrs ────────────────────────────────────────────────────────

  it("stores per-item value in PM listItem attrs", () => {
    const doc = parseMarkdownToDoc("2. A\n4. B\n6. C\n");
    const list = doc.content?.find((n) => n.type === "orderedList");
    expect(list?.attrs?.start).toBe(2);
    expect(list?.content?.[0]?.attrs?.value).toBe(2);
    expect(list?.content?.[1]?.attrs?.value).toBe(4);
    expect(list?.content?.[2]?.attrs?.value).toBe(6);
  });

  it("stores value=1 for all items in all-ones list", () => {
    const doc = parseMarkdownToDoc("1. A\n1. B\n1. C\n");
    const list = doc.content?.find((n) => n.type === "orderedList");
    expect(list?.content?.[0]?.attrs?.value).toBe(1);
    expect(list?.content?.[1]?.attrs?.value).toBe(1);
    expect(list?.content?.[2]?.attrs?.value).toBe(1);
  });

  // ── Nested ordered lists ───────────────────────────────────────────────────

  it("preserves nested ordered list markers independently", () => {
    expectStableRoundtrip("1. Outer A\n   1. Inner A\n   1. Inner B\n2. Outer B\n");
  });

  it("preserves non-sequential markers in nested ordered list", () => {
    // A blank line is required to separate the paragraph from the nested list;
    // without it remark treats the `3.` line as lazy continuation of "Outer".
    expectStableRoundtrip("1. Outer\n\n   3. Nested A\n   5. Nested B\n");
  });

  // ── Mixed list types ───────────────────────────────────────────────────────

  it("preserves ordered list adjacent to bullet list (no interference)", () => {
    expectStableRoundtrip("- Bullet A\n- Bullet B\n\n1. Ordered A\n1. Ordered B\n");
  });

  it("preserves bullet list nested inside ordered list", () => {
    expectStableRoundtrip("1. Ordered A\n   - Bullet child\n2. Ordered B\n");
  });

  it("preserves ordered list nested inside bullet list", () => {
    expectStableRoundtrip("- Parent bullet\n  1. Child A\n  1. Child B\n");
  });

  // ── Task lists not affected ────────────────────────────────────────────────

  it("task list checkboxes still serialize correctly after custom handler", () => {
    expectStableRoundtrip("- [ ] Todo\n- [x] Done\n");
  });

  it("tight task list preserves checked state alongside custom handler", () => {
    const doc = parseMarkdownToDoc("- [x] Done\n- [ ] Not done\n");
    const md = serializeDocToMarkdown(doc);
    expect(md).toBe("- [x] Done\n- [ ] Not done\n");
  });

  // ── Loose ordered list ─────────────────────────────────────────────────────

  it("preserves loose all-ones ordered list", () => {
    expectStableRoundtrip("1. First\n\n1. Second\n\n1. Third\n");
  });

  it("preserves loose non-sequential ordered list", () => {
    expectStableRoundtrip("2. A\n\n4. B\n\n6. C\n");
  });

  // ── Save/load round-trip (schema persistence) ──────────────────────────────

  it("per-item values survive a parse → serialize → re-parse cycle", () => {
    const md = "2. A\n4. B\n6. C\n";
    const once = roundtrip(md);
    // After one serialization the markers are preserved.
    expect(once).toBe("2. A\n4. B\n6. C\n");
    // Second parse also sees the stored values.
    const doc2 = parseMarkdownToDoc(once);
    const list = doc2.content?.find((n) => n.type === "orderedList");
    expect(list?.content?.[0]?.attrs?.value).toBe(2);
    expect(list?.content?.[1]?.attrs?.value).toBe(4);
    expect(list?.content?.[2]?.attrs?.value).toBe(6);
  });

  it("all-ones list survives two serialize passes without becoming sequential", () => {
    const md = "1. A\n1. B\n1. C\n";
    expect(roundtrip(roundtrip(md))).toBe(md);
  });
});
