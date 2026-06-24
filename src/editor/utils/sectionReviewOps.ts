import type { Transaction } from "@tiptap/pm/state";

// Matches a heading that leads with a dotted-number prefix, e.g. "2.1 CAN Interface".
const SECTION_NUMBER_RE = /^(\d+(?:\.\d+)*)\s+/;
const SECTION_ID_PREFIX = "section:";

/** Extracts the leading dotted-number from a heading's text content. Returns null if none. */
export function extractSectionNumber(label: string): string | null {
  const m = label.match(SECTION_NUMBER_RE);
  return m ? m[1] : null;
}

/** Converts a dotted section number to its review target key ("section:2.1"). */
export function sectionReviewId(sectionNumber: string): string {
  return SECTION_ID_PREFIX + sectionNumber;
}

/** Extracts the dotted section number from a review target ID. Returns null for non-section IDs. */
export function sectionNumberFromReviewId(id: string): string | null {
  if (!id.startsWith(SECTION_ID_PREFIX)) return null;
  return id.slice(SECTION_ID_PREFIX.length);
}

/** True when `id` identifies a section review target (has the "section:" prefix). */
export function isSectionReviewTarget(id: string): boolean {
  return id.startsWith(SECTION_ID_PREFIX);
}

/** True when `id` identifies a requirement review target (no "section:" prefix). */
export function isRequirementReviewTarget(id: string): boolean {
  return !id.startsWith(SECTION_ID_PREFIX);
}

/** Canonical type discriminator for all review target IDs. */
export function getReviewTargetType(id: string): "requirement" | "section" {
  return id.startsWith(SECTION_ID_PREFIX) ? "section" : "requirement";
}

/**
 * Replaces the leading section number in a heading.
 * Used to revert a duplicate section-number rename without touching the rest of the heading.
 *
 * headingPos — absolute PM position of the heading node.
 * currentNum — the number currently in the heading (to overwrite).
 * restoreNum — the original number to put back.
 */
export function rewriteSectionNumber(
  tr: Transaction,
  headingPos: number,
  currentNum: string,
  restoreNum: string,
): void {
  const { schema } = tr.doc.type;
  tr.replaceWith(headingPos + 1, headingPos + 1 + currentNum.length, schema.text(restoreNum));
}
