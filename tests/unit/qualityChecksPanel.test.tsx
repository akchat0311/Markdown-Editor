/**
 * Tests for groupAndSortIssues pure helper (from QualityChecksPanel).
 *
 * The modal component has moved into InsightsTab / Dashboard.
 * Component-level tests live in dashboard.test.tsx.
 */
import { describe, it, expect } from "vitest";
import { groupAndSortIssues } from "@/layout/QualityChecksPanel";
import type { ValidationIssue } from "@/types/validation";

// ── Factories ──────────────────────────────────────────────────────────────────

let issueCounter = 0;
function issue(
  severity: "error" | "warning",
  type: string,
  targetId: string,
  message = `${type} on ${targetId}`,
): ValidationIssue {
  issueCounter++;
  return { id: `${type}-${issueCounter}-${targetId}`, severity, type, message, targetId };
}

function errorIssue(targetId: string, type = "duplicate-requirement-id") {
  return issue("error", type, targetId);
}
function warningIssue(targetId: string, type = "requirement-order") {
  return issue("warning", type, targetId);
}

// ── groupAndSortIssues ────────────────────────────────────────────────────────

describe("groupAndSortIssues — grouping", () => {
  it("returns empty groups for an empty list", () => {
    const { errors, warnings } = groupAndSortIssues([]);
    expect(errors).toHaveLength(0);
    expect(warnings).toHaveLength(0);
  });

  it("routes errors and warnings into separate groups", () => {
    const issues = [
      errorIssue("REQ_001"),
      warningIssue("REQ_002"),
      errorIssue("REQ_003"),
    ];
    const { errors, warnings } = groupAndSortIssues(issues);
    expect(errors).toHaveLength(2);
    expect(warnings).toHaveLength(1);
  });

  it("all-error input produces empty warnings group", () => {
    const issues = [errorIssue("REQ_001"), errorIssue("REQ_002")];
    const { errors, warnings } = groupAndSortIssues(issues);
    expect(errors).toHaveLength(2);
    expect(warnings).toHaveLength(0);
  });

  it("all-warning input produces empty errors group", () => {
    const issues = [warningIssue("REQ_001"), warningIssue("REQ_003")];
    const { errors, warnings } = groupAndSortIssues(issues);
    expect(errors).toHaveLength(0);
    expect(warnings).toHaveLength(2);
  });

  it("preserves all issue fields after grouping", () => {
    const src = errorIssue("REQ_005");
    const { errors } = groupAndSortIssues([src]);
    expect(errors[0]).toEqual(src);
  });
});

describe("groupAndSortIssues — sorting within groups", () => {
  it("sorts errors by ascending numeric suffix of targetId", () => {
    const issues = [errorIssue("REQ_010"), errorIssue("REQ_001"), errorIssue("REQ_005")];
    const { errors } = groupAndSortIssues(issues);
    expect(errors.map((e) => e.targetId)).toEqual(["REQ_010", "REQ_001", "REQ_005"]
      .sort((a, b) => parseInt(a.match(/(\d+)$/)![1]) - parseInt(b.match(/(\d+)$/)![1])));
  });

  it("sorts warnings by ascending numeric suffix of targetId", () => {
    const issues = [warningIssue("REQ_030"), warningIssue("REQ_002"), warningIssue("REQ_015")];
    const { warnings } = groupAndSortIssues(issues);
    expect(warnings.map((w) => w.targetId)).toEqual(["REQ_002", "REQ_015", "REQ_030"]);
  });

  it("issues without targetId are sorted to the end", () => {
    const noTarget: ValidationIssue = { id: "no-target", severity: "warning", type: "x", message: "m" };
    const withTarget = warningIssue("REQ_001");
    const { warnings } = groupAndSortIssues([noTarget, withTarget]);
    expect(warnings[0].targetId).toBe("REQ_001");
    expect(warnings[1].targetId).toBeUndefined();
  });

  it("maintains stable grouping across mixed severities", () => {
    const issues = [
      warningIssue("REQ_010"),
      errorIssue("REQ_005"),
      warningIssue("REQ_001"),
      errorIssue("REQ_003"),
    ];
    const { errors, warnings } = groupAndSortIssues(issues);
    expect(errors.map((e) => e.targetId)).toEqual(["REQ_003", "REQ_005"]);
    expect(warnings.map((w) => w.targetId)).toEqual(["REQ_001", "REQ_010"]);
  });

  it("handles non-standard prefixes (SRS-001, FR001, etc.)", () => {
    const issues = [
      issue("warning", "req-order", "SRS-010"),
      issue("warning", "req-order", "SRS-001"),
    ];
    const { warnings } = groupAndSortIssues(issues);
    expect(warnings.map((w) => w.targetId)).toEqual(["SRS-001", "SRS-010"]);
  });

  it("is idempotent — calling twice gives the same result", () => {
    const issues = [warningIssue("REQ_003"), warningIssue("REQ_001"), warningIssue("REQ_002")];
    const first = groupAndSortIssues(issues);
    const second = groupAndSortIssues(issues);
    expect(first.warnings.map((w) => w.targetId)).toEqual(
      second.warnings.map((w) => w.targetId),
    );
  });
});
