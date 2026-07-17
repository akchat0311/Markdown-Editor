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
  /** Index into the top-level docContent[] array for document-level issues without a targetId. */
  documentIndex?: number;
  /**
   * Character offsets, within the string the rule scanned (today, always
   * RequirementRef.bodyText), that the issue refers to. Optional and
   * additive — absent means whole-requirement-level, the behavior of every
   * rule before this field existed. A rule populates this only when the
   * range is cheaply and unambiguously known (e.g. from a regex match's
   * own `index`/length) — never guessed. Exists to make future inline
   * diagnostics and quick fixes possible without another data-model
   * change; nothing consumes it yet (no inline decorations, no quick-fix
   * application — both explicitly out of scope for this phase).
   */
  range?: { from: number; to: number };
}
