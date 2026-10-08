import { describe, it, expect } from "vitest";
import { Editor } from "@tiptap/core";
import { createCoreExtensions } from "@/editor/extensions/core";
import { parseMarkdownToDoc, serializeDocToMarkdown } from "@/markdown";
import corpus from "../fixtures/corpus.md?raw";

/**
 * The Phase 0 spike gate: the webview's schema (createCoreExtensions) must
 * accept every node/mark the parser emits, and a document loaded into a live
 * editor must serialize back to the exact same markdown the parser produced
 * it from. If this holds, the sync loop's diff stays minimal by construction.
 */
function roundTripThroughEditor(markdown: string): string {
  const editor = new Editor({
    element: document.createElement("div"),
    extensions: createCoreExtensions(),
    content: parseMarkdownToDoc(markdown),
  });
  const out = serializeDocToMarkdown(editor.getJSON());
  editor.destroy();
  return out;
}

describe("createCoreExtensions schema coverage", () => {
  it("loads and exactly round-trips the corpus document", () => {
    expect(roundTripThroughEditor(corpus)).toBe(corpus);
  });

  it("round-trips representative block and inline constructs", () => {
    const md = [
      "# Title",
      "",
      "Text with **bold**, *italic*, `code`, ==highlight==, ^sup^, ~sub~, <u>underline</u>, and [a link](https://example.com).",
      "",
      "> \\[!INFO]",
      "> Callout body",
      "",
      "- item one",
      "  - nested",
      "",
      "1. first",
      "2. second",
      "",
      "- [ ] task open",
      "- [x] task done",
      "",
      "| A | B |",
      "| - | - |",
      "| 1 | H<sub>2</sub>O |",
      "",
      "```ts",
      "const x = 1;",
      "```",
      "",
      "Math: $e^{i\\pi} + 1 = 0$ inline.",
      "",
    ].join("\n");
    expect(roundTripThroughEditor(md)).toBe(md);
  });
});
