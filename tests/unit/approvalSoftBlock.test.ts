/**
 * Tests for the approval soft-block logic.
 *
 * The PM plugin checks this condition before dispatching an "Approved"
 * status change: if open comments exist, a confirmation dialog is shown.
 * These tests verify the predicate, not the dialog DOM itself.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { useReviewCommentsStore } from "@/stores/reviewCommentsStore";
import type { ReviewComment } from "@/types/reviewComment";

function resetStore() {
  useReviewCommentsStore.setState({ comments: {}, isDirty: false, loaded: false });
}

/** Mirror of the soft-block predicate used in requirementStatusPlugin. */
function shouldSoftBlock(reqId: string): { block: boolean; openCount: number } {
  const stored = useReviewCommentsStore.getState().getComments(reqId) as ReviewComment[];
  const openCount = stored.filter((c) => c.status === "open").length;
  return { block: openCount > 0, openCount };
}

describe("approval soft-block predicate", () => {
  beforeEach(resetStore);

  it("does not block when no comments exist", () => {
    expect(shouldSoftBlock("REQ_001").block).toBe(false);
  });

  it("does not block when all comments are closed", () => {
    const { id } = useReviewCommentsStore.getState().addComment("REQ_001", "Alice", "Issue");
    useReviewCommentsStore.getState().closeComment("REQ_001", id, "Alice");
    expect(shouldSoftBlock("REQ_001").block).toBe(false);
  });

  it("does not block when all comments are responded (none open)", () => {
    const { id } = useReviewCommentsStore.getState().addComment("REQ_001", "Alice", "Issue");
    useReviewCommentsStore.getState().respondToComment("REQ_001", id, "Fixed", "Bob");
    expect(shouldSoftBlock("REQ_001").block).toBe(false);
  });

  it("blocks when one open comment exists", () => {
    useReviewCommentsStore.getState().addComment("REQ_001", "Alice", "Open issue");
    const { block, openCount } = shouldSoftBlock("REQ_001");
    expect(block).toBe(true);
    expect(openCount).toBe(1);
  });

  it("blocks when multiple open comments exist and reports the correct count", () => {
    useReviewCommentsStore.getState().addComment("REQ_001", "Alice", "Issue A");
    useReviewCommentsStore.getState().addComment("REQ_001", "Bob", "Issue B");
    useReviewCommentsStore.getState().addComment("REQ_001", "Charlie", "Issue C");
    const { block, openCount } = shouldSoftBlock("REQ_001");
    expect(block).toBe(true);
    expect(openCount).toBe(3);
  });

  it("counts only open comments, ignoring responded and closed", () => {
    const { id: id1 } = useReviewCommentsStore.getState().addComment("REQ_001", "Alice", "Open");
    const { id: id2 } = useReviewCommentsStore.getState().addComment("REQ_001", "Bob", "Responded");
    const { id: id3 } = useReviewCommentsStore.getState().addComment("REQ_001", "Charlie", "Closed");
    useReviewCommentsStore.getState().respondToComment("REQ_001", id2, "Fixed", "Bob");
    useReviewCommentsStore.getState().closeComment("REQ_001", id3, "Alice");
    void id1; // id1 remains open
    const { block, openCount } = shouldSoftBlock("REQ_001");
    expect(block).toBe(true);
    expect(openCount).toBe(1);
  });

  it("blocks does not bleed across requirement IDs", () => {
    useReviewCommentsStore.getState().addComment("REQ_001", "Alice", "Open issue on 001");
    expect(shouldSoftBlock("REQ_002").block).toBe(false);
    expect(shouldSoftBlock("REQ_001").block).toBe(true);
  });

  it("reopened comment counts as open (blocks approval)", () => {
    const { id } = useReviewCommentsStore.getState().addComment("REQ_001", "Alice", "Issue");
    useReviewCommentsStore.getState().closeComment("REQ_001", id, "Alice");
    expect(shouldSoftBlock("REQ_001").block).toBe(false);
    useReviewCommentsStore.getState().reopenComment("REQ_001", id);
    expect(shouldSoftBlock("REQ_001").block).toBe(true);
  });
});
