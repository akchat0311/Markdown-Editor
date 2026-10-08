import type { PMNode } from "./types";
import { parseMarkdownToDoc } from "./parser";
import { serializeDocToMarkdown } from "./serializer";
import { expandSoftBreaks, collapseSoftBreaks } from "./softBreaks";
import { stripEmptyTopLevelParagraphs } from "./emptyParagraphs";
import { mergePreservingUnchangedBlocks } from "./sourcePreservation";

/**
 * Browser-app boundary between markdown text and the LIVE editor document.
 * (The VS Code extension does the same two transforms in its webview bridge.)
 *
 *   markdown ──parse──▶ PM JSON ──expandSoftBreaks──▶ editor
 *   editor ──collapseSoftBreaks + stripEmptyParagraphs──▶ serialize ──merge──▶ markdown
 *
 * - Soft line breaks (a lazy `\n` inside a paragraph) live in the editor as
 *   explicit `softBreak` nodes, never as raw newlines in text nodes — real
 *   Chromium contentEditable mangles those into `<br>`/hard breaks (see
 *   SoftBreak.ts). The parser/serializer themselves keep speaking raw `\n`.
 * - Empty top-level paragraphs are ephemeral caret parking and never reach
 *   the file (emptyParagraphs.ts).
 * - Per-block source preservation (D9): given the tab's previous markdown,
 *   only blocks whose content changed are re-emitted in canonical style;
 *   untouched lines stay byte-identical, so a no-edit round trip is a no-op.
 *
 * Every parse/serialize call that touches the live editor must go through
 * these two functions; the raw parser/serializer are for text-only paths
 * (block canonicalization, tests).
 */

export function markdownToEditorDoc(markdown: string): PMNode {
  return expandSoftBreaks(parseMarkdownToDoc(markdown));
}

/**
 * @param previousMarkdown  The markdown this editor state was loaded from or
 *   last serialized to (the tab's current `markdown`). When given, unchanged
 *   blocks are preserved verbatim from it. Line endings are normalized to LF
 *   first: the merge requires LF on both sides, and the app has always
 *   written LF.
 */
export function editorDocToMarkdown(doc: PMNode, previousMarkdown?: string): string {
  const canonical = serializeDocToMarkdown(
    stripEmptyTopLevelParagraphs(collapseSoftBreaks(doc)),
  );
  if (previousMarkdown === undefined) return canonical;
  const previous = previousMarkdown.includes("\r")
    ? previousMarkdown.replace(/\r\n?/g, "\n")
    : previousMarkdown;
  return mergePreservingUnchangedBlocks(previous, canonical);
}
