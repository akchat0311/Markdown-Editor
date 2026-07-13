import type { ValidationIssue } from "@/types/validation";
import { normalizeStatusText } from "@/services/requirementStatusService";

/**
 * Minimal per-requirement data needed by all validators.
 * Populated by useDocumentValidation; exported so the hook can type its array.
 */
export interface RequirementRef {
  /** Exact reconstructed ID, e.g. "REQ_003". */
  id: string;
  /** Integer value of the numeric suffix. Null for regex-mode patterns whose
   *  captured ID isn't purely numeric — such entries are skipped by the
   *  order check (there's no meaningful numeric ordering for them). */
  num: number | null;
  /** Raw text inside the trailing [bracket], or null when no bracket is present. */
  statusText: string | null;
  /** Trimmed plain-text content beneath the heading (the requirement body). */
  bodyText: string;
}

// ── Rule 1 — Requirement ordering ─────────────────────────────────────────────

/**
 * Flags requirements whose numeric suffix is lower than the running maximum
 * seen so far in document order.  Gaps are allowed; only descending transitions
 * are violations.
 *
 * When a violation is found the high-water mark is NOT advanced, so subsequent
 * out-of-order requirements still reference the correct "ceiling" ID.
 *
 * Entries with num === null (regex-mode IDs that aren't purely numeric) are
 * skipped — there's no numeric ordering to violate.
 */
export function checkRequirementOrder(
  requirements: ReadonlyArray<Pick<RequirementRef, "id" | "num">>,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  let maxNum = -Infinity;
  let maxId = "";

  for (let i = 0; i < requirements.length; i++) {
    const { id, num } = requirements[i];
    if (num === null) continue;
    if (num < maxNum) {
      issues.push({
        id: `requirement-order-${i}-${id}`,
        severity: "warning",
        type: "requirement-order",
        message: `${id} appears after ${maxId} but has a lower numeric ID.`,
        targetId: id,
      });
    } else {
      maxNum = num;
      maxId = id;
    }
  }

  return issues;
}

// ── Rule 2 — Duplicate requirement IDs ────────────────────────────────────────

/**
 * Flags every occurrence of a requirement ID that appears more than once in
 * the document.  All duplicates receive an issue (not just the second onwards),
 * so reviewers can locate each instance that needs attention.
 */
export function checkDuplicateIds(
  requirements: ReadonlyArray<Pick<RequirementRef, "id">>,
): ValidationIssue[] {
  const counts = new Map<string, number>();
  for (const { id } of requirements) {
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }

  const issues: ValidationIssue[] = [];
  for (let i = 0; i < requirements.length; i++) {
    const { id } = requirements[i];
    const count = counts.get(id) ?? 1;
    if (count > 1) {
      issues.push({
        id: `duplicate-requirement-id-${i}-${id}`,
        severity: "error",
        type: "duplicate-requirement-id",
        message: `${id} appears ${count} time${count !== 1 ? "s" : ""} in the document.`,
        targetId: id,
      });
    }
  }

  return issues;
}

// ── Rule 3 — Missing requirement status ───────────────────────────────────────

/**
 * Flags requirements whose status bracket is absent or contains an unrecognised
 * value.
 *
 * @param requirements  List of requirements with their raw bracket text.
 * @param validAliases  Complete set of recognised alias strings drawn from the
 *   status configuration, exactly as configured. Matching against `statusText`
 *   is case- and whitespace-insensitive (via normalizeStatusText), matching
 *   resolveRequirementStatus's behavior — but the aliases here are never
 *   rewritten; only the comparison is normalized.
 *   When empty (statuses not yet loaded) only the bracket-presence check fires.
 */
export function checkMissingStatus(
  requirements: ReadonlyArray<Pick<RequirementRef, "id" | "statusText">>,
  validAliases: ReadonlySet<string> = new Set(),
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const normalizedAliases = new Set(
    Array.from(validAliases, (alias) => normalizeStatusText(alias))
  );

  for (let i = 0; i < requirements.length; i++) {
    const { id, statusText } = requirements[i];

    if (statusText === null) {
      issues.push({
        id: `missing-requirement-status-${i}-${id}`,
        severity: "warning",
        type: "missing-requirement-status",
        message: `${id} does not have a status. Add a [Status] bracket.`,
        targetId: id,
      });
    } else if (normalizedAliases.size > 0 && !normalizedAliases.has(normalizeStatusText(statusText))) {
      issues.push({
        id: `missing-requirement-status-${i}-${id}`,
        severity: "warning",
        type: "missing-requirement-status",
        message: `${id} has an unrecognized status "${statusText.trim()}".`,
        targetId: id,
      });
    }
  }

  return issues;
}

// ── Rule 4 — Empty requirement body ───────────────────────────────────────────

/**
 * Flags requirements whose body section contains no meaningful text.
 * Whitespace-only content is treated as empty.
 */
export function checkEmptyBody(
  requirements: ReadonlyArray<Pick<RequirementRef, "id" | "bodyText">>,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  for (let i = 0; i < requirements.length; i++) {
    const { id, bodyText } = requirements[i];
    if (bodyText.trim() === "") {
      issues.push({
        id: `empty-requirement-${i}-${id}`,
        severity: "warning",
        type: "empty-requirement",
        message: `${id} has no body content.`,
        targetId: id,
      });
    }
  }

  return issues;
}

// ── Composition ───────────────────────────────────────────────────────────────

/**
 * Runs all document-quality rules and returns a flat issue list.
 *
 * @param requirements    Full requirement data built by useDocumentValidation.
 * @param validAliases    Alias strings from the status configuration; passed
 *   through to checkMissingStatus.  Pass an empty set when statuses are not
 *   yet loaded — the status rule then only checks for bracket presence.
 */
export function validateDocument(
  requirements: ReadonlyArray<RequirementRef>,
  validAliases: ReadonlySet<string> = new Set(),
): ValidationIssue[] {
  return [
    ...checkRequirementOrder(requirements),
    ...checkDuplicateIds(requirements),
    ...checkMissingStatus(requirements, validAliases),
    ...checkEmptyBody(requirements),
  ];
}
