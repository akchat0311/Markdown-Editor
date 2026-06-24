/**
 * Tests for section-level review target support.
 *
 * Covers:
 *   - Pure helpers in sectionReviewOps.ts
 *   - migrateReviewTarget() with section IDs (store)
 *   - detectRenames() with section IDs (pure)
 *   - Export row generation with section metadata
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  extractSectionNumber,
  sectionReviewId,
  sectionNumberFromReviewId,
  isSectionReviewTarget,
  isRequirementReviewTarget,
  getReviewTargetType,
} from "@/editor/utils/sectionReviewOps";
import { detectRenames } from "@/editor/plugins/requirementIdMigrationPlugin";
import { useReviewCommentsStore } from "@/stores/reviewCommentsStore";
import { collectReviewExportRows } from "@/services/reviewExportService";
import type { OutlineNode } from "@/types/outline";

function resetStore() {
  useReviewCommentsStore.setState({ comments: {}, isDirty: false, loaded: false });
}

// ── extractSectionNumber ──────────────────────────────────────────────────────

describe("extractSectionNumber", () => {
  it("extracts a simple top-level section number", () => {
    expect(extractSectionNumber("1 Feature Overview")).toBe("1");
  });

  it("extracts a dotted section number", () => {
    expect(extractSectionNumber("2.1 CAN Interface")).toBe("2.1");
  });

  it("extracts a deeply nested section number", () => {
    expect(extractSectionNumber("2.1.1 Message Format")).toBe("2.1.1");
  });

  it("extracts a four-level section number", () => {
    expect(extractSectionNumber("1.2.3.4 Sub-sub-subsection")).toBe("1.2.3.4");
  });

  it("returns null when heading has no leading number", () => {
    expect(extractSectionNumber("CAN Interface")).toBeNull();
  });

  it("returns null for requirement-style headings (no leading digit)", () => {
    expect(extractSectionNumber("REQ_005 Authentication [Draft]")).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(extractSectionNumber("")).toBeNull();
  });

  it("returns null when number is not followed by whitespace", () => {
    // "123abc" has a leading digit but no separating space
    expect(extractSectionNumber("123abc")).toBeNull();
  });
});

// ── sectionReviewId ───────────────────────────────────────────────────────────

describe("sectionReviewId / sectionNumberFromReviewId", () => {
  it("formats a section ID with the section: prefix", () => {
    expect(sectionReviewId("2.1")).toBe("section:2.1");
  });

  it("round-trips through sectionNumberFromReviewId", () => {
    expect(sectionNumberFromReviewId(sectionReviewId("2.1.1"))).toBe("2.1.1");
  });

  it("sectionNumberFromReviewId returns null for requirement IDs", () => {
    expect(sectionNumberFromReviewId("REQ_005")).toBeNull();
  });
});

// ── Type predicates ───────────────────────────────────────────────────────────

describe("isSectionReviewTarget / isRequirementReviewTarget / getReviewTargetType", () => {
  it("recognises section targets", () => {
    expect(isSectionReviewTarget("section:2.1")).toBe(true);
    expect(isSectionReviewTarget("REQ_005")).toBe(false);
  });

  it("recognises requirement targets", () => {
    expect(isRequirementReviewTarget("REQ_005")).toBe(true);
    expect(isRequirementReviewTarget("section:2.1")).toBe(false);
  });

  it("getReviewTargetType returns correct type", () => {
    expect(getReviewTargetType("section:2.1")).toBe("section");
    expect(getReviewTargetType("REQ_005")).toBe("requirement");
    expect(getReviewTargetType("TRANS_001")).toBe("requirement");
  });
});

// ── migrateReviewTarget — section IDs ────────────────────────────────────────

describe("migrateReviewTarget — section IDs", () => {
  beforeEach(resetStore);

  it("safe rename: moves comments from section:2.1 to section:2.2", () => {
    useReviewCommentsStore.getState().addComment("section:2.1", "Alice", "Needs clarification");

    const result = useReviewCommentsStore.getState().migrateReviewTarget("section:2.1", "section:2.2");

    expect(result).toBe("migrated");
    expect(useReviewCommentsStore.getState().getComments("section:2.1")).toHaveLength(0);
    expect(useReviewCommentsStore.getState().getComments("section:2.2")).toHaveLength(1);
  });

  it("conflict: blocked when target already has comments", () => {
    useReviewCommentsStore.getState().addComment("section:2.1", "Alice", "A");
    useReviewCommentsStore.getState().addComment("section:2.2", "Bob", "B");

    const result = useReviewCommentsStore.getState().migrateReviewTarget("section:2.1", "section:2.2");

    expect(result).toBe("conflict");
    expect(useReviewCommentsStore.getState().getComments("section:2.1")).toHaveLength(1);
    expect(useReviewCommentsStore.getState().getComments("section:2.2")).toHaveLength(1);
  });

  it("noop: returns noop when section has no comments", () => {
    const result = useReviewCommentsStore.getState().migrateReviewTarget("section:2.1", "section:2.2");
    expect(result).toBe("noop");
  });

  it("section and requirement IDs coexist independently in the store", () => {
    useReviewCommentsStore.getState().addComment("REQ_005", "Alice", "Req comment");
    useReviewCommentsStore.getState().addComment("section:2.1", "Bob", "Section comment");

    useReviewCommentsStore.getState().migrateReviewTarget("section:2.1", "section:2.2");

    // Requirement unaffected
    expect(useReviewCommentsStore.getState().getComments("REQ_005")).toHaveLength(1);
    // Section moved
    expect(useReviewCommentsStore.getState().getComments("section:2.1")).toHaveLength(0);
    expect(useReviewCommentsStore.getState().getComments("section:2.2")).toHaveLength(1);
  });

  it("multiple comments all migrate together", () => {
    useReviewCommentsStore.getState().addComment("section:3.1", "Alice", "A");
    useReviewCommentsStore.getState().addComment("section:3.1", "Bob", "B");
    useReviewCommentsStore.getState().addComment("section:3.1", "Charlie", "C");

    useReviewCommentsStore.getState().migrateReviewTarget("section:3.1", "section:3.2");

    expect(useReviewCommentsStore.getState().getComments("section:3.2")).toHaveLength(3);
    expect(useReviewCommentsStore.getState().getComments("section:3.1")).toHaveLength(0);
  });
});

// ── detectRenames — section IDs ───────────────────────────────────────────────

describe("detectRenames — section IDs", () => {
  it("detects a section number rename", () => {
    const prev = new Map([[0, "section:2.1"], [100, "section:3.0"]]);
    const next = new Map([[0, "section:2.2"], [100, "section:3.0"]]);

    const renames = detectRenames(prev, next, (p) => p);

    expect(renames).toHaveLength(1);
    expect(renames[0].oldId).toBe("section:2.1");
    expect(renames[0].newId).toBe("section:2.2");
    expect(renames[0].isDuplicate).toBe(false);
  });

  it("flags a duplicate section number", () => {
    // section:2.1 is renamed to section:2.2, but section:2.2 already exists
    const prev = new Map([[0, "section:2.1"], [100, "section:2.2"]]);
    const next = new Map([[0, "section:2.2"], [100, "section:2.2"]]);

    const renames = detectRenames(prev, next, (p) => p);

    expect(renames).toHaveLength(1);
    expect(renames[0].isDuplicate).toBe(true);
    expect(renames[0].oldId).toBe("section:2.1");
    expect(renames[0].newId).toBe("section:2.2");
  });

  it("handles mixed section and requirement renames in one batch", () => {
    const prev = new Map([
      [0, "REQ_005"],
      [100, "section:2.1"],
    ]);
    const next = new Map([
      [0, "REQ_007"],          // safe requirement rename
      [100, "section:2.2"],    // safe section rename
    ]);

    const renames = detectRenames(prev, next, (p) => p);

    expect(renames).toHaveLength(2);
    expect(renames.every((r) => !r.isDuplicate)).toBe(true);
    const reqRename = renames.find((r) => r.oldId === "REQ_005")!;
    const secRename = renames.find((r) => r.oldId === "section:2.1")!;
    expect(reqRename.newId).toBe("REQ_007");
    expect(secRename.newId).toBe("section:2.2");
  });

  it("requirement and section renames are independent (no cross-namespace collision)", () => {
    // A requirement rename to "REQ_001" should not conflict with a section rename to "section:1"
    const prev = new Map([[0, "REQ_002"], [100, "section:1.0"]]);
    const next = new Map([[0, "REQ_001"], [100, "section:1"]]);

    const renames = detectRenames(prev, next, (p) => p);

    expect(renames).toHaveLength(2);
    expect(renames.every((r) => !r.isDuplicate)).toBe(true);
  });
});

// ── Export rows — section metadata ────────────────────────────────────────────

describe("collectReviewExportRows — section targets", () => {
  beforeEach(resetStore);

  function makeOutlineNode(label: string, index: number): OutlineNode {
    return {
      key: `heading:${index * 10}`,
      type: "heading",
      level: 2,
      label,
      pmPos: index * 10,
      index,
      children: [],
    };
  }

  it("exports section comments with section heading text as requirementText", () => {
    const { id } = useReviewCommentsStore.getState().addComment("section:2.1", "Alice", "Issue A");
    const comments = useReviewCommentsStore.getState().comments;

    const flat = [makeOutlineNode("2.1 CAN Interface", 0)];

    const rows = collectReviewExportRows(flat, [], "doc.md", null, [], comments);

    expect(rows).toHaveLength(1);
    expect(rows[0].requirementId).toBe("section:2.1");
    expect(rows[0].requirementText).toBe("2.1 CAN Interface");
    expect(rows[0].requirementStatus).toBe("");
    expect(rows[0].commentId).toBe(id);
    expect(rows[0].author).toBe("Alice");
  });

  it("exports multiple section comments each as separate rows", () => {
    useReviewCommentsStore.getState().addComment("section:1.1", "Alice", "A");
    useReviewCommentsStore.getState().addComment("section:1.1", "Bob", "B");
    const comments = useReviewCommentsStore.getState().comments;

    const flat = [makeOutlineNode("1.1 Owner", 0)];

    const rows = collectReviewExportRows(flat, [], "doc.md", null, [], comments);

    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.requirementId === "section:1.1")).toBe(true);
    expect(rows.every((r) => r.requirementText === "1.1 Owner")).toBe(true);
  });

  it("exports requirement and section comments in the same call", () => {
    useReviewCommentsStore.getState().addComment("REQ_005", "Alice", "Req issue");
    useReviewCommentsStore.getState().addComment("section:2.1", "Bob", "Section issue");
    const comments = useReviewCommentsStore.getState().comments;

    const flat = [
      makeOutlineNode("2.1 CAN Interface", 1),
    ];

    // No patternExample → requirement metadata not populated, but rows still appear
    const rows = collectReviewExportRows(flat, [], "doc.md", null, [], comments);

    expect(rows).toHaveLength(2);
    const secRow = rows.find((r) => r.requirementId === "section:2.1")!;
    expect(secRow).toBeDefined();
    expect(secRow.requirementText).toBe("2.1 CAN Interface");

    const reqRow = rows.find((r) => r.requirementId === "REQ_005")!;
    expect(reqRow).toBeDefined();
    expect(reqRow.requirementText).toBe(""); // no outline match → empty
  });

  it("exports section:2.1 with empty requirementText when section is not in outline", () => {
    useReviewCommentsStore.getState().addComment("section:9.9", "Alice", "Orphaned");
    const comments = useReviewCommentsStore.getState().comments;

    const rows = collectReviewExportRows([], [], "doc.md", null, [], comments);

    expect(rows).toHaveLength(1);
    expect(rows[0].requirementId).toBe("section:9.9");
    expect(rows[0].requirementText).toBe(""); // section removed from outline
  });

  it("first occurrence wins when duplicate section numbers appear in outline", () => {
    useReviewCommentsStore.getState().addComment("section:2.1", "Alice", "Comment");
    const comments = useReviewCommentsStore.getState().comments;

    const flat = [
      makeOutlineNode("2.1 First Occurrence", 0),
      makeOutlineNode("2.1 Second Occurrence", 1),
    ];

    const rows = collectReviewExportRows(flat, [], "doc.md", null, [], comments);

    expect(rows).toHaveLength(1);
    expect(rows[0].requirementText).toBe("2.1 First Occurrence");
  });
});

// ── Requirement behavior unchanged (regression) ───────────────────────────────

describe("requirement behavior is unaffected by section support", () => {
  beforeEach(resetStore);

  it("detectRenames still finds requirement renames when no sections present", () => {
    const prev = new Map([[0, "REQ_005"]]);
    const next = new Map([[0, "REQ_007"]]);

    const [r] = detectRenames(prev, next, (p) => p);
    expect(r.oldId).toBe("REQ_005");
    expect(r.newId).toBe("REQ_007");
    expect(r.isDuplicate).toBe(false);
  });

  it("requirement IDs are never confused with section IDs", () => {
    expect(isSectionReviewTarget("REQ_001")).toBe(false);
    expect(isRequirementReviewTarget("REQ_001")).toBe(true);
    expect(isRequirementReviewTarget("section:1.1")).toBe(false);
  });

  it("migrateReviewTarget works for requirements alongside sections", () => {
    useReviewCommentsStore.getState().addComment("REQ_005", "Alice", "A");
    useReviewCommentsStore.getState().addComment("section:1.1", "Bob", "B");

    useReviewCommentsStore.getState().migrateReviewTarget("REQ_005", "REQ_007");

    expect(useReviewCommentsStore.getState().getComments("REQ_007")).toHaveLength(1);
    expect(useReviewCommentsStore.getState().getComments("REQ_005")).toHaveLength(0);
    // Section unaffected
    expect(useReviewCommentsStore.getState().getComments("section:1.1")).toHaveLength(1);
  });
});
