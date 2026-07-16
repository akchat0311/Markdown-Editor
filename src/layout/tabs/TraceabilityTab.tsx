import { useContext, useEffect, useMemo, useRef, useState } from "react";
import { EditorContext } from "@/editor/EditorContext";
import { useConfigStore } from "@/stores/configStore";
import { useTraceabilityStore } from "@/stores/traceabilityStore";
import { useTabStore, getActiveTab } from "@/stores";
import { useRequirementIndex } from "@/editor/utils/useRequirementIndex";
import {
  describeRequirementPattern,
  compileRequirementPattern,
  matchRequirementId,
} from "@/editor/utils/requirementOps";
import { deriveOutline, flattenOutline } from "@/editor/utils/deriveOutline";
import {
  collectTraceabilityCsvRows,
  generateTraceabilityCsv,
  downloadTraceabilityCsv,
} from "@/services/traceabilityExportService";
import {
  buildTraceabilityRows,
  filterTraceabilityRows,
  findBrokenLinks,
  summarizeTraceability,
} from "@/layout/tabs/traceabilityRows";
import type { TraceLink } from "@/types/traceability";
import {
  ConfirmUnlinkDialog,
  LinkTestCaseDialog,
  TestCaseEditorDialog,
} from "@/layout/traceability/TraceabilityDialogs";

// ── Tab ───────────────────────────────────────────────────────────────────────

export interface TraceabilityTabProps {
  onLoadTraceability: () => void;
  onSaveTraceability: () => void;
  onSaveTraceabilityAs: () => void;
}

export function TraceabilityTab({
  onLoadTraceability,
  onSaveTraceability,
  onSaveTraceabilityAs,
}: TraceabilityTabProps) {
  const editor = useContext(EditorContext);
  const requirementPattern = useConfigStore((s) => s.requirementPattern);
  const index = useRequirementIndex(editor, requirementPattern);

  const testCases = useTraceabilityStore((s) => s.testCases);
  const links = useTraceabilityStore((s) => s.links);
  const isDirty = useTraceabilityStore((s) => s.isDirty);
  const loaded = useTraceabilityStore((s) => s.loaded);
  const loadError = useTraceabilityStore((s) => s.loadError);
  const removeLink = useTraceabilityStore((s) => s.removeLink);
  const removeLinks = useTraceabilityStore((s) => s.removeLinks);

  const [query, setQuery] = useState("");
  const [linkDialogReq, setLinkDialogReq] = useState<string | null>(null);
  const [chipDialog, setChipDialog] = useState<{ tcId: string; reqId: string } | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmUnlink, setConfirmUnlink] = useState<{ message: string; pairs: TraceLink[] } | null>(null);

  const searchRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const id = setTimeout(() => searchRef.current?.focus(), 50);
    return () => clearTimeout(id);
  }, []);

  const requirementIds = useMemo(() => index?.requirements.map((r) => r.id) ?? [], [index]);
  const rows = useMemo(
    () => buildTraceabilityRows(requirementIds, testCases, links),
    [requirementIds, testCases, links],
  );
  const filteredRows = useMemo(() => filterTraceabilityRows(rows, query), [rows, query]);
  const brokenLinks = useMemo(
    () => findBrokenLinks(requirementIds, testCases, links),
    [requirementIds, testCases, links],
  );
  const summary = useMemo(
    () => summarizeTraceability(rows, testCases, links, brokenLinks),
    [rows, testCases, links, brokenLinks],
  );

  // Selection restricted to requirements that still exist in the document —
  // rows can disappear under a live selection while the user edits headings.
  const rowIdSet = useMemo(() => new Set(rows.map((r) => r.reqId)), [rows]);
  const selectedIds = useMemo(
    () => new Set([...selected].filter((id) => rowIdSet.has(id))),
    [selected, rowIdSet],
  );
  const selectedLinkPairs = useMemo(
    () => links.filter((l) => selectedIds.has(l.req)),
    [links, selectedIds],
  );

  const toggleRow = (reqId: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(reqId)) next.delete(reqId);
      else next.add(reqId);
      return next;
    });

  const allFilteredSelected =
    filteredRows.length > 0 && filteredRows.every((r) => selectedIds.has(r.reqId));
  const toggleAllFiltered = () =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (allFilteredSelected) filteredRows.forEach((r) => next.delete(r.reqId));
      else filteredRows.forEach((r) => next.add(r.reqId));
      return next;
    });

  const handleBulkUnlink = () => {
    if (selectedLinkPairs.length === 0) return;
    setConfirmUnlink({
      message: `Remove ${selectedLinkPairs.length} link${selectedLinkPairs.length !== 1 ? "s" : ""} from ${selectedIds.size} selected requirement${selectedIds.size !== 1 ? "s" : ""}?`,
      pairs: selectedLinkPairs,
    });
  };

  const handleRemoveAllBroken = () => {
    setConfirmUnlink({
      message: `Remove all ${brokenLinks.length} broken link${brokenLinks.length !== 1 ? "s" : ""}?`,
      pairs: brokenLinks.map((b) => ({ tc: b.testCase.id, req: b.req })),
    });
  };

  const handleExportCsv = () => {
    if (!editor) return;
    // Recompute the requirement order synchronously — the debounced index can
    // be up to 300 ms behind the document (same rule as the review export).
    const compiled = compileRequirementPattern(requirementPattern);
    const freshIds = compiled
      ? flattenOutline(deriveOutline(editor))
          .map((n) => matchRequirementId(n.label, compiled)?.id)
          .filter((id): id is string => id !== undefined)
      : [];
    const csvRows = collectTraceabilityCsvRows(freshIds, testCases, links);
    const tab = getActiveTab(useTabStore.getState());
    const documentName = tab?.fileName ?? `${tab?.title ?? "document"}.md`;
    downloadTraceabilityCsv(generateTraceabilityCsv(csvRows), documentName);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden" data-testid="traceability-tab">
      {/* ── Traceability File section ── */}
      <div className="shrink-0 border-b border-[var(--color-border)] px-5 py-4" data-testid="traceability-file-section">
        <h2 className="mb-3 text-sm font-bold uppercase tracking-wider text-[var(--color-text)]">
          Traceability File
        </h2>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            {loadError ? (
              <p className="text-xs text-red-600 dark:text-red-400" data-testid="traceability-file-status">
                ⚠ Traceability file could not be read — use Save As to write a new file
              </p>
            ) : !loaded ? (
              <p className="text-xs text-[var(--color-muted)]" data-testid="traceability-file-status">
                No traceability file loaded
              </p>
            ) : (
              <p
                className={`text-[11px] ${isDirty ? "text-amber-600 dark:text-amber-400" : "text-[var(--color-muted)]"}`}
                data-testid="traceability-file-status"
              >
                {isDirty ? "● Modified" : "✓ Saved"}
              </p>
            )}
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-1.5">
            {loaded && isDirty && (
              <button
                onClick={onSaveTraceability}
                className="rounded border border-amber-400 px-2.5 py-1 text-[11px] text-amber-600 transition-colors hover:bg-amber-50 dark:text-amber-400 dark:hover:bg-amber-900/20"
                data-testid="save-traceability-btn"
              >
                Save
              </button>
            )}
            {loaded && (
              <button
                onClick={onSaveTraceabilityAs}
                className="rounded border border-[var(--color-border)] px-2.5 py-1 text-[11px] text-[var(--color-muted)] transition-colors hover:bg-[var(--color-border)]"
                data-testid="save-traceability-as-btn"
              >
                Save As…
              </button>
            )}
            <button
              onClick={onLoadTraceability}
              className="rounded border border-[var(--color-border)] px-2.5 py-1 text-[11px] text-[var(--color-muted)] transition-colors hover:bg-[var(--color-border)]"
              data-testid="load-traceability-btn"
            >
              {loaded ? "Load Different…" : "Load File…"}
            </button>
            {requirementPattern != null && (rows.length > 0 || links.length > 0) && (
              <button
                onClick={handleExportCsv}
                className="rounded border border-[var(--color-border)] px-2.5 py-1 text-[11px] text-[var(--color-muted)] transition-colors hover:bg-[var(--color-border)]"
                title="Export the requirement ↔ test case matrix as CSV"
                data-testid="export-traceability-csv-btn"
              >
                Export CSV…
              </button>
            )}
          </div>
        </div>
      </div>

      {/* ── No pattern configured ── */}
      {!requirementPattern ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 py-12 text-center">
          <p className="text-sm text-[var(--color-muted)]">No requirement pattern configured.</p>
          <p className="text-xs text-[var(--color-muted)]">
            Set a pattern in the Requirements tab to link test cases to requirements.
          </p>
        </div>
      ) : (
        <>
          {/* ── Summary strip ── */}
          <div
            className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1 border-b border-[var(--color-border)] bg-[var(--color-paper)] px-4 py-2.5"
            data-testid="traceability-summary"
          >
            {[
              { value: summary.requirementCount, label: "Requirements" },
              { value: summary.linkedRequirementCount, label: "Linked" },
              { value: summary.testCaseCount, label: "Test Cases" },
              { value: summary.linkCount, label: "Links" },
            ].map((stat, i) => (
              <span key={stat.label} className="flex items-center gap-3 text-xs">
                {i > 0 && <span className="text-[var(--color-muted)] opacity-40">·</span>}
                <span>
                  <span className="font-semibold text-[var(--color-text)]">{stat.value}</span>
                  <span className="ml-1 text-[var(--color-muted)]">{stat.label}</span>
                </span>
              </span>
            ))}
            {summary.brokenLinkCount > 0 && (
              <span className="flex items-center gap-3 text-xs">
                <span className="text-[var(--color-muted)] opacity-40">·</span>
                <span>
                  <span className="font-semibold text-red-600 dark:text-red-400">
                    {summary.brokenLinkCount}
                  </span>
                  <span className="ml-1 text-[var(--color-muted)]">Broken</span>
                </span>
              </span>
            )}
          </div>

          {/* ── Search + selection toolbar ── */}
          <div className="flex shrink-0 items-center gap-3 border-b border-[var(--color-border)] px-4 py-2">
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
                placeholder="Search requirement ID, test case ID, or title…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="w-full rounded border border-[var(--color-border)] bg-[var(--color-page-bg)] py-1.5 pl-8 pr-3 text-xs text-[var(--color-text)] outline-none focus:border-[var(--color-accent)]"
                data-testid="traceability-search"
              />
            </div>

            {/* Selection toolbar — appears when rows are checked */}
            {selectedIds.size > 0 && (
              <>
                <div className="h-4 w-px shrink-0 bg-[var(--color-border)]" />
                <div className="flex items-center gap-2" data-testid="selection-toolbar">
                  <span className="text-[11px] text-[var(--color-muted)]">
                    <span className="font-semibold text-[var(--color-text)]">{selectedIds.size}</span>{" "}
                    selected · {selectedLinkPairs.length} link{selectedLinkPairs.length !== 1 ? "s" : ""}
                  </span>
                  <button
                    onClick={handleBulkUnlink}
                    disabled={selectedLinkPairs.length === 0}
                    className="rounded border border-red-300 px-2.5 py-1 text-[11px] text-red-600 transition-colors hover:bg-red-50 disabled:opacity-40 disabled:hover:bg-transparent dark:border-red-800 dark:text-red-400 dark:hover:bg-red-900/20"
                    data-testid="bulk-unlink-btn"
                  >
                    Unlink All
                  </button>
                  <button
                    onClick={() => setSelected(new Set())}
                    className="rounded px-2 py-1 text-[11px] text-[var(--color-muted)] transition-colors hover:bg-[var(--color-border)]"
                    data-testid="clear-selection-btn"
                  >
                    Clear
                  </button>
                </div>
              </>
            )}
          </div>

          {/* ── Table ── */}
          <div className="min-h-0 flex-1 overflow-y-auto">
            {filteredRows.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-2 px-6 py-14 text-center text-sm text-[var(--color-muted)]">
                {rows.length === 0 ? (
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
                  <p>No rows match the current search.</p>
                )}
              </div>
            ) : (
              <table className="w-full table-fixed text-xs" data-testid="traceability-table">
                <colgroup>
                  <col className="w-9" />
                  <col className="w-[28%]" />
                  <col />
                </colgroup>
                <thead className="sticky top-0 border-b border-[var(--color-border)] bg-[var(--color-paper)]">
                  <tr className="text-left text-[10px] font-semibold uppercase tracking-widest text-[var(--color-muted)]">
                    <th className="px-3 py-1.5">
                      <input
                        type="checkbox"
                        checked={allFilteredSelected}
                        onChange={toggleAllFiltered}
                        className="translate-y-px accent-[var(--color-accent)]"
                        title={allFilteredSelected ? "Deselect all" : "Select all"}
                        data-testid="select-all-checkbox"
                      />
                    </th>
                    <th className="px-4 py-1.5">Requirement ID</th>
                    <th className="px-4 py-1.5">Test Cases</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredRows.map((row, i) => (
                    <tr
                      key={row.reqId}
                      data-testid="traceability-row"
                      className={[
                        "border-b border-[var(--color-border)] last:border-0 transition-colors",
                        selectedIds.has(row.reqId)
                          ? "bg-[var(--color-accent)]/10"
                          : i % 2 === 1
                            ? "bg-black/[0.018] dark:bg-white/[0.025]"
                            : "",
                      ].join(" ")}
                    >
                      <td className="px-3 py-1.5">
                        <input
                          type="checkbox"
                          checked={selectedIds.has(row.reqId)}
                          onChange={() => toggleRow(row.reqId)}
                          className="translate-y-px accent-[var(--color-accent)]"
                          data-testid="row-checkbox"
                        />
                      </td>
                      <td className="truncate px-4 py-1.5 font-mono font-medium text-[var(--color-text)]">
                        {row.reqId}
                      </td>
                      <td className="px-4 py-1.5">
                        <div className="flex flex-wrap items-center gap-1">
                          {row.testCases.length === 0 && (
                            <button
                              onClick={() => setLinkDialogReq(row.reqId)}
                              className="rounded px-1 text-[var(--color-muted)] transition-colors hover:text-[var(--color-accent)]"
                              title={`Link a test case to ${row.reqId}`}
                              data-testid="empty-tc-cell"
                            >
                              —
                            </button>
                          )}
                          {row.testCases.map((tc) => (
                            <button
                              key={tc.id}
                              onClick={() => setChipDialog({ tcId: tc.id, reqId: row.reqId })}
                              className="inline-flex items-center rounded border border-[var(--color-border)] bg-[var(--color-page-bg)] px-1.5 py-0.5 font-mono text-[11px] font-medium text-[var(--color-text)] transition-colors hover:border-[var(--color-accent)] hover:text-[var(--color-accent)]"
                              title={tc.title}
                              data-testid="tc-chip"
                            >
                              {tc.id}
                            </button>
                          ))}
                          <button
                            onClick={() => setLinkDialogReq(row.reqId)}
                            className="inline-flex h-5 w-5 items-center justify-center rounded border border-transparent text-[var(--color-muted)] transition-colors hover:border-[var(--color-border)] hover:text-[var(--color-accent)]"
                            title={`Link a test case to ${row.reqId}`}
                            data-testid="add-link-btn"
                          >
                            <svg width="9" height="9" viewBox="0 0 9 9" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
                              <path d="M4.5 1v7M1 4.5h7" />
                            </svg>
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            {/* ── Broken Links ── */}
            {brokenLinks.length > 0 && (
              <div className="border-t border-[var(--color-border)] px-4 py-3" data-testid="broken-links-section">
                <div className="mb-2 flex items-center justify-between gap-3">
                  <p className="text-[10px] font-semibold uppercase tracking-widest text-red-600 dark:text-red-400">
                    ⚠ Broken Links ({brokenLinks.length})
                  </p>
                  <button
                    onClick={handleRemoveAllBroken}
                    className="rounded border border-red-300 px-2.5 py-1 text-[11px] text-red-600 transition-colors hover:bg-red-50 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-900/20"
                    data-testid="remove-all-broken-btn"
                  >
                    Remove All…
                  </button>
                </div>
                <p className="mb-2 text-[11px] text-[var(--color-muted)]">
                  These links reference requirement IDs not found in the document. They are
                  preserved and heal automatically if the requirement reappears (e.g. via undo).
                </p>
                <div className="flex flex-col gap-1">
                  {brokenLinks.map((b) => (
                    <div
                      key={`${b.testCase.id}→${b.req}`}
                      className="flex items-center gap-2"
                      data-testid="broken-link-row"
                    >
                      <span className="font-mono text-xs text-red-600 line-through decoration-red-300 dark:text-red-400">
                        {b.req}
                      </span>
                      <button
                        onClick={() => setChipDialog({ tcId: b.testCase.id, reqId: b.req })}
                        className="inline-flex items-center rounded border border-[var(--color-border)] bg-[var(--color-page-bg)] px-1.5 py-0.5 font-mono text-[11px] font-medium text-[var(--color-text)] transition-colors hover:border-[var(--color-accent)] hover:text-[var(--color-accent)]"
                        title={b.testCase.title}
                        data-testid="broken-link-chip"
                      >
                        {b.testCase.id}
                      </button>
                      <button
                        onClick={() => removeLink(b.testCase.id, b.req)}
                        className="rounded px-1.5 py-0.5 text-[11px] text-[var(--color-muted)] transition-colors hover:bg-[var(--color-border)] hover:text-red-600 dark:hover:text-red-400"
                        title={`Remove the broken link between ${b.testCase.id} and ${b.req}`}
                        data-testid="broken-link-unlink"
                      >
                        Unlink
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {filteredRows.length > 0 && filteredRows.length < rows.length && (
            <div className="shrink-0 border-t border-[var(--color-border)] px-4 py-1.5 text-center text-[10px] text-[var(--color-muted)]">
              Showing {filteredRows.length} of {rows.length} requirements
            </div>
          )}
        </>
      )}

      {/* ── Dialogs ── */}
      {linkDialogReq && (
        <LinkTestCaseDialog reqId={linkDialogReq} onClose={() => setLinkDialogReq(null)} />
      )}
      {chipDialog && (
        <TestCaseEditorDialog
          tcId={chipDialog.tcId}
          reqId={chipDialog.reqId}
          onClose={() => setChipDialog(null)}
        />
      )}
      {confirmUnlink && (
        <ConfirmUnlinkDialog
          message={confirmUnlink.message}
          onConfirm={() => {
            removeLinks(confirmUnlink.pairs);
            setSelected(new Set());
            setConfirmUnlink(null);
          }}
          onCancel={() => setConfirmUnlink(null)}
        />
      )}
    </div>
  );
}
