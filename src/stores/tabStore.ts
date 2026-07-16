import { create } from "zustand";

function makeId() {
  return `tab_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

export interface TabData {
  id: string;
  title: string;
  markdown: string;
  isDirty: boolean;
  lastSavedAt: number | null;
  fileName?: string;
  fileHandle?: FileSystemFileHandle;
  /** Handle for the companion .review.json file — set after first Save Review As. */
  reviewHandle?: FileSystemFileHandle;
  /** Handle for the companion .test-traceability.json file — set on bundle
   *  discovery, manual load, or first Save As. */
  traceabilityHandle?: FileSystemFileHandle;
  /** True for template/sample documents — never dirty, never saved to disk. */
  isReadOnly?: boolean;
}

interface TabActions {
  newTab(markdown?: string, title?: string, fileName?: string): string;
  newUntitledTab(): string;
  closeTab(id: string): void;
  setActiveTab(id: string): void;
  updateTab(id: string, patch: Partial<Omit<TabData, "id">>): void;
  updateActiveTab(patch: Partial<Omit<TabData, "id">>): void;
  markTabSaved(id?: string): void;
  setTabTitle(title: string): void;
}

interface TabState {
  tabs: TabData[];
  activeTabId: string;
}

export type TabStore = TabState & TabActions;

// Placeholder shown while public/templates/welcome.md is being fetched.
// App.tsx replaces the content as soon as the fetch resolves.
function makeWelcomeTab(): TabData {
  return {
    id: makeId(),
    title: "Welcome",
    markdown: "",
    isDirty: false,
    lastSavedAt: null,
    isReadOnly: true,
  };
}

export const useTabStore = create<TabStore>()((set, get) => {
  const initial = makeWelcomeTab();
  return {
    tabs: [initial],
    activeTabId: initial.id,

    newTab(markdown = "", title = "Untitled", fileName?: string) {
      const tab: TabData = {
        id: makeId(),
        title,
        markdown,
        isDirty: false,
        lastSavedAt: null,
        fileName,
      };
      set((s) => ({ tabs: [...s.tabs, tab], activeTabId: tab.id }));
      return tab.id;
    },

    newUntitledTab() {
      const existingNames = new Set(
        get().tabs.map((t) => t.fileName).filter((n): n is string => Boolean(n))
      );
      let fileName = "Untitled.md";
      let n = 2;
      while (existingNames.has(fileName)) {
        fileName = `Untitled-${n++}.md`;
      }
      return get().newTab("# Untitled\n\n", fileName.replace(/\.md$/, ""), fileName);
    },

    closeTab(id) {
      const { tabs, activeTabId } = get();
      if (tabs.length === 1) return;
      const idx = tabs.findIndex((t) => t.id === id);
      const next = tabs[idx + 1] ?? tabs[idx - 1];
      set({
        tabs: tabs.filter((t) => t.id !== id),
        activeTabId: activeTabId === id ? next.id : activeTabId,
      });
    },

    setActiveTab(id) {
      set({ activeTabId: id });
    },

    updateTab(id, patch) {
      set((s) => ({
        tabs: s.tabs.map((t) => (t.id === id ? { ...t, ...patch } : t)),
      }));
    },

    updateActiveTab(patch) {
      get().updateTab(get().activeTabId, patch);
    },

    markTabSaved(id?: string) {
      get().updateTab(id ?? get().activeTabId, {
        isDirty: false,
        lastSavedAt: Date.now(),
      });
    },

    setTabTitle(title) {
      get().updateActiveTab({ title, isDirty: true });
    },
  };
});

export function getActiveTab(store: TabStore): TabData | undefined {
  return store.tabs.find((t) => t.id === store.activeTabId);
}
