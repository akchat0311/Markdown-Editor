import { describe, it, expect } from "vitest";
import { parseMarkdownToDoc, serializeDocToMarkdown } from "@/markdown";
import { stripEmptyTopLevelParagraphs } from "@/markdown/emptyParagraphs";
import { mergePreservingUnchangedBlocks } from "@/markdown/sourcePreservation";
import type { PMNode } from "@/markdown/types";

/**
 * Incident regression (user report, 2026-08-30): pressing Enter in the
 * editor created an empty paragraph. Empty paragraphs have no markdown
 * representation — they serialized to stray blank lines, which (a) appeared
 * on disk while invisible in the editor, and (b) made the canonical output
 * a non-fixed-point of the serializer, tripping the D9 safety gate into
 * rewriting the ENTIRE file canonically (* bullets → -, 1) → 1., trailing
 * double-space → backslash). Two defenses are pinned here: empty top-level
 * paragraphs never serialize, and the gate compares re-canonicalized forms.
 */

const MESSY = [
  "Intro paragraph.",
  "",
  "* star bullet",
  "   * three-space nested",
  "",
  "1) paren ordered",
  "2) second",
  "",
  "hard break line  ",
  "continues here.",
  "",
].join("\n");

describe("stripEmptyTopLevelParagraphs", () => {
  it("an inserted empty paragraph does not change serialization", () => {
    const doc = parseMarkdownToDoc(MESSY);
    const withEmpty: PMNode = {
      ...doc,
      content: [
        doc.content![0],
        { type: "paragraph" },
        ...doc.content!.slice(1),
      ],
    };
    expect(serializeDocToMarkdown(stripEmptyTopLevelParagraphs(withEmpty))).toBe(
      serializeDocToMarkdown(doc),
    );
  });

  it("keeps one paragraph when the document is only empty paragraphs", () => {
    const doc: PMNode = { type: "doc", content: [{ type: "paragraph" }, { type: "paragraph" }] };
    const out = stripEmptyTopLevelParagraphs(doc);
    expect(out.content).toHaveLength(1);
  });

  it("leaves non-empty and nested content untouched", () => {
    const doc = parseMarkdownToDoc(MESSY);
    expect(stripEmptyTopLevelParagraphs(doc)).toBe(doc);
  });
});

describe("empty paragraphs inside blockquotes/callouts", () => {
  it("Enter artifacts inside a blockquote never serialize as stray '>' lines", () => {
    const doc = parseMarkdownToDoc("> quoted line\n");
    const bq = doc.content![0];
    const withEmpties: PMNode = {
      ...doc,
      content: [{ ...bq, content: [...bq.content!, { type: "paragraph" }, { type: "paragraph" }] }],
    };
    expect(serializeDocToMarkdown(stripEmptyTopLevelParagraphs(withEmpties))).toBe(
      "> quoted line\n",
    );
  });
});

describe("safety gate is fixed-point-insensitive", () => {
  it("a canonical input with stray blank lines must not nuke preservation", () => {
    // Simulate the old failure: canonical output containing an extra blank
    // region that disappears on re-parse (what an empty paragraph produced).
    const canonical = serializeDocToMarkdown(parseMarkdownToDoc(MESSY));
    const canonicalWithBlank = canonical.replace(
      "Intro paragraph.\n",
      "Intro paragraph.\n\n\n",
    );
    const merged = mergePreservingUnchangedBlocks(MESSY, canonicalWithBlank);
    // The gate must not fall back to full canonical: untouched non-canonical
    // styles survive.
    expect(merged).toContain("* star bullet\n   * three-space nested");
    expect(merged).toContain("1) paren ordered");
    expect(merged).toContain("hard break line  \ncontinues here.");
  });
});
