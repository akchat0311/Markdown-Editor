import { describe, it, expect, beforeEach, vi } from "vitest";
import { useTabStore, getActiveTab } from "@/stores/tabStore";

// Mock persistence layer — keeps tests pure and fast
vi.mock("@/persistence/db", () => ({
  getDB: vi.fn(),
  RECENT_STORE: "recent_files",
}));
vi.mock("@/persistence/recentFiles", () => ({
  addRecentFile: vi.fn(),
  getRecentFiles: vi.fn(async () => []),
  removeRecentFile: vi.fn(),
}));
vi.mock("@/persistence/fileAccess", () => ({
  openMarkdownFile: vi.fn(),
  saveMarkdownFile: vi.fn(),
  downloadMarkdown: vi.fn(),
}));

function resetTabStore() {
  useTabStore.setState(useTabStore.getInitialState());
}

// ── newUntitledTab ────────────────────────────────────────────────────────────

describe("newUntitledTab", () => {
  beforeEach(resetTabStore);

  it("creates a tab named Untitled.md", () => {
    useTabStore.getState().newUntitledTab();
    const tabs = useTabStore.getState().tabs;
    expect(tabs).toHaveLength(2);
    const newTab = tabs[1];
    expect(newTab.fileName).toBe("Untitled.md");
    expect(newTab.title).toBe("Untitled");
  });

  it("increments to Untitled-2.md when Untitled.md exists", () => {
    useTabStore.getState().newUntitledTab(); // Untitled.md
    useTabStore.getState().newUntitledTab(); // Untitled-2.md
    const tabs = useTabStore.getState().tabs;
    const names = tabs.map((t) => t.fileName);
    expect(names).toContain("Untitled.md");
    expect(names).toContain("Untitled-2.md");
  });

  it("continues incrementing correctly with multiple untitled tabs", () => {
    useTabStore.getState().newUntitledTab();
    useTabStore.getState().newUntitledTab();
    useTabStore.getState().newUntitledTab();
    const tabs = useTabStore.getState().tabs;
    const fileNames = tabs.map((t) => t.fileName).filter(Boolean);
    expect(fileNames).toContain("Untitled.md");
    expect(fileNames).toContain("Untitled-2.md");
    expect(fileNames).toContain("Untitled-3.md");
  });

  it("starts with initial heading content", () => {
    useTabStore.getState().newUntitledTab();
    const tab = getActiveTab(useTabStore.getState())!;
    expect(tab.markdown).toMatch(/^# Untitled/);
  });

  it("new tab becomes active", () => {
    useTabStore.getState().newUntitledTab();
    const s = useTabStore.getState();
    expect(s.activeTabId).toBe(s.tabs[s.tabs.length - 1].id);
  });
});

// ── updateTab ─────────────────────────────────────────────────────────────────

describe("updateTab", () => {
  beforeEach(resetTabStore);

  it("updates a non-active tab by id", () => {
    const firstId = useTabStore.getState().tabs[0].id;
    useTabStore.getState().newUntitledTab(); // now this is active
    useTabStore.getState().updateTab(firstId, { title: "Patched", isDirty: true });
    const patched = useTabStore.getState().tabs.find((t) => t.id === firstId)!;
    expect(patched.title).toBe("Patched");
    expect(patched.isDirty).toBe(true);
    // active tab should be untouched
    const active = getActiveTab(useTabStore.getState())!;
    expect(active.title).toBe("Untitled");
  });

  it("stores fileHandle on the tab", () => {
    const id = useTabStore.getState().tabs[0].id;
    const fakeHandle = { name: "readme.md" } as unknown as FileSystemFileHandle;
    useTabStore.getState().updateTab(id, { fileHandle: fakeHandle });
    const tab = useTabStore.getState().tabs.find((t) => t.id === id)!;
    expect(tab.fileHandle).toBe(fakeHandle);
  });
});

// ── markTabSaved (with optional id) ──────────────────────────────────────────

describe("markTabSaved", () => {
  beforeEach(resetTabStore);

  it("marks active tab saved when no id given", () => {
    useTabStore.getState().updateActiveTab({ isDirty: true });
    useTabStore.getState().markTabSaved();
    const tab = getActiveTab(useTabStore.getState())!;
    expect(tab.isDirty).toBe(false);
    expect(tab.lastSavedAt).toBeGreaterThan(0);
  });

  it("marks a specific non-active tab saved when id given", () => {
    const firstId = useTabStore.getState().tabs[0].id;
    useTabStore.getState().updateTab(firstId, { isDirty: true });
    useTabStore.getState().newUntitledTab(); // second tab active
    useTabStore.getState().markTabSaved(firstId);
    const first = useTabStore.getState().tabs.find((t) => t.id === firstId)!;
    expect(first.isDirty).toBe(false);
    // active (second) tab unaffected
    const active = getActiveTab(useTabStore.getState())!;
    expect(active.isDirty).toBe(false); // new tabs start clean
  });
});

// ── dirty state flow ──────────────────────────────────────────────────────────

describe("dirty state", () => {
  beforeEach(resetTabStore);

  it("starts as not dirty", () => {
    const tab = getActiveTab(useTabStore.getState())!;
    expect(tab.isDirty).toBe(false);
  });

  it("updateActiveTab with isDirty:true marks dirty", () => {
    useTabStore.getState().updateActiveTab({ markdown: "# Changed", isDirty: true });
    expect(getActiveTab(useTabStore.getState())!.isDirty).toBe(true);
  });

  it("markTabSaved clears dirty", () => {
    useTabStore.getState().updateActiveTab({ isDirty: true });
    useTabStore.getState().markTabSaved();
    expect(getActiveTab(useTabStore.getState())!.isDirty).toBe(false);
  });

  it("setTabTitle marks dirty", () => {
    useTabStore.getState().setTabTitle("New Name");
    expect(getActiveTab(useTabStore.getState())!.isDirty).toBe(true);
  });
});

// ── duplicate-tab detection (logic) ──────────────────────────────────────────

describe("open file duplicate detection logic", () => {
  beforeEach(resetTabStore);

  it("detects a tab with the same fileName", () => {
    useTabStore.getState().newTab("# Hello", "hello", "hello.md");
    const existing = useTabStore
      .getState()
      .tabs.find((t) => t.fileName === "hello.md");
    expect(existing).toBeDefined();
  });

  it("does not find a match for a different filename", () => {
    useTabStore.getState().newTab("# Hello", "hello", "hello.md");
    const existing = useTabStore
      .getState()
      .tabs.find((t) => t.fileName === "world.md");
    expect(existing).toBeUndefined();
  });
});

// ── closeTab with dirty guard (store-level) ───────────────────────────────────

describe("closeTab", () => {
  beforeEach(resetTabStore);

  it("does not close the last tab", () => {
    useTabStore.getState().closeTab(useTabStore.getState().tabs[0].id);
    expect(useTabStore.getState().tabs).toHaveLength(1);
  });

  it("closing non-active tab leaves active tab unchanged", () => {
    const firstId = useTabStore.getState().tabs[0].id;
    useTabStore.getState().newUntitledTab();
    const secondId = getActiveTab(useTabStore.getState())!.id;
    useTabStore.getState().closeTab(firstId);
    expect(useTabStore.getState().activeTabId).toBe(secondId);
    expect(useTabStore.getState().tabs).toHaveLength(1);
  });
});
