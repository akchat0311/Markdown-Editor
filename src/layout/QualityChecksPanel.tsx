import { useEffect } from "react";
import { useValidationStore } from "@/stores/validationStore";
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

// ── Sub-components ─────────────────────────────────────────────────────────────

function SeverityIcon({ severity }: { severity: "error" | "warning" }) {
  if (severity === "error") {
    return (
      <span className="shrink-0 text-[12px] text-red-500" aria-hidden="true">
        ❌
      </span>
    );
  }
  return (
    <span className="shrink-0 text-[12px] text-amber-500" aria-hidden="true">
      ⚠
    </span>
  );
}

interface IssueRowProps {
  issue: ValidationIssue;
  onNavigate: (targetId: string) => void;
  onClose: () => void;
}

function IssueRow({ issue, onNavigate, onClose }: IssueRowProps) {
  const handleClick = () => {
    if (issue.targetId) {
      onNavigate(issue.targetId);
    }
    onClose();
  };

  return (
    <button
      data-testid="issue-row"
      data-issue-id={issue.id}
      className="flex w-full items-start gap-2.5 px-4 py-2.5 text-left transition-colors hover:bg-[var(--color-border)]"
      onClick={handleClick}
      title={issue.targetId ? `Navigate to ${issue.targetId}` : undefined}
    >
      <SeverityIcon severity={issue.severity} />
      {issue.targetId && (
        <span
          className="shrink-0 font-mono text-xs font-semibold text-[var(--color-text)]"
          data-testid="issue-target-id"
        >
          {issue.targetId}
        </span>
      )}
      <span className="min-w-0 flex-1 text-xs text-[var(--color-muted)]" data-testid="issue-message">
        {issue.message}
      </span>
    </button>
  );
}

function SectionHeader({ label }: { label: string }) {
  return (
    <p className="px-4 pb-1 pt-3 text-[10px] font-semibold uppercase tracking-widest text-[var(--color-muted)]">
      {label}
    </p>
  );
}

// ── Panel ─────────────────────────────────────────────────────────────────────

export interface QualityChecksPanelProps {
  open: boolean;
  onClose: () => void;
  /**
   * Called with the targetId when the user clicks an issue row.
   * The caller is responsible for scrolling the requirement into view and
   * focusing the editor. The panel closes itself after calling this.
   */
  onNavigate: (targetId: string) => void;
}

export function QualityChecksPanel({
  open,
  onClose,
  onNavigate,
}: QualityChecksPanelProps) {
  const issues = useValidationStore((s) => s.issues);
  const { errors, warnings } = groupAndSortIssues(issues);
  const hasIssues = errors.length > 0 || warnings.length > 0;
  const total = errors.length + warnings.length;

  // Escape closes the panel
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 pt-[10vh] backdrop-blur-sm"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      aria-modal="true"
      role="dialog"
      aria-label="Quality Checks"
    >
      <div
        className="flex min-h-0 w-full max-w-2xl flex-col rounded-xl border border-[var(--color-border)] bg-[var(--color-paper)] shadow-2xl"
        style={{ maxHeight: "72vh" }}
      >
        {/* Header */}
        <div className="flex shrink-0 items-center justify-between border-b border-[var(--color-border)] px-4 py-3">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold text-[var(--color-text)]">
              Quality Checks
            </h2>
            {hasIssues && (
              <span
                className="rounded-full bg-[var(--color-border)] px-2 py-0.5 text-[10px] font-semibold text-[var(--color-muted)]"
                data-testid="issue-count-badge"
              >
                {total}
              </span>
            )}
          </div>
          <button
            onClick={onClose}
            className="flex h-6 w-6 items-center justify-center rounded text-[var(--color-muted)] transition-colors hover:bg-[var(--color-border)] hover:text-[var(--color-text)]"
            aria-label="Close Quality Checks"
          >
            <svg
              width="10"
              height="10"
              viewBox="0 0 10 10"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
            >
              <path d="M1 1l8 8M9 1L1 9" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="min-h-0 flex-1 overflow-y-auto">
          {!hasIssues && (
            <p
              className="flex items-center gap-2 px-4 py-8 text-sm text-[var(--color-muted)]"
              data-testid="empty-state"
            >
              <span className="text-green-500" aria-hidden="true">✓</span>
              No quality issues found
            </p>
          )}

          {errors.length > 0 && (
            <section aria-label="Errors" data-testid="errors-section">
              <SectionHeader label={`Errors (${errors.length})`} />
              {errors.map((issue) => (
                <IssueRow
                  key={issue.id}
                  issue={issue}
                  onNavigate={onNavigate}
                  onClose={onClose}
                />
              ))}
            </section>
          )}

          {warnings.length > 0 && (
            <section aria-label="Warnings" data-testid="warnings-section">
              <SectionHeader label={`Warnings (${warnings.length})`} />
              {warnings.map((issue) => (
                <IssueRow
                  key={issue.id}
                  issue={issue}
                  onNavigate={onNavigate}
                  onClose={onClose}
                />
              ))}
            </section>
          )}
        </div>

        {/* Footer */}
        {hasIssues && (
          <div className="shrink-0 border-t border-[var(--color-border)] px-4 py-2">
            <p className="text-[10px] text-[var(--color-muted)]">
              Click a row to navigate to the requirement
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
