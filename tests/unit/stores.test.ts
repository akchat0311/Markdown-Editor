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

  // ── Split view (dockable source pane) ─────────────────────────────────────

  describe("split view", () => {
    it("starts closed, uncollapsed, with the default splitter width", () => {
      const initial = useUIStore.getInitialState();
      expect(initial.splitViewOpen).toBe(false);
      expect(initial.splitCollapsedPane).toBe("none");
      expect(initial.splitSourceWidth).toBe(480);
    });

    it("toggleSplitView flips splitViewOpen", () => {
      useUIStore.setState({ splitViewOpen: false, sourceMode: false });
      useUIStore.getState().toggleSplitView();
      expect(useUIStore.getState().splitViewOpen).toBe(true);
      useUIStore.getState().toggleSplitView();
      expect(useUIStore.getState().splitViewOpen).toBe(false);
    });

    it("splitViewOpen and sourceMode are mutually exclusive: opening split view closes source mode", () => {
      useUIStore.setState({ sourceMode: true, splitViewOpen: false });
      useUIStore.getState().setSplitViewOpen(true);
      expect(useUIStore.getState().splitViewOpen).toBe(true);
      expect(useUIStore.getState().sourceMode).toBe(false);
    });

    it("splitViewOpen and sourceMode are mutually exclusive: enabling source mode closes split view", () => {
      useUIStore.setState({ sourceMode: false, splitViewOpen: true });
      useUIStore.getState().setSourceMode(true);
      expect(useUIStore.getState().sourceMode).toBe(true);
      expect(useUIStore.getState().splitViewOpen).toBe(false);
    });

    it("toggleSourceMode also closes split view when turning source mode on", () => {
      useUIStore.setState({ sourceMode: false, splitViewOpen: true });
      useUIStore.getState().toggleSourceMode();
      expect(useUIStore.getState().sourceMode).toBe(true);
      expect(useUIStore.getState().splitViewOpen).toBe(false);
    });

    it("toggleSplitView also closes source mode when turning split view on", () => {
      useUIStore.setState({ sourceMode: true, splitViewOpen: false });
      useUIStore.getState().toggleSplitView();
      expect(useUIStore.getState().splitViewOpen).toBe(true);
      expect(useUIStore.getState().sourceMode).toBe(false);
    });

    it("turning either mode off does not disturb the other", () => {
      useUIStore.setState({ sourceMode: false, splitViewOpen: false });
      useUIStore.getState().setSplitViewOpen(false);
      expect(useUIStore.getState().sourceMode).toBe(false);
      useUIStore.getState().setSourceMode(false);
      expect(useUIStore.getState().splitViewOpen).toBe(false);
    });

    it("adjustSplitSourceWidth clamps within bounds", () => {
      useUIStore.setState({ splitSourceWidth: 480 });
      useUIStore.getState().adjustSplitSourceWidth(10000);
      expect(useUIStore.getState().splitSourceWidth).toBe(1000);
      useUIStore.getState().adjustSplitSourceWidth(-10000);
      expect(useUIStore.getState().splitSourceWidth).toBe(280);
    });

    it("setSplitSourceWidth clamps within bounds", () => {
      useUIStore.getState().setSplitSourceWidth(50);
      expect(useUIStore.getState().splitSourceWidth).toBe(280);
      useUIStore.getState().setSplitSourceWidth(5000);
      expect(useUIStore.getState().splitSourceWidth).toBe(1000);
    });

    it("collapseSplitPane hides the given pane", () => {
      useUIStore.setState({ splitCollapsedPane: "none" });
      useUIStore.getState().collapseSplitPane("source");
      expect(useUIStore.getState().splitCollapsedPane).toBe("source");
      useUIStore.getState().collapseSplitPane("editor");
      expect(useUIStore.getState().splitCollapsedPane).toBe("editor");
    });

    it("maximizeSplitPane hides the OTHER pane", () => {
      useUIStore.setState({ splitCollapsedPane: "none" });
      useUIStore.getState().maximizeSplitPane("editor");
      expect(useUIStore.getState().splitCollapsedPane).toBe("source");
      useUIStore.getState().maximizeSplitPane("source");
      expect(useUIStore.getState().splitCollapsedPane).toBe("editor");
    });

    it("restoreSplitView resets to both panes visible", () => {
      useUIStore.setState({ splitCollapsedPane: "source" });
      useUIStore.getState().restoreSplitView();
      expect(useUIStore.getState().splitCollapsedPane).toBe("none");
    });

    describe("scroll sync mode", () => {
      it("starts off", () => {
        expect(useUIStore.getInitialState().scrollSyncMode).toBe("off");
      });

      it("setScrollSyncMode sets an exact mode", () => {
        useUIStore.getState().setScrollSyncMode("linked");
        expect(useUIStore.getState().scrollSyncMode).toBe("linked");
        useUIStore.getState().setScrollSyncMode("off");
        expect(useUIStore.getState().scrollSyncMode).toBe("off");
      });

      it("toggleScrollSync flips between off and linked", () => {
        useUIStore.setState({ scrollSyncMode: "off" });
        useUIStore.getState().toggleScrollSync();
        expect(useUIStore.getState().scrollSyncMode).toBe("linked");
        useUIStore.getState().toggleScrollSync();
        expect(useUIStore.getState().scrollSyncMode).toBe("off");
      });
    });
  });
});
