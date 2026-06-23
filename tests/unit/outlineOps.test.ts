import { describe, it, expect } from "vitest";
import type { JSONContent } from "@tiptap/core";
import {
  getNodeSectionRange,
  getSectionRange,
  moveSectionBefore,
  moveSectionAfter,
  isInsideSection,
  normalizeSelectedRanges,
} from "@/editor/utils/outlineOps";
import type { OutlineNode } from "@/types/outline";

// ── Helpers ───────────────────────────────────────────────────────────────────

function h(level: number, text = ""): JSONContent {
  return { type: "heading", attrs: { level }, content: [{ type: "text", text }] };
}

function p(text = "body"): JSONContent {
  return { type: "paragraph", content: [{ type: "text", text }] };
}

function bq(headingLevel: number, text = ""): JSONContent {
  return {
    type: "blockquote",
    content: [{ type: "heading", attrs: { level: headingLevel }, content: [{ type: "text", text }] }],
  };
}

function node(index: number, level: number, label = "", readonly?: true): OutlineNode {
  return { type: "heading", index, level, label, key: `${level}:${label}`, pmPos: 0, children: [], readonly };
}

// ── getNodeSectionRange ───────────────────────────────────────────────────────

describe("getNodeSectionRange", () => {
  describe("regular top-level heading (delegates to scan logic)", () => {
    it("section extends to end when no sibling heading follows", () => {
      const content = [h(2, "Braking"), p(), p()];
      expect(getNodeSectionRange(content, 0, 2)).toEqual([0, 3]);
    });

    it("stops at a sibling heading of the same level", () => {
      const content = [h(2, "Braking"), p(), h(2, "Powertrain"), p()];
      expect(getNodeSectionRange(content, 0, 2)).toEqual([0, 2]);
    });

    it("stops at a parent heading (lower level number)", () => {
      const content = [h(1, "System"), h(2, "Braking"), p(), h(1, "Other")];
      expect(getNodeSectionRange(content, 1, 2)).toEqual([1, 3]);
    });

    it("does NOT stop at a child heading (higher level number)", () => {
      const content = [h(2, "Braking"), h(3, "Sub"), p(), p()];
      expect(getNodeSectionRange(content, 0, 2)).toEqual([0, 4]);
    });
  });

  describe("stops at a blockquote containing a peer-level heading", () => {
    it("blockquoted requirement terminates at the next blockquoted requirement", () => {
      const content = [
        bq(3, "REQ_001"),
        p("body1"),
        bq(3, "REQ_002"),
        p("body2"),
      ];
      expect(getNodeSectionRange(content, 0, 3)).toEqual([0, 2]);
    });

    it("blockquoted requirement terminates at a top-level heading of same level", () => {
      const content = [
        bq(3, "REQ_001"),
        p("body1"),
        h(3, "Section 3"),
        p("body2"),
      ];
      expect(getNodeSectionRange(content, 0, 3)).toEqual([0, 2]);
    });

    it("blockquoted requirement terminates at a parent-level heading", () => {
      const content = [
        bq(3, "REQ_001"),
        p("body1"),
        h(2, "Powertrain"),
        p("body2"),
      ];
      expect(getNodeSectionRange(content, 0, 3)).toEqual([0, 2]);
    });

    it("blockquoted requirement does NOT terminate at a blockquote with a deeper heading", () => {
      const content = [
        bq(2, "REQ_SECTION"),
        p("body"),
        bq(3, "REQ_001"), // deeper level — not a terminator
        p("sub-body"),
      ];
      expect(getNodeSectionRange(content, 0, 2)).toEqual([0, 4]);
    });

    it("blockquoted requirement spans multiple body paragraphs", () => {
      const content = [
        bq(3, "REQ_001"),
        p("shall 1"),
        p("shall 2"),
        p("shall 3"),
        bq(3, "REQ_002"),
      ];
      expect(getNodeSectionRange(content, 0, 3)).toEqual([0, 4]);
    });

    it("last blockquoted requirement extends to end of content", () => {
      const content = [
        bq(3, "REQ_001"),
        p("body1"),
        bq(3, "REQ_002"),
        p("body2"),
        p("body3"),
      ];
      expect(getNodeSectionRange(content, 2, 3)).toEqual([2, 5]);
    });
  });

  describe("regular heading stops at blockquoted peer (mixed document)", () => {
    it("h3 section stops at the following blockquoted h3", () => {
      const content = [
        h(2, "Braking"),
        h(3, "Overview"),
        p("intro"),
        bq(3, "REQ_001"),
        p("req body"),
      ];
      // Overview (level 3) section stops at bq(h3) at index 3
      expect(getNodeSectionRange(content, 1, 3)).toEqual([1, 3]);
    });

    it("parent h2 section encompasses all level-3 children (regular and blockquoted)", () => {
      const content = [
        h(2, "Braking"),
        h(3, "Overview"),
        p(),
        bq(3, "REQ_001"),
        p(),
        bq(3, "REQ_002"),
        p(),
        h(2, "Powertrain"),
      ];
      // h2 at index 0 stops at next h2 at index 7
      expect(getNodeSectionRange(content, 0, 2)).toEqual([0, 7]);
    });
  });

  describe("getSectionRange alias behaves identically", () => {
    it("getSectionRange delegates to getNodeSectionRange", () => {
      const content = [bq(3, "REQ_001"), p(), bq(3, "REQ_002"), p()];
      expect(getSectionRange(content, 0, 3)).toEqual(getNodeSectionRange(content, 0, 3));
    });
  });
});

// ── moveSectionBefore with blockquoted requirements ───────────────────────────

describe("moveSectionBefore (blockquoted requirements)", () => {
  it("moves a blockquoted requirement before another requirement", () => {
    const content = [
      bq(3, "REQ_001"), // index 0
      p("body1"),       // index 1
      bq(3, "REQ_002"), // index 2
      p("body2"),       // index 3
    ];
    // Move REQ_002 before REQ_001
    const result = moveSectionBefore(content, 2, 3, 0);
    expect(result[0]).toEqual(bq(3, "REQ_002"));
    expect(result[1]).toEqual(p("body2"));
    expect(result[2]).toEqual(bq(3, "REQ_001"));
    expect(result[3]).toEqual(p("body1"));
  });

  it("moves a requirement before a section heading", () => {
    const content = [
      h(2, "Braking"),  // index 0
      bq(3, "REQ_001"), // index 1
      p("body"),        // index 2
      h(2, "Powertrain"), // index 3
    ];
    // Move REQ_001 before Braking
    const result = moveSectionBefore(content, 1, 3, 0);
    expect(result[0]).toEqual(bq(3, "REQ_001"));
    expect(result[1]).toEqual(p("body"));
    expect(result[2]).toEqual(h(2, "Braking"));
    expect(result[3]).toEqual(h(2, "Powertrain"));
  });
});

// ── moveSectionAfter with blockquoted requirements ────────────────────────────

describe("moveSectionAfter (blockquoted requirements)", () => {
  it("moves a blockquoted requirement after another requirement", () => {
    const content = [
      bq(3, "REQ_001"), // index 0
      p("body1"),       // index 1
      bq(3, "REQ_002"), // index 2
      p("body2"),       // index 3
    ];
    // Move REQ_001 after REQ_002
    const result = moveSectionAfter(content, 0, 3, 2, 3);
    expect(result[0]).toEqual(bq(3, "REQ_002"));
    expect(result[1]).toEqual(p("body2"));
    expect(result[2]).toEqual(bq(3, "REQ_001"));
    expect(result[3]).toEqual(p("body1"));
  });
});

// ── isInsideSection with blockquoted requirements ─────────────────────────────

describe("isInsideSection (blockquoted requirements)", () => {
  it("body paragraphs are inside a blockquoted requirement's section", () => {
    const content = [
      bq(3, "REQ_001"), // index 0
      p("body1"),       // index 1 — inside REQ_001's section
      p("body2"),       // index 2 — inside REQ_001's section
      bq(3, "REQ_002"), // index 3 — starts new section; NOT inside REQ_001
    ];
    expect(isInsideSection(content, 0, 3, 1)).toBe(true);
    expect(isInsideSection(content, 0, 3, 2)).toBe(true);
    expect(isInsideSection(content, 0, 3, 3)).toBe(false);
  });

  it("another requirement is not inside a sibling requirement's section", () => {
    const content = [bq(3, "REQ_001"), p(), bq(3, "REQ_002"), p()];
    expect(isInsideSection(content, 0, 3, 2)).toBe(false);
  });
});

// ── normalizeSelectedRanges with blockquoted requirements ─────────────────────

describe("normalizeSelectedRanges (blockquoted requirements)", () => {
  it("computes correct ranges for blockquoted requirements", () => {
    const content = [
      bq(3, "REQ_001"), // index 0
      p("body1"),       // index 1
      bq(3, "REQ_002"), // index 2
      p("body2"),       // index 3
    ];
    const nodes = [
      node(0, 3, "REQ_001", true),
      node(2, 3, "REQ_002", true),
    ];
    const ranges = normalizeSelectedRanges(nodes, content);
    expect(ranges).toHaveLength(2);
    expect(ranges[0]).toMatchObject({ from: 0, to: 2 });
    expect(ranges[1]).toMatchObject({ from: 2, to: 4 });
  });

  it("deduplicates a child requirement range inside a parent section range", () => {
    const content = [
      h(2, "Braking"),  // index 0
      bq(3, "REQ_001"), // index 1
      p("body"),        // index 2
      h(2, "Powertrain"), // index 3
    ];
    const nodes = [
      node(0, 2, "Braking"),        // range [0, 3]
      node(1, 3, "REQ_001", true),  // range [1, 3] — contained inside Braking
    ];
    const ranges = normalizeSelectedRanges(nodes, content);
    // REQ_001's range [1,3] is fully contained in Braking's [0,3]; deduplicated
    expect(ranges).toHaveLength(1);
    expect(ranges[0]).toMatchObject({ from: 0, to: 3 });
  });
});
