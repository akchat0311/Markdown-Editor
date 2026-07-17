/**
 * Tests for the per-companion save-state indicators in StatusBar — review
 * comments and traceability share one implementation (CompanionSaveIndicator)
 * so they're tested for parity: same states, same behavior, different data.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act } from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { StatusBar } from "@/layout/StatusBar";
import { useReviewCommentsStore } from "@/stores/reviewCommentsStore";
import { useTraceabilityStore } from "@/stores/traceabilityStore";

function resetStores() {
  useReviewCommentsStore.setState({ comments: {}, isDirty: false, loaded: false });
  useTraceabilityStore.setState({ testCases: [], links: [], isDirty: false, loaded: false, loadError: false });
}

describe("StatusBar — companion save indicators", () => {
  beforeEach(resetStores);

  it("shows neither indicator when nothing is loaded", () => {
    render(<StatusBar />);
    expect(screen.queryByTestId("statusbar-review-unsaved")).toBeNull();
    expect(screen.queryByTestId("statusbar-review-saved")).toBeNull();
    expect(screen.queryByTestId("statusbar-traceability-unsaved")).toBeNull();
    expect(screen.queryByTestId("statusbar-traceability-saved")).toBeNull();
  });

  describe("review", () => {
    it("shows the clean pill when loaded and not dirty", () => {
      useReviewCommentsStore.setState({ loaded: true, isDirty: false });
      render(<StatusBar />);
      expect(screen.getByTestId("statusbar-review-saved")).toHaveTextContent("Review Saved");
      expect(screen.queryByTestId("statusbar-review-unsaved")).toBeNull();
    });

    it("shows the dirty pill when loaded and dirty", () => {
      useReviewCommentsStore.setState({ loaded: true, isDirty: true });
      render(<StatusBar />);
      expect(screen.getByTestId("statusbar-review-unsaved")).toHaveTextContent("Unsaved Review Comments");
      expect(screen.queryByTestId("statusbar-review-saved")).toBeNull();
    });

    it("clicking the dirty pill calls onSaveReview", () => {
      useReviewCommentsStore.setState({ loaded: true, isDirty: true });
      const onSaveReview = vi.fn();
      render(<StatusBar onSaveReview={onSaveReview} />);
      fireEvent.click(screen.getByTestId("statusbar-review-unsaved"));
      expect(onSaveReview).toHaveBeenCalledOnce();
    });

    it("clicking the clean pill calls onSaveReviewAs", () => {
      useReviewCommentsStore.setState({ loaded: true, isDirty: false });
      const onSaveReviewAs = vi.fn();
      render(<StatusBar onSaveReviewAs={onSaveReviewAs} />);
      fireEvent.click(screen.getByTestId("statusbar-review-saved"));
      expect(onSaveReviewAs).toHaveBeenCalledOnce();
    });

    it("the indicator disappears (switches to the clean pill) immediately once isDirty flips", () => {
      useReviewCommentsStore.setState({ loaded: true, isDirty: true });
      render(<StatusBar />);
      expect(screen.getByTestId("statusbar-review-unsaved")).toBeInTheDocument();

      // Simulates what markSaved() does after a successful save.
      act(() => { useReviewCommentsStore.setState({ isDirty: false }); });
      expect(screen.queryByTestId("statusbar-review-unsaved")).toBeNull();
      expect(screen.getByTestId("statusbar-review-saved")).toBeInTheDocument();
    });
  });

  describe("traceability — parity with review", () => {
    it("shows the clean pill when loaded and not dirty", () => {
      useTraceabilityStore.setState({ loaded: true, isDirty: false });
      render(<StatusBar />);
      expect(screen.getByTestId("statusbar-traceability-saved")).toHaveTextContent("Traceability Saved");
      expect(screen.queryByTestId("statusbar-traceability-unsaved")).toBeNull();
    });

    it("shows the dirty pill when loaded and dirty, identical styling to review's", () => {
      useTraceabilityStore.setState({ loaded: true, isDirty: true });
      useReviewCommentsStore.setState({ loaded: true, isDirty: true });
      render(<StatusBar />);
      const traceabilityPill = screen.getByTestId("statusbar-traceability-unsaved");
      const reviewPill = screen.getByTestId("statusbar-review-unsaved");
      expect(traceabilityPill).toHaveTextContent("Unsaved Traceability");
      // Same shared component → same class list, only text differs.
      expect(traceabilityPill.className).toBe(reviewPill.className);
    });

    it("clicking the dirty pill calls onSaveTraceability only (not review, not the bundle)", () => {
      useTraceabilityStore.setState({ loaded: true, isDirty: true });
      useReviewCommentsStore.setState({ loaded: true, isDirty: true });
      const onSaveTraceability = vi.fn();
      const onSaveReview = vi.fn();
      render(<StatusBar onSaveTraceability={onSaveTraceability} onSaveReview={onSaveReview} />);
      fireEvent.click(screen.getByTestId("statusbar-traceability-unsaved"));
      expect(onSaveTraceability).toHaveBeenCalledOnce();
      expect(onSaveReview).not.toHaveBeenCalled();
    });

    it("clicking the clean pill calls onSaveTraceabilityAs", () => {
      useTraceabilityStore.setState({ loaded: true, isDirty: false });
      const onSaveTraceabilityAs = vi.fn();
      render(<StatusBar onSaveTraceabilityAs={onSaveTraceabilityAs} />);
      fireEvent.click(screen.getByTestId("statusbar-traceability-saved"));
      expect(onSaveTraceabilityAs).toHaveBeenCalledOnce();
    });

    it("the indicator disappears (switches to the clean pill) immediately once isDirty flips", () => {
      useTraceabilityStore.setState({ loaded: true, isDirty: true });
      render(<StatusBar />);
      expect(screen.getByTestId("statusbar-traceability-unsaved")).toBeInTheDocument();

      // Simulates what markSaved() does after a successful save.
      act(() => { useTraceabilityStore.setState({ isDirty: false }); });
      expect(screen.queryByTestId("statusbar-traceability-unsaved")).toBeNull();
      expect(screen.getByTestId("statusbar-traceability-saved")).toBeInTheDocument();
    });
  });

  it("both indicators coexist independently, in addition to the global document dirty pill", () => {
    useReviewCommentsStore.setState({ loaded: true, isDirty: true });
    useTraceabilityStore.setState({ loaded: true, isDirty: false });
    render(<StatusBar />);
    expect(screen.getByTestId("statusbar-review-unsaved")).toBeInTheDocument();
    expect(screen.getByTestId("statusbar-traceability-saved")).toBeInTheDocument();
    // Global bundle/document indicator (driven by tabStore, unrelated to either
    // companion store) still renders alongside — the default active tab is the
    // read-only Welcome sample, which renders the "Sample Document" badge.
    expect(screen.getByText("Sample Document")).toBeInTheDocument();
  });
});
