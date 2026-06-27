export type ValidationSeverity = "warning" | "error";
export type ValidationCategory = "language" | "structure" | "completeness" | "consistency" | "traceability";

export interface ValidationIssue {
  /** Stable identifier for this issue (unique within a single validation run). */
  id: string;
  severity: ValidationSeverity;
  /**
   * Machine-readable rule name. First-party types:
   *   "requirement-order"  — numeric ID out of ascending document order
   */
  type: string;
  /** Human-readable description. */
  message: string;
  /** The requirement ID (or other target identifier) the issue refers to. */
  targetId?: string;
  /** Rule category — used for grouping in the Quality dashboard. */
  category?: ValidationCategory;
}
