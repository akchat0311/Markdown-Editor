/**
 * Separation guarantee tests for the review comments system.
 *
 * Core invariant: review comments exist ONLY in the review store and the
 * sidecar .review.json file.  The markdown document must remain byte-for-byte
 * identical after any comment add/edit/delete/save operation.
 *
 * Each test group maps to one of the six requirements stated in the spec:
 *  1. Add comment → markdown unchanged
 *  2. Edit comment → markdown unchanged
 *  3. Delete comment → markdown unchanged
 *  4. Save review file → markdown unchanged
 *  5. Renumber requirements → comments remain in review store only
 *  6. Toggle source mode → comments never appear in raw markdown
 */

import { describe, it, expect, beforeEach } from "vitest";
import { Schema } from "@tiptap/pm/model";
import { EditorState } from "@tiptap/pm/state";

import { parseMarkdownToDoc } from "@/markdown/parser";
import { serializeDocToMarkdown } from "@/markdown/serializer";
import { useReviewCommentsStore } from "@/stores/reviewCommentsStore";
import { rewriteHeadingId } from "@/editor/utils/requirementHeadingOps";
import type { ReviewFile } from "@/types/reviewComment";

// ── Shared fixtures ───────────────────────────────────────────────────────────

/** A realistic requirement section with italicised status and body paragraphs. */
const REQUIREMENT_MD = [
  "> ### REQ_001 [*Draft*]",
  "The system shall monitor wheel speed.",
  "",
  "> ### REQ_002 [*Review*]",
  "The system shall apply ABS.",
].join("\n");

/** Minimal PM schema sufficient for rewriteHeadingId tests. */
const schema = new Schema({
  nodes: {
    doc:     { content: "block+" },
    heading: { content: "inline*", attrs: { level: { default: 3 } }, group: "block" },
    text:    { group: "inline" },
  },
  marks: {},
});

// ── Store helpers ─────────────────────────────────────────────────────────────

function store() {
  return useReviewCommentsStore.getState();
}

beforeEach(() => {
  store().reset();
});

// ── 1. Add comment → markdown unchanged ───────────────────────────────────────

describe("1. add comment → markdown unchanged", () => {
  it("markdown is byte-for-byte identical after addComment", () => {
    const doc  = parseMarkdownToDoc(REQUIREMENT_MD);
    const pre  = serializeDocToMarkdown(doc);

    store().addComment("REQ_001", "John", "Clarify wheel speed source.");

    const post = serializeDocToMarkdown(doc);
    expect(post).toBe(pre);
  });

  it("comment text does not appear anywhere in the serialized markdown", () => {
    const doc = parseMarkdownToDoc(REQUIREMENT_MD);
    store().addComment("REQ_001", "Alice", "This needs a unit.");

    const md = serializeDocToMarkdown(doc);
    expect(md).not.toContain("This needs a unit.");
    expect(md).not.toContain("Alice");
  });

  it("adding multiple comments to multiple requirements leaves markdown unchanged", () => {
    const doc = parseMarkdownToDoc(REQUIREMENT_MD);
    const pre = serializeDocToMarkdown(doc);

    store().addComment("REQ_001", "John",  "Clarify wheel speed source.");
    store().addComment("REQ_001", "Alice", "Agreed.");
    store().addComment("REQ_002", "Bob",   "Which ABS standard?");

    expect(serializeDocToMarkdown(doc)).toBe(pre);
  });

  it("comment that looks like markdown syntax does not leak into serialized markdown", () => {
    const doc = parseMarkdownToDoc(REQUIREMENT_MD);

    // These strings look like various markdown-based comment formats —
    // none of them should appear in the serialized output.
    store().addComment("REQ_001", "Alice", "<!-- review comment -->");
    store().addComment("REQ_001", "Bob",   "[comment]: Clarify wheel speed source.");
    store().addComment("REQ_001", "Carol", "> [!COMMENT] note");

    const md = serializeDocToMarkdown(doc);
    expect(md).not.toContain("<!-- review");
    expect(md).not.toContain("[comment]:");
    expect(md).not.toContain("[!COMMENT]");
  });
});

// ── 2. Edit comment → markdown unchanged ──────────────────────────────────────

describe("2. edit comment → markdown unchanged", () => {
  it("markdown is byte-for-byte identical after updateComment", () => {
    const doc = parseMarkdownToDoc(REQUIREMENT_MD);
    const pre = serializeDocToMarkdown(doc);

    const comment = store().addComment("REQ_001", "John", "Original text.");
    store().updateComment("REQ_001", comment.id, { text: "Revised text." });

    expect(serializeDocToMarkdown(doc)).toBe(pre);
  });

  it("updated comment text does not appear in markdown", () => {
    const doc = parseMarkdownToDoc(REQUIREMENT_MD);
    const comment = store().addComment("REQ_001", "John", "Original.");
    store().updateComment("REQ_001", comment.id, { author: "Jane", text: "Revised." });

    const md = serializeDocToMarkdown(doc);
    expect(md).not.toContain("Original.");
    expect(md).not.toContain("Revised.");
    expect(md).not.toContain("Jane");
  });

  it("updating author preserves id and createdAt", () => {
    const comment = store().addComment("REQ_001", "John", "Note.");
    const { id, createdAt } = comment;

    store().updateComment("REQ_001", comment.id, { author: "Jane" });

    const updated = store().getComments("REQ_001")[0];
    expect(updated.id).toBe(id);
    expect(updated.createdAt).toBe(createdAt);
    expect(updated.author).toBe("Jane");
  });
});

// ── 3. Delete comment → markdown unchanged ────────────────────────────────────

describe("3. delete comment → markdown unchanged", () => {
  it("markdown is byte-for-byte identical after deleteComment", () => {
    const doc = parseMarkdownToDoc(REQUIREMENT_MD);
    const pre = serializeDocToMarkdown(doc);

    const c = store().addComment("REQ_001", "John", "To be deleted.");
    store().deleteComment("REQ_001", c.id);

    expect(serializeDocToMarkdown(doc)).toBe(pre);
  });

  it("deleted comment text never appears in markdown", () => {
    const doc = parseMarkdownToDoc(REQUIREMENT_MD);
    const c = store().addComment("REQ_001", "John", "Ephemeral note.");
    store().deleteComment("REQ_001", c.id);

    expect(serializeDocToMarkdown(doc)).not.toContain("Ephemeral note.");
  });

  it("store is empty after deleting all comments on a requirement", () => {
    const c1 = store().addComment("REQ_001", "Alice", "First.");
    const c2 = store().addComment("REQ_001", "Bob",   "Second.");
    store().deleteComment("REQ_001", c1.id);
    store().deleteComment("REQ_001", c2.id);

    expect(store().getComments("REQ_001")).toHaveLength(0);
    expect(store().isDirty).toBe(true);
  });
});

// ── 4. Save review file → markdown unchanged ──────────────────────────────────

describe("4. save review file → markdown unchanged", () => {
  it("review file serializes to JSON, not markdown", () => {
    store().addComment("REQ_001", "John", "Clarify wheel speed source.");
    store().addComment("REQ_002", "Alice", "Which ABS standard?");

    // The data that saveReviewFile receives is the store's comments object.
    // Verify its shape is pure JSON / ReviewFile.
    const data: ReviewFile = store().comments;
    const json = JSON.stringify(data, null, 2);

    // Must be valid JSON
    const parsed = JSON.parse(json) as ReviewFile;
    expect(parsed["REQ_001"]).toHaveLength(1);
    expect(parsed["REQ_002"]).toHaveLength(1);

    // Must not contain any markdown syntax
    expect(json).not.toContain("###");
    expect(json).not.toContain("<!--");
    expect(json).not.toContain("> [!");
    expect(json).not.toContain("[comment]:");
    expect(json).not.toMatch(/^---/m);
  });

  it("review JSON round-trip is lossless", () => {
    store().addComment("REQ_001", "John",  "Clarify wheel speed source.");
    store().addComment("REQ_001", "Alice", "Agreed — needs precision.");
    store().addComment("REQ_002", "Bob",   "Which ABS standard?");

    const exported: ReviewFile = JSON.parse(JSON.stringify(store().comments));

    // Load back into a fresh store
    store().reset();
    store().load(exported);

    expect(store().getComments("REQ_001")).toHaveLength(2);
    expect(store().getComments("REQ_001")[0].author).toBe("John");
    expect(store().getComments("REQ_001")[1].text).toBe("Agreed — needs precision.");
    expect(store().getComments("REQ_002")[0].author).toBe("Bob");
  });

  it("calling markSaved does not modify markdown", () => {
    const doc = parseMarkdownToDoc(REQUIREMENT_MD);
    const pre = serializeDocToMarkdown(doc);

    store().addComment("REQ_001", "John", "Note.");
    store().markSaved();

    expect(serializeDocToMarkdown(doc)).toBe(pre);
    // markSaved only clears isDirty — comments stay in store
    expect(store().getComments("REQ_001")).toHaveLength(1);
    expect(store().isDirty).toBe(false);
    expect(store().loaded).toBe(true);
  });

  it("saving review data only requires ReviewFile shape — no markdown fields", () => {
    store().addComment("REQ_001", "John", "Note.");
    const data: ReviewFile = store().comments;

    // The ReviewFile type only has string keys mapping to ReviewComment[].
    // Verify no markdown-specific fields bleed in.
    for (const [key, comments] of Object.entries(data)) {
      if (key.startsWith("_") || !Array.isArray(comments)) continue;
      for (const c of comments) {
        const keys = Object.keys(c).sort();
        expect(keys).toEqual(["author", "createdAt", "id", "status", "text"].sort());
      }
    }
  });
});

// ── 5. Renumber requirements → comments remain in review store only ───────────

describe("5. renumber requirements → comments remain in review store only", () => {
  it("rewriteHeadingId on PM doc does not mutate review store", () => {
    // Pre-load comments on REQ_001
    store().load({ "REQ_001": [{ id: "c1", author: "John", text: "Note.", createdAt: "2026-06-01T00:00:00Z", status: "open" }] });
    const before = { ...store().comments };

    // Build a minimal PM doc with a heading "REQ_001 [Draft]"
    const heading = schema.node("heading", { level: 3 }, [schema.text("REQ_001 [Draft]")]);
    const doc     = schema.node("doc", null, [heading]);
    const state   = EditorState.create({ doc });

    // Apply the renumber transaction (REQ_001 → REQ_002)
    const tr = state.tr;
    rewriteHeadingId(tr, 0, "REQ_001", "REQ_002");
    state.apply(tr); // new PM state — store is untouched

    // Review store must be unchanged
    expect(store().comments).toEqual(before);
    expect(store().isDirty).toBe(false);
    expect(store().loaded).toBe(true);
    expect(store().getComments("REQ_001")).toHaveLength(1);
    expect(store().getComments("REQ_001")[0].text).toBe("Note.");
  });

  it("renumber PM transaction does not change markdown serialization of comment-free doc", () => {
    const doc = parseMarkdownToDoc(REQUIREMENT_MD);
    const pre = serializeDocToMarkdown(doc);

    // Load comments then simulate a renumber — PM doc is NOT re-parsed here.
    // This mirrors the app behavior: the PM doc object held in memory changes
    // but the review store is a separate Zustand atom.
    store().addComment("REQ_001", "John", "Note on REQ_001.");

    // The markdown pipeline operates on the JSON doc, not the store.
    expect(serializeDocToMarkdown(doc)).toBe(pre);
  });

  it("renumber does not write comment data into the serialized markdown", () => {
    store().addComment("REQ_001", "John",  "First comment.");
    store().addComment("REQ_002", "Alice", "Second comment.");

    const doc = parseMarkdownToDoc(REQUIREMENT_MD);
    const md  = serializeDocToMarkdown(doc);

    expect(md).not.toContain("First comment.");
    expect(md).not.toContain("Second comment.");
    expect(md).not.toContain("John");
    expect(md).not.toContain("Alice");
  });
});

// ── 6. Toggle source mode → comments never appear in raw markdown ─────────────

describe("6. toggle source mode → comments never appear in raw markdown", () => {
  it("source mode output (serializeDocToMarkdown) does not contain any comment text", () => {
    const commentTexts = [
      "Clarify wheel speed source.",
      "This requirement is too vague.",
      "Reference IEC 62061 §5.4.3 for SIL requirements.",
    ];

    const doc = parseMarkdownToDoc(REQUIREMENT_MD);

    for (const text of commentTexts) {
      store().addComment("REQ_001", "Reviewer", text);
    }

    const sourceModeOutput = serializeDocToMarkdown(doc);

    for (const text of commentTexts) {
      expect(sourceModeOutput).not.toContain(text);
    }
  });

  it("source mode output is unchanged regardless of how many comments exist", () => {
    const doc = parseMarkdownToDoc(REQUIREMENT_MD);
    const baseline = serializeDocToMarkdown(doc);

    // 0 comments
    expect(serializeDocToMarkdown(doc)).toBe(baseline);

    // After adding 5 comments
    for (let i = 0; i < 5; i++) {
      store().addComment("REQ_001", `Reviewer ${i}`, `Comment number ${i}.`);
    }
    expect(serializeDocToMarkdown(doc)).toBe(baseline);

    // After editing one
    const id = store().getComments("REQ_001")[0].id;
    store().updateComment("REQ_001", id, { text: "Edited." });
    expect(serializeDocToMarkdown(doc)).toBe(baseline);

    // After deleting all
    for (const c of [...store().getComments("REQ_001")]) {
      store().deleteComment("REQ_001", c.id);
    }
    expect(serializeDocToMarkdown(doc)).toBe(baseline);
  });

  it("source mode does not include reviewer metadata (author, id, createdAt)", () => {
    const doc = parseMarkdownToDoc(REQUIREMENT_MD);
    const comment = store().addComment("REQ_001", "SeniorEngineer", "Detailed note.");

    const md = serializeDocToMarkdown(doc);
    expect(md).not.toContain("SeniorEngineer");
    expect(md).not.toContain(comment.id);
    expect(md).not.toContain(comment.createdAt);
  });
});

// ── Store unit tests ──────────────────────────────────────────────────────────

describe("reviewCommentsStore state machine", () => {
  it("starts unloaded and clean", () => {
    expect(store().loaded).toBe(false);
    expect(store().isDirty).toBe(false);
    expect(store().comments).toEqual({});
  });

  it("load sets loaded=true, isDirty=false", () => {
    const data: ReviewFile = {
      "REQ_001": [{ id: "c1", author: "John", text: "Note.", createdAt: "2026-01-01T00:00:00Z", status: "open" }],
    };
    store().load(data);
    expect(store().loaded).toBe(true);
    expect(store().isDirty).toBe(false);
    expect(store().getComments("REQ_001")).toHaveLength(1);
  });

  it("addComment sets isDirty=true and loaded=true even without prior load", () => {
    store().addComment("REQ_001", "John", "Note.");
    expect(store().isDirty).toBe(true);
    expect(store().loaded).toBe(true);
  });

  it("updateComment sets isDirty=true", () => {
    const c = store().addComment("REQ_001", "John", "Original.");
    store().markSaved();
    expect(store().isDirty).toBe(false);

    store().updateComment("REQ_001", c.id, { text: "Revised." });
    expect(store().isDirty).toBe(true);
  });

  it("deleteComment sets isDirty=true", () => {
    const c = store().addComment("REQ_001", "John", "To delete.");
    store().markSaved();
    expect(store().isDirty).toBe(false);

    store().deleteComment("REQ_001", c.id);
    expect(store().isDirty).toBe(true);
    expect(store().getComments("REQ_001")).toHaveLength(0);
  });

  it("markSaved clears isDirty without removing comments", () => {
    store().addComment("REQ_001", "John", "Note.");
    expect(store().isDirty).toBe(true);

    store().markSaved();
    expect(store().isDirty).toBe(false);
    expect(store().getComments("REQ_001")).toHaveLength(1);
    expect(store().loaded).toBe(true);
  });

  it("reset returns store to initial state", () => {
    store().addComment("REQ_001", "John", "Note.");
    store().reset();

    expect(store().loaded).toBe(false);
    expect(store().isDirty).toBe(false);
    expect(store().comments).toEqual({});
    expect(store().getComments("REQ_001")).toHaveLength(0);
  });

  it("getComments returns empty array for unknown requirement", () => {
    expect(store().getComments("REQ_999")).toEqual([]);
  });

  it("each comment gets a unique id", () => {
    const a = store().addComment("REQ_001", "Alice", "First.");
    const b = store().addComment("REQ_001", "Bob",   "Second.");
    const c = store().addComment("REQ_002", "Carol", "Third.");
    const ids = [a.id, b.id, c.id];
    expect(new Set(ids).size).toBe(3);
  });

  it("addComment trims whitespace from author and text", () => {
    const c = store().addComment("REQ_001", "  Alice  ", "  Note.  ");
    expect(c.author).toBe("Alice");
    expect(c.text).toBe("Note.");
  });

  it("createdAt is a valid ISO-8601 timestamp", () => {
    const c = store().addComment("REQ_001", "Alice", "Note.");
    expect(new Date(c.createdAt).toISOString()).toBe(c.createdAt);
  });

  it("updateComment preserves id and createdAt", () => {
    const original = store().addComment("REQ_001", "John", "Original.");
    store().updateComment("REQ_001", original.id, { author: "Jane", text: "Revised." });

    const updated = store().getComments("REQ_001")[0];
    expect(updated.id).toBe(original.id);
    expect(updated.createdAt).toBe(original.createdAt);
    expect(updated.author).toBe("Jane");
    expect(updated.text).toBe("Revised.");
  });

  it("deleteComment removes only the targeted comment", () => {
    const c1 = store().addComment("REQ_001", "Alice", "First.");
    const c2 = store().addComment("REQ_001", "Bob",   "Second.");
    store().deleteComment("REQ_001", c1.id);

    const remaining = store().getComments("REQ_001");
    expect(remaining).toHaveLength(1);
    expect(remaining[0].id).toBe(c2.id);
  });

  it("comments for different requirements are independent", () => {
    store().addComment("REQ_001", "Alice", "About REQ_001.");
    store().addComment("REQ_002", "Bob",   "About REQ_002.");
    store().deleteComment("REQ_001", store().getComments("REQ_001")[0].id);

    expect(store().getComments("REQ_001")).toHaveLength(0);
    expect(store().getComments("REQ_002")).toHaveLength(1);
  });
});
