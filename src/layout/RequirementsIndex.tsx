import { useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { EditorContext } from "@/editor/EditorContext";
import { useConfigStore } from "@/stores/configStore";
import { useStatusConfigStore } from "@/stores/statusConfigStore";
import { useReviewCommentsStore } from "@/stores/reviewCommentsStore";
import { useToastStore } from "@/stores/toastStore";
import { useTabStore, getActiveTab } from "@/stores";
import { useRequirementIndex } from "@/editor/utils/useRequirementIndex";
import { CommentDrawer } from "@/layout/CommentDrawer";
import { deriveOutline, flattenOutline } from "@/editor/utils/deriveOutline";
import { collectReviewExportRows, generateReviewCsv, downloadReviewCsv } from "@/services/reviewExportService";
import type { RequirementRecord } from "@/editor/utils/requirementOps";
import type { RequirementStatus } from "@/types/requirementStatus";
import type { ReviewComment } from "@/types/reviewComment";

// ── Badge color palette (requirement status) ──────────────────────────────────

const BUILTIN_COLORS: Record<string, string> = {
  draft:       "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
  ready:       "bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300",
  "in-review": "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-200",
  approved:    "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300",
};

const PALETTE = [
  "bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300",
  "bg-pink-100 text-pink-700 dark:bg-pink-900/40 dark:text-pink-300",
  "bg-teal-100 text-teal-700 dark:bg-teal-900/40 dark:text-teal-300",
  "bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300",
];

const UNKNOWN_COLOR = "bg-[var(--color-border)] text-[var(--color-muted)]";

function badgeClass(statusId: string, statuses: RequirementStatus[]): string {
  if (statusId === "unknown") return UNKNOWN_COLOR;
  if (statusId in BUILTIN_COLORS) return BUILTIN_COLORS[statusId];
  const idx = statuses.findIndex((s) => s.id === statusId);
  return PALETTE[idx % PALETTE.length] ?? UNKNOWN_COLOR;
}

function StatusBadge({ status, statuses }: { status: string; statuses: RequirementStatus[] }) {
  const label =
    status === "unknown" ? "Unknown" : (statuses.find((s) => s.id === status)?.label ?? status);
  return (
    <span
      className={`inline-block rounded px-1.5 py-px text-[10px] font-semibold uppercase tracking-wide ${badgeClass(status, statuses)}`}
    >
      {label}
    </span>
  );
}

// ── Review status cell ────────────────────────────────────────────────────────

type ReviewState = "none" | "open" | "pending" | "clear";

interface CommentDetail {
  total: number;
  open: number;
  responded: number;
  closed: number;
}

function ReviewStatusCell({
  reqId,
  detail,
  isSelected,
  onClick,
}: {
  reqId: string;
  detail: CommentDetail | undefined;
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
        <svg
          width="9"
          height="9"
          viewBox="0 0 9 9"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
        >
          <path d="M4.5 1v7M1 4.5h7" />
        </svg>
        Add
      </button>
    );
  }

  const { open, responded, total } = detail;
  const hasOpen = open > 0;
  const hasPending = responded > 0;

  let indicator: string;
  let label: string;
  let cls: string;

  if (hasOpen) {
    indicator = "●";
    label = `${open} open`;
    cls = isSelected
      ? "bg-red-600 text-white"
      : "bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-400 hover:bg-red-200 dark:hover:bg-red-950/60";
  } else if (hasPending) {
    indicator = "●";
    label = `${responded} pending`;
    cls = isSelected
      ? "bg-amber-600 text-white"
      : "bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400 hover:bg-amber-200 dark:hover:bg-amber-950/60";
  } else {
    indicator = "✓";
    label = `${total}`;
    cls = isSelected
      ? "bg-green-600 text-white"
      : "bg-green-100 text-green-700 dark:bg-green-950/40 dark:text-green-400 hover:bg-green-200 dark:hover:bg-green-950/60";
  }

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

// ── Review state filter options ───────────────────────────────────────────────

const REVIEW_FILTER_OPTIONS: { id: ReviewState | "all"; label: string }[] = [
  { id: "all", label: "All Reviews" },
  { id: "open", label: "Has Open" },
  { id: "pending", label: "Awaiting Closure" },
  { id: "clear", label: "All Clear" },
];

// ── Props ─────────────────────────────────────────────────────────────────────

interface RequirementsIndexProps {
  open: boolean;
  onClose: () => void;
  onLoadReview: () => void;
  onSaveReview: () => void;
  onSaveReviewAs: () => void;
}

// ── Modal ─────────────────────────────────────────────────────────────────────

export function RequirementsIndex({
  open,
  onClose,
  onLoadReview,
  onSaveReview,
  onSaveReviewAs,
}: RequirementsIndexProps) {
  const editor = useContext(EditorContext);
  const requirementPattern = useConfigStore((s) => s.requirementPattern);
  const setRequirementPattern = useConfigStore((s) => s.setRequirementPattern);
  const statuses = useStatusConfigStore((s) => s.statuses);
  const reviewLoaded = useReviewCommentsStore((s) => s.loaded);
  const reviewIsDirty = useReviewCommentsStore((s) => s.isDirty);
  const reviewComments = useReviewCommentsStore((s) => s.comments);

  const index = useRequirementIndex(editor, requirementPattern?.example ?? null);

  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [reviewFilter, setReviewFilter] = useState<ReviewState | "all">("all");
  const [selectedRecord, setSelectedRecord] = useState<RequirementRecord | null>(null);

  const searchRef = useRef<HTMLInputElement>(null);

  // Per-requirement comment breakdown (guards against _version numeric field)
  const commentDetails = useMemo(() => {
    const details: Record<string, CommentDetail> = {};
    for (const [reqId, val] of Object.entries(reviewComments)) {
      if (reqId.startsWith("_") || !Array.isArray(val)) continue;
      const arr = val as ReviewComment[];
      details[reqId] = {
        total: arr.length,
        open: arr.filter((c) => c.status === "open").length,
        responded: arr.filter((c) => c.status === "responded").length,
        closed: arr.filter((c) => c.status === "closed").length,
      };
    }
    return details;
  }, [reviewComments]);

  // Per-requirement review state (for filtering)
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

  // Summary counts
  const totalComments = useMemo(
    () => Object.values(commentDetails).reduce((s, d) => s + d.total, 0),
    [commentDetails],
  );
  const openReqCount = useMemo(
    () => Object.values(reviewStates).filter((s) => s === "open").length,
    [reviewStates],
  );
  const pendingReqCount = useMemo(
    () => Object.values(reviewStates).filter((s) => s === "pending").length,
    [reviewStates],
  );

  // Focus search on open, reset state on close.
  useEffect(() => {
    if (open) {
      setQuery("");
      setStatusFilter("all");
      setReviewFilter("all");
      setSelectedRecord(null);
      setTimeout(() => searchRef.current?.focus(), 50);
    }
  }, [open]);

  // Close on Escape (only when drawer is not open).
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !selectedRecord) onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose, selectedRecord]);

  const handleRowClick = useCallback(
    (rec: RequirementRecord) => {
      if (!editor) return;
      editor.chain().focus().setTextSelection(rec.pmPos + 1).scrollIntoView().run();
      onClose();
    },
    [editor, onClose],
  );

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

  // Status filter buttons: All + each configured status in order.
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
        (reviewFilter === "none"
          ? !reviewStates[r.id]
          : reviewStates[r.id] === reviewFilter);
      return matchesStatus && matchesQuery && matchesReview;
    });
  }, [index, query, statusFilter, reviewFilter, reviewStates]);

  if (!open) return null;

  const total = index?.total ?? 0;
  const statusCounts = index?.statusCounts ?? {};

  const summaryItems = statuses
    .filter((s) => (statusCounts[s.id] ?? 0) > 0)
    .map((s) => ({ label: s.label, count: statusCounts[s.id] }));
  if ((statusCounts.unknown ?? 0) > 0) {
    summaryItems.push({ label: "Unknown", count: statusCounts.unknown });
  }

  const hasDrawer = selectedRecord !== null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 pt-[10vh] backdrop-blur-sm"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className={[
          "flex min-h-0 flex-row rounded-xl border border-[var(--color-border)] bg-[var(--color-paper)] shadow-2xl",
          hasDrawer ? "w-full max-w-5xl" : "w-full max-w-3xl",
        ].join(" ")}
        style={{ maxHeight: "78vh" }}
      >
        {/* ── Main panel ── */}
        <div className="flex min-w-0 flex-1 flex-col">
          {/* Header */}
          <div className="flex items-center justify-between border-b border-[var(--color-border)] px-4 py-3">
            <h2 className="text-sm font-semibold text-[var(--color-text)]">Requirements Index</h2>
            <div className="flex items-center gap-2">
              {reviewLoaded && reviewIsDirty && (
                <button
                  onMouseDown={onSaveReview}
                  className="rounded border border-amber-400 px-2.5 py-1 text-[11px] text-amber-600 hover:bg-amber-50 dark:text-amber-400 dark:hover:bg-amber-900/20 transition-colors"
                >
                  ● Save Reviews
                </button>
              )}
              {reviewLoaded && !reviewIsDirty && (
                <span className="text-[11px] text-[var(--color-muted)] opacity-60">
                  Reviews Saved
                </span>
              )}
              {reviewLoaded && (
                <button
                  onMouseDown={onSaveReviewAs}
                  className="rounded border border-[var(--color-border)] px-2.5 py-1 text-[11px] text-[var(--color-muted)] hover:bg-[var(--color-border)] transition-colors"
                  title="Save review comments to a different file"
                >
                  Save As…
                </button>
              )}
              {reviewLoaded && totalComments > 0 && (
                <button
                  onMouseDown={handleExportCsv}
                  className="rounded border border-[var(--color-border)] px-2.5 py-1 text-[11px] text-[var(--color-muted)] hover:bg-[var(--color-border)] transition-colors"
                  title="Export all review comments as CSV"
                >
                  Export CSV…
                </button>
              )}
              <button
                onMouseDown={onLoadReview}
                className="rounded border border-[var(--color-border)] px-2.5 py-1 text-[11px] text-[var(--color-muted)] hover:bg-[var(--color-border)] transition-colors"
                title="Load a .review.json sidecar file"
              >
                {reviewLoaded ? "Load Different…" : "Load Reviews…"}
              </button>
              <button
                onMouseDown={onClose}
                className="flex h-6 w-6 items-center justify-center rounded text-[var(--color-muted)] hover:bg-[var(--color-border)] hover:text-[var(--color-text)]"
                aria-label="Close"
              >
                <svg
                  width="10"
                  height="10"
                  viewBox="0 0 10 10"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                >
                  <path d="M1 1l8 8M9 1L1 9" />
                </svg>
              </button>
            </div>
          </div>

          {/* ── No pattern configured ── */}
          {!requirementPattern ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 py-12 text-center">
              <p className="text-sm text-[var(--color-muted)]">No requirement pattern configured.</p>
              <p className="text-xs text-[var(--color-muted)]">
                Set a pattern example (e.g.{" "}
                <code className="rounded bg-[var(--color-border)] px-1">REQ_001</code>) in the
                Outline panel to detect requirements.
              </p>
              <button
                className="mt-2 rounded-md border border-[var(--color-border)] px-3 py-1.5 text-xs text-[var(--color-text)] hover:bg-[var(--color-border)] transition-colors"
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
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-[var(--color-border)] px-4 py-2 text-xs text-[var(--color-muted)]">
                <span className="font-medium text-[var(--color-text)]">{total} Requirements</span>
                {summaryItems.map((item) => (
                  <span key={item.label} className="flex items-center gap-3">
                    <span className="opacity-40">·</span>
                    <span>
                      {item.count} {item.label}
                    </span>
                  </span>
                ))}
                {reviewLoaded && totalComments > 0 && (
                  <>
                    <span className="opacity-40">·</span>
                    {openReqCount > 0 ? (
                      <span className="font-medium text-red-600 dark:text-red-400">
                        {openReqCount} with open comments
                      </span>
                    ) : pendingReqCount > 0 ? (
                      <span className="font-medium text-amber-600 dark:text-amber-400">
                        {pendingReqCount} awaiting closure
                      </span>
                    ) : (
                      <span className="font-medium text-green-600 dark:text-green-400">
                        All comments closed
                      </span>
                    )}
                  </>
                )}
              </div>

              {/* ── Search + filters ── */}
              <div className="flex flex-wrap items-center gap-2 border-b border-[var(--color-border)] px-4 py-2">
                {/* Search input */}
                <div className="relative min-w-[160px] flex-1">
                  <svg
                    className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-[var(--color-muted)]"
                    width="12"
                    height="12"
                    viewBox="0 0 16 16"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
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
                    className="w-full rounded border border-[var(--color-border)] bg-[var(--color-page-bg)] py-1.5 pl-7 pr-3 text-xs text-[var(--color-text)] outline-none focus:border-[var(--color-accent)]"
                  />
                </div>

                {/* Requirement status filter */}
                <div className="flex items-center rounded-md border border-[var(--color-border)] text-[11px]">
                  {filterOptions.map((opt) => (
                    <button
                      key={opt.id}
                      onClick={() => setStatusFilter(opt.id)}
                      className={[
                        "px-2.5 py-1 transition-colors first:rounded-l-md last:rounded-r-md",
                        statusFilter === opt.id
                          ? "bg-[var(--color-accent)] text-white"
                          : "text-[var(--color-muted)] hover:bg-[var(--color-border)] hover:text-[var(--color-text)]",
                      ].join(" ")}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>

                {/* Review status filter (only when reviews loaded) */}
                {reviewLoaded && totalComments > 0 && (
                  <select
                    value={reviewFilter}
                    onChange={(e) => setReviewFilter(e.target.value as ReviewState | "all")}
                    className="rounded border border-[var(--color-border)] bg-[var(--color-paper)] px-2 py-1 text-[11px] text-[var(--color-text)] outline-none focus:border-[var(--color-accent)]"
                  >
                    {REVIEW_FILTER_OPTIONS.map((opt) => (
                      <option key={opt.id} value={opt.id}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
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
                            {requirementPattern.example}
                          </code>{" "}
                          will appear here.
                        </p>
                      </>
                    ) : (
                      <p>No requirements match the current filter.</p>
                    )}
                  </div>
                ) : (
                  <table className="w-full text-xs">
                    <thead className="sticky top-0 border-b border-[var(--color-border)] bg-[var(--color-paper)]">
                      <tr className="text-left text-[10px] font-semibold uppercase tracking-wide text-[var(--color-muted)]">
                        <th className="px-4 py-2">Section</th>
                        <th className="px-4 py-2">Req ID</th>
                        <th className="px-4 py-2">Status</th>
                        <th className="px-4 py-2 text-right">Review Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredRows.map((rec) => {
                        const isSelected = selectedRecord?.id === rec.id;
                        return (
                          <tr
                            key={`${rec.id}-${rec.pmPos}`}
                            className={[
                              "border-b border-[var(--color-border)] last:border-0 transition-colors",
                              isSelected
                                ? "bg-[var(--color-border)]/60"
                                : "hover:bg-[var(--color-border)]/50",
                            ].join(" ")}
                          >
                            <td
                              className="max-w-[180px] cursor-pointer truncate px-4 py-2.5 text-[var(--color-muted)]"
                              onClick={() => handleRowClick(rec)}
                            >
                              {rec.section}
                            </td>
                            <td
                              className="cursor-pointer px-4 py-2.5 font-mono font-medium text-[var(--color-text)]"
                              onClick={() => handleRowClick(rec)}
                            >
                              {rec.id}
                            </td>
                            <td
                              className="cursor-pointer px-4 py-2.5"
                              onClick={() => handleRowClick(rec)}
                            >
                              <StatusBadge status={rec.status} statuses={statuses} />
                            </td>
                            <td className="px-4 py-2.5 text-right">
                              <ReviewStatusCell
                                reqId={rec.id}
                                detail={commentDetails[rec.id]}
                                isSelected={isSelected}
                                onClick={() => setSelectedRecord(isSelected ? null : rec)}
                              />
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </div>

              {filteredRows.length > 0 && filteredRows.length < (index?.total ?? 0) && (
                <div className="border-t border-[var(--color-border)] px-4 py-1.5 text-center text-[10px] text-[var(--color-muted)]">
                  Showing {filteredRows.length} of {index?.total} requirements
                </div>
              )}
            </>
          )}
        </div>

        {/* ── Comment drawer (right panel) ── */}
        <CommentDrawer record={selectedRecord} onClose={() => setSelectedRecord(null)} />
      </div>
    </div>
  );
}
