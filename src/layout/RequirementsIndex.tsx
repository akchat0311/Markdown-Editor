import { useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { EditorContext } from "@/editor/EditorContext";
import { useConfigStore } from "@/stores/configStore";
import { useStatusConfigStore } from "@/stores/statusConfigStore";
import { useRequirementIndex } from "@/editor/utils/useRequirementIndex";
import type { RequirementRecord } from "@/editor/utils/requirementOps";
import type { RequirementStatus } from "@/types/requirementStatus";

// ── Badge color palette ───────────────────────────────────────────────────────
// Built-in ids get semantic colors; others cycle through the palette by order.

const BUILTIN_COLORS: Record<string, string> = {
  draft:    "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
  review:   "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-200",
  approved: "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300",
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
    status === "unknown"
      ? "Unknown"
      : (statuses.find((s) => s.id === status)?.label ?? status);
  return (
    <span className={`inline-block rounded px-1.5 py-px text-[10px] font-semibold uppercase tracking-wide ${badgeClass(status, statuses)}`}>
      {label}
    </span>
  );
}

// ── Props ─────────────────────────────────────────────────────────────────────

interface RequirementsIndexProps {
  open: boolean;
  onClose: () => void;
}

// ── Modal ─────────────────────────────────────────────────────────────────────

export function RequirementsIndex({ open, onClose }: RequirementsIndexProps) {
  const editor = useContext(EditorContext);
  const requirementPattern = useConfigStore((s) => s.requirementPattern);
  const setRequirementPattern = useConfigStore((s) => s.setRequirementPattern);
  const statuses = useStatusConfigStore((s) => s.statuses);

  const index = useRequirementIndex(editor, requirementPattern?.example ?? null);

  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");

  const searchRef = useRef<HTMLInputElement>(null);

  // Focus search on open, reset filters on close.
  useEffect(() => {
    if (open) {
      setQuery("");
      setStatusFilter("all");
      setTimeout(() => searchRef.current?.focus(), 50);
    }
  }, [open]);

  // Close on Escape.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const handleRowClick = useCallback(
    (rec: RequirementRecord) => {
      if (!editor) return;
      editor.chain().focus().setTextSelection(rec.pmPos + 1).scrollIntoView().run();
      onClose();
    },
    [editor, onClose]
  );

  // Filter buttons: All + each configured status in order.
  const filterOptions = useMemo(
    () => [{ id: "all", label: "All" }, ...statuses.map((s) => ({ id: s.id, label: s.label }))],
    [statuses]
  );

  const filteredRows = useMemo(() => {
    if (!index) return [];
    const q = query.trim().toLowerCase();
    return index.requirements.filter((r) => {
      const matchesStatus = statusFilter === "all" || r.status === statusFilter;
      const matchesQuery =
        !q ||
        r.id.toLowerCase().includes(q) ||
        r.section.toLowerCase().includes(q);
      return matchesStatus && matchesQuery;
    });
  }, [index, query, statusFilter]);

  if (!open) return null;

  const total = index?.total ?? 0;
  const statusCounts = index?.statusCounts ?? {};

  // Summary pills — show only statuses with count > 0, in config order.
  const summaryItems = statuses
    .filter((s) => (statusCounts[s.id] ?? 0) > 0)
    .map((s) => ({ label: s.label, count: statusCounts[s.id] }));
  if ((statusCounts.unknown ?? 0) > 0) {
    summaryItems.push({ label: "Unknown", count: statusCounts.unknown });
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 pt-[10vh] backdrop-blur-sm"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="flex w-full max-w-3xl flex-col rounded-xl border border-[var(--color-border)] bg-[var(--color-paper)] shadow-2xl"
        style={{ maxHeight: "78vh" }}
      >
        {/* ── Header ── */}
        <div className="flex items-center justify-between border-b border-[var(--color-border)] px-4 py-3">
          <h2 className="text-sm font-semibold text-[var(--color-text)]">Requirements Index</h2>
          <button
            onMouseDown={onClose}
            className="flex h-6 w-6 items-center justify-center rounded text-[var(--color-muted)] hover:bg-[var(--color-border)] hover:text-[var(--color-text)]"
            aria-label="Close"
          >
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
              <path d="M1 1l8 8M9 1L1 9" />
            </svg>
          </button>
        </div>

        {/* ── No pattern configured ── */}
        {!requirementPattern ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 py-12 text-center">
            <p className="text-sm text-[var(--color-muted)]">No requirement pattern configured.</p>
            <p className="text-xs text-[var(--color-muted)]">
              Set a pattern example (e.g. <code className="rounded bg-[var(--color-border)] px-1">REQ_001</code>) in the Outline panel to detect requirements.
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
            {/* ── Summary line ── */}
            <div className="flex items-center gap-3 border-b border-[var(--color-border)] px-4 py-2 text-xs text-[var(--color-muted)]">
              <span className="font-medium text-[var(--color-text)]">{total} Requirements</span>
              {summaryItems.map((item, i) => (
                <span key={item.label} className="flex items-center gap-3">
                  {i === 0 || true ? <span className="opacity-40">·</span> : null}
                  <span>{item.count} {item.label}</span>
                </span>
              ))}
            </div>

            {/* ── Search + filter ── */}
            <div className="flex items-center gap-2 border-b border-[var(--color-border)] px-4 py-2">
              <div className="relative flex-1">
                <svg
                  className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-[var(--color-muted)]"
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
                  className="w-full rounded border border-[var(--color-border)] bg-[var(--color-page-bg)] py-1.5 pl-7 pr-3 text-xs text-[var(--color-text)] outline-none focus:border-[var(--color-accent)]"
                />
              </div>

              {/* Dynamic status filter — built from config, ordered by status.order */}
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
            </div>

            {/* ── Table ── */}
            <div className="min-h-0 flex-1 overflow-y-auto">
              {filteredRows.length === 0 ? (
                <div className="flex flex-col items-center justify-center gap-2 px-6 py-14 text-center text-sm text-[var(--color-muted)]">
                  {index && index.total === 0 ? (
                    <>
                      <p>No requirements detected.</p>
                      <p className="text-xs">
                        Requirements matching pattern <code className="rounded bg-[var(--color-border)] px-1">{requirementPattern.example}</code> will appear here.
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
                    </tr>
                  </thead>
                  <tbody>
                    {filteredRows.map((rec) => (
                      <tr
                        key={`${rec.id}-${rec.pmPos}`}
                        onClick={() => handleRowClick(rec)}
                        className="cursor-pointer border-b border-[var(--color-border)] last:border-0 hover:bg-[var(--color-border)]/50 transition-colors"
                      >
                        <td className="max-w-[220px] truncate px-4 py-2.5 text-[var(--color-muted)]">
                          {rec.section}
                        </td>
                        <td className="px-4 py-2.5 font-mono font-medium text-[var(--color-text)]">
                          {rec.id}
                        </td>
                        <td className="px-4 py-2.5">
                          <StatusBadge status={rec.status} statuses={statuses} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            {/* ── Footer ── */}
            {filteredRows.length > 0 && filteredRows.length < (index?.total ?? 0) && (
              <div className="border-t border-[var(--color-border)] px-4 py-1.5 text-center text-[10px] text-[var(--color-muted)]">
                Showing {filteredRows.length} of {index?.total} requirements
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
