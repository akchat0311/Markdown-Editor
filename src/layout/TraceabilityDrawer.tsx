import { useState } from "react";
import { useTraceabilityStore } from "@/stores/traceabilityStore";
import { useRequirementTraceability } from "@/services/traceabilityQuery";
import {
  LinkTestCaseDialog,
  TestCaseEditorDialog,
} from "@/layout/traceability/TraceabilityDialogs";

/**
 * Contextual traceability panel for the editor's right workspace — opened by
 * clicking a requirement's 🧪 badge. Occupies the same slot as the review
 * CommentDrawer (one contextual panel at a time; App.tsx arbitrates).
 *
 * Bulk management stays in the dashboard Traceability tab; this panel is a
 * single-requirement view reusing the shared dialogs and store actions.
 */
export function TraceabilityDrawer({ reqId, onClose }: { reqId: string; onClose: () => void }) {
  const linked = useRequirementTraceability(reqId);
  const removeLink = useTraceabilityStore((s) => s.removeLink);

  const [linkDialogOpen, setLinkDialogOpen] = useState(false);
  const [editTcId, setEditTcId] = useState<string | null>(null);

  return (
    <div
      className="flex h-full w-full flex-col border-l border-[var(--color-border)] bg-[var(--color-paper)]"
      data-testid="traceability-drawer"
    >
      {/* ── Header ── */}
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-[var(--color-border)] px-4 py-3">
        <div className="min-w-0">
          <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--color-muted)]">
            🧪 Traceability
          </p>
          <p className="truncate font-mono text-sm font-semibold text-[var(--color-text)]" data-testid="drawer-req-id">
            {reqId}
          </p>
        </div>
        <button
          onClick={onClose}
          aria-label="Close traceability panel"
          className="rounded px-2 py-1 text-sm text-[var(--color-muted)] transition-colors hover:bg-[var(--color-border)] hover:text-[var(--color-text)]"
          data-testid="drawer-close"
        >
          ✕
        </button>
      </div>

      {/* ── Primary action — always visible, no scrolling required ── */}
      <div className="shrink-0 border-b border-[var(--color-border)] px-4 py-3">
        <button
          onClick={() => setLinkDialogOpen(true)}
          className="w-full rounded border border-[var(--color-border)] px-3 py-1.5 text-xs font-medium text-[var(--color-text)] transition-colors hover:border-[var(--color-accent)] hover:text-[var(--color-accent)]"
          data-testid="drawer-link-btn"
        >
          + Link Test Case…
        </button>
      </div>

      {/* ── Linked test cases ── */}
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        <p className="mb-2 text-[10px] font-bold uppercase tracking-wider text-[var(--color-muted)]">
          Linked Test Cases{linked.length > 0 ? ` (${linked.length})` : ""}
        </p>

        {linked.length === 0 ? (
          <p className="text-xs text-[var(--color-muted)]" data-testid="drawer-empty">
            No linked test cases
          </p>
        ) : (
          <ul className="flex flex-col">
            {linked.map((tc) => (
              <li
                key={tc.id}
                className="group border-b border-[var(--color-border)] py-2 last:border-0"
                data-testid="drawer-tc-row"
              >
                <p className="font-mono text-xs font-semibold text-[var(--color-text)]">{tc.id}</p>
                {tc.title && <p className="text-xs text-[var(--color-muted)]">{tc.title}</p>}
                <div className="mt-1 flex gap-1.5">
                  <button
                    onClick={() => setEditTcId(tc.id)}
                    className="rounded px-1.5 py-0.5 text-[10px] font-medium text-[var(--color-muted)] transition-colors hover:bg-[var(--color-border)] hover:text-[var(--color-text)]"
                    data-testid="drawer-edit-tc"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => removeLink(tc.id, reqId)}
                    className="rounded px-1.5 py-0.5 text-[10px] font-medium text-red-600 transition-colors hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/40"
                    title={`Remove the link between ${tc.id} and ${reqId} (the test case itself is kept)`}
                    data-testid="drawer-unlink-tc"
                  >
                    Unlink
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* ── Dialogs (shared with the dashboard tab) ── */}
      {linkDialogOpen && (
        <LinkTestCaseDialog reqId={reqId} onClose={() => setLinkDialogOpen(false)} />
      )}
      {editTcId && (
        <TestCaseEditorDialog tcId={editTcId} reqId={reqId} onClose={() => setEditTcId(null)} />
      )}
    </div>
  );
}
