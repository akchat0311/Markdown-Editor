import { useValidationStore } from "@/stores/validationStore";
import { groupAndSortIssues } from "@/layout/QualityChecksPanel";
import type { ValidationIssue } from "@/types/validation";

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

function IssueRow({
  issue,
  onNavigate,
}: {
  issue: ValidationIssue;
  onNavigate: (targetId: string) => void;
}) {
  return (
    <button
      data-testid="issue-row"
      data-issue-id={issue.id}
      className="flex w-full items-start gap-2.5 px-4 py-2.5 text-left transition-colors hover:bg-[var(--color-border)]"
      onClick={() => issue.targetId && onNavigate(issue.targetId)}
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

function SectionLabel({ label }: { label: string }) {
  return (
    <p className="px-4 pb-1 pt-3 text-[10px] font-semibold uppercase tracking-widest text-[var(--color-muted)]">
      {label}
    </p>
  );
}

// ── Tab ───────────────────────────────────────────────────────────────────────

export interface InsightsTabProps {
  /** Called with the targetId when the user clicks an issue row. The Dashboard
   *  resolves the targetId to a PM position and navigates. */
  onNavigateByTargetId: (targetId: string) => void;
}

export function InsightsTab({ onNavigateByTargetId }: InsightsTabProps) {
  const issues = useValidationStore((s) => s.issues);
  const { errors, warnings } = groupAndSortIssues(issues);
  const hasIssues = errors.length > 0 || warnings.length > 0;
  const total = errors.length + warnings.length;

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      {/* Tab header strip */}
      <div className="flex shrink-0 items-center gap-2 border-b border-[var(--color-border)] px-4 py-2">
        <span className="text-xs font-medium text-[var(--color-text)]">
          Validation Issues
        </span>
        {hasIssues && (
          <span
            className="rounded-full bg-[var(--color-border)] px-2 py-0.5 text-[10px] font-semibold text-[var(--color-muted)]"
            data-testid="issue-count-badge"
          >
            {total}
          </span>
        )}
      </div>

      {/* Content */}
      <div className="min-h-0 flex-1 overflow-y-auto" data-testid="insights-content">
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
            <SectionLabel label={`Errors (${errors.length})`} />
            {errors.map((issue) => (
              <IssueRow key={issue.id} issue={issue} onNavigate={onNavigateByTargetId} />
            ))}
          </section>
        )}

        {warnings.length > 0 && (
          <section aria-label="Warnings" data-testid="warnings-section">
            <SectionLabel label={`Warnings (${warnings.length})`} />
            {warnings.map((issue) => (
              <IssueRow key={issue.id} issue={issue} onNavigate={onNavigateByTargetId} />
            ))}
          </section>
        )}
      </div>

      {hasIssues && (
        <div className="shrink-0 border-t border-[var(--color-border)] px-4 py-2">
          <p className="text-[10px] text-[var(--color-muted)]">
            Click a row to navigate to the requirement
          </p>
        </div>
      )}
    </div>
  );
}
