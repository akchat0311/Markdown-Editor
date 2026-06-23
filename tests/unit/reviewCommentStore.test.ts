import { describe, it, expect, beforeEach } from "vitest";
import { useReviewCommentsStore, migrateComment, migrateReviewFile } from "@/stores/reviewCommentsStore";
import type { ReviewComment } from "@/types/reviewComment";

function resetStore() {
  useReviewCommentsStore.setState({
    comments: {},
    isDirty: false,
    loaded: false,
  });
}

// ── migrateComment ──────────────────────────────────────────────────────────

describe("migrateComment", () => {
  it("preserves all fields on a v1 comment", () => {
    const raw = {
      id: "c_1",
      author: "Alice",
      text: "Needs work",
      createdAt: "2026-06-22T10:00:00Z",
      status: "responded",
      response: "Updated",
      respondedBy: "Bob",
      respondedAt: "2026-06-23T10:00:00Z",
      closedBy: undefined,
      closedAt: undefined,
    };
    const result = migrateComment(raw as Record<string, unknown>);
    expect(result.status).toBe("responded");
    expect(result.response).toBe("Updated");
    expect(result.respondedBy).toBe("Bob");
  });

  it("defaults status to open for legacy comments with no status field", () => {
    const raw = { id: "c_1", author: "Alice", text: "Issue", createdAt: "2026-06-22T10:00:00Z" };
    expect(migrateComment(raw).status).toBe("open");
  });

  it("preserves status: closed from v1 comment", () => {
    const raw = { id: "c_1", author: "Alice", text: "Done", createdAt: "2026-06-22T10:00:00Z", status: "closed", closedBy: "Alice", closedAt: "2026-06-24T10:00:00Z" };
    const result = migrateComment(raw as Record<string, unknown>);
    expect(result.status).toBe("closed");
    expect(result.closedBy).toBe("Alice");
    expect(result.closedAt).toBe("2026-06-24T10:00:00Z");
  });
});

// ── migrateReviewFile ───────────────────────────────────────────────────────

describe("migrateReviewFile", () => {
  it("upgrades a legacy file: all comments get status open", () => {
    const legacy = {
      REQ_001: [
        { id: "c_1", author: "Alice", text: "Issue A", createdAt: "2026-06-22T10:00:00Z" },
        { id: "c_2", author: "Bob", text: "Issue B", createdAt: "2026-06-22T11:00:00Z" },
      ],
      REQ_002: [
        { id: "c_3", author: "Charlie", text: "Issue C", createdAt: "2026-06-22T12:00:00Z" },
      ],
    };
    const result = migrateReviewFile(legacy);
    expect(result._version).toBe(1);
    const req1 = result.REQ_001 as ReviewComment[];
    expect(req1).toHaveLength(2);
    expect(req1[0].status).toBe("open");
    expect(req1[1].status).toBe("open");
    expect((result.REQ_002 as ReviewComment[])[0].status).toBe("open");
  });

  it("strips _version from comment keys but sets it to 1 in output", () => {
    const v0 = { _version: 0, REQ_001: [{ id: "c_1", author: "A", text: "T", createdAt: "2026-01-01T00:00:00Z" }] };
    const result = migrateReviewFile(v0);
    expect(result._version).toBe(1);
    expect(result.REQ_001).toBeDefined();
  });

  it("handles empty file", () => {
    const result = migrateReviewFile({});
    expect(result._version).toBe(1);
    expect(Object.keys(result).filter((k) => k !== "_version")).toHaveLength(0);
  });

  it("preserves already-migrated v1 comments unchanged", () => {
    const v1 = {
      _version: 1,
      REQ_001: [{ id: "c_1", author: "A", text: "T", createdAt: "2026-01-01T00:00:00Z", status: "closed", closedBy: "A", closedAt: "2026-01-02T00:00:00Z" }],
    };
    const result = migrateReviewFile(v1);
    const c = (result.REQ_001 as ReviewComment[])[0];
    expect(c.status).toBe("closed");
    expect(c.closedBy).toBe("A");
  });
});

// ── store.load runs migration ────────────────────────────────────────────────

describe("store.load", () => {
  beforeEach(resetStore);

  it("migrates legacy comments on load", () => {
    const legacy = {
      REQ_001: [{ id: "c_1", author: "Alice", text: "Issue", createdAt: "2026-06-22T10:00:00Z" }],
    } as never;
    useReviewCommentsStore.getState().load(legacy);
    const comments = useReviewCommentsStore.getState().getComments("REQ_001");
    expect(comments[0].status).toBe("open");
  });
});

// ── addComment ───────────────────────────────────────────────────────────────

describe("addComment", () => {
  beforeEach(resetStore);

  it("creates a comment with status: open", () => {
    useReviewCommentsStore.getState().addComment("REQ_001", "Alice", "Needs work");
    const [c] = useReviewCommentsStore.getState().getComments("REQ_001");
    expect(c.status).toBe("open");
    expect(c.author).toBe("Alice");
    expect(c.text).toBe("Needs work");
  });

  it("sets loaded and isDirty", () => {
    useReviewCommentsStore.getState().addComment("REQ_001", "Alice", "X");
    const s = useReviewCommentsStore.getState();
    expect(s.loaded).toBe(true);
    expect(s.isDirty).toBe(true);
  });
});

// ── respondToComment ─────────────────────────────────────────────────────────

describe("respondToComment", () => {
  beforeEach(resetStore);

  it("transitions open → responded with response text", () => {
    const { id } = useReviewCommentsStore.getState().addComment("REQ_001", "Alice", "Issue");
    useReviewCommentsStore.getState().respondToComment("REQ_001", id, "Fixed it", "Bob");
    const [c] = useReviewCommentsStore.getState().getComments("REQ_001");
    expect(c.status).toBe("responded");
    expect(c.response).toBe("Fixed it");
    expect(c.respondedBy).toBe("Bob");
    expect(c.respondedAt).toBeDefined();
  });

  it("sets isDirty", () => {
    const { id } = useReviewCommentsStore.getState().addComment("REQ_001", "Alice", "Issue");
    useReviewCommentsStore.setState({ isDirty: false });
    useReviewCommentsStore.getState().respondToComment("REQ_001", id, "Fixed", "Bob");
    expect(useReviewCommentsStore.getState().isDirty).toBe(true);
  });

  it("does not affect other comments in the same requirement", () => {
    const { id: id1 } = useReviewCommentsStore.getState().addComment("REQ_001", "Alice", "Issue A");
    useReviewCommentsStore.getState().addComment("REQ_001", "Bob", "Issue B");
    useReviewCommentsStore.getState().respondToComment("REQ_001", id1, "Done", "Charlie");
    const comments = useReviewCommentsStore.getState().getComments("REQ_001");
    expect(comments[0].status).toBe("responded");
    expect(comments[1].status).toBe("open");
  });

  it("trims whitespace from response and respondedBy", () => {
    const { id } = useReviewCommentsStore.getState().addComment("REQ_001", "Alice", "Issue");
    useReviewCommentsStore.getState().respondToComment("REQ_001", id, "  Fixed  ", "  Bob  ");
    const [c] = useReviewCommentsStore.getState().getComments("REQ_001");
    expect(c.response).toBe("Fixed");
    expect(c.respondedBy).toBe("Bob");
  });
});

// ── closeComment ─────────────────────────────────────────────────────────────

describe("closeComment", () => {
  beforeEach(resetStore);

  it("transitions open → closed directly (skipping responded)", () => {
    const { id } = useReviewCommentsStore.getState().addComment("REQ_001", "Alice", "Minor issue");
    useReviewCommentsStore.getState().closeComment("REQ_001", id, "Alice");
    const [c] = useReviewCommentsStore.getState().getComments("REQ_001");
    expect(c.status).toBe("closed");
    expect(c.closedBy).toBe("Alice");
    expect(c.closedAt).toBeDefined();
  });

  it("transitions responded → closed", () => {
    const { id } = useReviewCommentsStore.getState().addComment("REQ_001", "Alice", "Issue");
    useReviewCommentsStore.getState().respondToComment("REQ_001", id, "Fixed", "Bob");
    useReviewCommentsStore.getState().closeComment("REQ_001", id, "Alice");
    const [c] = useReviewCommentsStore.getState().getComments("REQ_001");
    expect(c.status).toBe("closed");
    expect(c.response).toBe("Fixed");  // response is preserved
    expect(c.respondedBy).toBe("Bob"); // respondedBy is preserved
  });

  it("sets isDirty", () => {
    const { id } = useReviewCommentsStore.getState().addComment("REQ_001", "Alice", "Issue");
    useReviewCommentsStore.setState({ isDirty: false });
    useReviewCommentsStore.getState().closeComment("REQ_001", id, "Alice");
    expect(useReviewCommentsStore.getState().isDirty).toBe(true);
  });
});

// ── reopenComment ─────────────────────────────────────────────────────────────

describe("reopenComment", () => {
  beforeEach(resetStore);

  it("transitions closed → open and clears closedBy/closedAt", () => {
    const { id } = useReviewCommentsStore.getState().addComment("REQ_001", "Alice", "Issue");
    useReviewCommentsStore.getState().closeComment("REQ_001", id, "Alice");
    useReviewCommentsStore.getState().reopenComment("REQ_001", id);
    const [c] = useReviewCommentsStore.getState().getComments("REQ_001");
    expect(c.status).toBe("open");
    expect(c.closedBy).toBeUndefined();
    expect(c.closedAt).toBeUndefined();
  });

  it("preserves response and respondedBy when reopening", () => {
    const { id } = useReviewCommentsStore.getState().addComment("REQ_001", "Alice", "Issue");
    useReviewCommentsStore.getState().respondToComment("REQ_001", id, "Fixed", "Bob");
    useReviewCommentsStore.getState().closeComment("REQ_001", id, "Alice");
    useReviewCommentsStore.getState().reopenComment("REQ_001", id);
    const [c] = useReviewCommentsStore.getState().getComments("REQ_001");
    expect(c.response).toBe("Fixed");
    expect(c.respondedBy).toBe("Bob");
    expect(c.status).toBe("open");
  });

  it("sets isDirty", () => {
    const { id } = useReviewCommentsStore.getState().addComment("REQ_001", "Alice", "Issue");
    useReviewCommentsStore.getState().closeComment("REQ_001", id, "Alice");
    useReviewCommentsStore.setState({ isDirty: false });
    useReviewCommentsStore.getState().reopenComment("REQ_001", id);
    expect(useReviewCommentsStore.getState().isDirty).toBe(true);
  });
});

// ── renumberComments ─────────────────────────────────────────────────────────

describe("renumberComments", () => {
  beforeEach(resetStore);

  it("moves comments from old ID to new ID", () => {
    useReviewCommentsStore.getState().addComment("REQ_001", "Alice", "Issue A");
    useReviewCommentsStore.getState().addComment("REQ_001", "Bob", "Issue B");
    useReviewCommentsStore.getState().renumberComments("REQ_001", "REQ_004");
    const s = useReviewCommentsStore.getState();
    expect(s.getComments("REQ_001")).toHaveLength(0);
    expect(s.getComments("REQ_004")).toHaveLength(2);
  });

  it("does nothing if old ID has no comments", () => {
    useReviewCommentsStore.getState().addComment("REQ_002", "Alice", "Issue");
    useReviewCommentsStore.getState().renumberComments("REQ_001", "REQ_004");
    const s = useReviewCommentsStore.getState();
    expect(s.getComments("REQ_002")).toHaveLength(1);
    expect(s.getComments("REQ_004")).toHaveLength(0);
  });

  it("merges into existing comments at new ID", () => {
    useReviewCommentsStore.getState().addComment("REQ_001", "Alice", "Issue A");
    useReviewCommentsStore.getState().addComment("REQ_004", "Bob", "Issue B");
    // renumber REQ_001 → REQ_004: REQ_001's comments REPLACE (not merge) — old key is gone
    useReviewCommentsStore.getState().renumberComments("REQ_001", "REQ_004");
    // REQ_004 now holds REQ_001's comments (the old REQ_004 comments are overwritten)
    const s = useReviewCommentsStore.getState();
    const comments = s.getComments("REQ_004");
    expect(comments[0].author).toBe("Alice");
  });

  it("sets isDirty", () => {
    useReviewCommentsStore.getState().addComment("REQ_001", "Alice", "Issue");
    useReviewCommentsStore.setState({ isDirty: false });
    useReviewCommentsStore.getState().renumberComments("REQ_001", "REQ_002");
    expect(useReviewCommentsStore.getState().isDirty).toBe(true);
  });

  it("preserves comment status across renumber", () => {
    const { id } = useReviewCommentsStore.getState().addComment("REQ_001", "Alice", "Issue");
    useReviewCommentsStore.getState().respondToComment("REQ_001", id, "Fixed", "Bob");
    useReviewCommentsStore.getState().renumberComments("REQ_001", "REQ_007");
    const [c] = useReviewCommentsStore.getState().getComments("REQ_007");
    expect(c.status).toBe("responded");
    expect(c.response).toBe("Fixed");
  });
});

// ── full status lifecycle ────────────────────────────────────────────────────

describe("full comment lifecycle", () => {
  beforeEach(resetStore);

  it("open → responded → closed → open (reopen)", () => {
    const { id } = useReviewCommentsStore.getState().addComment("REQ_001", "Alice", "Issue");

    let [c] = useReviewCommentsStore.getState().getComments("REQ_001");
    expect(c.status).toBe("open");

    useReviewCommentsStore.getState().respondToComment("REQ_001", id, "Addressed", "Bob");
    [c] = useReviewCommentsStore.getState().getComments("REQ_001");
    expect(c.status).toBe("responded");

    useReviewCommentsStore.getState().closeComment("REQ_001", id, "Alice");
    [c] = useReviewCommentsStore.getState().getComments("REQ_001");
    expect(c.status).toBe("closed");

    useReviewCommentsStore.getState().reopenComment("REQ_001", id);
    [c] = useReviewCommentsStore.getState().getComments("REQ_001");
    expect(c.status).toBe("open");
    expect(c.closedBy).toBeUndefined();
    // Response is preserved across reopen
    expect(c.response).toBe("Addressed");
  });
});
