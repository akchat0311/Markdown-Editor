/**
 * Tests for duplicate requirement ID prevention.
 *
 * - detectRenames() (pure): covers detection logic without a browser
 * - migrateReviewTarget() (store): covers comment-preservation guarantees
 *
 * Full end-to-end revert (dispatch in view.update) requires a DOM and is
 * exercised by manual/integration testing.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { detectRenames } from "@/editor/plugins/requirementIdMigrationPlugin";
import { useReviewCommentsStore } from "@/stores/reviewCommentsStore";
import type { ReviewComment } from "@/types/reviewComment";

function resetStore() {
  useReviewCommentsStore.setState({ comments: {}, isDirty: false, loaded: false });
}

// ── detectRenames — safe rename ───────────────────────────────────────────────

describe("detectRenames — safe rename (unique target)", () => {
  it("detects a single safe rename", () => {
    const prev = new Map([[0, "REQ_005"], [100, "REQ_006"]]);
    const next = new Map([[0, "REQ_007"], [100, "REQ_006"]]);

    const renames = detectRenames(prev, next, (p) => p);

    expect(renames).toHaveLength(1);
    const [r] = renames;
    expect(r.oldId).toBe("REQ_005");
    expect(r.newId).toBe("REQ_007");
    expect(r.isDuplicate).toBe(false);
    expect(r.pos).toBe(0);
  });

  it("returns no renames when no IDs changed", () => {
    const prev = new Map([[0, "REQ_005"], [100, "REQ_006"]]);
    const next = new Map([[0, "REQ_005"], [100, "REQ_006"]]);

    expect(detectRenames(prev, next, (p) => p)).toHaveLength(0);
  });

  it("handles position shift from mapPos (simulates earlier insertion)", () => {
    // Heading originally at 0, shifted to 10 by an earlier insertion in the transaction
    const prev = new Map([[0, "REQ_005"]]);
    const next = new Map([[10, "REQ_007"]]);

    const renames = detectRenames(prev, next, (_) => 10);

    expect(renames).toHaveLength(1);
    expect(renames[0].isDuplicate).toBe(false);
    expect(renames[0].pos).toBe(10);
  });

  it("ignores headings that disappear from newState (deletion)", () => {
    const prev = new Map([[0, "REQ_005"], [100, "REQ_006"]]);
    // REQ_005's position (0) doesn't appear in next — heading was deleted
    const next = new Map([[100, "REQ_006"]]);

    const renames = detectRenames(prev, next, (p) => p);
    // No rename for the deleted heading (newId is undefined at mapped pos)
    expect(renames).toHaveLength(0);
  });

  it("detects multiple independent safe renames in one transaction", () => {
    const prev = new Map([[0, "REQ_001"], [100, "REQ_002"], [200, "REQ_003"]]);
    const next = new Map([[0, "REQ_004"], [100, "REQ_005"], [200, "REQ_006"]]);

    const renames = detectRenames(prev, next, (p) => p);

    expect(renames).toHaveLength(3);
    expect(renames.every((r) => !r.isDuplicate)).toBe(true);
  });
});

// ── detectRenames — duplicate rename ─────────────────────────────────────────

describe("detectRenames — duplicate rename (collision)", () => {
  it("flags a rename that collides with an existing requirement ID", () => {
    // REQ_005 is renamed to REQ_006, but REQ_006 already exists at pos 100
    const prev = new Map([[0, "REQ_005"], [100, "REQ_006"]]);
    const next = new Map([[0, "REQ_006"], [100, "REQ_006"]]);

    const renames = detectRenames(prev, next, (p) => p);

    expect(renames).toHaveLength(1);
    expect(renames[0].oldId).toBe("REQ_005");
    expect(renames[0].newId).toBe("REQ_006");
    expect(renames[0].isDuplicate).toBe(true);
  });

  it("flags when two headings are both renamed to the same new ID", () => {
    // Both REQ_001 and REQ_002 renamed to REQ_003 in one paste operation
    const prev = new Map([[0, "REQ_001"], [100, "REQ_002"], [200, "REQ_003"]]);
    const next = new Map([[0, "REQ_003"], [100, "REQ_003"], [200, "REQ_003"]]);

    const renames = detectRenames(prev, next, (p) => p);

    // Both renamed headings should be flagged as duplicates
    expect(renames).toHaveLength(2);
    expect(renames.every((r) => r.isDuplicate)).toBe(true);
    expect(renames.every((r) => r.newId === "REQ_003")).toBe(true);
  });

  it("mixes safe and duplicate renames in a single transaction", () => {
    // REQ_001 → REQ_005 (safe), REQ_002 → REQ_004 (duplicate of existing)
    const prev = new Map([[0, "REQ_001"], [100, "REQ_002"], [200, "REQ_004"]]);
    const next = new Map([[0, "REQ_005"], [100, "REQ_004"], [200, "REQ_004"]]);

    const renames = detectRenames(prev, next, (p) => p);

    const safe = renames.filter((r) => !r.isDuplicate);
    const dupes = renames.filter((r) => r.isDuplicate);
    expect(safe).toHaveLength(1);
    expect(safe[0].oldId).toBe("REQ_001");
    expect(dupes).toHaveLength(1);
    expect(dupes[0].oldId).toBe("REQ_002");
  });

  it("a heading renamed back to its own ID is not a rename", () => {
    // No-op: both positions have the same ID as before
    const prev = new Map([[0, "REQ_006"]]);
    const next = new Map([[0, "REQ_006"]]);

    expect(detectRenames(prev, next, (p) => p)).toHaveLength(0);
  });
});

// ── Comment preservation on duplicate attempt ─────────────────────────────────
//
// These tests verify the store behaviour that backs the plugin's contract:
// when a duplicate is detected, migrateReviewTarget is NOT called, so
// comments remain exactly where they were.

describe("comment preservation when duplicate rename is rejected", () => {
  beforeEach(resetStore);

  it("comments on both IDs remain intact when the rename is rejected", () => {
    useReviewCommentsStore.getState().addComment("REQ_005", "Alice", "Comment A");
    useReviewCommentsStore.getState().addComment("REQ_006", "Bob", "Comment B");

    // Simulate the plugin NOT calling migrateReviewTarget because isDuplicate = true
    // (We verify the store correctly rejects it if mistakenly called as "conflict")
    const result = useReviewCommentsStore.getState().migrateReviewTarget("REQ_005", "REQ_006");

    expect(result).toBe("conflict");
    const s = useReviewCommentsStore.getState();
    expect((s.getComments("REQ_005") as ReviewComment[])[0].author).toBe("Alice");
    expect((s.getComments("REQ_006") as ReviewComment[])[0].author).toBe("Bob");
  });

  it("multiple comments are all preserved under original IDs", () => {
    useReviewCommentsStore.getState().addComment("REQ_005", "Alice", "A1");
    useReviewCommentsStore.getState().addComment("REQ_005", "Alice", "A2");
    useReviewCommentsStore.getState().addComment("REQ_005", "Alice", "A3");
    useReviewCommentsStore.getState().addComment("REQ_006", "Bob", "B1");

    useReviewCommentsStore.getState().migrateReviewTarget("REQ_005", "REQ_006");

    expect(useReviewCommentsStore.getState().getComments("REQ_005")).toHaveLength(3);
    expect(useReviewCommentsStore.getState().getComments("REQ_006")).toHaveLength(1);
  });

  it("isDirty is not set when a conflict (duplicate) is rejected", () => {
    useReviewCommentsStore.getState().addComment("REQ_005", "Alice", "A");
    useReviewCommentsStore.getState().addComment("REQ_006", "Bob", "B");
    useReviewCommentsStore.setState({ isDirty: false });

    useReviewCommentsStore.getState().migrateReviewTarget("REQ_005", "REQ_006");

    expect(useReviewCommentsStore.getState().isDirty).toBe(false);
  });

  it("safe rename still succeeds after a rejected duplicate attempt", () => {
    useReviewCommentsStore.getState().addComment("REQ_005", "Alice", "A");
    useReviewCommentsStore.getState().addComment("REQ_006", "Bob", "B");

    // Duplicate attempt — rejected
    useReviewCommentsStore.getState().migrateReviewTarget("REQ_005", "REQ_006");

    // Subsequent safe rename works correctly
    const result = useReviewCommentsStore.getState().migrateReviewTarget("REQ_005", "REQ_007");
    expect(result).toBe("migrated");
    expect(useReviewCommentsStore.getState().getComments("REQ_007")).toHaveLength(1);
    expect(useReviewCommentsStore.getState().getComments("REQ_005")).toHaveLength(0);
    expect(useReviewCommentsStore.getState().getComments("REQ_006")).toHaveLength(1); // untouched
  });
});

// ── Bulk renumber still works (regression) ────────────────────────────────────

describe("renumberComments — bulk renumber is unaffected", () => {
  beforeEach(resetStore);

  it("renumberComments still moves all comments unconditionally", () => {
    useReviewCommentsStore.getState().addComment("REQ_001", "Alice", "Issue");
    useReviewCommentsStore.getState().renumberComments("REQ_001", "REQ_003");

    const s = useReviewCommentsStore.getState();
    expect(s.getComments("REQ_001")).toHaveLength(0);
    expect(s.getComments("REQ_003")).toHaveLength(1);
  });

  it("detectRenames marks a clean renumber as isDuplicate:false", () => {
    // After renumber: REQ_001 → REQ_002 (new unique ID, no collision)
    const prev = new Map([[0, "REQ_001"]]);
    const next = new Map([[0, "REQ_002"]]);

    const [r] = detectRenames(prev, next, (p) => p);
    expect(r.isDuplicate).toBe(false);
  });
});

// ── Duplicate-ID reassignment workflow (regression) ───────────────────────────

describe("duplicate-ID reassignment is unaffected", () => {
  beforeEach(resetStore);

  it("detectRenames treats reassignment to a fresh ID as safe (non-duplicate)", () => {
    // Duplicate: two headings at pos 0 and pos 100 both have REQ_001
    // Reassign the second occurrence to REQ_003 (a fresh ID)
    const prev = new Map([[0, "REQ_001"], [100, "REQ_001"]]);
    const next = new Map([[0, "REQ_001"], [100, "REQ_003"]]);

    const renames = detectRenames(prev, next, (p) => p);

    expect(renames).toHaveLength(1);
    expect(renames[0].oldId).toBe("REQ_001");
    expect(renames[0].newId).toBe("REQ_003");
    expect(renames[0].isDuplicate).toBe(false);
  });
});

// ── Edge cases ────────────────────────────────────────────────────────────────

describe("detectRenames — edge cases", () => {
  it("returns empty when prevIds is empty (fresh document)", () => {
    const prev = new Map<number, string>();
    const next = new Map([[0, "REQ_001"]]);
    expect(detectRenames(prev, next, (p) => p)).toHaveLength(0);
  });

  it("returns empty when both maps are empty", () => {
    const empty = new Map<number, string>();
    expect(detectRenames(empty, empty, (p) => p)).toHaveLength(0);
  });

  it("handles a heading whose mapped position no longer exists in newIds", () => {
    // prevIds has pos 0; after position shift, mapPos returns 50 which is not in newIds
    const prev = new Map([[0, "REQ_001"]]);
    const next = new Map([[200, "REQ_001"]]); // heading is at a completely different spot
    // mapPos maps 0 → 50, but 50 is not in next
    const renames = detectRenames(prev, next, (_) => 50);
    expect(renames).toHaveLength(0);
  });
});
