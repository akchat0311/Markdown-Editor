import { describe, expect, it } from "vitest";
import { parseMarkdownToDoc, serializeDocToMarkdown } from "@/markdown";

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
    const md = "### REQ_001 \\[Draft]\n\nSystem shall authenticate users.\n";
    expectStableRoundtrip(md);
    const doc = parseMarkdownToDoc(md);
    expect(doc.content?.[0].type).toBe("heading");
  });

  it("does not produce requirementBlock nodes", () => {
    const md = "### REQ_001 \\[Draft]\n\nBody.\n";
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
