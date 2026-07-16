/**
 * Tests for the document validation framework.
 *
 * All tests use plain objects so they do not depend on OutlineNode or editor state.
 * Each rule function is tested in isolation, then validateDocument() is tested
 * for correct composition.
 */
import { describe, it, expect } from "vitest";
import {
  checkRequirementOrder,
  checkDuplicateIds,
  checkMissingStatus,
  checkEmptyBody,
  validateDocument,
} from "@/services/documentValidationService";
import type { RequirementRef } from "@/services/documentValidationService";

// ── Factories ─────────────────────────────────────────────────────────────────

function req(
  id: string,
  num: number,
  opts: Partial<Omit<RequirementRef, "id" | "num">> = {},
): RequirementRef {
  return {
    id,
    num,
    // ?? would silently replace explicit null with the default; use !== undefined
    statusText: opts.statusText !== undefined ? opts.statusText : "Draft",
    bodyText: opts.bodyText !== undefined ? opts.bodyText : "The system shall provide this capability.",
  };
}

// ── checkRequirementOrder ─────────────────────────────────────────────────────

describe("checkRequirementOrder — valid orderings", () => {
  it("returns no issues for an empty list", () => {
    expect(checkRequirementOrder([])).toHaveLength(0);
  });

  it("returns no issues for a single requirement", () => {
    expect(checkRequirementOrder([req("REQ_001", 1)])).toHaveLength(0);
  });

  it("returns no issues for sequential IDs", () => {
    expect(checkRequirementOrder([
      req("REQ_001", 1), req("REQ_002", 2), req("REQ_003", 3),
    ])).toHaveLength(0);
  });

  it("allows gaps — non-consecutive numbers are valid", () => {
    expect(checkRequirementOrder([
      req("REQ_001", 1), req("REQ_005", 5), req("REQ_010", 10),
    ])).toHaveLength(0);
  });

  it("ties (same number) are not treated as descending", () => {
    // Duplicate IDs are a separate rule; ordering rule only flags descending.
    expect(checkRequirementOrder([req("REQ_003", 3), req("REQ_003", 3)])).toHaveLength(0);
  });
});

describe("checkRequirementOrder — violations", () => {
  it("flags a single out-of-order requirement", () => {
    const issues = checkRequirementOrder([
      req("REQ_001", 1), req("REQ_003", 3), req("REQ_002", 2),
    ]);
    expect(issues).toHaveLength(1);
    expect(issues[0].type).toBe("requirement-order");
    expect(issues[0].severity).toBe("warning");
    expect(issues[0].targetId).toBe("REQ_002");
    expect(issues[0].message).toContain("REQ_002");
    expect(issues[0].message).toContain("REQ_003");
  });

  it("high-water mark is not reset when a violation is skipped", () => {
    const issues = checkRequirementOrder([
      req("REQ_010", 10), req("REQ_001", 1), req("REQ_002", 2),
    ]);
    expect(issues).toHaveLength(2);
    // Both reference REQ_010 (the ceiling, not REQ_001)
    expect(issues[0].message).toContain("REQ_010");
    expect(issues[1].message).toContain("REQ_010");
  });

  it("reports independent violations with correct reference IDs", () => {
    const issues = checkRequirementOrder([
      req("REQ_001", 1), req("REQ_010", 10), req("REQ_005", 5),
      req("REQ_015", 15), req("REQ_012", 12),
    ]);
    expect(issues).toHaveLength(2);
    expect(issues[0].targetId).toBe("REQ_005");
    expect(issues[0].message).toContain("REQ_010");
    expect(issues[1].targetId).toBe("REQ_012");
    expect(issues[1].message).toContain("REQ_015");
  });

  it("completely reversed list: all but first are violations", () => {
    const issues = checkRequirementOrder([
      req("REQ_004", 4), req("REQ_003", 3), req("REQ_002", 2), req("REQ_001", 1),
    ]);
    expect(issues).toHaveLength(3);
    expect(issues.map((i) => i.targetId)).toEqual(["REQ_003", "REQ_002", "REQ_001"]);
  });

  it("all issues have unique IDs within one run", () => {
    const issues = checkRequirementOrder([
      req("REQ_010", 10), req("REQ_001", 1), req("REQ_002", 2),
    ]);
    const ids = issues.map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

// checkRequirementOrder with num === null: this is what regex-mode requirements
// look like when their captured ID isn't purely numeric (e.g. "PROJ-A17").
// There's no numeric ordering to violate for those entries, so they're skipped
// rather than crashing or comparing against `null`.
describe("checkRequirementOrder — regex-mode entries with num: null", () => {
  function reqNullNum(id: string): RequirementRef {
    return { id, num: null, statusText: "Draft", bodyText: "Body." };
  }

  it("skips entries with num === null entirely — no issues, no crash", () => {
    expect(checkRequirementOrder([reqNullNum("PROJ-A1"), reqNullNum("PROJ-B2")])).toHaveLength(0);
  });

  it("does not let a null entry reset or interfere with the numeric high-water mark", () => {
    const issues = checkRequirementOrder([
      req("REQ_010", 10), reqNullNum("PROJ-X"), req("REQ_002", 2),
    ]);
    expect(issues).toHaveLength(1);
    expect(issues[0].targetId).toBe("REQ_002");
    expect(issues[0].message).toContain("REQ_010");
  });

  it("a null entry between two ascending numeric entries reports no violation", () => {
    expect(checkRequirementOrder([
      req("REQ_001", 1), reqNullNum("PROJ-X"), req("REQ_002", 2),
    ])).toHaveLength(0);
  });
});

// ── checkDuplicateIds ─────────────────────────────────────────────────────────

describe("checkDuplicateIds — no violations", () => {
  it("returns no issues for an empty list", () => {
    expect(checkDuplicateIds([])).toHaveLength(0);
  });

  it("returns no issues when all IDs are unique", () => {
    expect(checkDuplicateIds([
      req("REQ_001", 1), req("REQ_002", 2), req("REQ_003", 3),
    ])).toHaveLength(0);
  });
});

describe("checkDuplicateIds — violations", () => {
  it("flags both occurrences of a duplicated ID", () => {
    const issues = checkDuplicateIds([req("REQ_005", 5), req("REQ_005", 5)]);
    expect(issues).toHaveLength(2);
    expect(issues.every((i) => i.type === "duplicate-requirement-id")).toBe(true);
    expect(issues.every((i) => i.severity === "error")).toBe(true);
    expect(issues.every((i) => i.targetId === "REQ_005")).toBe(true);
  });

  it("flags all three occurrences when an ID appears three times", () => {
    const issues = checkDuplicateIds([
      req("REQ_005", 5), req("REQ_005", 5), req("REQ_005", 5),
    ]);
    expect(issues).toHaveLength(3);
    expect(issues[0].message).toContain("3 times");
  });

  it("does not flag non-duplicate IDs in the same list", () => {
    const issues = checkDuplicateIds([
      req("REQ_001", 1),
      req("REQ_005", 5),
      req("REQ_005", 5),
      req("REQ_010", 10),
    ]);
    expect(issues).toHaveLength(2);
    expect(issues.every((i) => i.targetId === "REQ_005")).toBe(true);
  });

  it("handles multiple distinct duplicate IDs independently", () => {
    const issues = checkDuplicateIds([
      req("REQ_001", 1), req("REQ_001", 1),
      req("REQ_003", 3), req("REQ_003", 3),
    ]);
    expect(issues).toHaveLength(4);
    const dupeIds = new Set(issues.map((i) => i.targetId));
    expect(dupeIds).toEqual(new Set(["REQ_001", "REQ_003"]));
  });

  it("all issues have unique IDs within one run", () => {
    const issues = checkDuplicateIds([
      req("REQ_005", 5), req("REQ_005", 5), req("REQ_005", 5),
    ]);
    const issueIds = issues.map((i) => i.id);
    expect(new Set(issueIds).size).toBe(issueIds.length);
  });
});

// ── checkMissingStatus ────────────────────────────────────────────────────────

describe("checkMissingStatus — no violations", () => {
  it("returns no issues for an empty list", () => {
    expect(checkMissingStatus([])).toHaveLength(0);
  });

  it("returns no issues when all requirements have a status bracket", () => {
    const reqs = [
      { id: "REQ_001", statusText: "Draft" },
      { id: "REQ_002", statusText: "Approved" },
    ];
    expect(checkMissingStatus(reqs)).toHaveLength(0);
  });

  it("with validAliases: does not flag a recognised status", () => {
    const aliases = new Set(["Draft", "draft", "Approved"]);
    const reqs = [{ id: "REQ_001", statusText: "Draft" }];
    expect(checkMissingStatus(reqs, aliases)).toHaveLength(0);
  });

  it("with empty validAliases: does not flag bracket with any text (unknown value)", () => {
    // When statuses aren't configured, only the bracket-presence check runs.
    const reqs = [{ id: "REQ_001", statusText: "UnknownValue" }];
    expect(checkMissingStatus(reqs, new Set())).toHaveLength(0);
  });
});

describe("checkMissingStatus — violations", () => {
  it("flags a requirement with no status bracket (statusText null)", () => {
    const issues = checkMissingStatus([{ id: "REQ_005", statusText: null }]);
    expect(issues).toHaveLength(1);
    expect(issues[0].type).toBe("missing-requirement-status");
    expect(issues[0].severity).toBe("warning");
    expect(issues[0].targetId).toBe("REQ_005");
    expect(issues[0].message).toContain("REQ_005");
  });

  it("flags multiple requirements all missing brackets", () => {
    const reqs = [
      { id: "REQ_001", statusText: null },
      { id: "REQ_003", statusText: null },
    ];
    const issues = checkMissingStatus(reqs);
    expect(issues).toHaveLength(2);
    expect(issues.map((i) => i.targetId)).toEqual(["REQ_001", "REQ_003"]);
  });

  it("does not flag requirements that have brackets when others are missing", () => {
    const reqs = [
      { id: "REQ_001", statusText: "Draft" },
      { id: "REQ_002", statusText: null },
      { id: "REQ_003", statusText: "Approved" },
    ];
    const issues = checkMissingStatus(reqs);
    expect(issues).toHaveLength(1);
    expect(issues[0].targetId).toBe("REQ_002");
  });

  it("with validAliases: flags a bracket with an unrecognised status value", () => {
    const aliases = new Set(["Draft", "draft", "Approved"]);
    const reqs = [{ id: "REQ_001", statusText: "Foo" }];
    const issues = checkMissingStatus(reqs, aliases);
    expect(issues).toHaveLength(1);
    expect(issues[0].type).toBe("missing-requirement-status");
    expect(issues[0].message).toContain('"Foo"');
  });

  it("with validAliases: flags null bracket AND unrecognised bracket separately", () => {
    const aliases = new Set(["Draft"]);
    const reqs = [
      { id: "REQ_001", statusText: null },
      { id: "REQ_002", statusText: "Bar" },
      { id: "REQ_003", statusText: "Draft" },
    ];
    const issues = checkMissingStatus(reqs, aliases);
    expect(issues).toHaveLength(2);
    expect(issues[0].targetId).toBe("REQ_001");
    expect(issues[1].targetId).toBe("REQ_002");
  });

  it("alias matching is case-insensitive (matches resolveRequirementStatus behaviour)", () => {
    const aliases = new Set(["Draft"]);
    // "DRAFT" is not literally in the alias set, but normalizes to the same
    // text as the configured "Draft" alias, so it must not be flagged.
    expect(checkMissingStatus([{ id: "REQ_001", statusText: "DRAFT" }], aliases)).toHaveLength(0);
    expect(checkMissingStatus([{ id: "REQ_001", statusText: "Draft" }], aliases)).toHaveLength(0);
    expect(checkMissingStatus([{ id: "REQ_001", statusText: "draft" }], aliases)).toHaveLength(0);
  });

  it("trims whitespace from statusText before alias comparison", () => {
    const aliases = new Set(["Draft"]);
    expect(checkMissingStatus([{ id: "REQ_001", statusText: " Draft " }], aliases)).toHaveLength(0);
  });

  // ── Case & whitespace normalization regression ──────────────────────────────
  // The configured alias is "Ready for review" (mirrors the real
  // requirement-statuses.json / FALLBACK_STATUSES entry). Every case variant
  // and whitespace irregularity below must resolve without a violation, and
  // the alias itself must never be rewritten in the process.
  describe("case and whitespace insensitivity regression", () => {
    const READY_ALIASES = new Set(["Ready for review"]);

    it.each([
      "Ready For Review",
      "READY FOR REVIEW",
      "Ready for review",
      "ready For Review",
      "ready for review",
    ])("does not flag %j as an unrecognized status", (variant) => {
      expect(checkMissingStatus([{ id: "REQ_001", statusText: variant }], READY_ALIASES)).toHaveLength(0);
    });

    it("does not flag leading/trailing whitespace variants", () => {
      expect(
        checkMissingStatus([{ id: "REQ_001", statusText: "  Ready for review  " }], READY_ALIASES)
      ).toHaveLength(0);
      expect(
        checkMissingStatus([{ id: "REQ_001", statusText: "\tREADY FOR REVIEW\n" }], READY_ALIASES)
      ).toHaveLength(0);
    });

    it("does not flag multiple internal spaces", () => {
      expect(
        checkMissingStatus([{ id: "REQ_001", statusText: "Ready   for    review" }], READY_ALIASES)
      ).toHaveLength(0);
      expect(
        checkMissingStatus([{ id: "REQ_001", statusText: "READY  FOR   REVIEW" }], READY_ALIASES)
      ).toHaveLength(0);
    });

    it("still flags genuinely unrecognized status text", () => {
      expect(
        checkMissingStatus([{ id: "REQ_001", statusText: "Obsolete" }], READY_ALIASES)
      ).toHaveLength(1);
    });

    it("does not mutate the configured alias set", () => {
      checkMissingStatus([{ id: "REQ_001", statusText: "READY FOR REVIEW" }], READY_ALIASES);
      expect(READY_ALIASES).toEqual(new Set(["Ready for review"]));
    });
  });

  it("all issues have unique IDs within one run", () => {
    const reqs = [
      { id: "REQ_001", statusText: null },
      { id: "REQ_002", statusText: null },
    ];
    const issueIds = checkMissingStatus(reqs).map((i) => i.id);
    expect(new Set(issueIds).size).toBe(issueIds.length);
  });
});

// ── checkEmptyBody ────────────────────────────────────────────────────────────

describe("checkEmptyBody — no violations", () => {
  it("returns no issues for an empty list", () => {
    expect(checkEmptyBody([])).toHaveLength(0);
  });

  it("returns no issues when all requirements have body content", () => {
    const reqs = [
      { id: "REQ_001", bodyText: "The system shall authenticate users." },
      { id: "REQ_002", bodyText: "Response time shall be < 200ms." },
    ];
    expect(checkEmptyBody(reqs)).toHaveLength(0);
  });

  it("returns no issues for non-empty single-word body", () => {
    expect(checkEmptyBody([{ id: "REQ_001", bodyText: "TBD" }])).toHaveLength(0);
  });
});

describe("checkEmptyBody — violations", () => {
  it("flags a requirement with an empty body string", () => {
    const issues = checkEmptyBody([{ id: "REQ_005", bodyText: "" }]);
    expect(issues).toHaveLength(1);
    expect(issues[0].type).toBe("empty-requirement");
    expect(issues[0].severity).toBe("warning");
    expect(issues[0].targetId).toBe("REQ_005");
    expect(issues[0].message).toContain("REQ_005");
  });

  it("flags whitespace-only body as empty", () => {
    expect(checkEmptyBody([{ id: "REQ_001", bodyText: "   " }])).toHaveLength(1);
    expect(checkEmptyBody([{ id: "REQ_001", bodyText: "\n\n\t" }])).toHaveLength(1);
  });

  it("flags multiple empty-body requirements", () => {
    const reqs = [
      { id: "REQ_001", bodyText: "" },
      { id: "REQ_002", bodyText: "Has content." },
      { id: "REQ_003", bodyText: "" },
    ];
    const issues = checkEmptyBody(reqs);
    expect(issues).toHaveLength(2);
    expect(issues[0].targetId).toBe("REQ_001");
    expect(issues[1].targetId).toBe("REQ_003");
  });

  it("all issues have unique IDs within one run", () => {
    const reqs = [{ id: "REQ_001", bodyText: "" }, { id: "REQ_002", bodyText: "" }];
    const issueIds = checkEmptyBody(reqs).map((i) => i.id);
    expect(new Set(issueIds).size).toBe(issueIds.length);
  });
});

// ── validateDocument — composition ────────────────────────────────────────────

describe("validateDocument — composition", () => {
  it("returns no issues for a fully valid document", () => {
    const reqs = [
      req("REQ_001", 1),
      req("REQ_002", 2),
      req("REQ_003", 3),
    ];
    expect(validateDocument(reqs)).toHaveLength(0);
  });

  it("includes ordering violations", () => {
    const reqs = [req("REQ_003", 3), req("REQ_001", 1)];
    const issues = validateDocument(reqs);
    expect(issues.some((i) => i.type === "requirement-order")).toBe(true);
  });

  it("includes duplicate-id errors", () => {
    const reqs = [req("REQ_001", 1), req("REQ_001", 1)];
    const issues = validateDocument(reqs);
    expect(issues.some((i) => i.type === "duplicate-requirement-id")).toBe(true);
    expect(issues.some((i) => i.severity === "error")).toBe(true);
  });

  it("includes missing-status warnings", () => {
    const reqs = [req("REQ_001", 1, { statusText: null })];
    const issues = validateDocument(reqs);
    expect(issues.some((i) => i.type === "missing-requirement-status")).toBe(true);
  });

  it("includes empty-body warnings", () => {
    const reqs = [req("REQ_001", 1, { bodyText: "" })];
    const issues = validateDocument(reqs);
    expect(issues.some((i) => i.type === "empty-requirement")).toBe(true);
  });

  it("accumulates issues from multiple rules simultaneously", () => {
    // REQ_003 before REQ_001 (order), REQ_001 duplicate, REQ_002 no status, REQ_004 empty body
    const reqs = [
      req("REQ_003", 3),
      req("REQ_001", 1),
      req("REQ_001", 1),
      req("REQ_002", 2, { statusText: null }),
      req("REQ_004", 4, { bodyText: "" }),
    ];
    const issues = validateDocument(reqs);
    const types = issues.map((i) => i.type);
    expect(types).toContain("requirement-order");
    expect(types).toContain("duplicate-requirement-id");
    expect(types).toContain("missing-requirement-status");
    expect(types).toContain("empty-requirement");
  });

  it("passes validAliases through to checkMissingStatus", () => {
    const reqs = [req("REQ_001", 1, { statusText: "Unknown" })];
    const withAliases = new Set(["Draft"]);
    const withoutAliases = new Set<string>();

    expect(validateDocument(reqs, withAliases).some((i) => i.type === "missing-requirement-status")).toBe(true);
    expect(validateDocument(reqs, withoutAliases).some((i) => i.type === "missing-requirement-status")).toBe(false);
  });

  it("returns a flat array for an empty document", () => {
    const result = validateDocument([]);
    expect(Array.isArray(result)).toBe(true);
    expect(result).toHaveLength(0);
  });

  it("each issue carries required ValidationIssue fields", () => {
    const reqs = [req("REQ_002", 2), req("REQ_001", 1)];
    const [issue] = validateDocument(reqs);
    expect(issue).toHaveProperty("id");
    expect(issue).toHaveProperty("severity");
    expect(issue).toHaveProperty("type");
    expect(issue).toHaveProperty("message");
    expect(["warning", "error"]).toContain(issue.severity);
  });
});

// ── Cross-rule scenarios ──────────────────────────────────────────────────────

describe("cross-rule scenarios", () => {
  it("ordering rule is unaffected by requirements missing status or body", () => {
    const reqs = [
      req("REQ_003", 3, { statusText: null, bodyText: "" }),
      req("REQ_001", 1, { statusText: null, bodyText: "" }),
    ];
    const orderIssues = checkRequirementOrder(reqs);
    expect(orderIssues).toHaveLength(1);
    expect(orderIssues[0].targetId).toBe("REQ_001");
  });

  it("duplicate rule is unaffected by ordering violations", () => {
    // All out of order AND duplicated
    const reqs = [
      req("REQ_003", 3), req("REQ_001", 1), req("REQ_001", 1),
    ];
    const dupIssues = checkDuplicateIds(reqs);
    expect(dupIssues).toHaveLength(2);
    expect(dupIssues.every((i) => i.targetId === "REQ_001")).toBe(true);
  });

  it("a requirement with all problems gets one issue per rule", () => {
    const problematic = [req("REQ_001", 1, { statusText: null, bodyText: "" })];
    const issues = validateDocument(problematic);
    // Only one requirement so: no ordering violation, no duplicate,
    // but missing status AND empty body → 2 issues
    const types = issues.map((i) => i.type);
    expect(types).toContain("missing-requirement-status");
    expect(types).toContain("empty-requirement");
    expect(types).not.toContain("requirement-order");
    expect(types).not.toContain("duplicate-requirement-id");
  });
});
