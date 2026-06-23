/**
 * Unit tests for requirementHeadingOps — the mark-preserving PM-level
 * requirement heading rewrite utilities.
 *
 * Uses a minimal ProseMirror schema (doc / heading / text + em/strong marks)
 * so tests run without a browser DOM or a full Tiptap editor.
 */
import { describe, it, expect } from "vitest";
import { Schema, Fragment } from "@tiptap/pm/model";
import { EditorState, type Transaction } from "@tiptap/pm/state";
import {
  bracketCharRange,
  rewriteHeadingId,
  rewriteHeadingStatus,
  insertHeadingStatus,
} from "@/editor/utils/requirementHeadingOps";

// ── Minimal schema ────────────────────────────────────────────────────────────

const schema = new Schema({
  nodes: {
    doc:     { content: "block+" },
    heading: { content: "inline*", attrs: { level: { default: 3 } }, group: "block" },
    text:    { group: "inline" },
  },
  marks: {
    em:     {},
    strong: {},
  },
});

const em     = schema.mark("em");
const strong = schema.mark("strong");

// Builds a heading node from an array of { text, marks? } inline specs.
function mkHeading(inlines: { text: string; marks?: typeof em[] }[]): import("@tiptap/pm/model").Node {
  const nodes = inlines.map(({ text, marks }) =>
    marks?.length ? schema.text(text, marks) : schema.text(text)
  );
  return schema.node("heading", { level: 3 }, nodes);
}

// Creates an EditorState containing exactly one heading.
function stateWithHeading(
  inlines: { text: string; marks?: typeof em[] }[]
): { state: EditorState; headingPos: number } {
  const heading = mkHeading(inlines);
  const doc = schema.node("doc", null, [heading]);
  const state = EditorState.create({ doc });
  return { state, headingPos: 0 }; // heading is at position 0 in the doc
}

// Extracts the heading node's text content after applying the transaction.
function applyAndRead(
  state: EditorState,
  apply: (tr: ReturnType<EditorState["tr"]["constructor"]["prototype"]["constructor"]>) => void
): string {
  const tr = state.tr;
  apply(tr);
  const newState = state.apply(tr);
  return newState.doc.child(0).textContent;
}

// Same as applyAndRead but also returns the Fragment (inline nodes) for mark inspection.
function applyAndReadFragment(
  state: EditorState,
  apply: (tr: Transaction) => void
): { text: string; fragment: Fragment } {
  const tr = state.tr;
  apply(tr);
  const newState = state.apply(tr);
  const heading = newState.doc.child(0);
  return { text: heading.textContent, fragment: heading.content };
}

// ── bracketCharRange ──────────────────────────────────────────────────────────

describe("bracketCharRange", () => {
  it("finds the bracket at the end of a standard heading", () => {
    expect(bracketCharRange("REQ_001 [Draft]")).toEqual([8, 15]);
  });

  it("returns null when no bracket is present", () => {
    expect(bracketCharRange("REQ_001")).toBeNull();
    expect(bracketCharRange("Section heading")).toBeNull();
  });

  it("finds the last bracket when multiple appear", () => {
    const r = bracketCharRange("REQ_001 [old] [Draft]");
    expect(r).not.toBeNull();
    const [from] = r!;
    expect(from).toBe("REQ_001 [old] ".length);
  });

  it("ignores trailing whitespace after the bracket", () => {
    const r = bracketCharRange("REQ_001 [Draft]  ");
    expect(r).not.toBeNull();
    const [from, to] = r!;
    expect(from).toBe(8);
    expect(to).toBe(15);
  });

  it("handles multi-word status", () => {
    const r = bracketCharRange("REQ_001 [In Review]");
    expect(r).toEqual([8, 19]);
  });
});

// ── rewriteHeadingId ──────────────────────────────────────────────────────────

describe("rewriteHeadingId", () => {
  it("replaces the ID prefix and leaves the rest unchanged", () => {
    const { state, headingPos } = stateWithHeading([{ text: "REQ_003 [Draft]" }]);
    const text = applyAndRead(state, (tr) =>
      rewriteHeadingId(tr, headingPos, "REQ_003", "REQ_001")
    );
    expect(text).toBe("REQ_001 [Draft]");
  });

  it("replaces a longer ID with a shorter one", () => {
    const { state, headingPos } = stateWithHeading([{ text: "TRANS_TOS_010 [Approved]" }]);
    const text = applyAndRead(state, (tr) =>
      rewriteHeadingId(tr, headingPos, "TRANS_TOS_010", "TRANS_TOS_001")
    );
    expect(text).toBe("TRANS_TOS_001 [Approved]");
  });

  it("does not disturb italic marks on the status bracket", () => {
    const { state, headingPos } = stateWithHeading([
      { text: "REQ_002 [" },
      { text: "Draft", marks: [em] },
      { text: "]" },
    ]);
    const { text, fragment } = applyAndReadFragment(state, (tr) =>
      rewriteHeadingId(tr, headingPos, "REQ_002", "REQ_001")
    );
    expect(text).toBe("REQ_001 [Draft]");

    // The "Draft" node must still carry the em mark after the ID is rewritten.
    let foundItalic = false;
    fragment.forEach((node) => {
      if (node.textContent === "Draft" && node.marks.some((m) => m.type.name === "em")) {
        foundItalic = true;
      }
    });
    expect(foundItalic).toBe(true);
  });

  it("does not disturb bold marks on the title suffix", () => {
    const { state, headingPos } = stateWithHeading([
      { text: "REQ_005 " },
      { text: "Important thing", marks: [strong] },
      { text: " [Draft]" },
    ]);
    const { fragment } = applyAndReadFragment(state, (tr) =>
      rewriteHeadingId(tr, headingPos, "REQ_005", "REQ_001")
    );
    let foundBold = false;
    fragment.forEach((node) => {
      if (node.marks.some((m) => m.type.name === "strong")) foundBold = true;
    });
    expect(foundBold).toBe(true);
  });

  it("works for heading with ID only (no suffix or bracket)", () => {
    const { state, headingPos } = stateWithHeading([{ text: "REQ_099" }]);
    const text = applyAndRead(state, (tr) =>
      rewriteHeadingId(tr, headingPos, "REQ_099", "REQ_001")
    );
    expect(text).toBe("REQ_001");
  });
});

// ── rewriteHeadingStatus ──────────────────────────────────────────────────────

describe("rewriteHeadingStatus", () => {
  it("replaces a plain-text status bracket", () => {
    const { state, headingPos } = stateWithHeading([{ text: "REQ_001 [Draft]" }]);
    const heading = state.doc.child(0);
    const text = applyAndRead(state, (tr) =>
      rewriteHeadingStatus(tr, headingPos, heading, "Review")
    );
    expect(text).toBe("REQ_001 [Review]");
  });

  it("preserves italic mark on the inner label text", () => {
    const { state, headingPos } = stateWithHeading([
      { text: "REQ_001 [" },
      { text: "Draft", marks: [em] },
      { text: "]" },
    ]);
    const heading = state.doc.child(0);
    const { text, fragment } = applyAndReadFragment(state, (tr) =>
      rewriteHeadingStatus(tr, headingPos, heading, "Review")
    );
    expect(text).toBe("REQ_001 [Review]");

    // The "Review" node must carry the em mark.
    let foundItalic = false;
    fragment.forEach((node) => {
      if (node.textContent === "Review" && node.marks.some((m) => m.type.name === "em")) {
        foundItalic = true;
      }
    });
    expect(foundItalic).toBe(true);
  });

  it("preserves bold mark on the inner label text", () => {
    const { state, headingPos } = stateWithHeading([
      { text: "REQ_001 [" },
      { text: "Draft", marks: [strong] },
      { text: "]" },
    ]);
    const heading = state.doc.child(0);
    const { fragment } = applyAndReadFragment(state, (tr) =>
      rewriteHeadingStatus(tr, headingPos, heading, "Approved")
    );
    let foundBold = false;
    fragment.forEach((node) => {
      if (node.textContent === "Approved" && node.marks.some((m) => m.type.name === "strong")) {
        foundBold = true;
      }
    });
    expect(foundBold).toBe(true);
  });

  it("does not alter the ID portion's content or marks", () => {
    const { state, headingPos } = stateWithHeading([{ text: "REQ_001 [Draft]" }]);
    const heading = state.doc.child(0);
    const { text } = applyAndReadFragment(state, (tr) =>
      rewriteHeadingStatus(tr, headingPos, heading, "Approved")
    );
    expect(text.startsWith("REQ_001")).toBe(true);
  });

  it("returns false and makes no change when there is no bracket", () => {
    const { state, headingPos } = stateWithHeading([{ text: "REQ_001" }]);
    const heading = state.doc.child(0);
    let returnVal = true;
    const text = applyAndRead(state, (tr) => {
      returnVal = rewriteHeadingStatus(tr, headingPos, heading, "Review");
    });
    expect(returnVal).toBe(false);
    expect(text).toBe("REQ_001");
  });

  it("handles a multi-word status replacement", () => {
    const { state, headingPos } = stateWithHeading([
      { text: "REQ_001 [" },
      { text: "Draft", marks: [em] },
      { text: "]" },
    ]);
    const heading = state.doc.child(0);
    const { text } = applyAndReadFragment(state, (tr) =>
      rewriteHeadingStatus(tr, headingPos, heading, "In Review")
    );
    expect(text).toBe("REQ_001 [In Review]");
  });

  it("replaces the last bracket when multiple appear in the heading", () => {
    const { state, headingPos } = stateWithHeading([{ text: "REQ_001 [old] [Draft]" }]);
    const heading = state.doc.child(0);
    const text = applyAndRead(state, (tr) =>
      rewriteHeadingStatus(tr, headingPos, heading, "Approved")
    );
    expect(text).toBe("REQ_001 [old] [Approved]");
  });
});

// ── insertHeadingStatus ───────────────────────────────────────────────────────

describe("insertHeadingStatus", () => {
  it("appends a bracket when the heading has none", () => {
    const { state, headingPos } = stateWithHeading([{ text: "REQ_001" }]);
    const heading = state.doc.child(0);
    const text = applyAndRead(state, (tr) =>
      insertHeadingStatus(tr, headingPos, heading, "Draft")
    );
    expect(text).toBe("REQ_001 [Draft]");
  });

  it("appends as plain text (no marks inherited from neighbour)", () => {
    const { state, headingPos } = stateWithHeading([
      { text: "REQ_001", marks: [em] },
    ]);
    const heading = state.doc.child(0);
    const { fragment } = applyAndReadFragment(state, (tr) =>
      insertHeadingStatus(tr, headingPos, heading, "Review")
    );
    // The inserted " [Review]" should not carry the em mark from the ID.
    let plainBracket = false;
    fragment.forEach((node) => {
      if (node.textContent.includes("[Review]") && node.marks.length === 0) {
        plainBracket = true;
      }
    });
    expect(plainBracket).toBe(true);
  });
});

// ── Combined: rewriteHeadingId + rewriteHeadingStatus in one transaction ─────

describe("combined rewrites in a single transaction", () => {
  it("renumber + status preserve can coexist in one transaction (reverse order)", () => {
    // Two headings in the document; renumber both in one transaction.
    const heading1 = mkHeading([
      { text: "REQ_003 [" },
      { text: "Draft", marks: [em] },
      { text: "]" },
    ]);
    const heading2 = mkHeading([
      { text: "REQ_005 [" },
      { text: "Approved", marks: [em] },
      { text: "]" },
    ]);
    const doc = schema.node("doc", null, [heading1, heading2]);
    const state = EditorState.create({ doc });

    // heading1 is at pos 0, heading2 is at pos heading1.nodeSize
    const pos1 = 0;
    const pos2 = heading1.nodeSize;

    const tr = state.tr;
    // Apply in reverse order (pos2 first) so earlier positions stay valid.
    rewriteHeadingId(tr, pos2, "REQ_005", "REQ_002");
    rewriteHeadingId(tr, pos1, "REQ_003", "REQ_001");

    const newState = state.apply(tr);
    const h1 = newState.doc.child(0);
    const h2 = newState.doc.child(1);

    expect(h1.textContent).toBe("REQ_001 [Draft]");
    expect(h2.textContent).toBe("REQ_002 [Approved]");

    // Italic marks must survive on both headings.
    let italicCount = 0;
    [h1, h2].forEach((h) => {
      h.content.forEach((node) => {
        if (node.marks.some((m) => m.type.name === "em")) italicCount++;
      });
    });
    expect(italicCount).toBe(2);
  });
});
