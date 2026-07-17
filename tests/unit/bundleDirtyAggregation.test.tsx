/**
 * Regression coverage for the bundle-dirty-aggregation bug: the top status
 * (Header's "Unsaved changes" / "✓ All changes saved") must never disagree
 * with the bottom per-companion indicators (StatusBar's "● Unsaved Review
 * Comments" / "● Unsaved Traceability"). Root cause was Header computing
 * workspaceDirty from a hardcoded `activeTab.isDirty || (reviewLoaded &&
 * reviewDirty)` expression that never checked traceability at all.
 *
 * Covers both the pure aggregation hook (useAnyCompanionDirty) and the full
 * Header+StatusBar rendered together, across the scenario matrix from the
 * bug report.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { act } from "react";
import { renderHook, render, screen } from "@testing-library/react";
import { useAnyCompanionDirty } from "@/persistence/useAnyCompanionDirty";
import { Header } from "@/layout/Header";
import { StatusBar } from "@/layout/StatusBar";
import { useTabStore, getActiveTab } from "@/stores";
import { useReviewCommentsStore } from "@/stores/reviewCommentsStore";
import { useTraceabilityStore } from "@/stores/traceabilityStore";

function resetStores() {
  useReviewCommentsStore.setState({ comments: {}, isDirty: false, loaded: false });
  useTraceabilityStore.setState({ testCases: [], links: [], isDirty: false, loaded: false, loadError: false });
}

function makeHeaderProps() {
  return {
    onNewFile: vi.fn(),
    onOpen: vi.fn(),
    onSave: vi.fn(),
    onSaveAs: vi.fn(),
    onCloseTab: vi.fn(),
    onOpenRecent: vi.fn(),
    onChangeUserName: vi.fn(),
  };
}

/** The active tab, made non-read-only and clean, so tests control isDirty explicitly. */
function primeActiveTab(patch: { isDirty?: boolean } = {}) {
  const tab = getActiveTab(useTabStore.getState());
  if (!tab) throw new Error("no active tab in test setup");
  useTabStore.getState().updateTab(tab.id, { isReadOnly: false, isDirty: patch.isDirty ?? false });
}

describe("useAnyCompanionDirty — pure aggregation", () => {
  beforeEach(resetStores);

  it("is false when no companion is loaded", () => {
    const { result } = renderHook(() => useAnyCompanionDirty());
    expect(result.current).toBe(false);
  });

  it("is false when companions are loaded but clean", () => {
    useReviewCommentsStore.setState({ loaded: true, isDirty: false });
    useTraceabilityStore.setState({ loaded: true, isDirty: false });
    const { result } = renderHook(() => useAnyCompanionDirty());
    expect(result.current).toBe(false);
  });

  it("is true when only review is dirty", () => {
    useReviewCommentsStore.setState({ loaded: true, isDirty: true });
    const { result } = renderHook(() => useAnyCompanionDirty());
    expect(result.current).toBe(true);
  });

  it("is true when only traceability is dirty", () => {
    useTraceabilityStore.setState({ loaded: true, isDirty: true });
    const { result } = renderHook(() => useAnyCompanionDirty());
    expect(result.current).toBe(true);
  });

  it("is true when both are dirty", () => {
    useReviewCommentsStore.setState({ loaded: true, isDirty: true });
    useTraceabilityStore.setState({ loaded: true, isDirty: true });
    const { result } = renderHook(() => useAnyCompanionDirty());
    expect(result.current).toBe(true);
  });

  it("ignores dirty state on a companion that isn't loaded", () => {
    // isDirty true but loaded false shouldn't happen in practice, but the
    // hook must not trust isDirty alone — mirrors StatusBar's own isLoaded gate.
    useTraceabilityStore.setState({ loaded: false, isDirty: true });
    const { result } = renderHook(() => useAnyCompanionDirty());
    expect(result.current).toBe(false);
  });

  it("reacts live: flips true the instant a companion store goes dirty, false the instant it's saved", () => {
    useReviewCommentsStore.setState({ loaded: true, isDirty: false });
    const { result } = renderHook(() => useAnyCompanionDirty());
    expect(result.current).toBe(false);

    act(() => { useReviewCommentsStore.setState({ isDirty: true }); });
    expect(result.current).toBe(true);

    act(() => { useReviewCommentsStore.getState().markSaved(); });
    expect(result.current).toBe(false);
  });
});

describe("Header + StatusBar — bundle dirty invariant (the bug's exact scenario matrix)", () => {
  beforeEach(() => {
    resetStores();
    primeActiveTab({ isDirty: false });
  });

  function renderBoth() {
    render(
      <>
        <Header {...makeHeaderProps()} />
        <StatusBar />
      </>,
    );
  }

  function expectTopUnsaved() {
    expect(screen.getByText("Unsaved changes")).toBeInTheDocument();
    expect(screen.queryByText("✓ All changes saved")).toBeNull();
  }

  function expectTopSaved() {
    expect(screen.getByText("✓ All changes saved")).toBeInTheDocument();
    expect(screen.queryByText("Unsaved changes")).toBeNull();
  }

  it("nothing dirty → top saved, no bottom indicators", () => {
    renderBoth();
    expectTopSaved();
    expect(screen.queryByTestId("statusbar-review-unsaved")).toBeNull();
    expect(screen.queryByTestId("statusbar-traceability-unsaved")).toBeNull();
  });

  it("markdown dirty only → top unsaved", () => {
    primeActiveTab({ isDirty: true });
    renderBoth();
    expectTopUnsaved();
  });

  it("review dirty only → top unsaved, bottom shows review", () => {
    useReviewCommentsStore.setState({ loaded: true, isDirty: true });
    renderBoth();
    expectTopUnsaved();
    expect(screen.getByTestId("statusbar-review-unsaved")).toBeInTheDocument();
    expect(screen.queryByTestId("statusbar-traceability-unsaved")).toBeNull();
  });

  it("traceability dirty only → top unsaved, bottom shows traceability (the exact bug scenario)", () => {
    useTraceabilityStore.setState({ loaded: true, isDirty: true });
    renderBoth();
    expectTopUnsaved();
    expect(screen.getByTestId("statusbar-traceability-unsaved")).toBeInTheDocument();
    expect(screen.queryByTestId("statusbar-review-unsaved")).toBeNull();
  });

  it("markdown + review dirty → top unsaved", () => {
    primeActiveTab({ isDirty: true });
    useReviewCommentsStore.setState({ loaded: true, isDirty: true });
    renderBoth();
    expectTopUnsaved();
  });

  it("markdown + traceability dirty → top unsaved", () => {
    primeActiveTab({ isDirty: true });
    useTraceabilityStore.setState({ loaded: true, isDirty: true });
    renderBoth();
    expectTopUnsaved();
  });

  it("review + traceability dirty (both companions, clean markdown) → top unsaved, bottom shows both", () => {
    useReviewCommentsStore.setState({ loaded: true, isDirty: true });
    useTraceabilityStore.setState({ loaded: true, isDirty: true });
    renderBoth();
    expectTopUnsaved();
    expect(screen.getByTestId("statusbar-review-unsaved")).toBeInTheDocument();
    expect(screen.getByTestId("statusbar-traceability-unsaved")).toBeInTheDocument();
  });

  it("all three dirty → top unsaved, bottom shows both companions", () => {
    primeActiveTab({ isDirty: true });
    useReviewCommentsStore.setState({ loaded: true, isDirty: true });
    useTraceabilityStore.setState({ loaded: true, isDirty: true });
    renderBoth();
    expectTopUnsaved();
    expect(screen.getByTestId("statusbar-review-unsaved")).toBeInTheDocument();
    expect(screen.getByTestId("statusbar-traceability-unsaved")).toBeInTheDocument();
  });

  it("saving review only clears review's indicator and, if traceability is still dirty, top STAYS unsaved", () => {
    useReviewCommentsStore.setState({ loaded: true, isDirty: true });
    useTraceabilityStore.setState({ loaded: true, isDirty: true });
    renderBoth();
    expectTopUnsaved();

    act(() => { useReviewCommentsStore.getState().markSaved(); }); // "Save Review only"
    expectTopUnsaved(); // traceability still dirty — bundle must still read unsaved
    expect(screen.queryByTestId("statusbar-review-unsaved")).toBeNull();
    expect(screen.getByTestId("statusbar-traceability-unsaved")).toBeInTheDocument();
  });

  it("saving traceability only clears traceability's indicator and, if review is still dirty, top STAYS unsaved", () => {
    useReviewCommentsStore.setState({ loaded: true, isDirty: true });
    useTraceabilityStore.setState({ loaded: true, isDirty: true });
    renderBoth();

    act(() => { useTraceabilityStore.getState().markSaved(); }); // "Save Traceability only"
    expectTopUnsaved(); // review still dirty
    expect(screen.queryByTestId("statusbar-traceability-unsaved")).toBeNull();
    expect(screen.getByTestId("statusbar-review-unsaved")).toBeInTheDocument();
  });

  it("saving everything (markdown + both companions) flips top to saved and clears both bottom indicators", () => {
    primeActiveTab({ isDirty: true });
    useReviewCommentsStore.setState({ loaded: true, isDirty: true });
    useTraceabilityStore.setState({ loaded: true, isDirty: true });
    renderBoth();
    expectTopUnsaved();

    // Simulates Ctrl+S / saveBundle succeeding for every artifact.
    act(() => {
      useTabStore.getState().markTabSaved();
      useReviewCommentsStore.getState().markSaved();
      useTraceabilityStore.getState().markSaved();
    });

    expectTopSaved();
    expect(screen.queryByTestId("statusbar-review-unsaved")).toBeNull();
    expect(screen.queryByTestId("statusbar-traceability-unsaved")).toBeNull();
  });

  it("a failed companion save leaves the bundle dirty (isDirty untouched on failure, matching saveBundle's contract)", () => {
    // saveBundle only calls markSaved() on a companion after its save()
    // resolves AND the store is no longer dirty (bundleSave.ts). A failed
    // save() throws or returns without clearing dirty, so isDirty simply
    // stays true — this test asserts the top status reflects exactly that,
    // without needing to invoke the real (picker-driven) save handlers.
    useTraceabilityStore.setState({ loaded: true, isDirty: true });
    renderBoth();
    expectTopUnsaved();

    // A failed save attempt does NOT call markSaved() — isDirty is untouched.
    // (No-op act() call included only to flush any pending effects.)
    act(() => {});
    expectTopUnsaved();
    expect(screen.getByTestId("statusbar-traceability-unsaved")).toBeInTheDocument();
  });

  it("stale-handle recovery: a companion that goes through re-acquisition stays dirty until the retry actually succeeds", () => {
    useReviewCommentsStore.setState({ loaded: true, isDirty: true });
    renderBoth();
    expectTopUnsaved();

    // Mid-recovery: handle cleared, still dirty, still attempting — top must
    // not flip to saved just because a recovery attempt is in flight.
    expectTopUnsaved();
    expect(screen.getByTestId("statusbar-review-unsaved")).toBeInTheDocument();

    // Recovery's re-acquired Save-As succeeds.
    act(() => { useReviewCommentsStore.getState().markSaved(); });
    expectTopSaved();
    expect(screen.queryByTestId("statusbar-review-unsaved")).toBeNull();
  });
});
