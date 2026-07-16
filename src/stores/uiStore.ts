import { create } from "zustand";
import { persist } from "zustand/middleware";

export type Theme = "light" | "dark";

/** Which pane is fully hidden in the split view, or "none" if both are visible. */
export type SplitCollapsedPane = "none" | "editor" | "source";

/**
 * Split-view scroll sync mode. "linked" mirrors scroll position between the
 * rich editor and source panes by heading/requirement anchor. Modeled as a
 * union (not a boolean) so a future mode — e.g. "follow-cursor" — can be
 * added without a breaking store-shape change.
 */
export type ScrollSyncMode = "off" | "linked";

interface UIState {
  theme: Theme;
  sidebarOpen: boolean;
  sidebarWidth: number;
  rightPanelWidth: number;
  sourceMode: boolean;
  /** Dockable split view: rich editor + source pane shown side by side. */
  splitViewOpen: boolean;
  /** Fixed pixel width of the source pane in split view; editor takes the rest. */
  splitSourceWidth: number;
  splitCollapsedPane: SplitCollapsedPane;
  /** Persisted preference: scroll-sync behavior between split-view panes. */
  scrollSyncMode: ScrollSyncMode;
}

interface UIActions {
  setTheme(theme: Theme): void;
  toggleTheme(): void;
  setSidebarOpen(open: boolean): void;
  toggleSidebar(): void;
  setSidebarWidth(width: number): void;
  adjustSidebar(delta: number): void;
  adjustRightPanel(delta: number): void;
  setSourceMode(on: boolean): void;
  toggleSourceMode(): void;
  setSplitViewOpen(open: boolean): void;
  toggleSplitView(): void;
  setSplitSourceWidth(width: number): void;
  adjustSplitSourceWidth(delta: number): void;
  /** Hides `pane`, leaving the other one at full width. */
  collapseSplitPane(pane: "editor" | "source"): void;
  /** Hides the pane OTHER than `pane`, so `pane` takes full width. */
  maximizeSplitPane(pane: "editor" | "source"): void;
  /** Brings both panes back after a collapse/maximize. */
  restoreSplitView(): void;
  setScrollSyncMode(mode: ScrollSyncMode): void;
  /** Cycles the only two modes implemented today: "off" <-> "linked". */
  toggleScrollSync(): void;
}

export type UIStore = UIState & UIActions;

const MIN_SIDEBAR = 160;
const MAX_SIDEBAR = 500;
const MIN_RIGHT_PANEL = 260;
const MAX_RIGHT_PANEL = 480;
const MIN_SPLIT_SOURCE = 280;
const MAX_SPLIT_SOURCE = 1000;

export const useUIStore = create<UIStore>()(
  persist(
    (set) => ({
      theme: "light",
      sidebarOpen: true,
      sidebarWidth: 240,
      rightPanelWidth: 320,
      sourceMode: false,
      splitViewOpen: false,
      splitSourceWidth: 480,
      splitCollapsedPane: "none",
      scrollSyncMode: "off",

      setTheme: (theme) => set({ theme }),
      toggleTheme: () =>
        set((s) => ({ theme: s.theme === "light" ? "dark" : "light" })),

      setSidebarOpen: (sidebarOpen) => set({ sidebarOpen }),
      toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
      setSidebarWidth: (w) =>
        set({ sidebarWidth: Math.max(MIN_SIDEBAR, Math.min(MAX_SIDEBAR, w)) }),
      adjustSidebar: (delta) =>
        set((s) => ({
          sidebarWidth: Math.max(
            MIN_SIDEBAR,
            Math.min(MAX_SIDEBAR, s.sidebarWidth + delta)
          ),
        })),
      adjustRightPanel: (delta) =>
        set((s) => ({
          rightPanelWidth: Math.max(
            MIN_RIGHT_PANEL,
            Math.min(MAX_RIGHT_PANEL, s.rightPanelWidth + delta)
          ),
        })),

      // sourceMode (full-source view) and splitViewOpen (dockable side-by-side
      // view) are mutually exclusive — enabling one always turns the other off.
      // This keeps App.tsx's existing sync guards (which key off sourceMode
      // alone) fully valid unchanged: sourceMode's meaning ("the rich pane is
      // hidden and the source textarea is the sole authoritative editor") never
      // has to account for split view being open at the same time.
      setSourceMode: (sourceMode) =>
        set((s) => ({ sourceMode, splitViewOpen: sourceMode ? false : s.splitViewOpen })),
      toggleSourceMode: () =>
        set((s) => {
          const next = !s.sourceMode;
          return { sourceMode: next, splitViewOpen: next ? false : s.splitViewOpen };
        }),

      setSplitViewOpen: (open) =>
        set((s) => ({ splitViewOpen: open, sourceMode: open ? false : s.sourceMode })),
      toggleSplitView: () =>
        set((s) => {
          const next = !s.splitViewOpen;
          return { splitViewOpen: next, sourceMode: next ? false : s.sourceMode };
        }),

      setSplitSourceWidth: (w) =>
        set({ splitSourceWidth: Math.max(MIN_SPLIT_SOURCE, Math.min(MAX_SPLIT_SOURCE, w)) }),
      adjustSplitSourceWidth: (delta) =>
        set((s) => ({
          splitSourceWidth: Math.max(
            MIN_SPLIT_SOURCE,
            Math.min(MAX_SPLIT_SOURCE, s.splitSourceWidth + delta)
          ),
        })),

      collapseSplitPane: (pane) => set({ splitCollapsedPane: pane }),
      maximizeSplitPane: (pane) =>
        set({ splitCollapsedPane: pane === "editor" ? "source" : "editor" }),
      restoreSplitView: () => set({ splitCollapsedPane: "none" }),

      setScrollSyncMode: (scrollSyncMode) => set({ scrollSyncMode }),
      toggleScrollSync: () =>
        set((s) => ({ scrollSyncMode: s.scrollSyncMode === "linked" ? "off" : "linked" })),
    }),
    {
      name: "md-editor-ui",
      partialize: (s) => ({
        theme: s.theme,
        sidebarOpen: s.sidebarOpen,
        sidebarWidth: s.sidebarWidth,
        rightPanelWidth: s.rightPanelWidth,
        // Splitter position is the one piece of split-view state worth
        // persisting — it's a sizing preference, like sidebarWidth/
        // rightPanelWidth. Whether split view is currently open, and which
        // pane (if any) is collapsed, are transient view-mode state — same
        // treatment as sourceMode, which is deliberately NOT persisted either.
        splitSourceWidth: s.splitSourceWidth,
        // scrollSyncMode is a genuine cross-session preference (like
        // splitSourceWidth), not transient view-mode state (unlike
        // splitViewOpen/splitCollapsedPane).
        scrollSyncMode: s.scrollSyncMode,
      }),
    }
  )
);
