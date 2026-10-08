import { describe, it, expect } from "vitest";
import { parseMarkdownToDoc, serializeDocToMarkdown } from "@/markdown";
import { mergePreservingUnchangedBlocks } from "@/markdown/sourcePreservation";
import corpus from "../fixtures/corpus.md?raw";
import type { PMNode } from "@/markdown/types";

/**
 * D9 — never rewrite untouched lines.
 *
 * The messy fixture deliberately uses every non-canonical style the browser
 * app was observed rewriting (user report, 2026-08-29): `*` and `+` bullets,
 * 3- and 4-space nesting, trailing double-space hard breaks, `1)` ordered
 * lists, extra blank lines between blocks.
 */

const MESSY = [
  "# Spec  ",
  "",
  "Intro line with a hard break  ",
  "second line of intro",
  "",
  "* item one",
  "   * nested three-space",
  "* item two",
  "",
  "",
  "1) first",
  "2) second",
  "",
  "+ plus item",
  "    + deep nested",
  "",
  "Closing paragraph.",
  "",
].join("\n");

/** Simulate the editor pipeline: parse → (optional mutation) → serialize. */
function editorPass(markdown: string, mutate?: (doc: PMNode) => void): string {
  const doc = parseMarkdownToDoc(markdown);
  mutate?.(doc);
  return serializeDocToMarkdown(doc);
}

/** Replace the first text node whose text contains `find`. */
function replaceText(doc: PMNode, find: string, replacement: string): void {
  let done = false;
  const walk = (node: PMNode): void => {
    if (done) return;
    if (node.type === "text" && typeof node.text === "string" && node.text.includes(find)) {
      node.text = node.text.replace(find, replacement);
      done = true;
      return;
    }
    for (const child of node.content ?? []) walk(child);
  };
  walk(doc);
  if (!done) throw new Error(`text not found: ${find}`);
}

describe("mergePreservingUnchangedBlocks — no-edit identity", () => {
  it("returns the messy document byte-identical after a no-edit pass", () => {
    expect(mergePreservingUnchangedBlocks(MESSY, editorPass(MESSY))).toBe(MESSY);
  });

  it("returns the corpus byte-identical after a no-edit pass", () => {
    expect(mergePreservingUnchangedBlocks(corpus, editorPass(corpus))).toBe(corpus);
  });
});

describe("mergePreservingUnchangedBlocks — localized edits", () => {
  it("editing one paragraph preserves every other line verbatim", () => {
    const canonical = editorPass(MESSY, (doc) =>
      replaceText(doc, "Closing paragraph.", "Closing paragraph, edited."),
    );
    const merged = mergePreservingUnchangedBlocks(MESSY, canonical);

    expect(merged).toContain("Closing paragraph, edited.");
    // Untouched non-canonical styles survive byte-for-byte:
    expect(merged).toContain("Intro line with a hard break  \nsecond line of intro");
    expect(merged).toContain("* item one\n   * nested three-space\n* item two");
    expect(merged).toContain("1) first\n2) second");
    expect(merged).toContain("+ plus item\n    + deep nested");
    expect(merged).toContain("# Spec  ");
    // Extra blank line between preserved neighbors survives:
    expect(merged).toContain("* item two\n\n\n1) first");
  });

  it("editing a list canonicalizes only that list", () => {
    const canonical = editorPass(MESSY, (doc) => replaceText(doc, "first", "FIRST"));
    const merged = mergePreservingUnchangedBlocks(MESSY, canonical);

    expect(merged).toContain("1. FIRST"); // edited list is canonical now
    expect(merged).toContain("* item one\n   * nested three-space"); // untouched list intact
    expect(merged).toContain("+ plus item\n    + deep nested");
  });

  it("inserting a block preserves all existing blocks", () => {
    const canonical = editorPass(MESSY, (doc) => {
      doc.content!.splice(1, 0, {
        type: "paragraph",
        content: [{ type: "text", text: "A brand new paragraph." }],
      } as PMNode);
    });
    const merged = mergePreservingUnchangedBlocks(MESSY, canonical);

    expect(merged).toContain("A brand new paragraph.");
    expect(merged).toContain("* item one\n   * nested three-space");
    expect(merged).toContain("1) first");
  });

  it("deleting a block preserves the remaining blocks", () => {
    const canonical = editorPass(MESSY, (doc) => {
      // Drop the closing paragraph (last block).
      doc.content!.splice(doc.content!.length - 1, 1);
    });
    const merged = mergePreservingUnchangedBlocks(MESSY, canonical);

    expect(merged).not.toContain("Closing paragraph.");
    expect(merged).toContain("* item one\n   * nested three-space");
    expect(merged).toContain("1) first");
    expect(merged).toContain("+ plus item\n    + deep nested");
  });

  it("falls back to canonical output when preservation would change block boundaries", () => {
    // Deleting the ordered list makes the two bullet lists adjacent; keeping
    // both in their original styles could fuse them into one list. The safety
    // gate must detect this and emit the (semantically correct) canonical form.
    const canonical = editorPass(MESSY, (doc) => {
      doc.content!.splice(3, 1); // the "1) first / 2) second" list
    });
    const merged = mergePreservingUnchangedBlocks(MESSY, canonical);
    expect(editorPass(merged)).toBe(canonical);
  });

  it("the merged output still parses to the same content as the canonical form", () => {
    const canonical = editorPass(MESSY, (doc) => replaceText(doc, "item two", "item TWO"));
    const merged = mergePreservingUnchangedBlocks(MESSY, canonical);
    // Semantic equivalence: canonicalizing the merged text reproduces the
    // canonical serialization exactly.
    expect(editorPass(merged)).toBe(canonical);
  });
});
