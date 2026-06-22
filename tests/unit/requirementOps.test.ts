import { describe, it, expect } from "vitest";
import {
  derivePattern,
  formatId,
  analyzeRequirements,
  nextAvailableId,
  insertRequirementAfter,
  renumberRequirements,
  reassignRequirementId,
  computeRenumberReplacements,
  type RequirementEntry,
} from "@/editor/utils/requirementOps";
import type { OutlineNode } from "@/types/outline";
import type { JSONContent } from "@tiptap/core";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeNode(label: string, index: number, level = 2): OutlineNode {
  return {
    key: `heading:${index}`,
    type: "heading",
    level,
    label,
    pmPos: index * 10,
    index,
    children: [],
  };
}

function makeContent(nodes: { level: number; text: string }[]): JSONContent[] {
  return nodes.map((n) => ({
    type: "heading",
    attrs: { level: n.level },
    content: [{ type: "text", text: n.text }],
  }));
}

// ── derivePattern ─────────────────────────────────────────────────────────────

describe("derivePattern", () => {
  it("derives 3-digit TRANS_TOS style", () => {
    expect(derivePattern("TRANS_TOS_001")).toEqual({
      prefix: "TRANS_TOS_",
      digits: 3,
    });
  });

  it("derives 4-digit SYS_REQ style", () => {
    expect(derivePattern("SYS_REQ_0001")).toEqual({
      prefix: "SYS_REQ_",
      digits: 4,
    });
  });

  it("derives single-digit compact style", () => {
    expect(derivePattern("UC1")).toEqual({ prefix: "UC", digits: 1 });
  });

  it("derives hyphenated style", () => {
    expect(derivePattern("FR-001")).toEqual({ prefix: "FR-", digits: 3 });
  });

  it("handles all-digit example (empty prefix)", () => {
    expect(derivePattern("001")).toEqual({ prefix: "", digits: 3 });
  });

  it("derives 1-digit suffix", () => {
    expect(derivePattern("A1")).toEqual({ prefix: "A", digits: 1 });
  });

  it("returns null when example has no trailing digits", () => {
    expect(derivePattern("REQ_ABC")).toBeNull();
    expect(derivePattern("TEST")).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(derivePattern("")).toBeNull();
  });

  it("returns null for string ending with letter after digits", () => {
    expect(derivePattern("001A")).toBeNull();
  });
});

// ── formatId ──────────────────────────────────────────────────────────────────

describe("formatId", () => {
  it("zero-pads to specified width", () => {
    expect(formatId(1, "REQ-", 3)).toBe("REQ-001");
    expect(formatId(42, "TRANS_TOS_", 3)).toBe("TRANS_TOS_042");
  });

  it("does not truncate numbers exceeding digit width", () => {
    expect(formatId(1000, "REQ-", 3)).toBe("REQ-1000");
  });

  it("handles empty prefix", () => {
    expect(formatId(5, "", 2)).toBe("05");
  });

  it("handles exact-width numbers", () => {
    expect(formatId(999, "X-", 3)).toBe("X-999");
  });
});

// ── analyzeRequirements — returns null for invalid pattern ────────────────────

describe("analyzeRequirements — invalid pattern", () => {
  it("returns null when example has no trailing digits", () => {
    const flat = [makeNode("REQ_001", 0)];
    expect(analyzeRequirements(flat, [], "ABC")).toBeNull();
  });

  it("returns null for empty example", () => {
    expect(analyzeRequirements([], [], "")).toBeNull();
  });
});

// ── analyzeRequirements — detection ──────────────────────────────────────────

describe("analyzeRequirements — detection", () => {
  it("detects matching headings by prefix", () => {
    const flat = [
      makeNode("REQ_001 - Login", 0),
      makeNode("REQ_002 - Logout", 1),
      makeNode("Unrelated section", 2, 1),
    ];
    const content = makeContent([
      { level: 2, text: "REQ_001 - Login" },
      { level: 2, text: "REQ_002 - Logout" },
      { level: 1, text: "Unrelated section" },
    ]);
    const result = analyzeRequirements(flat, content, "REQ_001");
    expect(result).not.toBeNull();
    expect(result!.requirements).toHaveLength(2);
    expect(result!.requirements[0].id).toBe("REQ_001");
    expect(result!.requirements[1].id).toBe("REQ_002");
  });

  it("returns empty requirements when nothing matches", () => {
    const flat = [makeNode("Design considerations", 0, 1)];
    const content = makeContent([{ level: 1, text: "Design considerations" }]);
    const result = analyzeRequirements(flat, content, "REQ_001");
    expect(result!.requirements).toHaveLength(0);
    expect(result!.duplicates.size).toBe(0);
    expect(result!.missing).toHaveLength(0);
  });

  it("stores exact reconstructed id string", () => {
    const flat = [makeNode("TRANS_TOS_001 - Auth", 0)];
    const content = makeContent([{ level: 2, text: "TRANS_TOS_001 - Auth" }]);
    const result = analyzeRequirements(flat, content, "TRANS_TOS_001");
    expect(result!.requirements[0].id).toBe("TRANS_TOS_001");
    expect(result!.requirements[0].num).toBe(1);
  });
});

// ── analyzeRequirements — duplicate detection ─────────────────────────────────

describe("analyzeRequirements — duplicates", () => {
  it("detects exact-string duplicate IDs", () => {
    const flat = [
      makeNode("REQ_001 - Login", 0),
      makeNode("REQ_002 - Logout", 1),
      makeNode("REQ_001 - Duplicate", 2), // exact duplicate
    ];
    const content = makeContent([
      { level: 2, text: "REQ_001 - Login" },
      { level: 2, text: "REQ_002 - Logout" },
      { level: 2, text: "REQ_001 - Duplicate" },
    ]);
    const result = analyzeRequirements(flat, content, "REQ_001");
    expect(result!.duplicates.size).toBe(1);
    expect(result!.duplicates.has("REQ_001")).toBe(true);
    expect(result!.duplicates.get("REQ_001")).toHaveLength(2);
  });

  it("does NOT flag different-format IDs as duplicates", () => {
    // TRANS_TOS_01 vs TRANS_TOS_001 — same numeric value, different strings
    const flat = [
      makeNode("TRANS_TOS_01 - Login", 0),
      makeNode("TRANS_TOS_001 - Login", 1),
    ];
    const content = makeContent([
      { level: 2, text: "TRANS_TOS_01 - Login" },
      { level: 2, text: "TRANS_TOS_001 - Login" },
    ]);
    const result = analyzeRequirements(flat, content, "TRANS_TOS_001");
    expect(result!.duplicates.size).toBe(0);
  });

  it("returns no duplicates when all IDs are unique", () => {
    const flat = [
      makeNode("REQ_001", 0),
      makeNode("REQ_002", 1),
      makeNode("REQ_003", 2),
    ];
    const content = makeContent([
      { level: 2, text: "REQ_001" },
      { level: 2, text: "REQ_002" },
      { level: 2, text: "REQ_003" },
    ]);
    const result = analyzeRequirements(flat, content, "REQ_001");
    expect(result!.duplicates.size).toBe(0);
  });

  it("reports all occurrences of a triplicate", () => {
    const flat = [
      makeNode("REQ_001 - A", 0),
      makeNode("REQ_001 - B", 1),
      makeNode("REQ_001 - C", 2),
    ];
    const content = makeContent([
      { level: 2, text: "REQ_001 - A" },
      { level: 2, text: "REQ_001 - B" },
      { level: 2, text: "REQ_001 - C" },
    ]);
    const result = analyzeRequirements(flat, content, "REQ_001");
    expect(result!.duplicates.get("REQ_001")).toHaveLength(3);
  });
});

// ── analyzeRequirements — missing ID detection ────────────────────────────────

describe("analyzeRequirements — missing IDs", () => {
  it("detects a single gap in the middle", () => {
    const flat = [
      makeNode("REQ_001", 0),
      makeNode("REQ_002", 1),
      makeNode("REQ_004", 2), // REQ_003 is missing
    ];
    const content = makeContent([
      { level: 2, text: "REQ_001" },
      { level: 2, text: "REQ_002" },
      { level: 2, text: "REQ_004" },
    ]);
    const result = analyzeRequirements(flat, content, "REQ_001");
    expect(result!.missing).toEqual(["REQ_003"]);
  });

  it("detects multiple consecutive gaps", () => {
    const flat = [makeNode("REQ_001", 0), makeNode("REQ_005", 1)];
    const content = makeContent([
      { level: 2, text: "REQ_001" },
      { level: 2, text: "REQ_005" },
    ]);
    const result = analyzeRequirements(flat, content, "REQ_001");
    expect(result!.missing).toEqual(["REQ_002", "REQ_003", "REQ_004"]);
  });

  it("does NOT report IDs above max as missing", () => {
    const flat = [makeNode("REQ_001", 0), makeNode("REQ_003", 1)];
    const content = makeContent([
      { level: 2, text: "REQ_001" },
      { level: 2, text: "REQ_003" },
    ]);
    const result = analyzeRequirements(flat, content, "REQ_001");
    // Only REQ_002 is between min=1 and max=3
    expect(result!.missing).toEqual(["REQ_002"]);
    expect(result!.missing).not.toContain("REQ_004");
  });

  it("returns no missing for sequential IDs", () => {
    const flat = [
      makeNode("REQ_001", 0),
      makeNode("REQ_002", 1),
      makeNode("REQ_003", 2),
    ];
    const content = makeContent([
      { level: 2, text: "REQ_001" },
      { level: 2, text: "REQ_002" },
      { level: 2, text: "REQ_003" },
    ]);
    const result = analyzeRequirements(flat, content, "REQ_001");
    expect(result!.missing).toHaveLength(0);
  });

  it("returns no missing for a single requirement", () => {
    const flat = [makeNode("REQ_001", 0)];
    const content = makeContent([{ level: 2, text: "REQ_001" }]);
    const result = analyzeRequirements(flat, content, "REQ_001");
    expect(result!.missing).toHaveLength(0);
  });

  it("formats missing IDs using the derived digit width", () => {
    const flat = [makeNode("TRANS_TOS_001", 0), makeNode("TRANS_TOS_003", 1)];
    const content = makeContent([
      { level: 2, text: "TRANS_TOS_001" },
      { level: 2, text: "TRANS_TOS_003" },
    ]);
    const result = analyzeRequirements(flat, content, "TRANS_TOS_001");
    // digits=3, so gap is formatted as TRANS_TOS_002
    expect(result!.missing).toEqual(["TRANS_TOS_002"]);
  });
});

// ── analyzeRequirements — countsBySection ─────────────────────────────────────

describe("analyzeRequirements — countsBySection", () => {
  it("counts requirements within an H1 section", () => {
    const flat = [
      makeNode("Authentication", 0, 1),
      makeNode("REQ_001 - Login", 1, 2),
      makeNode("REQ_002 - Logout", 2, 2),
      makeNode("REQ_003 - Session", 3, 2),
    ];
    const content = makeContent([
      { level: 1, text: "Authentication" },
      { level: 2, text: "REQ_001 - Login" },
      { level: 2, text: "REQ_002 - Logout" },
      { level: 2, text: "REQ_003 - Session" },
    ]);
    const result = analyzeRequirements(flat, content, "REQ_001");
    // H1 section spans whole doc → 3 reqs
    expect(result!.countsBySection.get("heading:0")).toBe(3);
    // Each H2 section ends at the next H2 → 1 req each (itself only)
    expect(result!.countsBySection.get("heading:1")).toBe(1);
    expect(result!.countsBySection.get("heading:2")).toBe(1);
    expect(result!.countsBySection.get("heading:3")).toBe(1);
  });

  it("reports 0 for sections with no requirements", () => {
    const flat = [
      makeNode("Introduction", 0, 1),
      makeNode("REQ_001 - Login", 1, 2),
      makeNode("Appendix", 2, 1),
    ];
    const content = makeContent([
      { level: 1, text: "Introduction" },
      { level: 2, text: "REQ_001 - Login" },
      { level: 1, text: "Appendix" },
    ]);
    const result = analyzeRequirements(flat, content, "REQ_001");
    expect(result!.countsBySection.get("heading:2")).toBe(0);
  });

  it("handles multiple top-level sections independently", () => {
    const flat = [
      makeNode("Auth", 0, 1),
      makeNode("REQ_001", 1, 2),
      makeNode("REQ_002", 2, 2),
      makeNode("Reporting", 3, 1),
      makeNode("REQ_003", 4, 2),
    ];
    const content = makeContent([
      { level: 1, text: "Auth" },
      { level: 2, text: "REQ_001" },
      { level: 2, text: "REQ_002" },
      { level: 1, text: "Reporting" },
      { level: 2, text: "REQ_003" },
    ]);
    const result = analyzeRequirements(flat, content, "REQ_001");
    expect(result!.countsBySection.get("heading:0")).toBe(2);
    expect(result!.countsBySection.get("heading:3")).toBe(1);
  });
});

// ── nextAvailableId ───────────────────────────────────────────────────────────

describe("nextAvailableId", () => {
  function makeEntry(num: number, prefix = "REQ_", digits = 3): RequirementEntry {
    const id = prefix + String(num).padStart(digits, "0");
    return { node: makeNode(id, num - 1), id, num };
  }

  it("returns 001 when requirements is empty", () => {
    expect(nextAvailableId([], "REQ_", 3)).toBe("REQ_001");
  });

  it("returns max + 1 with zero-padding", () => {
    const reqs = [makeEntry(1), makeEntry(2), makeEntry(3)];
    expect(nextAvailableId(reqs, "REQ_", 3)).toBe("REQ_004");
  });

  it("uses max, not count, for non-sequential IDs", () => {
    // IDs 1, 3 — max is 3, not count=2
    const reqs = [makeEntry(1), makeEntry(3)];
    expect(nextAvailableId(reqs, "REQ_", 3)).toBe("REQ_004");
  });

  it("applies prefix and digit width", () => {
    const reqs = [makeEntry(5, "TRANS_TOS_", 3)];
    expect(nextAvailableId(reqs, "TRANS_TOS_", 3)).toBe("TRANS_TOS_006");
  });
});

// ── insertRequirementAfter ────────────────────────────────────────────────────

describe("insertRequirementAfter", () => {
  it("inserts immediately after a leaf heading (no sub-content)", () => {
    const content = makeContent([
      { level: 2, text: "REQ_001" },
      { level: 2, text: "REQ_002" },
    ]);
    const result = insertRequirementAfter(content, 0, 2, "REQ_003");
    expect(result).toHaveLength(3);
    // REQ_003 appears between REQ_001 and REQ_002
    expect(result[0].content![0].text).toBe("REQ_001");
    expect(result[1].content![0].text).toBe("REQ_003");
    expect(result[2].content![0].text).toBe("REQ_002");
  });

  it("inserts after all sub-content belonging to the section", () => {
    const content: import("@tiptap/core").JSONContent[] = [
      { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "Auth" }] },
      { type: "paragraph", content: [{ type: "text", text: "intro" }] },
      { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "REQ_001" }] },
      { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "Reporting" }] },
    ];
    // Insert after H1 "Auth" (section = [0, 3)) → insert at index 3
    const result = insertRequirementAfter(content, 0, 1, "NEW");
    expect(result).toHaveLength(5);
    expect(result[3].content![0].text).toBe("NEW");
    expect(result[4].content![0].text).toBe("Reporting");
  });

  it("produces a heading with the correct level", () => {
    const content = makeContent([{ level: 2, text: "REQ_001" }]);
    const result = insertRequirementAfter(content, 0, 2, "REQ_002");
    expect(result[1].type).toBe("heading");
    expect(result[1].attrs!.level).toBe(2);
    expect(result[1].content![0].text).toBe("REQ_002");
  });

  it("does not mutate the input content array", () => {
    const content = makeContent([{ level: 2, text: "REQ_001" }]);
    const original = [...content];
    insertRequirementAfter(content, 0, 2, "REQ_002");
    expect(content).toEqual(original);
  });
});

// ── renumberRequirements ──────────────────────────────────────────────────────

describe("renumberRequirements", () => {
  it("renumbers sequentially starting from 001", () => {
    const flat = [
      makeNode("REQ_003", 0, 2),
      makeNode("REQ_001", 1, 2),
      makeNode("REQ_002", 2, 2),
    ];
    const content = makeContent([
      { level: 2, text: "REQ_003" },
      { level: 2, text: "REQ_001" },
      { level: 2, text: "REQ_002" },
    ]);
    const entries = flat.map((node, i): RequirementEntry => ({
      node,
      id: node.label,
      num: i + 1,
    }));
    const result = renumberRequirements(content, entries, "REQ_", 3);
    expect(result[0].content![0].text).toBe("REQ_001");
    expect(result[1].content![0].text).toBe("REQ_002");
    expect(result[2].content![0].text).toBe("REQ_003");
  });

  it("preserves title suffix after the ID", () => {
    const node = makeNode("TRANS_TOS_003 - Auth flow", 0, 2);
    const content = makeContent([{ level: 2, text: "TRANS_TOS_003 - Auth flow" }]);
    const entries: RequirementEntry[] = [{ node, id: "TRANS_TOS_003", num: 3 }];
    const result = renumberRequirements(content, entries, "TRANS_TOS_", 3);
    expect(result[0].content![0].text).toBe("TRANS_TOS_001 - Auth flow");
  });

  it("normalizes digit width to the configured digits", () => {
    // Heading has 2-digit ID, configured pattern has 3 digits
    const node = makeNode("TRANS_TOS_01 - Login", 0, 2);
    const content = makeContent([{ level: 2, text: "TRANS_TOS_01 - Login" }]);
    const entries: RequirementEntry[] = [{ node, id: "TRANS_TOS_01", num: 1 }];
    const result = renumberRequirements(content, entries, "TRANS_TOS_", 3);
    expect(result[0].content![0].text).toBe("TRANS_TOS_001 - Login");
  });

  it("does not mutate the input content array", () => {
    const node = makeNode("REQ_001", 0, 2);
    const content = makeContent([{ level: 2, text: "REQ_001" }]);
    const original = content[0].content![0].text;
    const entries: RequirementEntry[] = [{ node, id: "REQ_001", num: 1 }];
    renumberRequirements(content, entries, "REQ_", 3);
    expect(content[0].content![0].text).toBe(original);
  });

  it("leaves non-requirement blocks in the content untouched", () => {
    const docContent: import("@tiptap/core").JSONContent[] = [
      { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "Intro" }] },
      { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "REQ_003" }] },
    ];
    const node = makeNode("REQ_003", 1, 2);
    const entries: RequirementEntry[] = [{ node, id: "REQ_003", num: 3 }];
    const result = renumberRequirements(docContent, entries, "REQ_", 3);
    // H1 "Intro" is unchanged
    expect(result[0].content![0].text).toBe("Intro");
    // H2 is renumbered
    expect(result[1].content![0].text).toBe("REQ_001");
  });
});

// ── reassignRequirementId ─────────────────────────────────────────────────────

// ── computeRenumberReplacements ───────────────────────────────────────────────
// Pure function: computes (pmPos, newLabel) pairs for a PM-transaction renumber.
// Works for both top-level and blockquoted headings because it uses pmPos, not
// content-array index.

describe("computeRenumberReplacements", () => {
  it("assigns sequential labels starting at 001, in document order", () => {
    const reqs: RequirementEntry[] = [
      { node: { ...makeNode("REQ_003", 0), pmPos: 0  }, id: "REQ_003", num: 3 },
      { node: { ...makeNode("REQ_001", 1), pmPos: 20 }, id: "REQ_001", num: 1 },
      { node: { ...makeNode("REQ_002", 2), pmPos: 40 }, id: "REQ_002", num: 2 },
    ];
    const result = computeRenumberReplacements(reqs, "REQ_", 3);
    expect(result[0].newLabel).toBe("REQ_001");
    expect(result[1].newLabel).toBe("REQ_002");
    expect(result[2].newLabel).toBe("REQ_003");
  });

  it("preserves title suffix after the ID", () => {
    const reqs: RequirementEntry[] = [
      { node: { ...makeNode("REQ_003 - Auth flow", 0), pmPos: 0 }, id: "REQ_003", num: 3 },
    ];
    const result = computeRenumberReplacements(reqs, "REQ_", 3);
    expect(result[0].newLabel).toBe("REQ_001 - Auth flow");
  });

  it("preserves status bracket suffix", () => {
    const reqs: RequirementEntry[] = [
      { node: { ...makeNode("REQ_002 [Draft]", 0), pmPos: 5 }, id: "REQ_002", num: 2 },
      { node: { ...makeNode("REQ_004 [Approved]", 1), pmPos: 25 }, id: "REQ_004", num: 4 },
    ];
    const result = computeRenumberReplacements(reqs, "REQ_", 3);
    expect(result[0].newLabel).toBe("REQ_001 [Draft]");
    expect(result[1].newLabel).toBe("REQ_002 [Approved]");
  });

  it("carries the correct pmPos for each replacement", () => {
    const reqs: RequirementEntry[] = [
      { node: { ...makeNode("REQ_001", 0), pmPos: 10 }, id: "REQ_001", num: 1 },
      { node: { ...makeNode("REQ_002", 1), pmPos: 30 }, id: "REQ_002", num: 2 },
    ];
    const result = computeRenumberReplacements(reqs, "REQ_", 3);
    expect(result[0].pmPos).toBe(10);
    expect(result[1].pmPos).toBe(30);
  });

  it("treats top-level and blockquoted headings identically (uses pmPos only)", () => {
    const topNode = { ...makeNode("REQ_002 [Draft]", 0), pmPos: 10 };
    const quotedNode = { ...makeNode("REQ_003 [Review]", 1), pmPos: 50, readonly: true as const };
    const reqs: RequirementEntry[] = [
      { node: topNode,    id: "REQ_002", num: 2 },
      { node: quotedNode, id: "REQ_003", num: 3 },
    ];
    const result = computeRenumberReplacements(reqs, "REQ_", 3);
    // Both get the same treatment: sequential labels, correct pmPos
    expect(result[0].newLabel).toBe("REQ_001 [Draft]");
    expect(result[1].newLabel).toBe("REQ_002 [Review]");
    expect(result[0].pmPos).toBe(10);
    expect(result[1].pmPos).toBe(50);
  });

  it("mixed document: top-level, blockquoted, top-level — all renumbered", () => {
    const reqs: RequirementEntry[] = [
      { node: { ...makeNode("REQ_001 [Draft]",    0), pmPos: 5  },               id: "REQ_001", num: 1 },
      { node: { ...makeNode("REQ_002 [Review]",   1), pmPos: 20, readonly: true as const }, id: "REQ_002", num: 2 },
      { node: { ...makeNode("REQ_003 [Approved]", 2), pmPos: 40 },               id: "REQ_003", num: 3 },
    ];
    const result = computeRenumberReplacements(reqs, "REQ_", 3);
    expect(result.map(r => r.newLabel)).toEqual([
      "REQ_001 [Draft]",
      "REQ_002 [Review]",
      "REQ_003 [Approved]",
    ]);
    expect(result.map(r => r.pmPos)).toEqual([5, 20, 40]);
  });

  it("normalises digit width when original used fewer digits", () => {
    const reqs: RequirementEntry[] = [
      { node: { ...makeNode("REQ_01 [Draft]", 0), pmPos: 0 }, id: "REQ_01", num: 1 },
    ];
    const result = computeRenumberReplacements(reqs, "REQ_", 3);
    expect(result[0].newLabel).toBe("REQ_001 [Draft]");
  });

  it("returns empty array for empty requirements", () => {
    expect(computeRenumberReplacements([], "REQ_", 3)).toEqual([]);
  });
});

describe("renumberRequirements — blockquote containers", () => {
  it("skips entries whose node.index points to a non-heading (blockquote container)", () => {
    // Three requirements: REQ_001 (top-level), REQ_002 (blockquote), REQ_003 (top-level).
    // node.index 1 is a blockquote, so REQ_002 must be skipped.
    const docContent: import("@tiptap/core").JSONContent[] = [
      { type: "heading", attrs: { level: 3 }, content: [{ type: "text", text: "REQ_003" }] },
      { type: "blockquote", content: [{ type: "heading", attrs: { level: 3 }, content: [{ type: "text", text: "REQ_001" }] }] },
      { type: "heading", attrs: { level: 3 }, content: [{ type: "text", text: "REQ_002" }] },
    ];
    const entries: RequirementEntry[] = [
      { node: { ...makeNode("REQ_003", 0, 3), index: 0 }, id: "REQ_003", num: 3 },
      { node: { ...makeNode("REQ_001", 1, 3), index: 1, readonly: true as const }, id: "REQ_001", num: 1 },
      { node: { ...makeNode("REQ_002", 2, 3), index: 2 }, id: "REQ_002", num: 2 },
    ];
    const result = renumberRequirements(docContent, entries, "REQ_", 3);
    // Index 0 (heading) → counter=1 → REQ_001
    expect(result[0].content![0].text).toBe("REQ_001");
    // Index 1 (blockquote) → skipped, counter=2
    expect(result[1].type).toBe("blockquote");
    // Index 2 (heading) → counter=3 → REQ_003
    expect(result[2].content![0].text).toBe("REQ_003");
  });

  it("does not corrupt blockquote content when skipping", () => {
    const docContent: import("@tiptap/core").JSONContent[] = [
      { type: "blockquote", content: [{ type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "REQ_001" }] }] },
    ];
    const entries: RequirementEntry[] = [
      { node: { ...makeNode("REQ_001", 0, 2), index: 0, readonly: true as const }, id: "REQ_001", num: 1 },
    ];
    const result = renumberRequirements(docContent, entries, "REQ_", 3);
    expect(result[0].type).toBe("blockquote");
    expect(result[0].content![0].content![0].text).toBe("REQ_001");
  });
});

describe("reassignRequirementId", () => {
  it("replaces the ID and preserves the title suffix", () => {
    const content = makeContent([
      { level: 2, text: "TRANS_TOS_001 - Auth flow" },
    ]);
    const result = reassignRequirementId(
      content,
      0,
      "TRANS_TOS_001 - Auth flow",
      "TRANS_TOS_001",
      "TRANS_TOS_005"
    );
    expect(result[0].content![0].text).toBe("TRANS_TOS_005 - Auth flow");
  });

  it("works when the heading is just the ID (no suffix)", () => {
    const content = makeContent([{ level: 2, text: "REQ_001" }]);
    const result = reassignRequirementId(content, 0, "REQ_001", "REQ_001", "REQ_007");
    expect(result[0].content![0].text).toBe("REQ_007");
  });

  it("handles colon-style suffixes", () => {
    const content = makeContent([{ level: 2, text: "REQ_002: Login required" }]);
    const result = reassignRequirementId(
      content,
      0,
      "REQ_002: Login required",
      "REQ_002",
      "REQ_004"
    );
    expect(result[0].content![0].text).toBe("REQ_004: Login required");
  });

  it("only modifies the target node index", () => {
    const content = makeContent([
      { level: 2, text: "REQ_001" },
      { level: 2, text: "REQ_001" }, // duplicate
    ]);
    const result = reassignRequirementId(content, 1, "REQ_001", "REQ_001", "REQ_002");
    expect(result[0].content![0].text).toBe("REQ_001"); // untouched
    expect(result[1].content![0].text).toBe("REQ_002"); // reassigned
  });

  it("does not mutate the input content array", () => {
    const content = makeContent([{ level: 2, text: "REQ_001" }]);
    reassignRequirementId(content, 0, "REQ_001", "REQ_001", "REQ_999");
    expect(content[0].content![0].text).toBe("REQ_001");
  });

  it("returns content unchanged when nodeIndex points to a non-heading container", () => {
    const content: import("@tiptap/core").JSONContent[] = [
      { type: "blockquote", content: [{ type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "REQ_001" }] }] },
    ];
    const result = reassignRequirementId(content, 0, "REQ_001", "REQ_001", "REQ_005");
    // Blockquote container must be unchanged
    expect(result).toBe(content); // same reference (no copy made)
    expect(result[0].type).toBe("blockquote");
  });
});
