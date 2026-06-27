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
import { REVIEW_STATUS_CHIP_CLS } from "@/layout/shared/reviewStatusColors";
import { isSectionReviewTarget, extractSectionNumber, sectionReviewId } from "@/editor/utils/sectionReviewOps";
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

function OpenBadge({ open, responded, total }: { open: number; responded: number; total: number }) {
  const base = "inline-flex items-center gap-1 rounded px-2 py-0.5 text-[11px] font-medium";
  if (open > 0)
    return (
      <span className={`${base} ${REVIEW_STATUS_CHIP_CLS.open}`} data-testid="open-badge">
        ● {open} open
      </span>
    );
  if (responded > 0)
    return (
      <span className={`${base} ${REVIEW_STATUS_CHIP_CLS.responded}`} data-testid="open-badge">
        ● {responded} pending
      </span>
    );
  if (total > 0)
    return (
      <span className={`${base} ${REVIEW_STATUS_CHIP_CLS.closed}`} data-testid="open-badge">
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
  onLoadReview: () => void;
  onSaveReview: () => void;
  onSaveReviewAs: () => void;
}

export function ReviewsTab({ onNavigate, onLoadReview, onSaveReview, onSaveReviewAs }: ReviewsTabProps) {
  const editor = useContext(EditorContext);
  const requirementPattern = useConfigStore((s) => s.requirementPattern);
  const statuses = useStatusConfigStore((s) => s.statuses);
  const reviewComments = useReviewCommentsStore((s) => s.comments);
  const reviewLoaded = useReviewCommentsStore((s) => s.loaded);
  const reviewIsDirty = useReviewCommentsStore((s) => s.isDirty);
  const reviewHandle = useTabStore((s) => getActiveTab(s)?.reviewHandle ?? null);
  const reviewFileName = reviewHandle?.name;

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

  const sectionPosMap = useMemo((): ReadonlyMap<string, number> => {
    if (!editor) return new Map();
    const map = new Map<string, number>();
    for (const node of flattenOutline(deriveOutline(editor))) {
      const num = extractSectionNumber(node.label);
      if (num) map.set(sectionReviewId(num), node.pmPos);
    }
    return map;
  }, [editor, index]);

  const allRows = useMemo(
    () => buildDashboardRows(reviewComments, index?.requirements ?? [], sectionPosMap),
    [reviewComments, index, sectionPosMap],
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
      {/* ── Review File section ── */}
      <div className="shrink-0 border-b border-[var(--color-border)] px-5 py-4" data-testid="review-file-section">
        <h2 className="mb-3 text-sm font-bold uppercase tracking-wider text-[var(--color-text)]">
          Review File
        </h2>
        <div className="flex flex-wrap items-center justify-between gap-3">
          {/* Status */}
          <div className="min-w-0">
            {!reviewLoaded ? (
              <p className="text-xs text-[var(--color-muted)]" data-testid="review-file-status">
                No review file loaded
              </p>
            ) : (
              <>
                {reviewFileName && (
                  <p className="truncate text-xs font-medium text-[var(--color-text)]" data-testid="review-file-name">
                    {reviewFileName}
                  </p>
                )}
                <p
                  className={`text-[11px] ${reviewIsDirty ? "text-amber-600 dark:text-amber-400" : "text-[var(--color-muted)]"}`}
                  data-testid="review-file-status"
                >
                  {reviewIsDirty ? "● Modified" : "✓ Saved"}
                </p>
              </>
            )}
          </div>
          {/* Actions */}
          <div className="flex shrink-0 flex-wrap items-center gap-1.5">
            {reviewLoaded && reviewIsDirty && (
              <button
                onClick={onSaveReview}
                className="rounded border border-amber-400 px-2.5 py-1 text-[11px] text-amber-600 transition-colors hover:bg-amber-50 dark:text-amber-400 dark:hover:bg-amber-900/20"
                data-testid="save-review-btn"
              >
                Save
              </button>
            )}
            {reviewLoaded && (
              <button
                onClick={onSaveReviewAs}
                className="rounded border border-[var(--color-border)] px-2.5 py-1 text-[11px] text-[var(--color-muted)] transition-colors hover:bg-[var(--color-border)]"
                data-testid="save-review-as-btn"
              >
                Save As…
              </button>
            )}
            <button
              onClick={onLoadReview}
              className="rounded border border-[var(--color-border)] px-2.5 py-1 text-[11px] text-[var(--color-muted)] transition-colors hover:bg-[var(--color-border)]"
              data-testid="load-review-btn"
            >
              {reviewLoaded ? "Load Different…" : "Load Review…"}
            </button>
            {hasData && (
              <button
                onClick={handleExportCsv}
                className="rounded border border-[var(--color-border)] px-2.5 py-1 text-[11px] text-[var(--color-muted)] transition-colors hover:bg-[var(--color-border)]"
                title="Export all review comments as CSV"
                data-testid="export-csv-btn"
              >
                Export CSV…
              </button>
            )}
          </div>
        </div>
      </div>

      {/* ── Overview cards ── */}
      {hasData && (
        <div className="shrink-0 border-b border-[var(--color-border)] bg-[var(--color-paper)] px-5 py-4" data-testid="overview-cards">
          <div className="grid grid-cols-5 gap-3">
            {[
              { label: "Targets",        value: allRows.length,               testId: "card-targets" },
              { label: "Total Comments", value: overviewStats.totalComments,   testId: "card-total" },
              { label: "Open",           value: overviewStats.openCount,       testId: "card-open",      accent: overviewStats.openCount > 0 ? "text-red-600 dark:text-red-400" : undefined },
              { label: "Pending",        value: overviewStats.respondedCount,  testId: "card-responded", accent: overviewStats.respondedCount > 0 ? "text-amber-600 dark:text-amber-400" : undefined },
              { label: "Closed",         value: overviewStats.closedCount,     testId: "card-closed",    accent: overviewStats.closedCount > 0 ? "text-green-600 dark:text-green-400" : undefined },
            ].map(({ label, value, testId, accent }) => (
              <div key={testId} data-testid={testId} className="flex flex-col items-center rounded-xl border border-[var(--color-border)] bg-[var(--color-page-bg)] px-3 py-3">
                <span className={`text-2xl font-bold tabular-nums ${accent ?? "text-[var(--color-text)]"}`}>{value}</span>
                <span className="mt-1 text-[10px] text-[var(--color-muted)]">{label}</span>
              </div>
            ))}
          </div>
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
                    <OpenBadge open={row.open} responded={row.responded} total={row.total} />
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
