/**
 * Mark-preserving ProseMirror-level utilities for requirement heading rewrites.
 *
 * All requirement heading mutations — status-dropdown change, renumber,
 * duplicate-ID reassignment — use these functions instead of the pattern:
 *
 *   tr.replaceWith(from, to, schema.text(heading.textContent))
 *
 * which rebuilds the heading as a plain string and silently strips every
 * inline mark (italic, bold, …) from the content it didn't intend to touch.
 *
 * The guarantee here is token-level precision:
 *   - rewriteHeadingId    replaces only the ID prefix characters
 *   - rewriteHeadingStatus replaces only the [Status] bracket, preserving the
 *                          marks that were on the inner label text
 *   - insertHeadingStatus  appends a bracket when none exists yet
 *
 * ProseMirror's replaceWith handles TextNode splitting at the character
 * boundary automatically, so marks on content OUTSIDE the replaced token are
 * preserved by the runtime without any extra work from these functions.
 */

import type { Transaction } from "@tiptap/pm/state";
import type { Node as PMNode, Mark } from "@tiptap/pm/model";

// ── Internal helpers ──────────────────────────────────────────────────────────

/**
 * Returns the character offsets [from, to) of the last [Status] bracket group
 * in `text`.  The search is anchored at the end of the string so trailing
 * whitespace is skipped.  Returns null when no bracket group is found.
 */
export function bracketCharRange(text: string): [number, number] | null {
  const m = text.match(/(\[[^\]]+\])\s*$/);
  if (!m) return null;
  const from = text.lastIndexOf(m[1]);
  return [from, from + m[1].length];
}

/**
 * Returns the marks active at `absPos` in the transaction's current doc.
 * Wraps resolve() so that out-of-range positions return an empty array.
 */
function marksAt(tr: Transaction, absPos: number): readonly Mark[] {
  if (absPos < 0 || absPos > tr.doc.content.size) return [];
  try {
    return tr.doc.resolve(absPos).marks();
  } catch {
    return [];
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Replaces the ID prefix of a requirement heading in `tr`.
 *
 * Only the first `oldId.length` characters of the heading are touched.
 * Everything after the ID (title suffix, status bracket with its marks)
 * is left completely intact.
 *
 * `headingPos` is the absolute PM position of the heading node itself
 * (the value from `entry.node.pmPos` / `doc.nodeAt(pmPos)` lookups).
 *
 * Requirement IDs are treated as plain text; any marks on the old ID are
 * not carried forward (IDs are structural identifiers, not rich content).
 */
export function rewriteHeadingId(
  tr: Transaction,
  headingPos: number,
  oldId: string,
  newId: string,
): void {
  const { schema } = tr.doc.type;
  // headingPos + 1 steps inside the heading node; oldId.length chars from there
  // cover exactly the ID prefix — nothing more.
  tr.replaceWith(headingPos + 1, headingPos + 1 + oldId.length, schema.text(newId));
}

/**
 * Replaces the [Status] bracket at the end of a requirement heading,
 * preserving any inline formatting marks on the inner label text.
 *
 * Example:  `[*Draft*]`  →  `[*Review*]`   (italic mark retained)
 *           `[Draft]`    →  `[Review]`      (no marks; plain text used)
 *
 * Marks are read from `tr.doc` (the transaction's current document state),
 * so earlier steps in a multi-step transaction are accounted for.
 *
 * Returns `false` when no [Status] bracket is found and no change is made.
 */
export function rewriteHeadingStatus(
  tr: Transaction,
  headingPos: number,
  headingNode: PMNode,
  newLabel: string,
): boolean {
  const range = bracketCharRange(headingNode.textContent);
  if (!range) return false;

  const [charFrom, charTo] = range;
  const absFrom = headingPos + 1 + charFrom;
  const absTo   = headingPos + 1 + charTo;

  // Read marks from one position PAST the opening "[".
  // At absFrom + 1 (the boundary between "[" and the label's first char),
  // PM's marks() looks leftward and sees the "[" node's marks — which may be
  // plain even when the label text is italic.  absFrom + 2 is safely inside
  // the label text (textOffset >= 1) and returns the label's own marks.
  const innerPos = absFrom + 2;
  const innerMarks: readonly Mark[] =
    innerPos < absTo ? marksAt(tr, innerPos) : [];

  const { schema } = tr.doc.type;
  const nodes: PMNode[] =
    innerMarks.length > 0
      ? [
          schema.text("["),
          schema.text(newLabel, [...innerMarks]),
          schema.text("]"),
        ]
      : [schema.text("[" + newLabel + "]")];

  tr.replaceWith(absFrom, absTo, nodes);
  return true;
}

/**
 * Appends a new [Status] bracket to a heading that currently has none.
 * Inserted as plain text — there is no prior formatting to preserve.
 */
export function insertHeadingStatus(
  tr: Transaction,
  headingPos: number,
  headingNode: PMNode,
  label: string,
): void {
  // Use replaceWith rather than insertText: insertText inherits the marks
  // active at the insertion position (e.g. italic from the preceding ID text),
  // while replaceWith uses the marks of the supplied content node — none here.
  const { schema } = tr.doc.type;
  const insertAt = headingPos + 1 + headingNode.textContent.length;
  tr.replaceWith(insertAt, insertAt, schema.text(" [" + label + "]"));
}
