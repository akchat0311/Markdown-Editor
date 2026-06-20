import { describe, it, expect, beforeEach } from "vitest";
import { useTabStore, getActiveTab } from "@/stores/tabStore";
import { useUIStore } from "@/stores/uiStore";

function resetTabStore() {
  useTabStore.setState(useTabStore.getInitialState());
}

describe("tabStore", () => {
  beforeEach(() => {
    resetTabStore();
  });

  it("starts with one tab and that tab is active", () => {
    const s = useTabStore.getState();
    expect(s.tabs).toHaveLength(1);
    expect(s.activeTabId).toBe(s.tabs[0].id);
  });

  it("getActiveTab returns the active tab", () => {
    const s = useTabStore.getState();
    const tab = getActiveTab(s);
    expect(tab).not.toBeUndefined();
    expect(tab!.id).toBe(s.activeTabId);
  });

  it("newTab adds a tab and makes it active", () => {
    useTabStore.getState().newTab("# Hi", "Hello");
    const s = useTabStore.getState();
    expect(s.tabs).toHaveLength(2);
    const tab = getActiveTab(s);
    expect(tab!.title).toBe("Hello");
    expect(tab!.markdown).toBe("# Hi");
  });

  it("closeTab removes the tab and switches to a neighbour", () => {
    const first = useTabStore.getState().tabs[0].id;
    useTabStore.getState().newTab("", "Second");
    const second = getActiveTab(useTabStore.getState())!.id;
    useTabStore.getState().closeTab(second);
    const s = useTabStore.getState();
    expect(s.tabs).toHaveLength(1);
    expect(s.activeTabId).toBe(first);
  });

  it("does not close the last remaining tab", () => {
    const id = useTabStore.getState().tabs[0].id;
    useTabStore.getState().closeTab(id);
    expect(useTabStore.getState().tabs).toHaveLength(1);
  });

  it("updateActiveTab merges patch onto active tab", () => {
    useTabStore.getState().updateActiveTab({ title: "Updated", isDirty: true });
    const tab = getActiveTab(useTabStore.getState())!;
    expect(tab.title).toBe("Updated");
    expect(tab.isDirty).toBe(true);
  });

  it("markTabSaved clears dirty and sets lastSavedAt", () => {
    useTabStore.getState().updateActiveTab({ isDirty: true });
    const before = Date.now();
    useTabStore.getState().markTabSaved();
    const after = Date.now();
    const tab = getActiveTab(useTabStore.getState())!;
    expect(tab.isDirty).toBe(false);
    expect(tab.lastSavedAt).toBeGreaterThanOrEqual(before);
    expect(tab.lastSavedAt).toBeLessThanOrEqual(after);
  });

  it("setTabTitle updates title and marks dirty", () => {
    useTabStore.getState().setTabTitle("My Doc");
    const tab = getActiveTab(useTabStore.getState())!;
    expect(tab.title).toBe("My Doc");
    expect(tab.isDirty).toBe(true);
  });

  it("setActiveTab switches active tab without closing others", () => {
    const first = useTabStore.getState().tabs[0].id;
    useTabStore.getState().newTab("", "Second");
    useTabStore.getState().setActiveTab(first);
    expect(useTabStore.getState().activeTabId).toBe(first);
    expect(useTabStore.getState().tabs).toHaveLength(2);
  });
});

describe("uiStore", () => {
  it("starts with sidebarOpen:true and sourceMode:false", () => {
    const initial = useUIStore.getInitialState();
    expect(initial.sidebarOpen).toBe(true);
    expect(initial.sourceMode).toBe(false);
  });

  it("toggleSidebar flips sidebarOpen", () => {
    useUIStore.setState({ sidebarOpen: true });
    useUIStore.getState().toggleSidebar();
    expect(useUIStore.getState().sidebarOpen).toBe(false);
    useUIStore.getState().toggleSidebar();
    expect(useUIStore.getState().sidebarOpen).toBe(true);
  });

  it("toggleSourceMode flips sourceMode", () => {
    useUIStore.setState({ sourceMode: false });
    useUIStore.getState().toggleSourceMode();
    expect(useUIStore.getState().sourceMode).toBe(true);
    useUIStore.getState().toggleSourceMode();
    expect(useUIStore.getState().sourceMode).toBe(false);
  });

  it("adjustSidebar clamps within bounds", () => {
    useUIStore.setState({ sidebarWidth: 240 });
    useUIStore.getState().adjustSidebar(10000);
    expect(useUIStore.getState().sidebarWidth).toBe(500);
    useUIStore.getState().adjustSidebar(-10000);
    expect(useUIStore.getState().sidebarWidth).toBe(160);
  });

  it("toggleTheme switches between light and dark", () => {
    useUIStore.setState({ theme: "light" });
    useUIStore.getState().toggleTheme();
    expect(useUIStore.getState().theme).toBe("dark");
    useUIStore.getState().toggleTheme();
    expect(useUIStore.getState().theme).toBe("light");
  });
});
