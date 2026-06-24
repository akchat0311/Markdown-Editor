import { describe, it, expect, beforeEach } from "vitest";
import { useReviewCommentsStore, migrateReviewFile } from "@/stores/reviewCommentsStore";
import type { ReviewComment } from "@/types/reviewComment";

function resetStore() {
  useReviewCommentsStore.setState({ comments: {}, isDirty: false, loaded: false });
}

// ── migrateReviewTarget ───────────────────────────────────────────────────────

describe("migrateReviewTarget — safe rename", () => {
  beforeEach(resetStore);

  it("moves all comments from oldId to newId when newId is empty", () => {
    useReviewCommentsStore.getState().addComment("REQ_005", "Alice", "Issue A");
    useReviewCommentsStore.getState().addComment("REQ_005", "Bob", "Issue B");

    const result = useReviewCommentsStore.getState().migrateReviewTarget("REQ_005", "REQ_007");

    expect(result).toBe("migrated");
    const s = useReviewCommentsStore.getState();
    expect(s.getComments("REQ_005")).toHaveLength(0);
    expect(s.getComments("REQ_007")).toHaveLength(2);
  });

  it("preserves comment content across migration", () => {
    const { id } = useReviewCommentsStore.getState().addComment("REQ_005", "Alice", "Needs clarification");
    useReviewCommentsStore.getState().respondToComment("REQ_005", id, "Clarified in §3", "Bob");

    useReviewCommentsStore.getState().migrateReviewTarget("REQ_005", "REQ_007");

    const [c] = useReviewCommentsStore.getState().getComments("REQ_007") as ReviewComment[];
    expect(c.text).toBe("Needs clarification");
    expect(c.status).toBe("responded");
    expect(c.response).toBe("Clarified in §3");
    expect(c.respondedBy).toBe("Bob");
  });

  it("migrates multiple comments all at once", () => {
    useReviewCommentsStore.getState().addComment("REQ_005", "Alice", "A");
    useReviewCommentsStore.getState().addComment("REQ_005", "Bob", "B");
    useReviewCommentsStore.getState().addComment("REQ_005", "Charlie", "C");

    useReviewCommentsStore.getState().migrateReviewTarget("REQ_005", "REQ_007");

    expect(useReviewCommentsStore.getState().getComments("REQ_007")).toHaveLength(3);
    expect(useReviewCommentsStore.getState().getComments("REQ_005")).toHaveLength(0);
  });

  it("sets isDirty after migration", () => {
    useReviewCommentsStore.getState().addComment("REQ_005", "Alice", "Issue");
    useReviewCommentsStore.setState({ isDirty: false });

    useReviewCommentsStore.getState().migrateReviewTarget("REQ_005", "REQ_007");

    expect(useReviewCommentsStore.getState().isDirty).toBe(true);
  });

  it("does not touch other requirements during migration", () => {
    useReviewCommentsStore.getState().addComment("REQ_005", "Alice", "Issue");
    useReviewCommentsStore.getState().addComment("REQ_003", "Bob", "Other issue");

    useReviewCommentsStore.getState().migrateReviewTarget("REQ_005", "REQ_007");

    expect(useReviewCommentsStore.getState().getComments("REQ_003")).toHaveLength(1);
  });
});

// ── migrateReviewTarget — conflict ────────────────────────────────────────────

describe("migrateReviewTarget — conflict", () => {
  beforeEach(resetStore);

  it("returns conflict and does NOT migrate when newId already has comments", () => {
    useReviewCommentsStore.getState().addComment("REQ_005", "Alice", "A");
    useReviewCommentsStore.getState().addComment("REQ_006", "Bob", "B");

    const result = useReviewCommentsStore.getState().migrateReviewTarget("REQ_005", "REQ_006");

    expect(result).toBe("conflict");
    // Comments must be preserved under their original IDs
    expect(useReviewCommentsStore.getState().getComments("REQ_005")).toHaveLength(1);
    expect(useReviewCommentsStore.getState().getComments("REQ_006")).toHaveLength(1);
    expect((useReviewCommentsStore.getState().getComments("REQ_005") as ReviewComment[])[0].author).toBe("Alice");
    expect((useReviewCommentsStore.getState().getComments("REQ_006") as ReviewComment[])[0].author).toBe("Bob");
  });

  it("does not set isDirty on conflict", () => {
    useReviewCommentsStore.getState().addComment("REQ_005", "Alice", "A");
    useReviewCommentsStore.getState().addComment("REQ_006", "Bob", "B");
    useReviewCommentsStore.setState({ isDirty: false });

    useReviewCommentsStore.getState().migrateReviewTarget("REQ_005", "REQ_006");

    expect(useReviewCommentsStore.getState().isDirty).toBe(false);
  });

  it("conflict is symmetric — both orderings are blocked", () => {
    useReviewCommentsStore.getState().addComment("REQ_005", "Alice", "A");
    useReviewCommentsStore.getState().addComment("REQ_006", "Bob", "B");

    expect(useReviewCommentsStore.getState().migrateReviewTarget("REQ_005", "REQ_006")).toBe("conflict");
    expect(useReviewCommentsStore.getState().migrateReviewTarget("REQ_006", "REQ_005")).toBe("conflict");
  });
});

// ── migrateReviewTarget — noop ────────────────────────────────────────────────

describe("migrateReviewTarget — noop", () => {
  beforeEach(resetStore);

  it("returns noop when oldId has no comments", () => {
    useReviewCommentsStore.getState().addComment("REQ_003", "Alice", "Unrelated");

    const result = useReviewCommentsStore.getState().migrateReviewTarget("REQ_005", "REQ_007");

    expect(result).toBe("noop");
    expect(useReviewCommentsStore.getState().getComments("REQ_007")).toHaveLength(0);
  });

  it("returns noop for a document with no comments at all", () => {
    const result = useReviewCommentsStore.getState().migrateReviewTarget("REQ_001", "REQ_002");
    expect(result).toBe("noop");
  });

  it("returns noop when oldId exists in store but has an empty array", () => {
    // Simulate a key that was created but all comments deleted
    useReviewCommentsStore.setState({
      comments: { _version: 1, REQ_005: [] },
      isDirty: false,
      loaded: true,
    });

    const result = useReviewCommentsStore.getState().migrateReviewTarget("REQ_005", "REQ_007");
    expect(result).toBe("noop");
  });
});

// ── Review file persistence — save/load round-trip ───────────────────────────

describe("save/load compatibility after migration", () => {
  beforeEach(resetStore);

  it("persisted review file remains valid after migration", () => {
    useReviewCommentsStore.getState().addComment("REQ_005", "Alice", "Issue");
    useReviewCommentsStore.getState().migrateReviewTarget("REQ_005", "REQ_007");

    const snapshot = useReviewCommentsStore.getState().comments;

    const reloaded = migrateReviewFile(snapshot);

    expect(reloaded.REQ_007).toBeDefined();
    expect((reloaded.REQ_007 as ReviewComment[])[0].author).toBe("Alice");
    expect(reloaded.REQ_005).toBeUndefined();
  });

  it("loading a pre-migration review file and migrating produces a loadable file", () => {
    // Simulate loading an old file that still has REQ_005
    const oldFile = {
      _version: 1,
      REQ_005: [{ id: "c_1", author: "Alice", text: "Issue", createdAt: "2026-01-01T00:00:00Z", status: "open" }],
    };
    useReviewCommentsStore.getState().load(oldFile as never);

    useReviewCommentsStore.getState().migrateReviewTarget("REQ_005", "REQ_007");

    const snapshot = useReviewCommentsStore.getState().comments;
    expect(snapshot.REQ_007).toBeDefined();
    expect(snapshot.REQ_005).toBeUndefined();
    expect((snapshot.REQ_007 as ReviewComment[])[0].status).toBe("open");
  });
});
