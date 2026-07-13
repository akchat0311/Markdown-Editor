import { useContext } from "react";
import { EditorContent } from "@tiptap/react";
import { EditorContext } from "./EditorContext";
import { EditorToolbar } from "./Toolbar";
import { SourcePane } from "./SourcePane";
import { SplitPaneToolbar, CollapsedPaneStrip } from "./SplitPaneChrome";
import { ResizeHandle } from "@/layout/ResizeHandle";
import { useTabStore, useUIStore } from "@/stores";

export function EditorMain() {
  const editor = useContext(EditorContext);
  const sourceMode = useUIStore((s) => s.sourceMode);
  const splitViewOpen = useUIStore((s) => s.splitViewOpen);
  const splitSourceWidth = useUIStore((s) => s.splitSourceWidth);
  const adjustSplitSourceWidth = useUIStore((s) => s.adjustSplitSourceWidth);
  const splitCollapsedPane = useUIStore((s) => s.splitCollapsedPane);
  const collapseSplitPane = useUIStore((s) => s.collapseSplitPane);
  const maximizeSplitPane = useUIStore((s) => s.maximizeSplitPane);
  const restoreSplitView = useUIStore((s) => s.restoreSplitView);
  const activeTabId = useTabStore((s) => s.activeTabId);

  // ── Mode switch (unchanged) ──────────────────────────────────────────────────
  //
  // This branch is byte-for-byte the original EditorMain behavior: the WYSIWYG
  // pane is always mounted (hidden via CSS in source mode) and SourcePane is
  // only active in source mode. splitViewOpen and sourceMode are mutually
  // exclusive (see uiStore.ts), so this is exactly today's component whenever
  // split view isn't in use.
  if (!splitViewOpen) {
    return (
      <div className="relative flex flex-1 flex-col overflow-hidden bg-[var(--color-page-bg)]">
        <div className={`flex flex-1 flex-col overflow-y-auto ${sourceMode ? "hidden" : ""}`}>
          {editor && <EditorToolbar editor={editor} />}
          <div className="w-full py-8">
            <div className="doc-page">
              <EditorContent editor={editor} />
            </div>
          </div>
        </div>

        {editor && <SourcePane editor={editor} active={sourceMode} activeTabId={activeTabId} />}
      </div>
    );
  }

  // ── Dockable split view ──────────────────────────────────────────────────────
  //
  // Both panes reuse the exact same EditorContent/SourcePane instances as the
  // mode-switch branch above — no new editor is created. sourceMode is
  // guaranteed false here, so App.tsx's onUpdate keeps behaving exactly as it
  // does in normal (non-source) mode: the rich pane stays live/authoritative,
  // serializing into the tab store on every edit, same as always.
  //
  // Both panes are kept mounted for the entire time split view is open and
  // are only ever CSS-hidden when collapsed (same `hidden`-class pattern for
  // both — TipTap's view is never torn down, and SourcePane is never
  // unmounted/remounted by a collapse/restore). SourcePane's `active` prop is
  // therefore hardcoded true throughout split view; freshness while
  // collapsed-and-restored, and freshness relative to rich-editor edits made
  // while both panes are visible, are both handled by SourcePane's own live
  // store-subscription effect (see SourcePane.tsx) — not by remounting it.
  const editorHidden = splitCollapsedPane === "editor";
  const sourceHidden = splitCollapsedPane === "source";

  return (
    <div className="relative flex flex-1 overflow-hidden bg-[var(--color-page-bg)]">
      <div
        className={`flex min-w-0 flex-1 flex-col overflow-hidden ${editorHidden ? "hidden" : ""}`}
      >
        <SplitPaneToolbar
          label="Editor"
          onCollapse={() => collapseSplitPane("editor")}
          onMaximize={() => maximizeSplitPane("editor")}
        />
        <div className="flex flex-1 flex-col overflow-y-auto">
          {editor && <EditorToolbar editor={editor} />}
          <div className="w-full py-8">
            <div className="doc-page">
              <EditorContent editor={editor} />
            </div>
          </div>
        </div>
      </div>

      {editorHidden && <CollapsedPaneStrip label="Editor" onRestore={restoreSplitView} />}

      {!editorHidden && !sourceHidden && (
        <ResizeHandle onDelta={(d) => adjustSplitSourceWidth(-d)} />
      )}

      <div
        className={[
          sourceHidden
            ? "hidden"
            : editorHidden
              ? "flex min-w-0 flex-1 flex-col overflow-hidden"
              : "flex shrink-0 flex-col overflow-hidden",
        ].join(" ")}
        style={sourceHidden || editorHidden ? undefined : { width: splitSourceWidth }}
      >
        <SplitPaneToolbar
          label="Source"
          onCollapse={() => collapseSplitPane("source")}
          onMaximize={() => maximizeSplitPane("source")}
        />
        {editor && <SourcePane editor={editor} active={true} activeTabId={activeTabId} />}
      </div>

      {sourceHidden && <CollapsedPaneStrip label="Source" onRestore={restoreSplitView} />}
    </div>
  );
}
