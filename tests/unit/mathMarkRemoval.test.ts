/**
 * Regression tests for inline math mark removal ("Remove math" toolbar action).
 *
 * Root cause: inlineMath is an exclusive mark rendered as a KaTeX decoration
 * widget.  There was no command or toolbar button to remove it, trapping users
 * unless they used source/code mode.
 *
 * Fix: add a "Remove math" button to the BubbleMenu toolbar (shouldShow now
 * also activates when e.isActive("inlineMath")), which calls:
 *   editor.chain().focus().extendMarkRange("inlineMath").unsetMark("inlineMath").run()
 *
 * These tests verify the serializer-level invariant: after removing the
 * inlineMath mark the underlying text is preserved and no $…$ delimiters
 * appear in the output.
 */

import { describe, it, expect } from "vitest";
import { parseMarkdownToDoc, serializeDocToMarkdown } from "@/markdown";
import type { JSONContent } from "@tiptap/core";

// ── Helper: recursively strip inlineMath marks ────────────────────────────────

function removeMathMark(node: JSONContent): JSONContent {
  return {
    ...node,
    marks: node.marks?.filter((m) => m.type !== "inlineMath"),
    content: node.content?.map(removeMathMark),
  };
}

// ── Math mark presence ────────────────────────────────────────────────────────

describe("inline math mark — presence after parsing", () => {
  it("$x^2$ creates a text node with inlineMath mark", () => {
    const doc = parseMarkdownToDoc("$x^2$\n");
    const para = doc.content?.[0];
    const textNode = para?.content?.[0];
    expect(textNode?.text).toBe("x^2");
    expect(textNode?.marks?.some((m) => m.type === "inlineMath")).toBe(true);
  });

  it("source text is stored verbatim inside the mark", () => {
    const doc = parseMarkdownToDoc("$a + b$\n");
    const textNode = doc.content?.[0]?.content?.[0];
    expect(textNode?.text).toBe("a + b");
  });
});

// ── Serialization after mark removal ─────────────────────────────────────────

describe("inline math mark removal — serialization", () => {
  it("removing inlineMath mark drops $-delimiters from output", () => {
    const doc = parseMarkdownToDoc("$x^2$\n");
    const stripped = removeMathMark(doc);
    expect(serializeDocToMarkdown(stripped)).toBe("x^2\n");
  });

  it("source text is preserved exactly after removal", () => {
    const doc = parseMarkdownToDoc("$a + b$\n");
    const stripped = removeMathMark(doc);
    expect(serializeDocToMarkdown(stripped)).toBe("a + b\n");
  });

  it("surrounding prose is preserved after removal", () => {
    const doc = parseMarkdownToDoc("Before $x^2$ after\n");
    const stripped = removeMathMark(doc);
    expect(serializeDocToMarkdown(stripped)).toBe("Before x^2 after\n");
  });

  it("text before and after math is unaffected", () => {
    const doc = parseMarkdownToDoc("intro $E = mc^2$ conclusion\n");
    const stripped = removeMathMark(doc);
    const result = serializeDocToMarkdown(stripped);
    expect(result).toContain("intro");
    expect(result).toContain("conclusion");
    expect(result).not.toContain("$");
  });

  it("bold marks surrounding math are preserved after removal", () => {
    const doc = parseMarkdownToDoc("**bold** $x^2$ **more**\n");
    const stripped = removeMathMark(doc);
    expect(serializeDocToMarkdown(stripped)).toBe("**bold** x^2 **more**\n");
  });

  it("table-cell math removal preserves table structure", () => {
    const md = "| Math | Text |\n|------|------|\n| $x^2$ | normal |\n";
    const doc = parseMarkdownToDoc(md);
    const stripped = removeMathMark(doc);
    const result = serializeDocToMarkdown(stripped);
    expect(result).toContain("x^2");
    expect(result).not.toContain("$x^2$");
    expect(result).toContain("normal");
  });
});

// ── Serialization stability ───────────────────────────────────────────────────

describe("inline math mark removal — round-trip stability", () => {
  it("re-serializing the mark-stripped doc is idempotent", () => {
    const doc = parseMarkdownToDoc("Some $x^2$ text\n");
    const stripped = removeMathMark(doc);
    const md1 = serializeDocToMarkdown(stripped);
    const md2 = serializeDocToMarkdown(parseMarkdownToDoc(md1));
    expect(md2).toBe(md1);
  });

  it("stripped doc does not re-acquire $-delimiters on reparse", () => {
    const doc = parseMarkdownToDoc("Result $a + b$\n");
    const stripped = removeMathMark(doc);
    const md = serializeDocToMarkdown(stripped);
    expect(md).not.toContain("$");
    const reparsed = parseMarkdownToDoc(md);
    const text = reparsed.content?.[0]?.content?.[0];
    expect(text?.marks?.some((m) => m.type === "inlineMath")).toBeFalsy();
  });

  it("multiple math expressions in one paragraph — all stripped", () => {
    const doc = parseMarkdownToDoc("$a$ plus $b$ equals $c$\n");
    const stripped = removeMathMark(doc);
    const result = serializeDocToMarkdown(stripped);
    expect(result).toBe("a plus b equals c\n");
  });
});
