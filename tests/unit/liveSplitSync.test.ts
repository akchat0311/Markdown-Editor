/**
 * Regression tests for SourcePane's live-sync behavior in split view.
 *
 * Background
 * ----------
 * Prior to this change, SourcePane only refreshed its local `text` state on
 * mount / tab switch / activation — so while both the rich editor and the
 * source pane are simultaneously visible (split view), typing in the rich
 * editor never appeared in the source pane until the pane was unmounted and
 * remounted (e.g. via collapse + restore).
 *
 * The fix subscribes SourcePane to the tab store's `markdown` field and
 * mirrors external changes into `text` immediately, while a
 * `lastSelfWrittenRef` distinguishes "the store changed because this pane
 * itself just wrote it" (skip, to avoid resetting the caret mid-keystroke)
 * from "the store changed because something else (the rich editor) wrote
 * it" (adopt it).
 *
 * A second, related fix: the existing 250ms debounced sync from source text
 * into the rich editor used to parse a value *captured at schedule time*.
 * Once both panes can be edited within the same debounce window, a
 * rich-editor edit landing in that window would get silently discarded when
 * the stale captured text was later applied via a full-document replace.
 * The fix re-reads the store's current value at *fire time* instead.
 *
 * These tests simulate both fixes in isolation (mirroring the style of
 * sourceModeSync.test.ts), without rendering the real React component.
 */

import { describe, it, expect, vi, afterEach } from "vitest";

// ── Self-echo suppression (rich editor → source pane live sync) ─────────────

/**
 * Simulates SourcePane's live-sync effect condition: given the store's
 * current markdown and the pane's own last-self-written value, decide
 * whether the pane should adopt the store's value into its local text.
 */
function shouldAdoptExternalChange(
  storeMarkdown: string | undefined,
  lastSelfWritten: string | undefined,
): boolean {
  if (storeMarkdown === undefined) return false;
  if (storeMarkdown === lastSelfWritten) return false;
  return true;
}

describe("SourcePane live sync — self-echo suppression", () => {
  it("does not re-adopt the store value when it merely echoes this pane's own write", () => {
    const lastSelfWritten = "# typed by me";
    const storeMarkdown = "# typed by me"; // the echo of the write this pane just made
    expect(shouldAdoptExternalChange(storeMarkdown, lastSelfWritten)).toBe(false);
  });

  it("adopts the store value when it differs from this pane's own last write (external change)", () => {
    const lastSelfWritten = "# typed by me";
    const storeMarkdown = "# typed in the rich editor"; // changed by someone else
    expect(shouldAdoptExternalChange(storeMarkdown, lastSelfWritten)).toBe(true);
  });

  it("adopts the store value on first activation, before this pane has ever written anything", () => {
    const lastSelfWritten = undefined;
    const storeMarkdown = "# initial content";
    expect(shouldAdoptExternalChange(storeMarkdown, lastSelfWritten)).toBe(true);
  });

  it("does nothing while the store has no entry yet for this tab", () => {
    expect(shouldAdoptExternalChange(undefined, "# typed by me")).toBe(false);
  });

  it("a stale self-written value from a previous tab does not suppress a same-text coincidence on a new tab", () => {
    // Simulates the reset performed on tab switch: after resetting,
    // lastSelfWritten is undefined, so even if the new tab's markdown
    // happens to equal the old tab's last self-written text, it's adopted.
    const lastSelfWrittenAfterReset = undefined;
    const newTabMarkdown = "# typed by me"; // coincidentally identical text
    expect(shouldAdoptExternalChange(newTabMarkdown, lastSelfWrittenAfterReset)).toBe(true);
  });
});

// ── Freshest-read-at-fire-time (source pane → rich editor debounced sync) ───

interface FakeTab {
  id: string;
  markdown: string;
}

/**
 * Simulates the debounced sync callback: instead of parsing a value frozen
 * at schedule time, it re-reads the tab's current markdown from the store
 * at fire time.
 */
function simulateDebouncedSync(
  store: { tabs: FakeTab[] },
  capturedTabId: string,
  activeTabIdRef: { current: string | undefined },
): string | null {
  if (activeTabIdRef.current !== capturedTabId) return null;
  const freshest = store.tabs.find((t) => t.id === capturedTabId)?.markdown;
  return freshest ?? null;
}

describe("SourcePane debounced sync — reads freshest store value at fire time", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("uses the value captured at schedule time when nothing else changed it in the meantime", () => {
    const store = { tabs: [{ id: "tab-a", markdown: "# B typed" }] };
    const activeTabIdRef = { current: "tab-a" as string | undefined };
    const result = simulateDebouncedSync(store, "tab-a", activeTabIdRef);
    expect(result).toBe("# B typed");
  });

  it("uses a NEWER value if the rich editor wrote to the store after the source-pane keystroke was scheduled", () => {
    const store = { tabs: [{ id: "tab-a", markdown: "# B typed" }] };
    const activeTabIdRef = { current: "tab-a" as string | undefined };

    // Simulates: user typed "[B]" in the source pane (schedules this sync),
    // then typed "[C]" in the rich editor before the 250ms elapsed — the
    // rich editor's onUpdate overwrote the store with its own (newer) state.
    store.tabs[0].markdown = "# B typed, then C typed in rich editor";

    const result = simulateDebouncedSync(store, "tab-a", activeTabIdRef);
    // Must reflect the newer value, not the stale one from schedule time —
    // this is what prevents the debounced setContent from discarding the
    // rich-editor edit that landed inside the same debounce window.
    expect(result).toBe("# B typed, then C typed in rich editor");
    expect(result).not.toBe("# B typed");
  });

  it("skips firing when the active tab changed before the timer fired (existing cross-tab guard, unaffected)", () => {
    const store = { tabs: [{ id: "tab-a", markdown: "# A content" }] };
    const activeTabIdRef = { current: "tab-b" as string | undefined }; // switched away

    const result = simulateDebouncedSync(store, "tab-a", activeTabIdRef);
    expect(result).toBeNull();
  });

  it("skips firing when the tab no longer exists in the store", () => {
    const store = { tabs: [] as FakeTab[] };
    const activeTabIdRef = { current: "tab-a" as string | undefined };
    const result = simulateDebouncedSync(store, "tab-a", activeTabIdRef);
    expect(result).toBeNull();
  });
});

// ── Known, accepted residual limitation ──────────────────────────────────────
//
// Rapid alternation between the two panes WITHIN the same ~250ms debounce
// window can still lose an in-flight source-pane edit: if the user types in
// the source pane, then switches to the rich editor and types again before
// the debounce fires, the rich editor's onUpdate (which always treats its
// own current doc as authoritative) overwrites the store with a version that
// doesn't include the source pane's just-typed text. This is a documented,
// accepted trade-off of live bidirectional sync built only on the existing
// debounce/full-replace primitives (no incremental patching) — fixing it
// would require conflict detection/merging, which is explicitly out of scope.
// This test documents the boundary precisely rather than silently assuming
// it away.
describe("known limitation — rapid cross-pane alternation within one debounce window", () => {
  it("a rich-editor edit that lands before the source pane's debounce fires wins over the in-flight source edit", () => {
    const store = { tabs: [{ id: "tab-a", markdown: "# A" }] };

    // 1. User types "[B]" in the source pane: immediate store write, schedule debounce.
    store.tabs[0].markdown = "# A[B]";

    // 2. Before the debounce fires, user types "[C]" in the rich editor.
    //    onUpdate always serializes ITS OWN current doc — which never learned
    //    about "[B]" yet — so it overwrites the store, losing "[B]".
    const richEditorDocText = "# A[C]"; // rich editor never saw "[B]"
    store.tabs[0].markdown = richEditorDocText;

    // 3. The source pane's debounce fires and reads the freshest store value
    //    (the fix under test) — it correctly does NOT clobber "[C]" with the
    //    stale "[B]" capture, but "[B]" itself is already gone from the store.
    const activeTabIdRef = { current: "tab-a" as string | undefined };
    const atFireTime = simulateDebouncedSync(store, "tab-a", activeTabIdRef);

    expect(atFireTime).toBe("# A[C]"); // rich editor's later edit is preserved
    expect(atFireTime).not.toContain("[B]"); // the in-flight source edit is not
  });
});
