export interface TestCase {
  /** User-facing ID — the primary key. Unique within the file (exact string). */
  id: string;
  title: string;
}

export interface TraceLink {
  /** Test case ID — must reference an entry in `testCases`. */
  tc: string;
  /**
   * Requirement ID exactly as matched in the markdown heading (e.g. "REQ_001").
   * May reference a requirement that no longer exists in the document — such
   * links are "broken" but are preserved, never deleted.
   */
  req: string;
}

/**
 * Engineer-selected verification coverage for a requirement — never inferred
 * automatically from the linked test cases. Applies to the whole requirement,
 * not to individual links, because a set of test cases may only collectively
 * verify it.
 */
export type CoverageStatus = "NONE" | "PARTIAL" | "FULL";

export const COVERAGE_STATUSES: readonly CoverageStatus[] = ["NONE", "PARTIAL", "FULL"];

/** Display labels — the UI and CSV export must show only these strings. */
export const COVERAGE_LABELS: Record<CoverageStatus, string> = {
  NONE: "No",
  PARTIAL: "Partial",
  FULL: "Yes",
};

/** On-disk schema of the <document>.test-traceability.json sidecar. */
export interface TraceabilityFile {
  version?: number;
  testCases: TestCase[];
  links: TraceLink[];
  /** Requirement ID → coverage status. Missing entries default to "NONE". */
  coverage: Record<string, CoverageStatus>;
}
