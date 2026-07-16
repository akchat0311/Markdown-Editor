// Small presentational controls for the dockable split view (EditorMain.tsx).
// No store access here — EditorMain wires these to uiStore actions, keeping
// this file a pure, reusable layout-chrome component.

interface SplitPaneToolbarProps {
  label: string;
  onCollapse: () => void;
  onMaximize: () => void;
}

/** Thin header shown above each pane while split view is open. */
export function SplitPaneToolbar({ label, onCollapse, onMaximize }: SplitPaneToolbarProps) {
  return (
    <div className="flex h-7 shrink-0 items-center justify-between border-b border-[var(--color-border)] bg-[var(--color-page-bg)] px-2">
      <span className="text-[10px] font-semibold uppercase tracking-wide text-[var(--color-muted)]">
        {label}
      </span>
      <div className="flex items-center gap-0.5">
        <button
          onClick={onMaximize}
          title={`Maximize ${label} pane`}
          aria-label={`Maximize ${label} pane`}
          className="flex h-5 w-5 items-center justify-center rounded text-[var(--color-muted)] transition-colors hover:bg-[var(--color-border)] hover:text-[var(--color-text)]"
        >
          <svg width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
            <path d="M1 4V1h3M11 4V1H8M1 8v3h3M11 8v3H8" />
          </svg>
        </button>
        <button
          onClick={onCollapse}
          title={`Collapse ${label} pane`}
          aria-label={`Collapse ${label} pane`}
          className="flex h-5 w-5 items-center justify-center rounded text-[var(--color-muted)] transition-colors hover:bg-[var(--color-border)] hover:text-[var(--color-text)]"
        >
          <svg width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
            <path d="M2 2l8 8M10 2l-8 8" />
          </svg>
        </button>
      </div>
    </div>
  );
}

interface CollapsedPaneStripProps {
  label: string;
  onRestore: () => void;
}

/** Slim clickable strip shown in place of a pane that's been collapsed/hidden by the other pane's maximize. */
export function CollapsedPaneStrip({ label, onRestore }: CollapsedPaneStripProps) {
  return (
    <button
      onClick={onRestore}
      title={`Show ${label} pane`}
      aria-label={`Show ${label} pane`}
      className="flex w-6 shrink-0 items-center justify-center border-l border-[var(--color-border)] bg-[var(--color-page-bg)] text-[var(--color-muted)] transition-colors hover:bg-[var(--color-border)] hover:text-[var(--color-text)]"
    >
      <span
        className="text-[10px] font-semibold uppercase tracking-wide"
        style={{ writingMode: "vertical-rl" }}
      >
        {label}
      </span>
    </button>
  );
}
