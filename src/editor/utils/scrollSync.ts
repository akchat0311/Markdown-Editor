/**
 * Pure logic for split-view scroll synchronization (Phase 1: heading-anchor
 * only, no interpolation — see docs/split-view-scroll-sync-design.md).
 *
 * Deliberately DOM-free so it's unit-testable without a real layout engine
 * (jsdom cannot lay out content — coordsAtPos/getBoundingClientRect are
 * meaningless there). All pixel/coordinate reads live in useScrollSync.ts;
 * this file only does array/arithmetic work on numbers handed to it.
 */

export type PaneId = "rich" | "source";

/**
 * One heading, paired by ORDINAL position (n-th heading in the rich doc ==
 * n-th heading line in the source) rather than by text match — the two
 * panes are always views of the same currently-loaded document, so heading
 * count/order match whenever both are in a settled (non-mid-edit) state.
 */
export interface HeadingAnchor {
  index: number;
  /** Absolute ProseMirror position of the heading in the rich doc. */
  pmPos: number;
  /** 0-based line number of the heading in the raw markdown source. */
  sourceLine: number;
}

/**
 * ATX heading lines, including the one-level-into-blockquote/callout case
 * (`> # Heading`) that deriveOutline.ts also treats as a heading — this
 * keeps ordinal pairing valid against deriveOutline's richHeadings list.
 * CommonMark allows up to 3 leading spaces before the `#` run. The two
 * alternatives (not a single pattern with two independent `{0,3}` groups)
 * are deliberate: independent groups would let their space budgets stack to
 * 6 total when no `>` is present, wrongly matching a 4-space-indented code
 * block as a heading.
 */
const ATX_HEADING_LINE = /^(?: {0,3}>\s? {0,3}#{1,6}(?:\s|$)| {0,3}#{1,6}(?:\s|$))/;

/** Returns the 0-based line numbers of every heading line in `markdown`. */
export function scanSourceHeadingLines(markdown: string): number[] {
  const lines = markdown.split("\n");
  const result: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (ATX_HEADING_LINE.test(lines[i])) result.push(i);
  }
  return result;
}

/**
 * Pairs rich-doc heading positions with source heading lines by ordinal
 * index. If the two lists have different lengths (a heading was just
 * typed/deleted and the debounced source↔rich resync hasn't landed yet),
 * only the common prefix is paired — trailing unmatched headings on either
 * side are dropped for this cycle rather than mispaired.
 */
export function buildHeadingAnchors(
  richPmPositions: number[],
  sourceHeadingLines: number[],
): HeadingAnchor[] {
  const count = Math.min(richPmPositions.length, sourceHeadingLines.length);
  const anchors: HeadingAnchor[] = [];
  for (let i = 0; i < count; i++) {
    anchors.push({ index: i, pmPos: richPmPositions[i], sourceLine: sourceHeadingLines[i] });
  }
  return anchors;
}

/**
 * Given each anchor's pixel Y position in the MASTER pane (ascending, one
 * per anchor, same order as the anchors array) and the master pane's
 * current scroll position, returns the index of the last anchor at or
 * above `masterY` — i.e. "which heading section is at/above the top of the
 * master's viewport." Returns -1 if `masterY` is above the first anchor
 * (scrolled above the first heading).
 */
export function findActiveAnchorIndex(anchorMasterYs: number[], masterY: number): number {
  let active = -1;
  for (let i = 0; i < anchorMasterYs.length; i++) {
    if (anchorMasterYs[i] <= masterY) active = i;
    else break;
  }
  return active;
}

/** Below this pixel delta, the follower is already close enough — do nothing (avoids jitter). */
export const SCROLL_SYNC_TOLERANCE_PX = 20;

/**
 * Returns the follower's next scrollTop, or null if it's already within
 * `tolerancePx` of the target (no correction needed).
 */
export function computeFollowerScrollTarget(
  currentFollowerScrollTop: number,
  targetFollowerY: number,
  tolerancePx: number = SCROLL_SYNC_TOLERANCE_PX,
): number | null {
  const clamped = Math.max(0, targetFollowerY);
  if (Math.abs(clamped - currentFollowerScrollTop) < tolerancePx) return null;
  return clamped;
}
