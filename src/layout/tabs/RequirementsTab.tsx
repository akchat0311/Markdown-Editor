import { useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { EditorContext } from "@/editor/EditorContext";
import { useConfigStore } from "@/stores/configStore";
import { useStatusConfigStore } from "@/stores/statusConfigStore";
import { useReviewCommentsStore } from "@/stores/reviewCommentsStore";
import { useRequirementIndex } from "@/editor/utils/useRequirementIndex";
import { useCommentDetails } from "@/editor/utils/useCommentDetails";
import { badgeClass, statusLabel } from "@/layout/shared/StatusBadge";
import { REVIEW_STATUS_CHIP_CLS, REVIEW_STATUS_SELECTED_CLS, REVIEW_STATUS_HOVER_CLS } from "@/layout/shared/reviewStatusColors";
import { describeRequirementPattern } from "@/editor/utils/requirementOps";
import type { RequirementRecord } from "@/editor/utils/requirementOps";

// ── Review status cell ─────────────────────────────────────────────────────────

type ReviewState = "none" | "open" | "pending" | "clear";

function ReviewStatusCell({
  reqId,
  detail,
  isSelected,
  onClick,
}: {
  reqId: string;
  detail: { total: number; open: number; responded: number; closed: number } | undefined;
  isSelected: boolean;
  onClick: () => void;
}) {
  if (!detail || detail.total === 0) {
    return (
      <button
        onClick={onClick}
        className={[
          "inline-flex items-center gap-1 rounded border px-2 py-0.5 text-[11px] font-medium transition-colors",
          isSelected
            ? "border-[var(--color-accent)] bg-[var(--color-accent)]/10 text-[var(--color-accent)]"
            : "border-[var(--color-border)] text-[var(--color-muted)] hover:border-[var(--color-accent)] hover:text-[var(--color-accent)]",
        ].join(" ")}
        title={`Add a review comment to ${reqId}`}
      >
        <svg width="9" height="9" viewBox="0 0 9 9" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
          <path d="M4.5 1v7M1 4.5h7" />
        </svg>
        Add Review
      </button>
    );
  }

  const { open, responded, total } = detail;

  let indicator: string;
  let label: string;
  let cls: string;

  const status = open > 0 ? "open" : responded > 0 ? "responded" : "closed";
  if (open > 0) {
    indicator = "●";
    label = `${open} open`;
  } else if (responded > 0) {
    indicator = "●";
    label = `${responded} pending`;
  } else {
    indicator = "✓";
    label = `${total}`;
  }
  cls = isSelected
    ? REVIEW_STATUS_SELECTED_CLS[status]
    : `${REVIEW_STATUS_CHIP_CLS[status]} ${REVIEW_STATUS_HOVER_CLS[status]}`;

  return (
    <button
      onClick={onClick}
      className={`inline-flex items-center gap-1 rounded px-2 py-0.5 text-[11px] font-medium transition-colors ${cls}`}
      title={`${total} review comment${total !== 1 ? "s" : ""} — click to open`}
    >
      <span>{indicator}</span>
      <span>{label}</span>
    </button>
  );
}

// ── Review filter options ──────────────────────────────────────────────────────

const REVIEW_FILTER_OPTIONS: { id: ReviewState | "all"; label: string }[] = [
  { id: "all",     label: "All Reviews" },
  { id: "open",    label: "Has Open" },
  { id: "pending", label: "Awaiting Closure" },
  { id: "clear",   label: "All Clear" },
];

// ── Tab ───────────────────────────────────────────────────────────────────────

export interface RequirementsTabProps {
  onNavigate: (pmPos: number) => void;
  selectedRecord: RequirementRecord | null;
  onSelectRecord: (r: RequirementRecord | null) => void;
}

export function RequirementsTab({
  onNavigate,
  selectedRecord,
  onSelectRecord,
}: RequirementsTabProps) {
  const editor = useContext(EditorContext);
  const requirementPattern = useConfigStore((s) => s.requirementPattern);
  const setRequirementPattern = useConfigStore((s) => s.setRequirementPattern);
  const statuses = useStatusConfigStore((s) => s.statuses);
  const reviewLoaded = useReviewCommentsStore((s) => s.loaded);
  const commentDetails = useCommentDetails();

  const index = useRequirementIndex(editor, requirementPattern);

  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [reviewFilter, setReviewFilter] = useState<ReviewState | "all">("all");

  const searchRef = useRef<HTMLInputElement>(null);

  // Auto-focus the search input when the tab mounts (becomes active)
  useEffect(() => {
    const id = setTimeout(() => searchRef.current?.focus(), 50);
    return () => clearTimeout(id);
  }, []);

  // Per-requirement review states (for filter)
  const reviewStates = useMemo(() => {
    const states: Record<string, ReviewState> = {};
    for (const [reqId, d] of Object.entries(commentDetails)) {
      if (d.total === 0) states[reqId] = "none";
      else if (d.open > 0) states[reqId] = "open";
      else if (d.responded > 0) states[reqId] = "pending";
      else states[reqId] = "clear";
    }
    return states;
  }, [commentDetails]);

  const totalComments = useMemo(
    () => Object.values(commentDetails).reduce((s, d) => s + d.total, 0),
    [commentDetails],
  );
  const openReqCount = useMemo(
    () => Object.values(reviewStates).filter((s) => s === "open").length,
    [reviewStates],
  );

  const filterOptions = useMemo(
    () => [{ id: "all", label: "All" }, ...statuses.map((s) => ({ id: s.id, label: s.label }))],
    [statuses],
  );

  const filteredRows = useMemo(() => {
    if (!index) return [];
    const q = query.trim().toLowerCase();
    return index.requirements.filter((r) => {
      const matchesStatus = statusFilter === "all" || r.status === statusFilter;
      const matchesQuery =
        !q || r.id.toLowerCase().includes(q) || r.section.toLowerCase().includes(q);
      const matchesReview =
        reviewFilter === "all" ||
        (reviewFilter === "none" ? !reviewStates[r.id] : reviewStates[r.id] === reviewFilter);
      return matchesStatus && matchesQuery && matchesReview;
    });
  }, [index, query, statusFilter, reviewFilter, reviewStates]);

  const handleRowClick = useCallback(
    (rec: RequirementRecord) => {
      if (!editor) return;
      onNavigate(rec.pmPos);
    },
    [editor, onNavigate],
  );

  const total = index?.total ?? 0;
  const statusCounts = index?.statusCounts ?? {};

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden" data-testid="requirements-tab">
      {/* ── No pattern configured ── */}
      {!requirementPattern ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 py-12 text-center">
          <p className="text-sm text-[var(--color-muted)]">No requirement pattern configured.</p>
          <p className="text-xs text-[var(--color-muted)]">
            Set a pattern example (e.g.{" "}
            <code className="rounded bg-[var(--color-border)] px-1">REQ_001</code>) to detect requirements.
          </p>
          <button
            className="mt-2 rounded-md border border-[var(--color-border)] px-3 py-1.5 text-xs text-[var(--color-text)] transition-colors hover:bg-[var(--color-border)]"
            onClick={() => {
              const ex = window.prompt("Requirement ID example (e.g. REQ_001)");
              if (ex?.trim()) setRequirementPattern(ex.trim());
            }}
          >
            Set Pattern
          </button>
        </div>
      ) : (
        <>
          {/* ── Summary strip ── */}
          <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1 border-b border-[var(--color-border)] bg-[var(--color-paper)] px-4 py-2.5">
            <span className="text-xs">
              <span className="font-semibold text-[var(--color-text)]">{total}</span>
              <span className="ml-1 text-[var(--color-muted)]">Requirements</span>
            </span>
            {statuses.map((s) => (
              <span key={s.id} className="flex items-center gap-3 text-xs">
                <span className="text-[var(--color-muted)] opacity-40">·</span>
                <span>
                  <span className="font-semibold text-[var(--color-text)]">{statusCounts[s.id] ?? 0}</span>
                  <span className="ml-1 text-[var(--color-muted)]">{s.label}</span>
                </span>
              </span>
            ))}
            {(statusCounts.unknown ?? 0) > 0 && (
              <span className="flex items-center gap-3 text-xs">
                <span className="text-[var(--color-muted)] opacity-40">·</span>
                <span>
                  <span className="font-semibold text-[var(--color-text)]">{statusCounts.unknown}</span>
                  <span className="ml-1 text-[var(--color-muted)]">Unknown</span>
                </span>
              </span>
            )}
            {reviewLoaded && (
              <span className="flex items-center gap-3 text-xs">
                <span className="text-[var(--color-muted)] opacity-40">·</span>
                <span>
                  <span className={`font-semibold ${openReqCount > 0 ? "text-red-600 dark:text-red-400" : "text-[var(--color-text)]"}`}>
                    {openReqCount}
                  </span>
                  <span className="ml-1 text-[var(--color-muted)]">Open Reviews</span>
                </span>
              </span>
            )}
          </div>

          {/* ── Filters toolbar ── */}
          <div className="flex shrink-0 items-center gap-3 border-b border-[var(--color-border)] px-4 py-2">
            {/* Search */}
            <div className="relative w-80 shrink-0">
              <svg
                className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--color-muted)]"
                width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"
              >
                <circle cx="7" cy="7" r="5" />
                <path d="m10.5 10.5 3 3" />
              </svg>
              <input
                ref={searchRef}
                type="text"
                placeholder="Search by ID or section…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="w-full rounded border border-[var(--color-border)] bg-[var(--color-page-bg)] py-1.5 pl-8 pr-3 text-xs text-[var(--color-text)] outline-none focus:border-[var(--color-accent)]"
                data-testid="req-search"
              />
            </div>

            <div className="h-4 w-px shrink-0 bg-[var(--color-border)]" />

            {/* Status filter */}
            <div className="flex items-center gap-2">
              <span className="shrink-0 text-[10px] font-bold uppercase tracking-wider text-[var(--color-muted)]">
                Status
              </span>
              <div className="flex items-center rounded border border-[var(--color-border)] text-[11px]">
                {filterOptions.map((opt) => (
                  <button
                    key={opt.id}
                    onClick={() => setStatusFilter(opt.id)}
                    className={[
                      "px-2.5 py-1 transition-colors first:rounded-l last:rounded-r",
                      statusFilter === opt.id
                        ? "bg-[var(--color-accent)] text-white"
                        : "text-[var(--color-muted)] hover:bg-[var(--color-border)] hover:text-[var(--color-text)]",
                    ].join(" ")}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Review filter */}
            {reviewLoaded && totalComments > 0 && (
              <>
                <div className="h-4 w-px shrink-0 bg-[var(--color-border)]" />
                <div className="flex items-center gap-2">
                  <span className="shrink-0 text-[10px] font-bold uppercase tracking-wider text-[var(--color-muted)]">
                    Review
                  </span>
                  <select
                    value={reviewFilter}
                    onChange={(e) => setReviewFilter(e.target.value as ReviewState | "all")}
                    className="rounded border border-[var(--color-border)] bg-[var(--color-paper)] px-2 py-1 text-[11px] text-[var(--color-text)] outline-none focus:border-[var(--color-accent)]"
                  >
                    {REVIEW_FILTER_OPTIONS.map((opt) => (
                      <option key={opt.id} value={opt.id}>{opt.label}</option>
                    ))}
                  </select>
                </div>
              </>
            )}
          </div>

          {/* ── Table ── */}
          <div className="min-h-0 flex-1 overflow-y-auto">
            {filteredRows.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-2 px-6 py-14 text-center text-sm text-[var(--color-muted)]">
                {index && index.total === 0 ? (
                  <>
                    <p>No requirements detected.</p>
                    <p className="text-xs">
                      Requirements matching pattern{" "}
                      <code className="rounded bg-[var(--color-border)] px-1">
                        {describeRequirementPattern(requirementPattern)}
                      </code>{" "}
                      will appear here.
                    </p>
                  </>
                ) : (
                  <p>No requirements match the current filter.</p>
                )}
              </div>
            ) : (
              <table className="w-full table-fixed text-xs" data-testid="requirements-table">
                <colgroup>
                  <col className="w-[40%]" />
                  <col className="w-[20%]" />
                  <col className="w-[20%]" />
                  <col className="w-[20%]" />
                </colgroup>
                <thead className="sticky top-0 border-b border-[var(--color-border)] bg-[var(--color-paper)]">
                  <tr className="text-left text-[10px] font-semibold uppercase tracking-widest text-[var(--color-muted)]">
                    <th className="px-4 py-1.5">Section</th>
                    <th className="px-4 py-1.5">Req ID</th>
                    <th className="px-4 py-1.5">Status</th>
                    <th className="px-4 py-1.5 text-right">Review Status</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredRows.map((rec, i) => {
                    const isSelected = selectedRecord?.id === rec.id;
                    return (
                      <tr
                        key={`${rec.id}-${rec.pmPos}`}
                        data-testid="req-row"
                        className={[
                          "cursor-pointer border-b border-[var(--color-border)] last:border-0 transition-colors",
                          isSelected
                            ? "bg-[var(--color-accent)]/10"
                            : i % 2 === 1
                              ? "bg-black/[0.018] hover:bg-[var(--color-border)]/70 dark:bg-white/[0.025] dark:hover:bg-white/[0.04]"
                              : "hover:bg-[var(--color-border)]/50 dark:hover:bg-white/[0.03]",
                        ].join(" ")}
                      >
                        <td
                          className="truncate px-4 py-1.5 text-[var(--color-muted)]"
                          onClick={() => handleRowClick(rec)}
                        >
                          {rec.section}
                        </td>
                        <td
                          className="px-4 py-1.5 font-mono font-medium text-[var(--color-text)]"
                          onClick={() => handleRowClick(rec)}
                        >
                          {rec.id}
                        </td>
                        <td
                          className="px-4 py-2"
                          onClick={() => handleRowClick(rec)}
                        >
                          <span className={`inline-flex items-center rounded px-2 py-0.5 text-xs font-semibold uppercase tracking-wide ${badgeClass(rec.status, statuses)}`}>
                            {statusLabel(rec.status, statuses)}
                          </span>
                        </td>
                        <td className="px-4 py-1.5 text-right">
                          <ReviewStatusCell
                            reqId={rec.id}
                            detail={commentDetails[rec.id]}
                            isSelected={isSelected}
                            onClick={() => onSelectRecord(isSelected ? null : rec)}
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>

          {filteredRows.length > 0 && filteredRows.length < total && (
            <div className="shrink-0 border-t border-[var(--color-border)] px-4 py-1.5 text-center text-[10px] text-[var(--color-muted)]">
              Showing {filteredRows.length} of {total} requirements
            </div>
          )}
        </>
      )}
    </div>
  );
}
