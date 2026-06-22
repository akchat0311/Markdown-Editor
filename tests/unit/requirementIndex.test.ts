import { describe, it, expect } from "vitest";
import {
  extractStatusText,
  buildRequirementIndex,
} from "@/editor/utils/requirementOps";
import { resolveRequirementStatus } from "@/services/requirementStatusService";
import type { OutlineNode } from "@/types/outline";
import type { RequirementStatus } from "@/types/requirementStatus";

// ── Shared fixture statuses ───────────────────────────────────────────────────

const DEFAULT_STATUSES: RequirementStatus[] = [
  { id: "draft",    label: "Draft",    order: 1, aliases: ["Draft", "draft", "DRAFT"] },
  { id: "review",   label: "Review",   order: 2, aliases: ["Review", "review", "REVIEW", "In Review"] },
  { id: "approved", label: "Approved", order: 3, aliases: ["Approved", "approved", "APPROVED"] },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

let keyCounter = 0;
function makeNode(label: string, level: number, pmPos = keyCounter * 10): OutlineNode {
  keyCounter++;
  return {
    key: `heading:${pmPos}`,
    type: "heading",
    level,
    label,
    pmPos,
    index: keyCounter,
    children: [],
  };
}

// ── extractStatusText ─────────────────────────────────────────────────────────

describe("extractStatusText", () => {
  it("returns the bracket content", () => {
    expect(extractStatusText("REQ_001 [Draft]")).toBe("Draft");
    expect(extractStatusText("REQ_001 [In Review]")).toBe("In Review");
  });

  it("returns null when no bracket group", () => {
    expect(extractStatusText("REQ_001")).toBeNull();
  });

  it("trims whitespace inside brackets", () => {
    expect(extractStatusText("REQ_001 [ Draft ]")).toBe("Draft");
  });

  it("picks the last bracket group", () => {
    expect(extractStatusText("REQ_006 [something] [Approved]")).toBe("Approved");
  });

  it("handles trailing whitespace after bracket", () => {
    expect(extractStatusText("REQ_005 [Draft]  ")).toBe("Draft");
  });
});

// ── resolveRequirementStatus ──────────────────────────────────────────────────

describe("resolveRequirementStatus", () => {
  it("resolves by exact alias match", () => {
    expect(resolveRequirementStatus("Draft",    DEFAULT_STATUSES)).toBe("draft");
    expect(resolveRequirementStatus("draft",    DEFAULT_STATUSES)).toBe("draft");
    expect(resolveRequirementStatus("DRAFT",    DEFAULT_STATUSES)).toBe("draft");
    expect(resolveRequirementStatus("Review",   DEFAULT_STATUSES)).toBe("review");
    expect(resolveRequirementStatus("In Review",DEFAULT_STATUSES)).toBe("review");
    expect(resolveRequirementStatus("Approved", DEFAULT_STATUSES)).toBe("approved");
  });

  it("returns unknown for unrecognized text", () => {
    expect(resolveRequirementStatus("Pending",  DEFAULT_STATUSES)).toBe("unknown");
    expect(resolveRequirementStatus("",         DEFAULT_STATUSES)).toBe("unknown");
  });

  it("does not do case-folding — aliases are exact", () => {
    // "approved" is an alias, but "Approve" is not
    expect(resolveRequirementStatus("Approve", DEFAULT_STATUSES)).toBe("unknown");
  });

  it("resolves against custom statuses", () => {
    const custom: RequirementStatus[] = [
      { id: "proposed",    label: "Proposed",    order: 1, aliases: ["Proposed", "proposed"] },
      { id: "implemented", label: "Implemented", order: 2, aliases: ["Implemented"] },
    ];
    expect(resolveRequirementStatus("Proposed",    custom)).toBe("proposed");
    expect(resolveRequirementStatus("Implemented", custom)).toBe("implemented");
    expect(resolveRequirementStatus("Draft",       custom)).toBe("unknown");
  });
});

// ── buildRequirementIndex ─────────────────────────────────────────────────────

describe("buildRequirementIndex — invalid pattern", () => {
  it("returns null for invalid pattern", () => {
    expect(buildRequirementIndex([], "no-digits", DEFAULT_STATUSES)).toBeNull();
  });
});

describe("buildRequirementIndex — basic extraction", () => {
  it("detects requirements matching pattern", () => {
    const flat = [
      makeNode("REQ_001 [Draft]", 2),
      makeNode("REQ_002 [Approved]", 2),
    ];
    const idx = buildRequirementIndex(flat, "REQ_001", DEFAULT_STATUSES);
    expect(idx).not.toBeNull();
    expect(idx!.total).toBe(2);
    expect(idx!.requirements[0].id).toBe("REQ_001");
    expect(idx!.requirements[1].id).toBe("REQ_002");
  });

  it("strips status suffix from ID", () => {
    const flat = [makeNode("SYS_001 [Draft]", 3)];
    const idx = buildRequirementIndex(flat, "SYS_001", DEFAULT_STATUSES);
    expect(idx!.requirements[0].id).toBe("SYS_001");
  });

  it("ignores non-requirement headings", () => {
    const flat = [
      makeNode("Brake System", 2),
      makeNode("REQ_001 [Draft]", 3),
    ];
    const idx = buildRequirementIndex(flat, "REQ_001", DEFAULT_STATUSES);
    expect(idx!.total).toBe(1);
  });
});

describe("buildRequirementIndex — status resolution", () => {
  it("resolves aliases against configured statuses", () => {
    const flat = [
      makeNode("REQ_001 [DRAFT]", 2),
      makeNode("REQ_002 [In Review]", 2),
      makeNode("REQ_003 [APPROVED]", 2),
    ];
    const idx = buildRequirementIndex(flat, "REQ_001", DEFAULT_STATUSES);
    expect(idx!.requirements[0].status).toBe("draft");
    expect(idx!.requirements[1].status).toBe("review");
    expect(idx!.requirements[2].status).toBe("approved");
  });

  it("marks unrecognized status as unknown", () => {
    const flat = [makeNode("REQ_001 [Pending]", 2)];
    const idx = buildRequirementIndex(flat, "REQ_001", DEFAULT_STATUSES);
    expect(idx!.requirements[0].status).toBe("unknown");
  });

  it("marks missing bracket as unknown", () => {
    const flat = [makeNode("REQ_001", 2)];
    const idx = buildRequirementIndex(flat, "REQ_001", DEFAULT_STATUSES);
    expect(idx!.requirements[0].status).toBe("unknown");
  });

  it("works with custom status config", () => {
    const custom: RequirementStatus[] = [
      { id: "proposed",    label: "Proposed",    order: 1, aliases: ["Proposed"] },
      { id: "implemented", label: "Implemented", order: 2, aliases: ["Implemented"] },
    ];
    const flat = [
      makeNode("REQ_001 [Proposed]",    2),
      makeNode("REQ_002 [Implemented]", 2),
      makeNode("REQ_003 [Draft]",       2),  // not in custom config
    ];
    const idx = buildRequirementIndex(flat, "REQ_001", custom);
    expect(idx!.requirements[0].status).toBe("proposed");
    expect(idx!.requirements[1].status).toBe("implemented");
    expect(idx!.requirements[2].status).toBe("unknown");
  });
});

describe("buildRequirementIndex — statusCounts", () => {
  it("tallies statusCounts from config ids dynamically", () => {
    const flat = [
      makeNode("REQ_001 [Draft]",    2),
      makeNode("REQ_002 [Draft]",    2),
      makeNode("REQ_003 [Review]",   2),
      makeNode("REQ_004 [Approved]", 2),
      makeNode("REQ_005 [Pending]",  2),  // unknown
    ];
    const idx = buildRequirementIndex(flat, "REQ_001", DEFAULT_STATUSES);
    expect(idx!.statusCounts.draft).toBe(2);
    expect(idx!.statusCounts.review).toBe(1);
    expect(idx!.statusCounts.approved).toBe(1);
    expect(idx!.statusCounts.unknown).toBe(1);
    expect(idx!.total).toBe(5);
  });

  it("includes all config status ids in counts even if zero", () => {
    const flat = [makeNode("REQ_001 [Draft]", 2)];
    const idx = buildRequirementIndex(flat, "REQ_001", DEFAULT_STATUSES);
    expect("review" in idx!.statusCounts).toBe(true);
    expect("approved" in idx!.statusCounts).toBe(true);
    expect(idx!.statusCounts.review).toBe(0);
  });

  it("uses config-defined ids for custom status sets", () => {
    const custom: RequirementStatus[] = [
      { id: "proposed", label: "Proposed", order: 1, aliases: ["Proposed"] },
      { id: "released", label: "Released", order: 2, aliases: ["Released"] },
    ];
    const flat = [
      makeNode("REQ_001 [Proposed]", 2),
      makeNode("REQ_002 [Released]", 2),
    ];
    const idx = buildRequirementIndex(flat, "REQ_001", custom);
    expect(idx!.statusCounts.proposed).toBe(1);
    expect(idx!.statusCounts.released).toBe(1);
    expect("draft" in idx!.statusCounts).toBe(false);
  });
});

describe("buildRequirementIndex — section resolution", () => {
  it("assigns the nearest non-requirement parent as section", () => {
    const flat = [
      makeNode("Brake Monitoring", 2),
      makeNode("REQ_001 [Draft]", 3),
      makeNode("REQ_002 [Approved]", 3),
    ];
    const idx = buildRequirementIndex(flat, "REQ_001", DEFAULT_STATUSES);
    expect(idx!.requirements[0].section).toBe("Brake Monitoring");
    expect(idx!.requirements[1].section).toBe("Brake Monitoring");
  });

  it("resolves section change mid-document", () => {
    const flat = [
      makeNode("Brake Monitoring", 2),
      makeNode("REQ_001 [Draft]", 3),
      makeNode("Wheel Speed", 2),
      makeNode("REQ_002 [Review]", 3),
    ];
    const idx = buildRequirementIndex(flat, "REQ_001", DEFAULT_STATUSES);
    expect(idx!.requirements[0].section).toBe("Brake Monitoring");
    expect(idx!.requirements[1].section).toBe("Wheel Speed");
  });

  it("uses — for top-level requirements with no parent", () => {
    const flat = [makeNode("REQ_001 [Draft]", 1)];
    const idx = buildRequirementIndex(flat, "REQ_001", DEFAULT_STATUSES);
    expect(idx!.requirements[0].section).toBe("—");
  });

  it("resolves nearest parent for deep nesting", () => {
    const flat = [
      makeNode("System", 1),
      makeNode("Brake Monitoring", 2),
      makeNode("REQ_001 [Draft]", 3),
    ];
    const idx = buildRequirementIndex(flat, "REQ_001", DEFAULT_STATUSES);
    expect(idx!.requirements[0].section).toBe("Brake Monitoring");
  });

  it("resets section stack when a shallower heading appears", () => {
    const flat = [
      makeNode("Brakes", 2),
      makeNode("REQ_001 [Draft]", 3),
      makeNode("Powertrain", 2),
      makeNode("REQ_002 [Approved]", 3),
    ];
    const idx = buildRequirementIndex(flat, "REQ_001", DEFAULT_STATUSES);
    expect(idx!.requirements[0].section).toBe("Brakes");
    expect(idx!.requirements[1].section).toBe("Powertrain");
  });
});

describe("buildRequirementIndex — pmPos", () => {
  it("preserves pmPos for navigation", () => {
    const flat = [makeNode("REQ_001 [Draft]", 2, 42)];
    const idx = buildRequirementIndex(flat, "REQ_001", DEFAULT_STATUSES);
    expect(idx!.requirements[0].pmPos).toBe(42);
  });
});

describe("buildRequirementIndex — empty document", () => {
  it("returns zero totals for empty flat outline", () => {
    const idx = buildRequirementIndex([], "REQ_001", DEFAULT_STATUSES);
    expect(idx!.total).toBe(0);
    expect(idx!.requirements).toHaveLength(0);
    expect(idx!.statusCounts.unknown).toBe(0);
  });
});

// ── buildRequirementIndex — blockquoted requirements ─────────────────────────
// Requirements inside blockquotes are marked readonly: true on their OutlineNode
// (index points to the container). Detection should be parent-agnostic.

describe("buildRequirementIndex — blockquoted requirements", () => {
  function makeReadonlyNode(label: string, level: number, pmPos = keyCounter * 10): OutlineNode {
    keyCounter++;
    return {
      key: `heading:${pmPos}`,
      type: "heading",
      level,
      label,
      pmPos,
      index: keyCounter, // container's top-level index
      children: [],
      readonly: true,
    };
  }

  it("detects a blockquoted requirement (readonly: true) the same as a top-level one", () => {
    const flat = [
      makeNode("Brake Monitoring", 2),
      makeReadonlyNode("REQ_001 [Draft]", 3),
    ];
    const idx = buildRequirementIndex(flat, "REQ_001", DEFAULT_STATUSES);
    expect(idx!.total).toBe(1);
    expect(idx!.requirements[0].id).toBe("REQ_001");
    expect(idx!.requirements[0].status).toBe("draft");
    expect(idx!.requirements[0].section).toBe("Brake Monitoring");
  });

  it("produces identical results for top-level and blockquoted variants", () => {
    const topLevel = [
      makeNode("System", 2),
      makeNode("REQ_001 [Approved]", 3),
    ];
    const quoted = [
      makeNode("System", 2),
      makeReadonlyNode("REQ_001 [Approved]", 3),
    ];
    const idx1 = buildRequirementIndex(topLevel, "REQ_001", DEFAULT_STATUSES);
    const idx2 = buildRequirementIndex(quoted, "REQ_001", DEFAULT_STATUSES);
    expect(idx1!.total).toBe(idx2!.total);
    expect(idx1!.requirements[0].id).toBe(idx2!.requirements[0].id);
    expect(idx1!.requirements[0].status).toBe(idx2!.requirements[0].status);
    expect(idx1!.requirements[0].section).toBe(idx2!.requirements[0].section);
  });

  it("handles a mix of blockquoted and top-level requirements", () => {
    const flat = [
      makeNode("Auth", 2),
      makeNode("REQ_001 [Draft]", 3),
      makeReadonlyNode("REQ_002 [Review]", 3),
      makeNode("Reporting", 2),
      makeReadonlyNode("REQ_003 [Approved]", 3),
    ];
    const idx = buildRequirementIndex(flat, "REQ_001", DEFAULT_STATUSES);
    expect(idx!.total).toBe(3);
    expect(idx!.requirements[0].section).toBe("Auth");
    expect(idx!.requirements[1].section).toBe("Auth");
    expect(idx!.requirements[2].section).toBe("Reporting");
    expect(idx!.statusCounts.draft).toBe(1);
    expect(idx!.statusCounts.review).toBe(1);
    expect(idx!.statusCounts.approved).toBe(1);
  });

  it("uses pmPos for navigation (not affected by readonly)", () => {
    const flat = [makeReadonlyNode("REQ_001 [Draft]", 3, 42)];
    const idx = buildRequirementIndex(flat, "REQ_001", DEFAULT_STATUSES);
    expect(idx!.requirements[0].pmPos).toBe(42);
  });
});
