/**
 * Regression tests for cross-tab content synchronisation races.
 *
 * Background
 * ----------
 * The editor uses a singleton TipTap instance. Per-tab content is stored as
 * markdown strings in Zustand (tabStore). Content flows:
 *
 *   user types → TipTap onUpdate → queueMicrotask → store.updateTab(capturedId, ...)
 *   tab switch  → useEffect      → setTimeout(0)  → editor.view.dispatch(newContent)
 *
 * Original bug (Fix 1)
 * --------------------
 * onUpdate queued a microtask that called updateActiveTab(). Because microtasks
 * run before macrotasks, the microtask fired AFTER setActiveTab(B) but BEFORE
 * the setTimeout that loads B's content. updateActiveTab() reads get().activeTabId
 * at call time — which was now B — so Tab A's content was written into Tab B's
 * store entry. Saving Tab B then destroyed it.
 *
 * Fix 1: capture tabId = get().activeTabId synchronously inside onUpdate, then
 * call updateTab(capturedId, ...) in the microtask.
 *
 * A→B→C rapid switch bug (Fix 2)
 * --------------------------------
 * The tab-switch effect also had a belt-and-suspenders flush: before setting
 * isLoadingContentRef=true it serialised the editor into the departing tab's
 * store. This was correct for a single A→B switch. But in a rapid A→B→C
 * switch the A→B setTimeout is cancelled by React's cleanup before it fires,
 * so the editor still holds Tab A's content when the B→C effect runs.
 * Without the isLoadingContentRef guard, the B→C flush would write Tab A's
 * content into Tab B's store entry.
 *
 * Fix 2: skip the departing-tab flush when isLoadingContentRef.current is
 * already true (editor is mid-transition and does not represent that tab).
 */

import { describe, it, expect, beforeEach } from "vitest";
import { useTabStore } from "@/stores/tabStore";

// ── Helpers ───────────────────────────────────────────────────────────────────

function resetTabStore() {
  useTabStore.setState(useTabStore.getInitialState());
}

/** Simulates the core logic of the tab-switch useEffect's departing flush. */
function simulateDepartingFlush(
  departingId: string,
  editorMarkdown: string,
  isLoadingContent: boolean,
  inSourceMode: boolean,
): void {
  if (departingId && !inSourceMode && !isLoadingContent) {
    useTabStore.getState().updateTab(departingId, {
      markdown: editorMarkdown,
      isDirty: true,
    });
  }
}

// ── Setup ─────────────────────────────────────────────────────────────────────

describe("Tab synchronisation races", () => {
  let tabAId: string;
  let tabBId: string;
  let tabCId: string;

  beforeEach(() => {
    resetTabStore();
    // Create three tabs; start with A active.
    tabAId = useTabStore.getState().newTab("# A original", "Tab A");
    useTabStore.getState().setActiveTab(tabAId);
    tabBId = useTabStore.getState().newTab("# B original", "Tab B");
    useTabStore.getState().setActiveTab(tabBId);
    tabCId = useTabStore.getState().newTab("# C original", "Tab C");
    useTabStore.getState().setActiveTab(tabCId);
    // Start each test with Tab A active.
    useTabStore.getState().setActiveTab(tabAId);
  });

  // ── Fix 1 ────────────────────────────────────────────────────────────────────

  describe("Fix 1 – onUpdate microtask targets captured tabId", () => {
    it("updates the source tab even after the active tab changes", async () => {
      // Simulate what onUpdate now does: capture the tab ID synchronously,
      // use it inside the microtask.
      const capturedId = useTabStore.getState().activeTabId; // A
      queueMicrotask(() => {
        useTabStore.getState().updateTab(capturedId, {
          markdown: "# A edited",
          isDirty: true,
        });
      });

      // Switch to B BEFORE the microtask executes.
      useTabStore.getState().setActiveTab(tabBId);
      expect(useTabStore.getState().activeTabId).toBe(tabBId);

      await Promise.resolve(); // drain microtask queue

      const { tabs } = useTabStore.getState();
      const tabA = tabs.find((t) => t.id === tabAId)!;
      const tabB = tabs.find((t) => t.id === tabBId)!;

      expect(tabA.markdown).toBe("# A edited");   // A received its own edit
      expect(tabB.markdown).toBe("# B original"); // B is untouched
      expect(tabA.isDirty).toBe(true);
    });

    it("multiple queued microtasks from one tab all target that tab", async () => {
      // Simulate three rapid keystrokes → three onUpdate calls → three microtasks.
      for (const version of ["# A v1", "# A v2", "# A v3"]) {
        const capturedId = useTabStore.getState().activeTabId; // always A
        const snapshot = version;
        queueMicrotask(() => {
          useTabStore.getState().updateTab(capturedId, {
            markdown: snapshot,
            isDirty: true,
          });
        });
      }

      // Switch to B while all three microtasks are still pending.
      useTabStore.getState().setActiveTab(tabBId);

      await Promise.resolve(); // drain all microtasks

      const { tabs } = useTabStore.getState();
      expect(tabs.find((t) => t.id === tabAId)!.markdown).toBe("# A v3");      // last write wins
      expect(tabs.find((t) => t.id === tabBId)!.markdown).toBe("# B original"); // untouched
    });

    it("regression: updateActiveTab() in a microtask writes to whichever tab is active at flush time", async () => {
      // This test documents the pre-fix behaviour to confirm the bug was real
      // and that updateActiveTab() has the same timing hazard today.
      // The fix replaced updateActiveTab() with updateTab(capturedId).
      queueMicrotask(() => {
        // Old code: reads get().activeTabId at microtask execution time,
        // which is now tabB because setActiveTab(tabBId) ran synchronously.
        useTabStore.getState().updateActiveTab({
          markdown: "# A edited",
          isDirty: true,
        });
      });

      useTabStore.getState().setActiveTab(tabBId); // activeTabId flips to B
      await Promise.resolve();

      // The old pattern writes Tab A's content into Tab B's store entry.
      const tabB = useTabStore.getState().tabs.find((t) => t.id === tabBId)!;
      expect(tabB.markdown).toBe("# A edited"); // documents the bug: B was corrupted
    });
  });

  // ── Fix 2 ────────────────────────────────────────────────────────────────────

  describe("Fix 2 – departing-tab flush guard (isLoadingContentRef)", () => {
    it("single A→B switch: flushes Tab A's content to the store", () => {
      // isLoadingContent starts false → flush should run.
      simulateDepartingFlush(tabAId, "# A edited", false, false);
      useTabStore.getState().setActiveTab(tabBId);

      const tabA = useTabStore.getState().tabs.find((t) => t.id === tabAId)!;
      expect(tabA.markdown).toBe("# A edited");
    });

    it("rapid A→B→C: Tab B store is not overwritten with Tab A's content", () => {
      // A→B switch: isLoading=false → flush A (correct), then set isLoading=true.
      let isLoading = false;

      simulateDepartingFlush(tabAId, "# A edited", isLoading, false);
      isLoading = true; // mirrors isLoadingContentRef.current = true
      useTabStore.getState().setActiveTab(tabBId);

      // The A→B setTimeout is cancelled (clearTimeout in cleanup).
      // Editor still contains Tab A's content.
      // B→C switch: isLoading is still true → flush must be skipped.

      simulateDepartingFlush(tabBId, "# A edited" /* stale editor */, isLoading, false);
      useTabStore.getState().setActiveTab(tabCId);

      const { tabs } = useTabStore.getState();
      expect(tabs.find((t) => t.id === tabAId)!.markdown).toBe("# A edited");   // A correctly saved
      expect(tabs.find((t) => t.id === tabBId)!.markdown).toBe("# B original"); // B NOT corrupted
    });

    it("source mode suppresses the flush regardless of isLoadingContent", () => {
      // In source mode the editor's WYSIWYG doc does not reflect typed text
      // (SourcePane writes to TipTap via its own debounce). Flushing the
      // editor state during source mode would save stale content.
      simulateDepartingFlush(tabAId, "# stale WYSIWYG", false, true /* inSourceMode */);
      useTabStore.getState().setActiveTab(tabBId);

      const tabA = useTabStore.getState().tabs.find((t) => t.id === tabAId)!;
      expect(tabA.markdown).toBe("# A original"); // untouched — flush was skipped
    });
  });

  // ── Save path ─────────────────────────────────────────────────────────────────

  describe("Save path correctness", () => {
    it("after a rapid switch, each tab's store holds only its own content", async () => {
      // Simulate: user edits A, rapidly switches to B, then saves B.
      // Saving reads tab.markdown from the store; it must be B's content.
      const capturedId = useTabStore.getState().activeTabId; // A
      queueMicrotask(() => {
        useTabStore.getState().updateTab(capturedId, {
          markdown: "# A saved",
          isDirty: true,
        });
      });

      useTabStore.getState().setActiveTab(tabBId);
      await Promise.resolve(); // drain microtasks

      const storeState = useTabStore.getState();
      const tabAStore = storeState.tabs.find((t) => t.id === tabAId)!;
      const tabBStore = storeState.tabs.find((t) => t.id === tabBId)!;

      expect(tabBStore.markdown).toBe("# B original"); // saving B writes B's content
      expect(tabAStore.markdown).toBe("# A saved");    // A has its own updated content
    });

    it("updateTab targets the specified tab, not the currently active one", () => {
      // Verify the store primitive itself is correct: updateTab(id) only
      // modifies the named tab regardless of which tab is active.
      useTabStore.getState().setActiveTab(tabBId); // B is now active

      useTabStore.getState().updateTab(tabAId, {
        markdown: "# A patched",
        isDirty: true,
      });

      const { tabs, activeTabId } = useTabStore.getState();
      expect(activeTabId).toBe(tabBId);
      expect(tabs.find((t) => t.id === tabAId)!.markdown).toBe("# A patched");
      expect(tabs.find((t) => t.id === tabBId)!.markdown).toBe("# B original");
    });
  });
});
