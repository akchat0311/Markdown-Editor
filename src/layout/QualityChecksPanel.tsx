import type { ValidationIssue } from "@/types/validation";

// ── Pure grouping/sorting helpers (exported for tests) ────────────────────────

function numericKey(targetId: string | undefined): number {
  if (!targetId) return Infinity;
  const m = targetId.match(/(\d+)$/);
  return m ? parseInt(m[1], 10) : Infinity;
}

export interface GroupedIssues {
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
}

/**
 * Partitions issues into error/warning groups and sorts each group by the
 * numeric suffix of targetId (ascending document order for sequential IDs).
 * Errors are returned before warnings by convention — callers decide rendering
 * order — but both arrays are independently sorted.
 */
export function groupAndSortIssues(issues: ValidationIssue[]): GroupedIssues {
  const errors = issues
    .filter((i) => i.severity === "error")
    .sort((a, b) => numericKey(a.targetId) - numericKey(b.targetId));
  const warnings = issues
    .filter((i) => i.severity === "warning")
    .sort((a, b) => numericKey(a.targetId) - numericKey(b.targetId));
  return { errors, warnings };
}
