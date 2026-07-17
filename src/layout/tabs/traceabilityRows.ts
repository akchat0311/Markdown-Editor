import { buildLinksByReq } from "@/services/traceabilityQuery";
import type { BrokenLink } from "@/services/traceabilityQuery";
import type { TestCase, TraceLink, CoverageStatus } from "@/types/traceability";

// Pure row-model helpers for the Traceability tab. Kept out of the component
// file so the tab stays fast-refreshable and the logic is unit-testable
// without rendering. The req→test-case projection itself lives in
// services/traceabilityQuery — shared with the editor badge and workspace panel.

export interface TraceabilityRow {
  reqId: string;
  /** Linked test cases in links-array order. */
  testCases: TestCase[];
  /** Engineer-selected coverage status; defaults to "NONE" when unset. */
  coverage: CoverageStatus;
}

/**
 * Builds one row per requirement in the given (document) order.
 * Duplicate requirement IDs collapse to their first occurrence — the sidecar
 * links by ID, so both headings would show identical chips anyway.
 */
export function buildTraceabilityRows(
  requirementIds: string[],
  testCases: TestCase[],
  links: TraceLink[],
  coverage: Record<string, CoverageStatus>,
): TraceabilityRow[] {
  const byReq = buildLinksByReq(testCases, links);
  const seen = new Set<string>();
  const rows: TraceabilityRow[] = [];
  for (const reqId of requirementIds) {
    if (seen.has(reqId)) continue;
    seen.add(reqId);
    rows.push({ reqId, testCases: byReq.get(reqId) ?? [], coverage: coverage[reqId] ?? "NONE" });
  }
  return rows;
}

/** Matches requirement ID, test case ID, or test case title (case-insensitive). */
export function filterTraceabilityRows(
  rows: TraceabilityRow[],
  query: string,
): TraceabilityRow[] {
  const q = query.trim().toLowerCase();
  if (!q) return rows;
  return rows.filter(
    (row) =>
      row.reqId.toLowerCase().includes(q) ||
      row.testCases.some(
        (tc) => tc.id.toLowerCase().includes(q) || tc.title.toLowerCase().includes(q),
      ),
  );
}

// Broken-link detection lives in the shared query module; re-exported here so
// existing tab-level imports keep working.
export { findBrokenLinks } from "@/services/traceabilityQuery";
export type { BrokenLink } from "@/services/traceabilityQuery";

export interface TraceabilitySummary {
  requirementCount: number;
  /** Requirements with at least one resolvable link. */
  linkedRequirementCount: number;
  testCaseCount: number;
  linkCount: number;
  brokenLinkCount: number;
}

export function summarizeTraceability(
  rows: TraceabilityRow[],
  testCases: TestCase[],
  links: TraceLink[],
  brokenLinks: BrokenLink[],
): TraceabilitySummary {
  return {
    requirementCount: rows.length,
    linkedRequirementCount: rows.filter((r) => r.testCases.length > 0).length,
    testCaseCount: testCases.length,
    linkCount: links.length,
    brokenLinkCount: brokenLinks.length,
  };
}

/**
 * Suggests the next test case ID from the last existing one ("TC_002" after
 * "TC_001"). Returns "" when there is no test case to derive from or the last
 * ID has no numeric suffix — the field is then simply left empty.
 */
export function suggestNextTestCaseId(testCases: TestCase[]): string {
  const last = testCases[testCases.length - 1];
  const match = last?.id.match(/(\d+)$/);
  if (!match) return "";
  const prefix = last.id.slice(0, last.id.length - match[1].length);
  return prefix + String(parseInt(match[1], 10) + 1).padStart(match[1].length, "0");
}
