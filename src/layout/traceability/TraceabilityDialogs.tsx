import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useTraceabilityStore } from "@/stores/traceabilityStore";
import { suggestNextTestCaseId } from "@/layout/tabs/traceabilityRows";

// Shared traceability dialogs — used by both the dashboard Traceability tab
// and the editor's right-workspace TraceabilityDrawer. Business logic stays in
// the store; these components only collect input and surface store rejections.

// ── Shared dialog chrome ──────────────────────────────────────────────────────

export function DialogShell({ onClose, children }: { onClose: () => void; children: ReactNode }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="w-96 rounded-xl border border-[var(--color-border)] bg-[var(--color-paper)] p-5 shadow-2xl">
        {children}
      </div>
    </div>
  );
}

export const FIELD_CLS =
  "w-full rounded border border-[var(--color-border)] bg-[var(--color-page-bg)] px-2.5 py-1.5 text-xs text-[var(--color-text)] outline-none focus:border-[var(--color-accent)]";
export const PRIMARY_BTN_CLS =
  "rounded bg-[var(--color-accent)] px-3 py-1.5 text-xs font-medium text-white transition-colors hover:opacity-90 disabled:opacity-40";
export const SECONDARY_BTN_CLS =
  "rounded px-3 py-1.5 text-xs text-[var(--color-muted)] transition-colors hover:bg-[var(--color-border)]";

// ── Link dialog: link existing (multi-select) / create & link ────────────────

export function LinkTestCaseDialog({ reqId, onClose }: { reqId: string; onClose: () => void }) {
  const testCases = useTraceabilityStore((s) => s.testCases);
  const links = useTraceabilityStore((s) => s.links);
  const addTestCase = useTraceabilityStore((s) => s.addTestCase);
  const addLink = useTraceabilityStore((s) => s.addLink);
  const addLinks = useTraceabilityStore((s) => s.addLinks);

  const linkedIds = useMemo(
    () => new Set(links.filter((l) => l.req === reqId).map((l) => l.tc)),
    [links, reqId],
  );
  const linkable = useMemo(
    () => testCases.filter((tc) => !linkedIds.has(tc.id)),
    [testCases, linkedIds],
  );

  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [anchorId, setAnchorId] = useState<string | null>(null);
  const [newId, setNewId] = useState(() => suggestNextTestCaseId(testCases));
  const [newTitle, setNewTitle] = useState("");
  const [error, setError] = useState<string | null>(null);

  const toggle = (tcId: string) =>
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(tcId)) next.delete(tcId);
      else next.add(tcId);
      return next;
    });

  // Shift lives on the click event, not the change event, so it's captured on
  // click (which fires first) and consumed when onChange applies the result.
  // Ctrl/Cmd needs no special handling here — toggling a single checkbox
  // never touches the others, which is exactly the "don't clear selection"
  // behavior it asks for. Letting the browser's native toggle proceed (rather
  // than intercepting via preventDefault) avoids a jsdom quirk where it
  // reverts the controlled re-render's DOM write once it sees the click's
  // default was prevented.
  const shiftHeldRef = useRef(false);

  const handleCheckboxClick = (e: React.MouseEvent) => {
    shiftHeldRef.current = e.shiftKey;
  };

  const handleCheckboxChange = (tcId: string) => {
    if (shiftHeldRef.current && anchorId) {
      const anchorIdx = linkable.findIndex((tc) => tc.id === anchorId);
      const targetIdx = linkable.findIndex((tc) => tc.id === tcId);
      if (anchorIdx !== -1 && targetIdx !== -1) {
        const [start, end] = anchorIdx <= targetIdx ? [anchorIdx, targetIdx] : [targetIdx, anchorIdx];
        const rangeIds = linkable.slice(start, end + 1).map((tc) => tc.id);
        setChecked((prev) => new Set([...prev, ...rangeIds]));
        return;
      }
    }
    toggle(tcId);
    setAnchorId(tcId);
  };

  const allChecked = linkable.length > 0 && linkable.every((tc) => checked.has(tc.id));
  const someChecked = linkable.some((tc) => checked.has(tc.id));
  const selectedCount = linkable.filter((tc) => checked.has(tc.id)).length;

  const handleSelectAllChange = () => {
    if (allChecked) {
      setChecked(new Set());
    } else {
      setChecked(new Set(linkable.map((tc) => tc.id)));
    }
    setAnchorId(null);
  };

  const selectAllRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (selectAllRef.current) {
      selectAllRef.current.indeterminate = someChecked && !allChecked;
    }
  }, [someChecked, allChecked]);

  const handleLinkSelected = () => {
    addLinks([...checked], reqId);
    onClose();
  };

  const handleCreateAndLink = () => {
    const id = newId.trim();
    if (!id) {
      setError("ID is required.");
      return;
    }
    if (!addTestCase(id, newTitle)) {
      setError(`Test case "${id}" already exists.`);
      return;
    }
    addLink(id, reqId);
    // Any checked existing test cases get linked in the same action.
    addLinks([...checked], reqId);
    onClose();
  };

  return (
    <DialogShell onClose={onClose}>
      <p className="mb-3 text-sm font-semibold text-[var(--color-text)]" data-testid="link-dialog-title">
        Link Test Case to <span className="font-mono">{reqId}</span>
      </p>

      {/* Link existing test cases (multi-select) */}
      {linkable.length > 0 && (
        <div className="mb-4">
          <div className="mb-1.5 flex items-baseline justify-between">
            <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--color-muted)]" data-testid="link-existing-header">
              Existing Test Cases ({linkable.length})
            </p>
            <p className="text-[10px] text-[var(--color-muted)]" data-testid="link-selected-count">
              Selected: {selectedCount}
            </p>
          </div>
          <div className="rounded border border-[var(--color-border)]">
            <label
              className="flex w-full cursor-pointer items-center gap-2 border-b border-[var(--color-border)] bg-[var(--color-page-bg)] px-2.5 py-1.5 text-left"
              data-testid="link-select-all"
            >
              <input
                ref={selectAllRef}
                type="checkbox"
                checked={allChecked}
                onChange={handleSelectAllChange}
                className="translate-y-px accent-[var(--color-accent)]"
                data-testid="link-select-all-checkbox"
              />
              <span className="text-xs font-medium text-[var(--color-text)]">Select All</span>
            </label>
            <div className="max-h-44 overflow-y-auto">
              {linkable.map((tc) => (
                <label
                  key={tc.id}
                  className="flex w-full cursor-pointer items-baseline gap-2 border-b border-[var(--color-border)] px-2.5 py-1.5 text-left transition-colors last:border-0 hover:bg-[var(--color-border)]/50"
                  data-testid="link-existing-tc"
                >
                  <input
                    type="checkbox"
                    checked={checked.has(tc.id)}
                    onClick={handleCheckboxClick}
                    onChange={() => handleCheckboxChange(tc.id)}
                    className="translate-y-px accent-[var(--color-accent)]"
                    data-testid="link-existing-tc-checkbox"
                  />
                  <span className="shrink-0 font-mono text-xs font-medium text-[var(--color-text)]">{tc.id}</span>
                  {tc.title && (
                    <span className="truncate text-xs text-[var(--color-muted)]">{tc.title}</span>
                  )}
                </label>
              ))}
            </div>
          </div>
          <div className="mt-2 flex justify-end">
            <button
              onClick={handleLinkSelected}
              disabled={checked.size === 0}
              className={PRIMARY_BTN_CLS}
              data-testid="link-selected-btn"
            >
              Link Selected{checked.size > 0 ? ` (${checked.size})` : ""}
            </button>
          </div>
        </div>
      )}

      {/* Create a new test case and link it */}
      <p className="mb-1.5 text-[10px] font-bold uppercase tracking-wider text-[var(--color-muted)]">
        {linkable.length > 0 ? "Or create a new test case" : "Create a new test case"}
      </p>
      <div className="flex flex-col gap-2">
        <input
          type="text"
          placeholder="Test case ID (e.g. TC_001)"
          value={newId}
          onChange={(e) => { setNewId(e.target.value); setError(null); }}
          className={`${FIELD_CLS} font-mono`}
          data-testid="new-tc-id"
        />
        <input
          type="text"
          placeholder="Test case title (optional)"
          value={newTitle}
          onChange={(e) => { setNewTitle(e.target.value); setError(null); }}
          onKeyDown={(e) => e.key === "Enter" && handleCreateAndLink()}
          className={FIELD_CLS}
          data-testid="new-tc-title"
        />
        {error && (
          <p className="text-[11px] text-red-600 dark:text-red-400" data-testid="link-dialog-error">
            {error}
          </p>
        )}
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <button onClick={onClose} className={SECONDARY_BTN_CLS}>Cancel</button>
        <button onClick={handleCreateAndLink} className={PRIMARY_BTN_CLS} data-testid="create-and-link-btn">
          Create &amp; Link
        </button>
      </div>
    </DialogShell>
  );
}

// ── Test case editor dialog ───────────────────────────────────────────────────

export function TestCaseEditorDialog({
  tcId,
  reqId,
  onClose,
}: {
  tcId: string;
  /** The requirement context the editor was opened from — enables contextual unlink. */
  reqId: string;
  onClose: () => void;
}) {
  const testCases = useTraceabilityStore((s) => s.testCases);
  const updateTestCase = useTraceabilityStore((s) => s.updateTestCase);
  const removeLink = useTraceabilityStore((s) => s.removeLink);

  const testCase = testCases.find((t) => t.id === tcId);
  const [id, setId] = useState(testCase?.id ?? "");
  const [title, setTitle] = useState(testCase?.title ?? "");
  const [error, setError] = useState<string | null>(null);

  if (!testCase) return null; // deleted underneath the dialog — nothing to edit

  const handleSave = () => {
    const result = updateTestCase(tcId, { id, title });
    if (result === "duplicate") {
      setError(`Test case "${id.trim()}" already exists.`);
      return;
    }
    if (result === "invalid") {
      setError("ID is required.");
      return;
    }
    onClose();
  };

  return (
    <DialogShell onClose={onClose}>
      <p className="mb-3 text-sm font-semibold text-[var(--color-text)]" data-testid="tc-editor-title">
        Edit Test Case
      </p>
      <div className="flex flex-col gap-2">
        <label className="text-[10px] font-bold uppercase tracking-wider text-[var(--color-muted)]">
          ID
          <input
            type="text"
            value={id}
            onChange={(e) => { setId(e.target.value); setError(null); }}
            className={`${FIELD_CLS} mt-1 font-mono`}
            data-testid="tc-editor-id"
          />
        </label>
        <label className="text-[10px] font-bold uppercase tracking-wider text-[var(--color-muted)]">
          Title
          <input
            type="text"
            placeholder="Optional"
            value={title}
            onChange={(e) => { setTitle(e.target.value); setError(null); }}
            onKeyDown={(e) => e.key === "Enter" && handleSave()}
            className={`${FIELD_CLS} mt-1`}
            data-testid="tc-editor-title-input"
          />
        </label>
        {error && (
          <p className="text-[11px] text-red-600 dark:text-red-400" data-testid="tc-editor-error">
            {error}
          </p>
        )}
      </div>
      <div className="mt-4 flex items-center justify-between gap-2">
        <button
          onClick={() => {
            removeLink(tcId, reqId);
            onClose();
          }}
          className="rounded border border-red-300 px-2.5 py-1 text-[11px] text-red-600 transition-colors hover:bg-red-50 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-900/20"
          title={`Remove the link between ${tcId} and ${reqId} (the test case itself is kept)`}
          data-testid="tc-editor-unlink"
        >
          Unlink from {reqId}
        </button>
        <div className="flex gap-2">
          <button onClick={onClose} className={SECONDARY_BTN_CLS}>Cancel</button>
          <button onClick={handleSave} className={PRIMARY_BTN_CLS} data-testid="tc-editor-save">
            Save
          </button>
        </div>
      </div>
    </DialogShell>
  );
}

// ── Bulk unlink confirmation ──────────────────────────────────────────────────

export function ConfirmUnlinkDialog({
  message,
  onConfirm,
  onCancel,
}: {
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <DialogShell onClose={onCancel}>
      <p className="mb-3 text-sm font-semibold text-[var(--color-text)]">Remove Links</p>
      <p className="mb-5 text-xs leading-relaxed text-[var(--color-muted)]" data-testid="confirm-unlink-message">
        {message} Test cases themselves are kept.
      </p>
      <div className="flex justify-end gap-2">
        <button onClick={onCancel} className={SECONDARY_BTN_CLS}>Cancel</button>
        <button
          onClick={onConfirm}
          className="rounded bg-red-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-red-700"
          data-testid="confirm-unlink-btn"
        >
          Remove
        </button>
      </div>
    </DialogShell>
  );
}
