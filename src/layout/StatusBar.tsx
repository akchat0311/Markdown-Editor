import { useContext } from "react";
import { useEditorState } from "@tiptap/react";
import { EditorContext } from "@/editor/EditorContext";
import { useUIStore, useTabStore, getActiveTab } from "@/stores";
import { useReviewCommentsStore } from "@/stores/reviewCommentsStore";
import { useTraceabilityStore } from "@/stores/traceabilityStore";

function countWords(text: string): number {
  return text.trim() ? text.trim().split(/\s+/).length : 0;
}

function readingTime(words: number): string {
  const mins = Math.max(1, Math.round(words / 200));
  return `${mins} min read`;
}

// ── Per-companion save-state indicator ──────────────────────────────────────
//
// One shared implementation for every companion artifact's StatusBar pill
// (review comments, traceability, and any future sidecar) — each companion
// only differs in its label/handlers/dirty-testid, not in markup or styling.
// This is the "bottom status indicator = individual companion artifact save
// state" half of the save UX; the separate global Unsaved/Saved pill further
// down reflects the bundle/document save state instead.
interface CompanionSaveIndicatorProps {
  loaded: boolean;
  dirty: boolean;
  dirtyText: string;
  dirtyTitle: string;
  savedText: string;
  savedTitle: string;
  dirtyTestId: string;
  savedTestId: string;
  onSaveDirty?: () => void;
  onSaveClean?: () => void;
}

function CompanionSaveIndicator({
  loaded,
  dirty,
  dirtyText,
  dirtyTitle,
  savedText,
  savedTitle,
  dirtyTestId,
  savedTestId,
  onSaveDirty,
  onSaveClean,
}: CompanionSaveIndicatorProps) {
  if (!loaded) return null;
  return (
    <>
      {dirty ? (
        <button
          onClick={onSaveDirty}
          className="flex items-center gap-1 rounded px-1.5 py-0.5 text-amber-600 hover:bg-amber-50 dark:text-amber-400 dark:hover:bg-amber-900/20 transition-colors"
          title={dirtyTitle}
          data-testid={dirtyTestId}
        >
          <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
          {dirtyText}
        </button>
      ) : (
        <button
          onClick={onSaveClean}
          className="rounded px-1.5 py-0.5 opacity-40 hover:opacity-100 hover:bg-[var(--color-border)] transition-all"
          title={savedTitle}
          data-testid={savedTestId}
        >
          {savedText}
        </button>
      )}
      <span className="opacity-40">·</span>
    </>
  );
}

interface StatusBarProps {
  onSaveReview?: () => void;
  onSaveReviewAs?: () => void;
  onSaveTraceability?: () => void;
  onSaveTraceabilityAs?: () => void;
}

export function StatusBar({
  onSaveReview,
  onSaveReviewAs,
  onSaveTraceability,
  onSaveTraceabilityAs,
}: StatusBarProps) {
  const editor = useContext(EditorContext);
  const sourceMode = useUIStore((s) => s.sourceMode);
  const toggleSourceMode = useUIStore((s) => s.toggleSourceMode);
  const splitViewOpen = useUIStore((s) => s.splitViewOpen);
  const toggleSplitView = useUIStore((s) => s.toggleSplitView);
  const splitCollapsedPane = useUIStore((s) => s.splitCollapsedPane);
  const scrollSyncMode = useUIStore((s) => s.scrollSyncMode);
  const toggleScrollSync = useUIStore((s) => s.toggleScrollSync);
  const isDirty = useTabStore((s) => getActiveTab(s)?.isDirty ?? false);
  const isReadOnly = useTabStore((s) => getActiveTab(s)?.isReadOnly ?? false);
  const reviewLoaded = useReviewCommentsStore((s) => s.loaded);
  const reviewIsDirty = useReviewCommentsStore((s) => s.isDirty);
  const traceabilityLoaded = useTraceabilityStore((s) => s.loaded);
  const traceabilityIsDirty = useTraceabilityStore((s) => s.isDirty);

  const stats = useEditorState({
    editor,
    selector: ({ editor: e }) => {
      if (!e) return { words: 0, chars: 0, pos: 0 };
      const text = e.getText();
      return {
        words: countWords(text),
        chars: text.length,
        pos: e.state.selection.from,
      };
    },
    equalityFn: (a, b) =>
      a?.words === b?.words && a?.chars === b?.chars && a?.pos === b?.pos,
  });

  const words = stats?.words ?? 0;
  const chars = stats?.chars ?? 0;

  return (
    <div className="flex h-7 shrink-0 items-center gap-3 border-t border-[var(--color-border)] bg-[var(--color-page-bg)] px-3 text-[10px] text-[var(--color-muted)] select-none">
      <span>{words.toLocaleString()} words</span>
      <span className="opacity-40">·</span>
      <span>{chars.toLocaleString()} chars</span>
      <span className="opacity-40">·</span>
      <span>{readingTime(words)}</span>

      <div className="ml-auto flex items-center gap-2">
        <CompanionSaveIndicator
          loaded={reviewLoaded}
          dirty={reviewIsDirty}
          dirtyText="Unsaved Review Comments"
          dirtyTitle="Save review comments"
          savedText="Review Saved"
          savedTitle="Save review comments to a different file"
          dirtyTestId="statusbar-review-unsaved"
          savedTestId="statusbar-review-saved"
          onSaveDirty={onSaveReview}
          onSaveClean={onSaveReviewAs}
        />
        <CompanionSaveIndicator
          loaded={traceabilityLoaded}
          dirty={traceabilityIsDirty}
          dirtyText="Unsaved Traceability"
          dirtyTitle="Save traceability"
          savedText="Traceability Saved"
          savedTitle="Save traceability to a different file"
          dirtyTestId="statusbar-traceability-unsaved"
          savedTestId="statusbar-traceability-saved"
          onSaveDirty={onSaveTraceability}
          onSaveClean={onSaveTraceabilityAs}
        />
        {isReadOnly ? (
          <span className="rounded-sm bg-[var(--color-border)] px-1.5 py-px text-[9px] font-medium">
            Sample Document
          </span>
        ) : isDirty ? (
          <span className="flex items-center gap-1 font-medium text-amber-600 dark:text-amber-400">
            <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
            Unsaved
          </span>
        ) : (
          <span className="opacity-60">Saved</span>
        )}
        <span className="opacity-40">·</span>
        <span className="opacity-40">UTF-8</span>
        <button
          onClick={toggleSplitView}
          title={splitViewOpen ? "Close split view (⌘\\)" : "Split view: editor + source (⌘\\)"}
          className={[
            "flex items-center gap-1 rounded px-1.5 py-0.5 font-mono transition-colors",
            splitViewOpen
              ? "bg-[var(--color-accent)] text-white"
              : "hover:bg-[var(--color-border)] hover:text-[var(--color-text)]",
          ].join(" ")}
        >
          <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M8 2v12M2 4h3v8H2zM11 4h3v8h-3z" />
          </svg>
          Split
        </button>
        {splitViewOpen && splitCollapsedPane === "none" && (
          <button
            onClick={toggleScrollSync}
            title={scrollSyncMode === "linked" ? "Unlink scroll sync between panes" : "Sync scroll between panes by heading"}
            className={[
              "flex items-center gap-1 rounded px-1.5 py-0.5 transition-colors",
              scrollSyncMode === "linked"
                ? "bg-[var(--color-accent)] text-white"
                : "hover:bg-[var(--color-border)] hover:text-[var(--color-text)]",
            ].join(" ")}
          >
            🔗 Sync Scroll
          </button>
        )}
        <button
          onClick={toggleSourceMode}
          title={sourceMode ? "Switch to WYSIWYG (⌘/)" : "View source (⌘/)"}
          className={[
            "flex items-center gap-1 rounded px-1.5 py-0.5 font-mono transition-colors",
            sourceMode
              ? "bg-[var(--color-accent)] text-white"
              : "hover:bg-[var(--color-border)] hover:text-[var(--color-text)]",
          ].join(" ")}
        >
          <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M5 4L1 8l4 4M11 4l4 4-4 4" />
          </svg>
          {sourceMode ? "Source" : "<>"}
        </button>
      </div>
    </div>
  );
}
