import { create } from "zustand";
import { persist } from "zustand/middleware";

export type Theme = "light" | "dark";

interface UIState {
  theme: Theme;
  sidebarOpen: boolean;
  sidebarWidth: number;
  rightPanelWidth: number;
  sourceMode: boolean;
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
}

export type UIStore = UIState & UIActions;

const MIN_SIDEBAR = 160;
const MAX_SIDEBAR = 500;
const MIN_RIGHT_PANEL = 260;
const MAX_RIGHT_PANEL = 480;

export const useUIStore = create<UIStore>()(
  persist(
    (set) => ({
      theme: "light",
      sidebarOpen: true,
      sidebarWidth: 240,
      rightPanelWidth: 320,
      sourceMode: false,

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

      setSourceMode: (sourceMode) => set({ sourceMode }),
      toggleSourceMode: () => set((s) => ({ sourceMode: !s.sourceMode })),
    }),
    {
      name: "md-editor-ui",
      partialize: (s) => ({
        theme: s.theme,
        sidebarOpen: s.sidebarOpen,
        sidebarWidth: s.sidebarWidth,
        rightPanelWidth: s.rightPanelWidth,
      }),
    }
  )
);
