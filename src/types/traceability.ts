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

/** On-disk schema of the <document>.test-traceability.json sidecar. */
export interface TraceabilityFile {
  version?: number;
  testCases: TestCase[];
  links: TraceLink[];
}
