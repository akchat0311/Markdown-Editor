import { describe, it, expect } from "vitest";
import {
  scanSourceHeadingLines,
  buildHeadingAnchors,
  findActiveAnchorIndex,
  computeFollowerScrollTarget,
  SCROLL_SYNC_TOLERANCE_PX,
} from "@/editor/utils/scrollSync";

describe("scanSourceHeadingLines", () => {
  it("finds ATX headings of every level", () => {
    const md = "# One\ntext\n## Two\n###### Six\nnot a heading";
    expect(scanSourceHeadingLines(md)).toEqual([0, 2, 3]);
  });

  it("requires a space (or end of line) after the # run", () => {
    const md = "#NoSpace\n# Real\n#";
    expect(scanSourceHeadingLines(md)).toEqual([1, 2]); // "#" alone is a valid empty heading
  });

  it("allows up to 3 leading spaces (CommonMark)", () => {
    const md = "   # indented\n    # too indented (4 spaces, code block)";
    expect(scanSourceHeadingLines(md)).toEqual([0]);
  });

  it("matches headings nested one level inside a blockquote/callout", () => {
    const md = "> # Quoted heading\n> body text\nplain paragraph";
    expect(scanSourceHeadingLines(md)).toEqual([0]);
  });

  it("ignores more than 6 #s", () => {
    const md = "####### seven";
    expect(scanSourceHeadingLines(md)).toEqual([]);
  });

  it("returns an empty array for a headingless document", () => {
    expect(scanSourceHeadingLines("just some\nplain text")).toEqual([]);
  });
});

describe("buildHeadingAnchors", () => {
  it("pairs by ordinal index when counts match", () => {
    const anchors = buildHeadingAnchors([10, 50, 90], [0, 5, 12]);
    expect(anchors).toEqual([
      { index: 0, pmPos: 10, sourceLine: 0 },
      { index: 1, pmPos: 50, sourceLine: 5 },
      { index: 2, pmPos: 90, sourceLine: 12 },
    ]);
  });

  it("pairs only the common prefix when counts mismatch (mid-edit)", () => {
    expect(buildHeadingAnchors([10, 50, 90], [0, 5])).toEqual([
      { index: 0, pmPos: 10, sourceLine: 0 },
      { index: 1, pmPos: 50, sourceLine: 5 },
    ]);
    expect(buildHeadingAnchors([10], [0, 5, 12])).toEqual([
      { index: 0, pmPos: 10, sourceLine: 0 },
    ]);
  });

  it("returns an empty array when either side has no headings", () => {
    expect(buildHeadingAnchors([], [0, 5])).toEqual([]);
    expect(buildHeadingAnchors([10, 50], [])).toEqual([]);
  });
});

describe("findActiveAnchorIndex", () => {
  const ys = [0, 100, 250, 500];

  it("returns the last anchor at or before masterY", () => {
    expect(findActiveAnchorIndex(ys, 0)).toBe(0);
    expect(findActiveAnchorIndex(ys, 99)).toBe(0);
    expect(findActiveAnchorIndex(ys, 100)).toBe(1);
    expect(findActiveAnchorIndex(ys, 499)).toBe(2);
    expect(findActiveAnchorIndex(ys, 500)).toBe(3);
    expect(findActiveAnchorIndex(ys, 10000)).toBe(3); // past the last heading — pins to it
  });

  it("returns -1 when masterY is above the first anchor", () => {
    expect(findActiveAnchorIndex(ys, -1)).toBe(-1);
  });

  it("returns -1 for an empty anchor list", () => {
    expect(findActiveAnchorIndex([], 500)).toBe(-1);
  });
});

describe("computeFollowerScrollTarget", () => {
  it("returns the clamped target when the delta exceeds the tolerance", () => {
    expect(computeFollowerScrollTarget(0, 200)).toBe(200);
    expect(computeFollowerScrollTarget(500, 200)).toBe(200);
  });

  it("returns null when already within tolerance (avoids jitter)", () => {
    expect(computeFollowerScrollTarget(200, 200)).toBeNull();
    expect(computeFollowerScrollTarget(200, 200 + SCROLL_SYNC_TOLERANCE_PX - 1)).toBeNull();
  });

  it("treats exactly-tolerance as still needing correction (strict <)", () => {
    expect(computeFollowerScrollTarget(200, 200 + SCROLL_SYNC_TOLERANCE_PX)).toBe(
      200 + SCROLL_SYNC_TOLERANCE_PX,
    );
  });

  it("clamps negative targets to 0", () => {
    expect(computeFollowerScrollTarget(50, -30)).toBe(0);
  });

  it("respects a custom tolerance", () => {
    expect(computeFollowerScrollTarget(100, 105, 10)).toBeNull();
    expect(computeFollowerScrollTarget(100, 115, 10)).toBe(115);
  });
});
