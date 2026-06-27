import { useCallback, useContext, useMemo, useState } from "react";
import { EditorContext } from "@/editor/EditorContext";
import { useConfigStore } from "@/stores/configStore";
import { useStatusConfigStore } from "@/stores/statusConfigStore";
import { useReviewCommentsStore } from "@/stores/reviewCommentsStore";
import { useToastStore } from "@/stores/toastStore";
import { useTabStore, getActiveTab } from "@/stores";
import { useRequirementIndex } from "@/editor/utils/useRequirementIndex";
import { deriveOutline, flattenOutline } from "@/editor/utils/deriveOutline";
import { collectReviewExportRows, generateReviewCsv, downloadReviewCsv } from "@/services/reviewExportService";
import { buildDashboardRows, sortRows, filterRows } from "@/layout/ReviewDashboard";
import type { DashboardRow } from "@/layout/ReviewDashboard";
import { badgeClass, statusLabel } from "@/layout/shared/StatusBadge";
import { isSectionReviewTarget } from "@/editor/utils/sectionReviewOps";
import type { RequirementStatus } from "@/types/requirementStatus";

// ── Types ─────────────────────────────────────────────────────────────────────

type SortKey = "id" | "open" | "lastUpdated" | "reqStatus";
type SortDir = "asc" | "desc";

// ── Sub-components ─────────────────────────────────────────────────────────────

function SortButton({
  col,
  label,
  current,
  dir,
  onSort,
}: {
  col: SortKey;
  label: string;
  current: SortKey;
  dir: SortDir;
  onSort: (col: SortKey) => void;
}) {
  const active = current === col;
  return (
    <button
      className="flex items-center gap-0.5 text-left text-[10px] font-semibold uppercase tracking-wide text-[var(--color-muted)] hover:text-[var(--color-text)] transition-colors"
      onClick={() => onSort(col)}
      data-testid={`sort-${col}`}
    >
      {label}
      <span className={`ml-0.5 ${active ? "opacity-80" : "opacity-30"}`} aria-hidden="true">
        {active ? (dir === "asc" ? "↑" : "↓") : "↕"}
      </span>
    </button>
  );
}

function OpenBadge({ open, total }: { open: number; total: number }) {
  if (open > 0)
    return (
      <span className="inline-flex items-center gap-1 rounded bg-red-100 px-2 py-0.5 text-[11px] font-medium text-red-700 dark:bg-red-950/40 dark:text-red-400" data-testid="open-badge">
        ● {open} open
      </span>
    );
  if (total > 0)
    return (
      <span className="inline-flex items-center gap-1 rounded bg-green-100 px-2 py-0.5 text-[11px] font-medium text-green-700 dark:bg-green-950/40 dark:text-green-400" data-testid="open-badge">
        ✓ {total}
      </span>
    );
  return null;
}

function formatDate(iso: string): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function StatusDistribution({
  statuses,
  statusCounts,
  activeFilter,
  onFilter,
}: {
  statuses: RequirementStatus[];
  statusCounts: Record<string, number>;
  activeFilter: string;
  onFilter: (id: string) => void;
}) {
  const items = useMemo(() => {
    const result: { id: string; label: string; count: number }[] = [];
    for (const s of statuses) {
      const count = statusCounts[s.id] ?? 0;
      if (count > 0) result.push({ id: s.id, label: s.label, count });
    }
    const unknownCount = statusCounts["unknown"] ?? 0;
    if (unknownCount > 0) result.push({ id: "unknown", label: "Unknown", count: unknownCount });
    return result;
  }, [statuses, statusCounts]);

  if (items.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-[var(--color-border)] px-4 py-2" data-testid="status-distribution">
      <span className="text-[10px] font-semibold uppercase tracking-wide text-[var(--color-muted)]">
        Req Status
      </span>
      <button
        className={[
          "rounded px-2 py-0.5 text-[11px] transition-colors",
          activeFilter === "all"
            ? "bg-[var(--color-accent)] text-white"
            : "text-[var(--color-muted)] hover:bg-[var(--color-border)] hover:text-[var(--color-text)]",
        ].join(" ")}
        onClick={() => onFilter("all")}
      >
        All
      </button>
      {items.map(({ id, label, count }) => (
        <button
          key={id}
          data-testid={`status-filter-${id}`}
          className={[
            "inline-flex items-center gap-1.5 rounded px-2 py-0.5 text-[11px] font-medium transition-colors cursor-pointer",
            activeFilter === id
              ? `${badgeClass(id, statuses)} ring-2 ring-[var(--color-accent)] ring-offset-1`
              : badgeClass(id, statuses),
          ].join(" ")}
          onClick={() => onFilter(activeFilter === id ? "all" : id)}
        >
          {label}
          <span className="opacity-70">({count})</span>
        </button>
      ))}
    </div>
  );
}

// ── Tab ───────────────────────────────────────────────────────────────────────

export interface ReviewsTabProps {
  onNavigate: (pmPos: number) => void;
}

export function ReviewsTab({ onNavigate }: ReviewsTabProps) {
  const editor = useContext(EditorContext);
  const requirementPattern = useConfigStore((s) => s.requirementPattern);
  const statuses = useStatusConfigStore((s) => s.statuses);
  const reviewComments = useReviewCommentsStore((s) => s.comments);

  const index = useRequirementIndex(editor, requirementPattern?.example ?? null);

  const [reqStatusFilter, setReqStatusFilter] = useState("all");
  const [commentStatusFilter, setCommentStatusFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const [hasOpenFilter, setHasOpenFilter] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>("id");
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  const handleSort = useCallback((col: SortKey) => {
    setSortKey((prev) => {
      if (prev === col) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
      else setSortDir("asc");
      return col;
    });
  }, []);

  // ── Data ─────────────────────────────────────────────────────────────────────

  const allRows = useMemo(
    () => buildDashboardRows(reviewComments, index?.requirements ?? []),
    [reviewComments, index],
  );

  const overviewStats = useMemo(() => {
    let totalComments = 0, openCount = 0, respondedCount = 0, closedCount = 0;
    for (const r of allRows) {
      totalComments += r.total;
      openCount += r.open;
      respondedCount += r.responded;
      closedCount += r.closed;
    }
    return { totalComments, openCount, respondedCount, closedCount };
  }, [allRows]);

  const filteredRows = useMemo(
    () => filterRows(allRows, {
      reqStatus: reqStatusFilter,
      commentStatus: commentStatusFilter,
      type: typeFilter,
      hasOpen: hasOpenFilter,
    }),
    [allRows, reqStatusFilter, commentStatusFilter, typeFilter, hasOpenFilter],
  );

  const sortedRows = useMemo(
    () => sortRows(filteredRows, sortKey, sortDir),
    [filteredRows, sortKey, sortDir],
  );

  // ── CSV export ────────────────────────────────────────────────────────────────

  const handleExportCsv = useCallback(() => {
    if (!editor) return;
    const tab = getActiveTab(useTabStore.getState());
    const documentName = tab?.fileName ?? (tab ? `${tab.title}.md` : "document.md");
    const flat = flattenOutline(deriveOutline(editor));
    const docContent = editor.state.doc.content.toJSON();
    const rows = collectReviewExportRows(
      flat,
      docContent,
      documentName,
      requirementPattern?.example ?? null,
      statuses,
      reviewComments,
    );
    if (rows.length === 0) {
      useToastStore.getState().show("No review comments to export.", "info");
      return;
    }
    downloadReviewCsv(generateReviewCsv(rows), documentName);
  }, [editor, requirementPattern, statuses, reviewComments]);

  const handleRowNavigate = useCallback(
    (row: DashboardRow) => {
      if (row.pmPos !== null) onNavigate(row.pmPos);
    },
    [onNavigate],
  );

  const hasData = allRows.length > 0;

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden" data-testid="reviews-tab">
      {/* ── Overview cards ── */}
      {hasData && (
        <div className="grid shrink-0 grid-cols-5 divide-x divide-[var(--color-border)] border-b border-[var(--color-border)]" data-testid="overview-cards">
          {[
            { label: "Targets",         value: allRows.length,            testId: "card-targets" },
            { label: "Total Comments",  value: overviewStats.totalComments, testId: "card-total" },
            { label: "Open",            value: overviewStats.openCount,     testId: "card-open",      accent: overviewStats.openCount > 0 ? "text-red-600 dark:text-red-400" : undefined },
            { label: "Pending",         value: overviewStats.respondedCount, testId: "card-responded", accent: overviewStats.respondedCount > 0 ? "text-amber-600 dark:text-amber-400" : undefined },
            { label: "Closed",          value: overviewStats.closedCount,   testId: "card-closed",    accent: overviewStats.closedCount > 0 ? "text-green-600 dark:text-green-400" : undefined },
          ].map(({ label, value, testId, accent }) => (
            <div key={testId} className="flex flex-col items-center py-3" data-testid={testId}>
              <span className={`text-xl font-semibold ${accent ?? "text-[var(--color-text)]"}`}>{value}</span>
              <span className="mt-0.5 text-[10px] text-[var(--color-muted)]">{label}</span>
            </div>
          ))}
        </div>
      )}

      {/* ── Status distribution ── */}
      {hasData && index && (
        <StatusDistribution
          statuses={statuses}
          statusCounts={index.statusCounts}
          activeFilter={reqStatusFilter}
          onFilter={setReqStatusFilter}
        />
      )}

      {/* ── Filters + export ── */}
      {hasData && (
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-[var(--color-border)] px-4 py-2" data-testid="filters-row">
          <select
            value={commentStatusFilter}
            onChange={(e) => setCommentStatusFilter(e.target.value)}
            className="rounded border border-[var(--color-border)] bg-[var(--color-paper)] px-2 py-1 text-[11px] text-[var(--color-text)] outline-none focus:border-[var(--color-accent)]"
            data-testid="comment-status-filter"
            aria-label="Filter by comment status"
          >
            <option value="all">All Comments</option>
            <option value="open">Has Open</option>
            <option value="responded">Has Pending</option>
            <option value="closed">Has Closed</option>
          </select>
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            className="rounded border border-[var(--color-border)] bg-[var(--color-paper)] px-2 py-1 text-[11px] text-[var(--color-text)] outline-none focus:border-[var(--color-accent)]"
            data-testid="type-filter"
            aria-label="Filter by target type"
          >
            <option value="all">All Types</option>
            <option value="requirement">Requirements</option>
            <option value="section">Sections</option>
          </select>
          <label className="flex cursor-pointer items-center gap-1.5 text-[11px] text-[var(--color-muted)]">
            <input
              type="checkbox"
              checked={hasOpenFilter}
              onChange={(e) => setHasOpenFilter(e.target.checked)}
              className="accent-[var(--color-accent)]"
              data-testid="has-open-filter"
            />
            Open only
          </label>
          <div className="flex-1" />
          <button
            onClick={handleExportCsv}
            className="rounded border border-[var(--color-border)] px-2.5 py-1 text-[11px] text-[var(--color-muted)] transition-colors hover:bg-[var(--color-border)]"
            title="Export all review comments as CSV"
            data-testid="export-csv-btn"
          >
            Export CSV…
          </button>
        </div>
      )}

      {/* ── Table or empty state ── */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {!hasData ? (
          <div className="flex flex-col items-center justify-center gap-3 px-6 py-16 text-center" data-testid="empty-state">
            <p className="text-sm text-[var(--color-muted)]">No review comments yet.</p>
            <p className="text-xs text-[var(--color-muted)] opacity-70">
              Open the Requirements tab to add comments to requirements.
            </p>
          </div>
        ) : sortedRows.length === 0 ? (
          <div className="flex items-center justify-center px-6 py-14 text-sm text-[var(--color-muted)]" data-testid="no-results">
            No targets match the current filter.
          </div>
        ) : (
          <table className="w-full text-xs" data-testid="activity-table">
            <thead className="sticky top-0 border-b border-[var(--color-border)] bg-[var(--color-paper)]">
              <tr>
                <th className="px-4 py-2 text-left">
                  <SortButton col="id" label="Target ID" current={sortKey} dir={sortDir} onSort={handleSort} />
                </th>
                <th className="px-4 py-2 text-left text-[10px] font-semibold uppercase tracking-wide text-[var(--color-muted)]">
                  Section
                </th>
                <th className="px-4 py-2 text-left">
                  <SortButton col="reqStatus" label="Req Status" current={sortKey} dir={sortDir} onSort={handleSort} />
                </th>
                <th className="px-4 py-2 text-left">
                  <SortButton col="open" label="Open" current={sortKey} dir={sortDir} onSort={handleSort} />
                </th>
                <th className="px-4 py-2 text-left text-[10px] font-semibold uppercase tracking-wide text-[var(--color-muted)]">
                  Comments
                </th>
                <th className="px-4 py-2 text-left">
                  <SortButton col="lastUpdated" label="Last Updated" current={sortKey} dir={sortDir} onSort={handleSort} />
                </th>
              </tr>
            </thead>
            <tbody>
              {sortedRows.map((row) => (
                <tr
                  key={row.id}
                  data-testid="dashboard-row"
                  className={[
                    "border-b border-[var(--color-border)] last:border-0 transition-colors",
                    row.pmPos !== null
                      ? "cursor-pointer hover:bg-[var(--color-border)]/50"
                      : "opacity-70",
                  ].join(" ")}
                  onClick={() => handleRowNavigate(row)}
                >
                  <td className="px-4 py-2.5 font-mono font-medium text-[var(--color-text)]">
                    {isSectionReviewTarget(row.id) ? (
                      <span className="flex flex-col gap-0.5">
                        <span className="text-[var(--color-accent)]">§{row.id.replace(/^section:/, "")}</span>
                        {row.section !== "—" && (
                          <span className="text-[10px] font-normal text-[var(--color-muted)]">{row.section}</span>
                        )}
                      </span>
                    ) : (
                      row.id
                    )}
                  </td>
                  <td className="max-w-[160px] truncate px-4 py-2.5 text-[var(--color-muted)]">
                    {row.section}
                  </td>
                  <td className="px-4 py-2.5">
                    {row.reqStatus ? (
                      <span className={`inline-block rounded px-1.5 py-px text-[10px] font-semibold uppercase tracking-wide ${badgeClass(row.reqStatus, statuses)}`} data-testid="req-status-badge">
                        {statusLabel(row.reqStatus, statuses)}
                      </span>
                    ) : (
                      <span className="text-[var(--color-muted)]">—</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5">
                    <OpenBadge open={row.open} total={row.total} />
                  </td>
                  <td className="px-4 py-2.5 text-[var(--color-muted)]">
                    <span className="tabular-nums">{row.open}o</span>
                    <span className="mx-1 opacity-30">/</span>
                    <span className="tabular-nums">{row.responded}p</span>
                    <span className="mx-1 opacity-30">/</span>
                    <span className="tabular-nums">{row.closed}c</span>
                  </td>
                  <td className="px-4 py-2.5 text-[var(--color-muted)]">
                    {formatDate(row.lastUpdated)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {sortedRows.length > 0 && sortedRows.length < allRows.length && (
        <div className="shrink-0 border-t border-[var(--color-border)] px-4 py-1.5 text-center text-[10px] text-[var(--color-muted)]">
          Showing {sortedRows.length} of {allRows.length} targets
        </div>
      )}
    </div>
  );
}
