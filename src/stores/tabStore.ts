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

export const INITIAL_MARKDOWN = `# Welcome

Start writing in **Markdown**. Type \`/\` on a new line to insert blocks.

> [!INFO]
>
> This is an info callout. Try \`/callout\` to add one.

## Features

- WYSIWYG editing — Markdown stays in sync behind the scenes
- Tables, code blocks, task lists, callouts
- Multiple document tabs
- Open / save Markdown files
- Light and dark themes

## Code

\`\`\`javascript
function greet(name) {
  return \`Hello, \${name}!\`;
}
\`\`\`

| Column A | Column B |
| - | - |
| Cell 1   | Cell 2   |
| Cell 3   | Cell 4   |
`;

function makeInitialTab(): TabData {
  return {
    id: makeId(),
    title: "Welcome",
    markdown: INITIAL_MARKDOWN,
    isDirty: false,
    lastSavedAt: null,
  };
}

export const useTabStore = create<TabStore>()((set, get) => {
  const initial = makeInitialTab();
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
