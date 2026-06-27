import { useContext, useMemo } from "react";
import { useEditorState } from "@tiptap/react";
import { EditorContext } from "@/editor/EditorContext";
import { useConfigStore } from "@/stores/configStore";
import { useStatusConfigStore } from "@/stores/statusConfigStore";
import { useValidationStore } from "@/stores/validationStore";
import { useCommentDetails } from "@/editor/utils/useCommentDetails";
import { useRequirementIndex } from "@/editor/utils/useRequirementIndex";
import { deriveOutline, flattenOutline } from "@/editor/utils/deriveOutline";
import { badgeClass } from "@/layout/shared/StatusBadge";
import type { RequirementStatus } from "@/types/requirementStatus";

// ── Stat card ─────────────────────────────────────────────────────────────────

function StatCard({
  label,
  value,
  accent,
  onClick,
  testId,
}: {
  label: string;
  value: number;
  accent?: string;
  onClick?: () => void;
  testId?: string;
}) {
  const cls = [
    "flex flex-col items-center rounded-lg border border-[var(--color-border)] px-4 py-3",
    onClick ? "cursor-pointer transition-colors hover:border-[var(--color-accent)] hover:bg-[var(--color-border)]/30" : "",
  ].join(" ");

  return (
    <div className={cls} onClick={onClick} data-testid={testId}>
      <span className={`text-2xl font-semibold tabular-nums ${accent ?? "text-[var(--color-text)]"}`}>
        {value}
      </span>
      <span className="mt-0.5 text-center text-[11px] text-[var(--color-muted)]">{label}</span>
    </div>
  );
}

// ── Needs attention item ───────────────────────────────────────────────────────

interface AttentionItem {
  text: string;
  tabId: string;
  severity: "error" | "warning" | "info";
}

function AttentionRow({
  item,
  onSwitchTab,
}: {
  item: AttentionItem;
  onSwitchTab: (tabId: string) => void;
}) {
  const dotCls =
    item.severity === "error"
      ? "text-red-500"
      : item.severity === "warning"
      ? "text-amber-500"
      : "text-blue-500";

  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-[var(--color-border)] px-3 py-2" data-testid="attention-item">
      <div className="flex items-center gap-2 text-xs text-[var(--color-text)]">
        <span className={dotCls} aria-hidden="true">●</span>
        {item.text}
      </div>
      <button
        className="shrink-0 rounded px-2 py-0.5 text-[11px] text-[var(--color-accent)] transition-colors hover:bg-[var(--color-accent)]/10"
        onClick={() => onSwitchTab(item.tabId)}
      >
        View →
      </button>
    </div>
  );
}

// ── Tab ───────────────────────────────────────────────────────────────────────

export interface OverviewTabProps {
  onSwitchTab: (tabId: string) => void;
}

export function OverviewTab({ onSwitchTab }: OverviewTabProps) {
  const editor = useContext(EditorContext);
  const requirementPattern = useConfigStore((s) => s.requirementPattern);
  const statuses = useStatusConfigStore((s) => s.statuses);
  const issues = useValidationStore((s) => s.issues);
  const commentDetails = useCommentDetails();

  const index = useRequirementIndex(editor, requirementPattern?.example ?? null);

  // Subscribe to doc changes to recompute outline length
  const doc = useEditorState({
    editor,
    selector: ({ editor: e }) => e?.state.doc ?? null,
    equalityFn: (a, b) => a === b,
  });

  const outlineLength = useMemo(() => {
    if (!editor) return 0;
    return flattenOutline(deriveOutline(editor)).length;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, doc]);

  const sectionCount = outlineLength - (index?.total ?? 0);

  // ── Comment aggregates ────────────────────────────────────────────────────────
  const commentTotals = useMemo(() => {
    let total = 0, open = 0, responded = 0, closed = 0;
    for (const d of Object.values(commentDetails)) {
      total += d.total;
      open += d.open;
      responded += d.responded;
      closed += d.closed;
    }
    return { total, open, responded, closed };
  }, [commentDetails]);

  const openTargetCount = useMemo(
    () => Object.values(commentDetails).filter((d) => d.open > 0).length,
    [commentDetails],
  );

  // ── Validation ────────────────────────────────────────────────────────────────
  const errorCount = issues.filter((i) => i.severity === "error").length;
  const warningCount = issues.filter((i) => i.severity === "warning").length;
  const hasOrderingIssues = issues.some((i) => i.type === "requirement-order");

  // ── Status distribution ───────────────────────────────────────────────────────
  const statusCounts = index?.statusCounts ?? {};
  const distributionItems = useMemo((): { id: string; label: string; count: number }[] => {
    const items: { id: string; label: string; count: number }[] = [];
    for (const s of statuses) {
      const count = statusCounts[s.id] ?? 0;
      if (count > 0) items.push({ id: s.id, label: s.label, count });
    }
    const unknownCount = statusCounts.unknown ?? 0;
    if (unknownCount > 0) items.push({ id: "unknown", label: "Unknown", count: unknownCount });
    return items;
  }, [statuses, statusCounts]);

  // ── Needs attention list ──────────────────────────────────────────────────────
  const attentionItems = useMemo((): AttentionItem[] => {
    const items: AttentionItem[] = [];
    if (commentTotals.open > 0) {
      items.push({
        text: `${openTargetCount} target${openTargetCount !== 1 ? "s" : ""} ${openTargetCount !== 1 ? "have" : "has"} open review comment${commentTotals.open !== 1 ? "s" : ""} (${commentTotals.open} total)`,
        tabId: "reviews",
        severity: "error",
      });
    }
    if (commentTotals.responded > 0) {
      items.push({
        text: `${commentTotals.responded} comment${commentTotals.responded !== 1 ? "s" : ""} awaiting closure`,
        tabId: "reviews",
        severity: "warning",
      });
    }
    // Flag requirements in non-final statuses (draft, in-review)
    const draftCount = statusCounts["draft"] ?? 0;
    const inReviewCount = statusCounts["in-review"] ?? 0;
    if (draftCount > 0) {
      const label = statuses.find((s) => s.id === "draft")?.label ?? "Draft";
      items.push({
        text: `${draftCount} requirement${draftCount !== 1 ? "s" : ""} still ${label}`,
        tabId: "requirements",
        severity: "info",
      });
    }
    if (inReviewCount > 0) {
      const label = statuses.find((s) => s.id === "in-review")?.label ?? "In Review";
      items.push({
        text: `${inReviewCount} requirement${inReviewCount !== 1 ? "s" : ""} ${label}`,
        tabId: "requirements",
        severity: "info",
      });
    }
    if (errorCount > 0) {
      items.push({
        text: `${errorCount} validation error${errorCount !== 1 ? "s" : ""}`,
        tabId: "insights",
        severity: "error",
      });
    }
    if (warningCount > 0) {
      items.push({
        text: `${warningCount} validation warning${warningCount !== 1 ? "s" : ""}`,
        tabId: "insights",
        severity: "warning",
      });
    }
    if (hasOrderingIssues) {
      items.push({
        text: "Requirement ordering issues detected",
        tabId: "insights",
        severity: "warning",
      });
    }
    return items;
  }, [commentTotals, openTargetCount, statusCounts, statuses, errorCount, warningCount, hasOrderingIssues]);

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4" data-testid="overview-tab">
      {/* ── Needs attention ── */}
      <div className="mb-5" data-testid="needs-attention">
        <p className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-[var(--color-muted)]">
          Needs Attention
        </p>
        {attentionItems.length === 0 ? (
          <div className="flex items-center gap-2 rounded-lg border border-[var(--color-border)] px-3 py-3 text-sm text-green-600 dark:text-green-400" data-testid="all-clear">
            <span aria-hidden="true">✓</span>
            <span>Everything looks good</span>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {attentionItems.map((item, i) => (
              <AttentionRow key={i} item={item} onSwitchTab={onSwitchTab} />
            ))}
          </div>
        )}
      </div>

      {/* ── Comment breakdown ── */}
      {commentTotals.total > 0 && (
        <div className="mb-4 grid grid-cols-3 gap-3">
          <StatCard
            label="Open"
            value={commentTotals.open}
            accent={commentTotals.open > 0 ? "text-red-600 dark:text-red-400" : undefined}
            onClick={() => onSwitchTab("reviews")}
            testId="stat-open"
          />
          <StatCard
            label="Pending"
            value={commentTotals.responded}
            accent={commentTotals.responded > 0 ? "text-amber-600 dark:text-amber-400" : undefined}
            onClick={() => onSwitchTab("reviews")}
            testId="stat-pending"
          />
          <StatCard
            label="Closed"
            value={commentTotals.closed}
            accent={commentTotals.closed > 0 ? "text-green-600 dark:text-green-400" : undefined}
            onClick={() => onSwitchTab("reviews")}
            testId="stat-closed"
          />
        </div>
      )}

      {/* ── Requirement status distribution ── */}
      {distributionItems.length > 0 && (
        <div className="mb-4" data-testid="status-distribution">
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-[var(--color-muted)]">
            Requirement Status
          </p>
          <div className="flex flex-wrap gap-2">
            {distributionItems.map(({ id, label, count }) => (
              <button
                key={id}
                className={`inline-flex cursor-pointer items-center gap-1.5 rounded px-2.5 py-1 text-[11px] font-medium transition-opacity hover:opacity-80 ${badgeClass(id, statuses)}`}
                onClick={() => onSwitchTab("requirements")}
                data-testid={`dist-${id}`}
              >
                {label}
                <span className="opacity-70">({count})</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ── Primary stats grid ── */}
      <div className="grid grid-cols-4 gap-3" data-testid="stat-grid">
        <StatCard
          label="Requirements"
          value={index?.total ?? 0}
          onClick={() => onSwitchTab("requirements")}
          testId="stat-requirements"
        />
        <StatCard
          label="Sections"
          value={sectionCount}
          testId="stat-sections"
        />
        <StatCard
          label="Comments"
          value={commentTotals.total}
          onClick={commentTotals.total > 0 ? () => onSwitchTab("reviews") : undefined}
          testId="stat-comments"
        />
        <StatCard
          label="Issues"
          value={issues.length}
          accent={issues.length > 0 ? "text-red-600 dark:text-red-400" : undefined}
          onClick={issues.length > 0 ? () => onSwitchTab("insights") : undefined}
          testId="stat-issues"
        />
      </div>

      {/* ── No pattern hint ── */}
      {!requirementPattern && (
        <p className="mt-4 text-xs text-[var(--color-muted)]">
          Set a requirement pattern in the{" "}
          <button
            className="text-[var(--color-accent)] hover:underline"
            onClick={() => onSwitchTab("requirements")}
          >
            Requirements tab
          </button>{" "}
          to track requirement status.
        </p>
      )}
    </div>
  );
}
