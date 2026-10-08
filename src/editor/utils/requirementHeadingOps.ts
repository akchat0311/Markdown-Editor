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
import { parseHeadingFields } from "@/editor/utils/headingFields";
import { getRequirementStatuses } from "@/services/requirementStatusService";

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
  // Target the CLASSIFIED status bracket, never simply the last bracket —
  // once a heading carries a variant ("ID [*Draft*] [V2]"), the last
  // bracket is the variant and a blind rewrite would overwrite it (D11).
  const fields = parseHeadingFields(headingNode.textContent, getRequirementStatuses());
  if (!fields.status) return false;
  rewriteBracketAt(tr, headingPos, fields.status.charFrom, fields.status.charTo, newLabel, true);
  return true;
}

/**
 * Replaces the [Variant] bracket of a requirement heading, preserving any
 * inline marks on the previous variant text. Variants are written plain by
 * default (design D10) — no italic is added.
 * Returns false when the heading has no variant bracket.
 */
export function rewriteHeadingVariant(
  tr: Transaction,
  headingPos: number,
  headingNode: PMNode,
  newText: string,
): boolean {
  const fields = parseHeadingFields(headingNode.textContent, getRequirementStatuses());
  if (!fields.variant) return false;
  rewriteBracketAt(tr, headingPos, fields.variant.charFrom, fields.variant.charTo, newText, false);
  return true;
}

/**
 * Shared token rewrite: replaces the bracket group at [charFrom, charTo)
 * with "[newLabel]", carrying over the marks found on the previous inner
 * label text (plus italic when defaultItalic is set and not already there).
 */
function rewriteBracketAt(
  tr: Transaction,
  headingPos: number,
  charFrom: number,
  charTo: number,
  newLabel: string,
  defaultItalic: boolean,
): void {
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
  // Statuses render italic by default ("[*Draft*]" in markdown); preserve any
  // additional marks the previous label carried.
  const italic = schema.marks.italic;
  const labelMarks = [...innerMarks];
  if (defaultItalic && italic && !labelMarks.some((m) => m.type === italic)) {
    labelMarks.push(italic.create());
  }
  const nodes: PMNode[] = [
    schema.text("["),
    schema.text(newLabel, labelMarks),
    schema.text("]"),
  ];

  tr.replaceWith(absFrom, absTo, nodes);
}

/**
 * Inserts a new [Status] bracket into a heading that currently has none.
 * The label is italic by default ("[*Draft*]" in markdown); the brackets
 * stay plain. When the heading carries a variant bracket the status is
 * inserted BEFORE it (canonical order "[Status] [Variant]", D10); with no
 * variant it is appended at the end. (A heading with a variant but no
 * status cannot parse — a single bracket is always the status — but the
 * ordering rule keeps the op safe under any future grammar change.)
 */
export function insertHeadingStatus(
  tr: Transaction,
  headingPos: number,
  headingNode: PMNode,
  label: string,
  variant?: string,
): void {
  // Use replaceWith rather than insertText: insertText inherits the marks
  // active at the insertion position (e.g. italic from the preceding ID text),
  // while replaceWith uses the marks of the supplied content node — none here.
  const { schema } = tr.doc.type;
  const italic = schema.marks.italic;
  const labelMarks = italic ? [italic.create()] : [];
  const text = headingNode.textContent;
  const fields = parseHeadingFields(text, getRequirementStatuses());
  if (fields.variant && !fields.status) {
    const at = headingPos + 1 + fields.variant.charFrom;
    tr.replaceWith(at, at, [
      schema.text("["),
      schema.text(label, labelMarks),
      schema.text("] "),
    ]);
    return;
  }
  const insertAt = headingPos + 1 + text.length;
  const nodes = [
    schema.text(" ["),
    schema.text(label, labelMarks),
    schema.text("]"),
  ];
  // Optional inherited variant, appended plain in the same token insert
  // (canonical order [Status] [Variant]; one undo step).
  if (variant) {
    nodes.push(schema.text(" ["), schema.text(variant), schema.text("]"));
  }
  tr.replaceWith(insertAt, insertAt, nodes);
}

/**
 * Appends a new [Variant] bracket at the end of the heading (canonical
 * order puts the variant last — D10). Written plain, no italic.
 */
export function insertHeadingVariant(
  tr: Transaction,
  headingPos: number,
  headingNode: PMNode,
  text: string,
): void {
  const { schema } = tr.doc.type;
  const insertAt = headingPos + 1 + headingNode.textContent.length;
  tr.replaceWith(insertAt, insertAt, [
    schema.text(" ["),
    schema.text(text),
    schema.text("]"),
  ]);
}

/**
 * Deletes the [Variant] bracket (plus the whitespace before it) from a
 * heading. Returns false when there is no variant bracket.
 */
export function removeHeadingVariant(
  tr: Transaction,
  headingPos: number,
  headingNode: PMNode,
): boolean {
  const content = headingNode.textContent;
  const fields = parseHeadingFields(content, getRequirementStatuses());
  if (!fields.variant) return false;
  let charFrom = fields.variant.charFrom;
  while (charFrom > 0 && /\s/.test(content[charFrom - 1])) charFrom--;
  tr.delete(headingPos + 1 + charFrom, headingPos + 1 + fields.variant.charTo);
  return true;
}
