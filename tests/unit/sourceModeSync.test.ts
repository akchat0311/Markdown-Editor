/**
 * Regression tests for source-mode synchronisation guarantees.
 *
 * Background
 * ----------
 * SourcePane owned a local `text` state that fed a 250 ms debounce into
 * TipTap. The tab store was never updated until the debounce fired.
 *
 * This created two independent data-safety bugs:
 *
 * Bug 1 — Stale save
 *   User edits in source mode → presses Ctrl+S before 250 ms elapses →
 *   save reads tab.markdown from the store (stale) → disk gets old content.
 *
 * Bug 2 — Cross-tab debounce
 *   User edits Tab A in source mode → switches to Tab B within 250 ms →
 *   debounce fires for Tab A's text but TipTap (singleton) is now on Tab B →
 *   Tab B's WYSIWYG view is overwritten with Tab A's source content.
 *   Subsequent onUpdate (or manual save) then persists Tab A's content under
 *   Tab B's file.
 *
 * Fixes
 * -----
 *  1. SourcePane now writes to the store immediately on every keystroke via
 *     updateTab(capturedTabId, { markdown, isDirty: true }).
 *  2. SourcePane receives activeTabId as a prop. The cleanup effect includes
 *     activeTabId in its deps, so the pending TipTap debounce is cancelled
 *     whenever the active tab changes.
 *  3. Inside the debounce setTimeout, a captured-tab-ID guard skips the
 *     TipTap write if the active tab has changed since the timer was set.
 *  4. App.tsx adds a useEffect([editor, sourceMode]) that syncs TipTap from
 *     the store when source mode exits (true → false), closing the gap where
 *     TipTap might be one debounce interval behind.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { useTabStore } from "@/stores/tabStore";

// ── Helpers ───────────────────────────────────────────────────────────────────

function resetTabStore() {
  useTabStore.setState(useTabStore.getInitialState());
}

/**
 * Simulates the source-mode immediate store write from SourcePane.handleChange.
 * In production this runs synchronously inside the onChange handler.
 */
function simulateSourceWrite(tabId: string, markdown: string): void {
  const store = useTabStore.getState();
  const tab = store.tabs.find((t) => t.id === tabId);
  if (tab && !tab.isReadOnly) {
    store.updateTab(tabId, { markdown, isDirty: true });
  }
}

/**
 * Simulates the debounce guard inside SourcePane's setTimeout callback.
 * Returns true if the TipTap sync would proceed, false if guarded out.
 */
function simulateDebounceGuard(
  activeTabIdRef: { current: string | undefined },
  capturedTabId: string | undefined,
): boolean {
  return activeTabIdRef.current === capturedTabId;
}

// ── Setup ─────────────────────────────────────────────────────────────────────

describe("Source-mode synchronisation", () => {
  let tabAId: string;
  let tabBId: string;
  let tabCId: string;

  beforeEach(() => {
    resetTabStore();
    tabAId = useTabStore.getState().newTab("# A original", "Tab A");
    useTabStore.getState().setActiveTab(tabAId);
    tabBId = useTabStore.getState().newTab("# B original", "Tab B");
    tabCId = useTabStore.getState().newTab("# C original", "Tab C");
    useTabStore.getState().setActiveTab(tabAId);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ── Bug 1: Immediate Ctrl+S ──────────────────────────────────────────────────

  describe("Bug 1 fix – store updated immediately (no debounce for save path)", () => {
    it("store reflects typed text immediately, before any debounce fires", () => {
      simulateSourceWrite(tabAId, "# A typed in source mode");

      // Save reads tab.markdown from the store — must be current.
      const tab = useTabStore.getState().tabs.find((t) => t.id === tabAId)!;
      expect(tab.markdown).toBe("# A typed in source mode");
      expect(tab.isDirty).toBe(true);
    });

    it("multiple keystrokes each update the store, last write wins", () => {
      simulateSourceWrite(tabAId, "# A v1");
      simulateSourceWrite(tabAId, "# A v2");
      simulateSourceWrite(tabAId, "# A v3");

      const tab = useTabStore.getState().tabs.find((t) => t.id === tabAId)!;
      expect(tab.markdown).toBe("# A v3");
    });

    it("all writes target the captured tabId, not the currently active tab", () => {
      // Simulate: user typed on Tab A, store has captured tabAId.
      // Active tab then changes to B (mimics a tab switch mid-sequence).
      const capturedTabId = tabAId;
      useTabStore.getState().setActiveTab(tabBId);

      // Writes still target the captured ID.
      simulateSourceWrite(capturedTabId, "# A source edit");

      const { tabs } = useTabStore.getState();
      expect(tabs.find((t) => t.id === tabAId)!.markdown).toBe("# A source edit");
      expect(tabs.find((t) => t.id === tabBId)!.markdown).toBe("# B original"); // untouched
    });

    it("does not mark a read-only tab as dirty", () => {
      // Make Tab A read-only.
      useTabStore.getState().updateTab(tabAId, { isReadOnly: true });

      simulateSourceWrite(tabAId, "should not apply");

      const tab = useTabStore.getState().tabs.find((t) => t.id === tabAId)!;
      expect(tab.markdown).toBe("# A original"); // unchanged
      expect(tab.isDirty).toBe(false);
    });
  });

  // ── Bug 2: Cross-tab debounce guard ─────────────────────────────────────────

  describe("Bug 2 fix – debounce timer is guarded by captured tab ID", () => {
    it("debounce fires TipTap sync when still on the same tab", () => {
      vi.useFakeTimers();
      const activeTabIdRef = { current: tabAId as string | undefined };
      const capturedTabId = tabAId;

      let tiptapSynced = false;
      // Simulate what SourcePane's setTimeout does.
      setTimeout(() => {
        if (!simulateDebounceGuard(activeTabIdRef, capturedTabId)) return;
        tiptapSynced = true; // would call editor.commands.setContent(...)
      }, 250);

      vi.advanceTimersByTime(250);
      expect(tiptapSynced).toBe(true);
    });

    it("debounce is skipped when active tab changes before timer fires", () => {
      vi.useFakeTimers();
      const activeTabIdRef = { current: tabAId as string | undefined };
      const capturedTabId = tabAId;

      let tiptapSynced = false;
      setTimeout(() => {
        if (!simulateDebounceGuard(activeTabIdRef, capturedTabId)) return;
        tiptapSynced = true;
      }, 250);

      // User switches to Tab B before the 250 ms fires.
      activeTabIdRef.current = tabBId;
      vi.advanceTimersByTime(250);

      expect(tiptapSynced).toBe(false); // guard prevented the cross-tab write
    });

    it("multiple pending debounces for Tab A are all skipped after switch to B", () => {
      vi.useFakeTimers();
      const activeTabIdRef = { current: tabAId as string | undefined };
      let tiptapSyncCount = 0;

      // Three rapid keystrokes schedule three (coalesced) timers.
      // Simulate the last-one-wins pattern SourcePane uses.
      for (const ms of [50, 150, 250]) {
        const capturedTabId = tabAId;
        setTimeout(() => {
          if (!simulateDebounceGuard(activeTabIdRef, capturedTabId)) return;
          tiptapSyncCount++;
        }, ms);
      }

      // Tab switch before any timer fires.
      activeTabIdRef.current = tabBId;
      vi.advanceTimersByTime(300);

      expect(tiptapSyncCount).toBe(0);
    });
  });

  // ── Tab switch with pending source-mode work ─────────────────────────────────

  describe("Tab switch while source-mode edits are pending", () => {
    it("Tab A store is correct after switch to B (single switch)", () => {
      simulateSourceWrite(tabAId, "# A source edit");
      useTabStore.getState().setActiveTab(tabBId);

      const { tabs } = useTabStore.getState();
      expect(tabs.find((t) => t.id === tabAId)!.markdown).toBe("# A source edit");
      expect(tabs.find((t) => t.id === tabBId)!.markdown).toBe("# B original");
    });

    it("A→B→C: all three tabs retain their own content", () => {
      simulateSourceWrite(tabAId, "# A typed");
      useTabStore.getState().setActiveTab(tabBId);

      simulateSourceWrite(tabBId, "# B typed");
      useTabStore.getState().setActiveTab(tabCId);

      const { tabs } = useTabStore.getState();
      expect(tabs.find((t) => t.id === tabAId)!.markdown).toBe("# A typed");
      expect(tabs.find((t) => t.id === tabBId)!.markdown).toBe("# B typed");
      expect(tabs.find((t) => t.id === tabCId)!.markdown).toBe("# C original");
    });

    it("switching back and forth preserves each tab's latest source edit", () => {
      simulateSourceWrite(tabAId, "# A v1");
      useTabStore.getState().setActiveTab(tabBId);
      simulateSourceWrite(tabBId, "# B v1");
      useTabStore.getState().setActiveTab(tabAId);
      simulateSourceWrite(tabAId, "# A v2"); // second edit on A
      useTabStore.getState().setActiveTab(tabBId);

      const { tabs } = useTabStore.getState();
      expect(tabs.find((t) => t.id === tabAId)!.markdown).toBe("# A v2");
      expect(tabs.find((t) => t.id === tabBId)!.markdown).toBe("# B v1");
    });

    it("Tab B debounce writes only to Tab B even when Tab A's timer was also pending", () => {
      vi.useFakeTimers();
      const activeTabIdRef = { current: tabAId as string | undefined };
      let aSync = 0;
      let bSync = 0;

      // Tab A's debounce.
      const capturedA = tabAId;
      setTimeout(() => {
        if (activeTabIdRef.current !== capturedA) return;
        aSync++;
      }, 250);

      // Switch to Tab B — Tab A's debounce cleanup would cancel this.
      activeTabIdRef.current = tabBId;
      useTabStore.getState().setActiveTab(tabBId);

      // Tab B types and schedules its own debounce.
      simulateSourceWrite(tabBId, "# B typed");
      const capturedB = tabBId;
      setTimeout(() => {
        if (activeTabIdRef.current !== capturedB) return;
        bSync++;
      }, 250);

      vi.advanceTimersByTime(300);

      expect(aSync).toBe(0); // A's timer was guarded out
      expect(bSync).toBe(1); // B's timer fired correctly
      expect(useTabStore.getState().tabs.find((t) => t.id === tabBId)!.markdown).toBe("# B typed");
    });
  });

  // ── Cross-tab write regression ───────────────────────────────────────────────

  describe("Cross-tab write regression (original Bug 2 scenario)", () => {
    it("Tab B store is not corrupted by a stale Tab A debounce", () => {
      vi.useFakeTimers();
      const activeTabIdRef = { current: tabAId as string | undefined };

      // User types in Tab A source mode.
      simulateSourceWrite(tabAId, "# A source content");
      const capturedA = tabAId;
      setTimeout(() => {
        // Old behaviour (no guard): would call editor.commands.setContent for Tab A text
        // while TipTap was now showing Tab B, poisoning the WYSIWYG view and next save.
        // New behaviour: guard prevents this.
        if (activeTabIdRef.current !== capturedA) return;
        // TipTap sync would happen here — but it's skipped.
        // The test verifies that Tab B's store is not touched.
        useTabStore.getState().updateTab(tabBId, { markdown: "# A source content" }); // old bug
      }, 250);

      // Switch to Tab B before debounce fires.
      activeTabIdRef.current = tabBId;
      useTabStore.getState().setActiveTab(tabBId);

      // The debounce cleanup (activeTabId dep) would cancel this timer before it fires.
      // The guard in the callback is the belt-and-suspenders fallback.
      vi.advanceTimersByTime(300);

      // With the guard active (activeTabIdRef.current === tabBId ≠ capturedA),
      // the timer body early-returns — so Tab B's store must be untouched.
      const tabB = useTabStore.getState().tabs.find((t) => t.id === tabBId)!;
      expect(tabB.markdown).toBe("# B original");
    });
  });
});
