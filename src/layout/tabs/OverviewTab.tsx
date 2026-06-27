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

// ── SVG icons ─────────────────────────────────────────────────────────────────

function IconDoc({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="16" y1="13" x2="8" y2="13" />
      <line x1="16" y1="17" x2="8" y2="17" />
      <line x1="10" y1="9" x2="8" y2="9" />
    </svg>
  );
}

function IconLayers({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <polygon points="12 2 2 7 12 12 22 7 12 2" />
      <polyline points="2 17 12 22 22 17" />
      <polyline points="2 12 12 17 22 12" />
    </svg>
  );
}

function IconMessageCircle({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  );
}

function IconAlertCircle({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="8" x2="12" y2="12" />
      <line x1="12" y1="16" x2="12.01" y2="16" />
    </svg>
  );
}

// ── Stat card ─────────────────────────────────────────────────────────────────

function StatCard({
  icon,
  iconBg,
  label,
  value,
  accentValue,
  onClick,
  testId,
}: {
  icon: React.ReactNode;
  iconBg: string;
  label: string;
  value: number;
  accentValue?: string;
  onClick?: () => void;
  testId?: string;
}) {
  return (
    <div
      data-testid={testId}
      onClick={onClick}
      className={[
        "flex items-center gap-4 rounded-2xl border border-[var(--color-border)] bg-[var(--color-paper)] p-5",
        onClick ? "cursor-pointer transition-colors hover:border-[var(--color-accent)]/40" : "",
      ].join(" ")}
    >
      <span className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-xl ${iconBg}`}>
        {icon}
      </span>
      <div>
        <div className={`text-4xl font-bold leading-none tabular-nums ${accentValue ?? "text-[var(--color-text)]"}`}>
          {value}
        </div>
        <div className="mt-1 text-sm text-[var(--color-muted)]">{label}</div>
      </div>
    </div>
  );
}

// ── Mini stat card (for Open / Pending / Closed breakdown) ────────────────────

function MiniStatCard({
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
  return (
    <div
      data-testid={testId}
      onClick={onClick}
      className={[
        "flex items-center gap-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-paper)] px-4 py-3",
        onClick ? "cursor-pointer transition-colors hover:border-[var(--color-accent)]/40" : "",
      ].join(" ")}
    >
      <div className={`text-3xl font-bold tabular-nums leading-none ${accent ?? "text-[var(--color-text)]"}`}>
        {value}
      </div>
      <div className="text-sm text-[var(--color-muted)]">{label}</div>
    </div>
  );
}

// ── Severity circle (for attention rows, matches Quality tab's SeverityCircle) ─

function SeverityCircle({ severity }: { severity: "error" | "warning" | "info" }) {
  const bg =
    severity === "error" ? "bg-red-500" :
    severity === "warning" ? "bg-amber-500" :
    "bg-blue-500";
  return (
    <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${bg}`}>
      <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
        {severity === "info"
          ? <><line x1="12" y1="16" x2="12" y2="12" /><line x1="12" y1="8" x2="12.01" y2="8" /></>
          : <><line x1="12" y1="8" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" /></>
        }
      </svg>
    </span>
  );
}

// ── Attention item ────────────────────────────────────────────────────────────

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
  return (
    <div
      className="flex items-start gap-4 px-5 py-4"
      data-testid="attention-item"
    >
      <SeverityCircle severity={item.severity} />
      <div className="flex-1 text-sm text-[var(--color-text)]">{item.text}</div>
      <button
        className="shrink-0 text-sm font-medium text-[var(--color-accent)] transition-colors hover:opacity-75"
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

  // ── Validation aggregates ─────────────────────────────────────────────────────
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

  // ── Attention items ───────────────────────────────────────────────────────────
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
        tabId: "quality",
        severity: "error",
      });
    }
    if (warningCount > 0) {
      items.push({
        text: `${warningCount} validation warning${warningCount !== 1 ? "s" : ""}`,
        tabId: "quality",
        severity: "warning",
      });
    }
    if (hasOrderingIssues) {
      items.push({
        text: "Requirement ordering issues detected",
        tabId: "quality",
        severity: "warning",
      });
    }
    return items;
  }, [commentTotals, openTargetCount, statusCounts, statuses, errorCount, warningCount, hasOrderingIssues]);

  const hasIssues = issues.length > 0;

  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-5" data-testid="overview-tab">
      <div className="space-y-5">

        {/* ── Primary stat grid ────────────────────────────────────────────── */}
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4" data-testid="stat-grid">
          <StatCard
            icon={<IconDoc className="h-6 w-6 text-blue-600 dark:text-blue-400" />}
            iconBg="bg-blue-100 dark:bg-blue-900/30"
            label="Requirements"
            value={index?.total ?? 0}
            onClick={() => onSwitchTab("requirements")}
            testId="stat-requirements"
          />
          <StatCard
            icon={<IconLayers className="h-6 w-6 text-slate-500 dark:text-slate-400" />}
            iconBg="bg-slate-100 dark:bg-slate-800"
            label="Sections"
            value={sectionCount}
            testId="stat-sections"
          />
          <StatCard
            icon={<IconMessageCircle className="h-6 w-6 text-violet-600 dark:text-violet-400" />}
            iconBg="bg-violet-100 dark:bg-violet-900/30"
            label="Comments"
            value={commentTotals.total}
            onClick={commentTotals.total > 0 ? () => onSwitchTab("reviews") : undefined}
            testId="stat-comments"
          />
          <StatCard
            icon={<IconAlertCircle className={`h-6 w-6 ${hasIssues ? "text-red-600 dark:text-red-400" : "text-slate-400 dark:text-slate-500"}`} />}
            iconBg={hasIssues ? "bg-red-100 dark:bg-red-900/30" : "bg-slate-100 dark:bg-slate-800"}
            label="Issues"
            value={issues.length}
            accentValue={hasIssues ? "text-red-600 dark:text-red-400" : undefined}
            onClick={hasIssues ? () => onSwitchTab("quality") : undefined}
            testId="stat-issues"
          />
        </div>

        {/* ── Needs Attention ──────────────────────────────────────────────── */}
        <div data-testid="needs-attention">
          <div className="mb-3 flex items-center gap-2.5">
            <h2 className="text-sm font-bold uppercase tracking-wider text-[var(--color-text)]">
              Needs Attention
            </h2>
            {attentionItems.length > 0 && (
              <span className="rounded-full bg-[var(--color-border)] px-2 py-0.5 text-[11px] font-semibold tabular-nums text-[var(--color-muted)]">
                {attentionItems.length}
              </span>
            )}
          </div>

          {attentionItems.length === 0 ? (
            <div
              data-testid="all-clear"
              className="flex items-center gap-4 rounded-2xl border border-[var(--color-border)] bg-[var(--color-paper)] px-5 py-4"
            >
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-green-100 dark:bg-green-900/30">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4 text-green-600 dark:text-green-400">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              </span>
              <span className="text-sm text-green-700 dark:text-green-400">Everything looks good</span>
            </div>
          ) : (
            <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-paper)] divide-y divide-[var(--color-border)]">
              {attentionItems.map((item, i) => (
                <AttentionRow key={i} item={item} onSwitchTab={onSwitchTab} />
              ))}
            </div>
          )}
        </div>

        {/* ── Comment breakdown ────────────────────────────────────────────── */}
        {commentTotals.total > 0 && (
          <div>
            <h2 className="mb-3 text-sm font-bold uppercase tracking-wider text-[var(--color-text)]">
              Review Comments
            </h2>
            <div className="grid grid-cols-3 gap-3">
              <MiniStatCard
                label="Open"
                value={commentTotals.open}
                accent={commentTotals.open > 0 ? "text-red-600 dark:text-red-400" : undefined}
                onClick={() => onSwitchTab("reviews")}
                testId="stat-open"
              />
              <MiniStatCard
                label="Pending"
                value={commentTotals.responded}
                accent={commentTotals.responded > 0 ? "text-amber-600 dark:text-amber-400" : undefined}
                onClick={() => onSwitchTab("reviews")}
                testId="stat-pending"
              />
              <MiniStatCard
                label="Closed"
                value={commentTotals.closed}
                accent={commentTotals.closed > 0 ? "text-green-600 dark:text-green-400" : undefined}
                onClick={() => onSwitchTab("reviews")}
                testId="stat-closed"
              />
            </div>
          </div>
        )}

        {/* ── Status distribution ──────────────────────────────────────────── */}
        {distributionItems.length > 0 && (
          <div data-testid="status-distribution">
            <h2 className="mb-3 text-sm font-bold uppercase tracking-wider text-[var(--color-text)]">
              Requirement Status
            </h2>
            <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-paper)] px-5 py-4">
              <div className="flex flex-wrap gap-2">
                {distributionItems.map(({ id, label, count }) => (
                  <button
                    key={id}
                    data-testid={`dist-${id}`}
                    className={`inline-flex cursor-pointer items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-opacity hover:opacity-80 ${badgeClass(id, statuses)}`}
                    onClick={() => onSwitchTab("requirements")}
                  >
                    {label}
                    <span className="opacity-70">({count})</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ── No pattern hint ──────────────────────────────────────────────── */}
        {!requirementPattern && (
          <p className="text-xs text-[var(--color-muted)]">
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
    </div>
  );
}
