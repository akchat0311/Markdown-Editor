/**
 * Requirement-ID migration for traceability links (Phase 5).
 *
 * Three levels:
 * 1. Store — remapRequirementIds atomicity: chain-safety over overlapping
 *    old/new ID spaces, union-merge semantics, no-op cleanliness.
 * 2. Service — migrateRequirementIdTargets fan-out: one atomic trace remap +
 *    per-target review migration with preserved conflict semantics.
 * 3. Pipeline — a real editor with the RequirementIdMigration extension:
 *    renaming a heading migrates links with no manual store calls.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Editor } from "@tiptap/core";
import Document from "@tiptap/extension-document";
import Paragraph from "@tiptap/extension-paragraph";
import Text from "@tiptap/extension-text";
import Heading from "@tiptap/extension-heading";
import { RequirementIdMigration } from "@/editor/extensions/RequirementIdMigration";
import { useTraceabilityStore } from "@/stores/traceabilityStore";
import { useReviewCommentsStore } from "@/stores/reviewCommentsStore";
import { useConfigStore } from "@/stores/configStore";
import { migrateRequirementIdTargets } from "@/services/requirementIdMigration";
import { rewriteHeadingId } from "@/editor/utils/requirementHeadingOps";
import { computeRenumberReplacements, nextAvailableId } from "@/editor/utils/requirementOps";
import type { RequirementEntry } from "@/editor/utils/requirementOps";
import type { OutlineNode } from "@/types/outline";

const TCS = [
  { id: "TC_001", title: "T1" },
  { id: "TC_002", title: "T2" },
  { id: "TC_003", title: "T3" },
];

function resetStores() {
  useTraceabilityStore.setState({
    testCases: [],
    links: [],
    coverage: {},
    isDirty: false,
    loaded: false,
    loadError: false,
  });
  useReviewCommentsStore.setState({ comments: {}, isDirty: false, loaded: false });
  useConfigStore.setState({ requirementPattern: { mode: "simple", example: "REQ_001" } });
}

function loadLinks(links: { tc: string; req: string }[]) {
  useTraceabilityStore.getState().load({ version: 1, testCases: TCS, links });
}

function linkSet() {
  return useTraceabilityStore.getState().links.map((l) => `${l.tc}→${l.req}`).sort();
}

// ── 1. Store: remapRequirementIds ─────────────────────────────────────────────

describe("remapRequirementIds — atomic batch semantics", () => {
  beforeEach(resetStores);

  it("applies a simple rename to every affected link in one update", () => {
    loadLinks([
      { tc: "TC_001", req: "REQ_005" },
      { tc: "TC_002", req: "REQ_005" },
      { tc: "TC_003", req: "REQ_009" },
    ]);
    useTraceabilityStore.getState().remapRequirementIds([{ oldId: "REQ_005", newId: "REQ_007" }]);
    expect(linkSet()).toEqual(["TC_001→REQ_007", "TC_002→REQ_007", "TC_003→REQ_009"]);
    expect(useTraceabilityStore.getState().isDirty).toBe(true);
  });

  it("is chain-safe: overlapping renumber mappings never cascade", () => {
    // Renumber: REQ_003→REQ_001 while REQ_001→REQ_002 and REQ_002→REQ_003.
    // Sequential per-ID renames would chain (REQ_003's links would end at
    // REQ_003 again after passing through REQ_001 and REQ_002).
    loadLinks([
      { tc: "TC_001", req: "REQ_001" },
      { tc: "TC_002", req: "REQ_002" },
      { tc: "TC_003", req: "REQ_003" },
    ]);
    useTraceabilityStore.getState().remapRequirementIds([
      { oldId: "REQ_001", newId: "REQ_002" },
      { oldId: "REQ_002", newId: "REQ_003" },
      { oldId: "REQ_003", newId: "REQ_001" },
    ]);
    expect(linkSet()).toEqual(["TC_001→REQ_002", "TC_002→REQ_003", "TC_003→REQ_001"]);
  });

  it("union-merges when a rename lands on an ID that already has links", () => {
    loadLinks([
      { tc: "TC_001", req: "REQ_005" },
      { tc: "TC_001", req: "REQ_007" }, // same tc already linked to the target
      { tc: "TC_002", req: "REQ_007" },
    ]);
    useTraceabilityStore.getState().remapRequirementIds([{ oldId: "REQ_005", newId: "REQ_007" }]);
    // TC_001→REQ_007 deduped to one pair; TC_002 untouched. Never loses a link.
    expect(linkSet()).toEqual(["TC_001→REQ_007", "TC_002→REQ_007"]);
  });

  it("is a clean no-op for an empty list or a list that touches nothing", () => {
    loadLinks([{ tc: "TC_001", req: "REQ_001" }]);
    useTraceabilityStore.getState().markSaved();
    useTraceabilityStore.getState().remapRequirementIds([]);
    useTraceabilityStore.getState().remapRequirementIds([{ oldId: "REQ_404", newId: "REQ_405" }]);
    expect(useTraceabilityStore.getState().isDirty).toBe(false);
    expect(linkSet()).toEqual(["TC_001→REQ_001"]);
  });

  it("preserves link order for untouched links", () => {
    loadLinks([
      { tc: "TC_001", req: "REQ_001" },
      { tc: "TC_002", req: "REQ_002" },
      { tc: "TC_003", req: "REQ_001" },
    ]);
    useTraceabilityStore.getState().remapRequirementIds([{ oldId: "REQ_002", newId: "REQ_099" }]);
    expect(useTraceabilityStore.getState().links).toEqual([
      { tc: "TC_001", req: "REQ_001" },
      { tc: "TC_002", req: "REQ_099" },
      { tc: "TC_003", req: "REQ_001" },
    ]);
  });

  it("moves a coverage entry to the renamed requirement", () => {
    loadLinks([{ tc: "TC_001", req: "REQ_005" }]);
    useTraceabilityStore.getState().setCoverage("REQ_005", "FULL");
    useTraceabilityStore.getState().remapRequirementIds([{ oldId: "REQ_005", newId: "REQ_007" }]);
    expect(useTraceabilityStore.getState().coverage).toEqual({ REQ_007: "FULL" });
  });

  it("never overwrites a destination's own explicit coverage with an incoming rename", () => {
    // Both requirements need a linked test case for setCoverage to accept PARTIAL/FULL.
    loadLinks([
      { tc: "TC_001", req: "REQ_005" },
      { tc: "TC_002", req: "REQ_007" },
    ]);
    useTraceabilityStore.getState().setCoverage("REQ_005", "FULL");
    useTraceabilityStore.getState().setCoverage("REQ_007", "PARTIAL");
    useTraceabilityStore.getState().remapRequirementIds([{ oldId: "REQ_005", newId: "REQ_007" }]);
    expect(useTraceabilityStore.getState().coverage).toEqual({ REQ_007: "PARTIAL" });
  });

  it("leaves coverage untouched and clean on a no-op mapping", () => {
    loadLinks([{ tc: "TC_001", req: "REQ_001" }]);
    useTraceabilityStore.getState().setCoverage("REQ_001", "FULL");
    useTraceabilityStore.getState().markSaved();
    useTraceabilityStore.getState().remapRequirementIds([{ oldId: "REQ_404", newId: "REQ_405" }]);
    expect(useTraceabilityStore.getState().coverage).toEqual({ REQ_001: "FULL" });
    expect(useTraceabilityStore.getState().isDirty).toBe(false);
  });

  // ── Fan-out: a duplicated requirement ID splitting into multiple new IDs ──

  it("fans out links to every destination when one oldId maps to several newIds", () => {
    loadLinks([
      { tc: "TC_001", req: "REQ_001" },
      { tc: "TC_002", req: "REQ_001" },
    ]);
    useTraceabilityStore.getState().remapRequirementIds([
      { oldId: "REQ_001", newId: "REQ_001" }, // occurrence 1 keeps its number
      { oldId: "REQ_001", newId: "REQ_002" }, // occurrence 2 (the duplicate)
    ]);
    expect(linkSet()).toEqual([
      "TC_001→REQ_001",
      "TC_001→REQ_002",
      "TC_002→REQ_001",
      "TC_002→REQ_002",
    ]);
  });

  it("fan-out clears the old ID's own bucket — nothing is left behind under it", () => {
    loadLinks([{ tc: "TC_001", req: "REQ_001" }]);
    useTraceabilityStore.getState().remapRequirementIds([
      { oldId: "REQ_001", newId: "REQ_003" },
      { oldId: "REQ_001", newId: "REQ_004" },
    ]);
    expect(linkSet()).toEqual(["TC_001→REQ_003", "TC_001→REQ_004"]);
  });

  it("fan-out copies an explicit coverage status onto every destination", () => {
    loadLinks([{ tc: "TC_001", req: "REQ_001" }]);
    useTraceabilityStore.getState().setCoverage("REQ_001", "FULL");
    useTraceabilityStore.getState().remapRequirementIds([
      { oldId: "REQ_001", newId: "REQ_003" },
      { oldId: "REQ_001", newId: "REQ_004" },
    ]);
    expect(useTraceabilityStore.getState().coverage).toEqual({ REQ_003: "FULL", REQ_004: "FULL" });
  });

  it("fan-out promotes an unset destination to PARTIAL via the standard first-link rule", () => {
    loadLinks([{ tc: "TC_001", req: "REQ_001" }]); // coverage left NONE
    useTraceabilityStore.getState().remapRequirementIds([
      { oldId: "REQ_001", newId: "REQ_003" },
      { oldId: "REQ_001", newId: "REQ_004" },
    ]);
    expect(useTraceabilityStore.getState().coverage).toEqual({ REQ_003: "PARTIAL", REQ_004: "PARTIAL" });
  });

  it("fan-out never overwrites a destination's own pre-existing links or coverage", () => {
    loadLinks([
      { tc: "TC_001", req: "REQ_001" }, // duplicated ID, being fanned out
      { tc: "TC_002", req: "REQ_003" }, // REQ_003 already exists independently
    ]);
    useTraceabilityStore.getState().setCoverage("REQ_003", "PARTIAL");
    useTraceabilityStore.getState().remapRequirementIds([
      { oldId: "REQ_001", newId: "REQ_003" },
      { oldId: "REQ_001", newId: "REQ_004" },
    ]);
    expect(linkSet()).toEqual(["TC_001→REQ_003", "TC_001→REQ_004", "TC_002→REQ_003"]);
    // REQ_003's own PARTIAL survives — the incoming fan-out never had an
    // explicit status to copy (REQ_001's coverage was NONE), so it can't overwrite anyway.
    expect(useTraceabilityStore.getState().coverage).toEqual({ REQ_003: "PARTIAL", REQ_004: "PARTIAL" });
  });
});

// ── 2. Service: migrateRequirementIdTargets ───────────────────────────────────

describe("migrateRequirementIdTargets — fan-out", () => {
  beforeEach(resetStores);

  it("remaps traceability links and migrates review comments in one call", () => {
    loadLinks([{ tc: "TC_001", req: "REQ_005" }]);
    useReviewCommentsStore.getState().addComment("REQ_005", "Alice", "Issue");

    const outcomes = migrateRequirementIdTargets([{ oldId: "REQ_005", newId: "REQ_007" }]);

    expect(linkSet()).toEqual(["TC_001→REQ_007"]);
    expect(useReviewCommentsStore.getState().getComments("REQ_007")).toHaveLength(1);
    expect(outcomes).toEqual([{ oldId: "REQ_005", newId: "REQ_007", result: "migrated" }]);
  });

  it("preserves the review conflict outcome while still remapping trace links", () => {
    loadLinks([{ tc: "TC_001", req: "REQ_005" }]);
    useReviewCommentsStore.getState().addComment("REQ_005", "Alice", "old");
    useReviewCommentsStore.getState().addComment("REQ_007", "Bob", "existing");

    const outcomes = migrateRequirementIdTargets([{ oldId: "REQ_005", newId: "REQ_007" }]);

    // Reviews block (conflict), traceability union-merges — different stores,
    // different frozen semantics.
    expect(outcomes[0].result).toBe("conflict");
    expect(useReviewCommentsStore.getState().getComments("REQ_005")).toHaveLength(1);
    expect(linkSet()).toEqual(["TC_001→REQ_007"]);
  });

  it("excludes section review targets from the traceability mapping", () => {
    loadLinks([{ tc: "TC_001", req: "section:2.1" }]); // pathological, but must not move
    useReviewCommentsStore.getState().addComment("section:2.1", "Alice", "Section note");

    migrateRequirementIdTargets([{ oldId: "section:2.1", newId: "section:2.2" }]);

    expect(linkSet()).toEqual(["TC_001→section:2.1"]); // untouched
    expect(useReviewCommentsStore.getState().getComments("section:2.2")).toHaveLength(1); // reviews migrate
  });

  it("fans traceability links out to every destination when the same oldId appears twice", () => {
    loadLinks([{ tc: "TC_001", req: "REQ_005" }]);
    migrateRequirementIdTargets([
      { oldId: "REQ_005", newId: "REQ_007" },
      { oldId: "REQ_005", newId: "REQ_009" },
    ]);
    expect(linkSet()).toEqual(["TC_001→REQ_007", "TC_001→REQ_009"]);
  });
});

// ── 3. Pipeline: heading rename in a real editor ──────────────────────────────

describe("editor pipeline — heading rename migrates links automatically", () => {
  let editor: Editor | null = null;

  beforeEach(resetStores);
  afterEach(() => {
    editor?.destroy();
    editor = null;
  });

  function makeEditor(headings: string[]): Editor {
    return new Editor({
      extensions: [Document, Paragraph, Text, Heading, RequirementIdMigration],
      content: {
        type: "doc",
        content: headings.map((text) => ({
          type: "heading",
          attrs: { level: 3 },
          content: [{ type: "text", text }],
        })),
      },
    });
  }

  it("rename via document edit migrates traceability links", () => {
    loadLinks([
      { tc: "TC_001", req: "REQ_002" },
      { tc: "TC_002", req: "REQ_002" },
      { tc: "TC_003", req: "REQ_001" },
    ]);
    editor = makeEditor(["REQ_001 Auth", "REQ_002 Session"]);

    // Rewrite REQ_002 → REQ_042 exactly as the app's ID-rewrite helper does.
    // The second heading starts after the first heading node.
    const firstHeading = editor.state.doc.child(0);
    const secondPos = firstHeading.nodeSize;
    const tr = editor.state.tr;
    rewriteHeadingId(tr, secondPos, "REQ_002", "REQ_042");
    editor.view.dispatch(tr);

    expect(linkSet()).toEqual(["TC_001→REQ_042", "TC_002→REQ_042", "TC_003→REQ_001"]);
    // The document now carries REQ_042 — no broken links were created.
    expect(useTraceabilityStore.getState().isDirty).toBe(true);
  });

  it("copy-and-diverge: renaming a duplicated heading copies links onto the new ID and keeps the original's", () => {
    loadLinks([
      { tc: "TC_001", req: "REQ_001" },
      { tc: "TC_002", req: "REQ_001" },
    ]);
    // Two headings both start as REQ_001 — simulates a copy-paste duplicate
    // of a requirement section, before the user disambiguates the copy's ID.
    editor = makeEditor(["REQ_001 Auth", "REQ_001 Auth (copy)"]);

    const firstHeading = editor.state.doc.child(0);
    const secondPos = firstHeading.nodeSize;
    const tr = editor.state.tr;
    rewriteHeadingId(tr, secondPos, "REQ_001", "REQ_003");
    editor.view.dispatch(tr);

    // The untouched original (REQ_001) keeps its links; the diverged copy
    // (REQ_003) gets a copy of them — nothing was moved or lost.
    expect(linkSet()).toEqual([
      "TC_001→REQ_001",
      "TC_001→REQ_003",
      "TC_002→REQ_001",
      "TC_002→REQ_003",
    ]);
    expect(useTraceabilityStore.getState().isDirty).toBe(true);
  });

  it("duplicate-creating rename is reverted and links stay untouched", () => {
    loadLinks([{ tc: "TC_001", req: "REQ_002" }]);
    editor = makeEditor(["REQ_001 Auth", "REQ_002 Session"]);

    const firstHeading = editor.state.doc.child(0);
    const secondPos = firstHeading.nodeSize;
    const tr = editor.state.tr;
    rewriteHeadingId(tr, secondPos, "REQ_002", "REQ_001"); // collides with heading 1
    editor.view.dispatch(tr);

    // Plugin reverts the document change; links must not have moved.
    expect(editor.state.doc.child(1).textContent).toContain("REQ_002");
    expect(linkSet()).toEqual(["TC_001→REQ_002"]);
  });
});

// ── 4. handleRenumber pipeline: duplicate-ID fan-out (regression) ────────────
//
// Reproduces the exact data flow OutlinePanel's handleRenumber runs — build
// occurrence-level replacements via computeRenumberReplacements (the real,
// unmodified pure function), then apply them to both companion stores the
// same way handleRenumber does. This is the scenario the bug report
// describes: a requirement duplicated via copy/paste (two physical headings
// sharing one ID) going through a bulk renumber.

function makeHeadingNode(label: string, index: number, pmPos: number): OutlineNode {
  return { key: `heading:${index}`, type: "heading", level: 3, label, pmPos, index, children: [] };
}

/**
 * Mirrors handleRenumber's transformation from replacements to a rename
 * list — deliberately NOT filtering out self-pairs (newId === entry.id);
 * see the comment in OutlinePanel.tsx's handleRenumber for why that filter
 * would break duplicate-ID fan-out detection.
 */
function renamesFrom(replacements: ReturnType<typeof computeRenumberReplacements>) {
  return replacements.map(({ newId, entry }) => ({ oldId: entry.id, newId }));
}

describe("handleRenumber pipeline — duplicate-ID fan-out", () => {
  beforeEach(resetStores);

  it("preserves companion data for BOTH the original and a duplicated requirement after renumbering", () => {
    // Two physical headings both read "REQ_001" (a copy/paste duplicate
    // awaiting disambiguation), followed by one already-distinct REQ_002.
    // Document order renumbers them to REQ_001, REQ_002, REQ_003.
    const entries: RequirementEntry[] = [
      { node: makeHeadingNode("REQ_001 Auth", 0, 0), id: "REQ_001", num: 1 },
      { node: makeHeadingNode("REQ_001 Auth (copy)", 1, 10), id: "REQ_001", num: 1 },
      { node: makeHeadingNode("REQ_002 Session", 2, 20), id: "REQ_002", num: 2 },
    ];
    const replacements = computeRenumberReplacements(entries, "REQ_", 3);
    // Sanity-check the pure function still assigns distinct new IDs per
    // occurrence, even though two entries share the same id string.
    expect(replacements.map((r) => r.newId)).toEqual(["REQ_001", "REQ_002", "REQ_003"]);

    loadLinks([
      { tc: "TC_001", req: "REQ_001" },
      { tc: "TC_002", req: "REQ_002" },
    ]);
    useReviewCommentsStore.getState().addComment("REQ_001", "Alice", "Duplicate-aware review note");
    useTraceabilityStore.getState().setCoverage("REQ_001", "FULL");

    const renames = renamesFrom(replacements);
    useReviewCommentsStore.getState().renumberComments(renames);
    useTraceabilityStore.getState().remapRequirementIds(renames);

    // Original occurrence (stays REQ_001) keeps everything it had.
    expect(useReviewCommentsStore.getState().getComments("REQ_001")).toHaveLength(1);
    // Duplicate occurrence (renumbered to REQ_002) gets its OWN copy — not
    // moved away from, not dropped.
    expect(useReviewCommentsStore.getState().getComments("REQ_002")).toHaveLength(1);
    // The pre-existing, unrelated REQ_002 requirement was itself renumbered
    // to REQ_003 in the same pass — no collision, nothing overwritten.
    expect(useReviewCommentsStore.getState().getComments("REQ_003")).toHaveLength(0);

    expect(linkSet()).toEqual([
      "TC_001→REQ_001",
      "TC_001→REQ_002",
      "TC_002→REQ_003",
    ]);
    expect(useTraceabilityStore.getState().coverage).toEqual({ REQ_001: "FULL", REQ_002: "FULL" });
  });

  it("three-way duplicate: every occurrence gets its own copy after renumbering", () => {
    const entries: RequirementEntry[] = [
      { node: makeHeadingNode("REQ_005 A", 0, 0), id: "REQ_005", num: 5 },
      { node: makeHeadingNode("REQ_005 B", 1, 10), id: "REQ_005", num: 5 },
      { node: makeHeadingNode("REQ_005 C", 2, 20), id: "REQ_005", num: 5 },
    ];
    const replacements = computeRenumberReplacements(entries, "REQ_", 3);
    expect(replacements.map((r) => r.newId)).toEqual(["REQ_001", "REQ_002", "REQ_003"]);

    loadLinks([{ tc: "TC_001", req: "REQ_005" }]);
    const renames = renamesFrom(replacements);
    useTraceabilityStore.getState().remapRequirementIds(renames);

    expect(linkSet()).toEqual(["TC_001→REQ_001", "TC_001→REQ_002", "TC_001→REQ_003"]);
  });

  it("no duplicates: behaves exactly like a plain renumber (regression)", () => {
    const entries: RequirementEntry[] = [
      { node: makeHeadingNode("REQ_003 A", 0, 0), id: "REQ_003", num: 3 },
      { node: makeHeadingNode("REQ_001 B", 1, 10), id: "REQ_001", num: 1 },
      { node: makeHeadingNode("REQ_002 C", 2, 20), id: "REQ_002", num: 2 },
    ];
    const replacements = computeRenumberReplacements(entries, "REQ_", 3);

    loadLinks([
      { tc: "TC_001", req: "REQ_003" },
      { tc: "TC_002", req: "REQ_001" },
      { tc: "TC_003", req: "REQ_002" },
    ]);
    const renames = renamesFrom(replacements);
    useTraceabilityStore.getState().remapRequirementIds(renames);

    // Overlapping chain (REQ_003→REQ_001, REQ_001→REQ_002, REQ_002→REQ_003)
    // resolves chain-safely, exactly as the plain single-destination path did.
    expect(linkSet()).toEqual(["TC_001→REQ_001", "TC_002→REQ_002", "TC_003→REQ_003"]);
  });
});

// ── 5. handleReassignDuplicate pipeline: occurrence-aware copy (regression) ──
//
// Reproduces the exact data flow OutlinePanel's handleReassignDuplicate runs
// for its per-duplicate "Fix" action: pick the next available ID via the
// real nextAvailableId utility, then copy (not move) companion data from the
// still-shared ID onto the newly reassigned occurrence — mirroring
// handleRenumber's occurrence-aware philosophy, but via the copy primitives
// (copyRequirementLinks / copyRequirementComments) since this is a single
// sequential reassignment, not a batch.

describe("handleReassignDuplicate pipeline — occurrence-aware copy", () => {
  beforeEach(resetStores);

  it("the remaining occurrence keeps everything; the reassigned duplicate gets its own copy", () => {
    // Two occurrences share REQ_001; nextAvailableId looks at ALL current
    // requirement numbers (both read as num=1) to pick REQ_002 as fresh.
    const requirements: RequirementEntry[] = [
      { node: { key: "h:0", type: "heading", level: 3, label: "REQ_001 Auth", pmPos: 0, index: 0, children: [] }, id: "REQ_001", num: 1 },
      { node: { key: "h:1", type: "heading", level: 3, label: "REQ_001 Auth (copy)", pmPos: 10, index: 1, children: [] }, id: "REQ_001", num: 1 },
    ];
    const newId = nextAvailableId(requirements, "REQ_", 3);
    expect(newId).toBe("REQ_002");

    loadLinks([
      { tc: "TC_001", req: "REQ_001" },
      { tc: "TC_002", req: "REQ_001" },
    ]);
    useTraceabilityStore.getState().setCoverage("REQ_001", "FULL");
    useReviewCommentsStore.getState().addComment("REQ_001", "Alice", "Shared review note");

    // Mirrors handleReassignDuplicate: rewrite the heading (not exercised
    // here — that's pure ProseMirror text replacement, already covered
    // elsewhere), then copy companion data from the old id onto newId.
    useReviewCommentsStore.getState().copyRequirementComments("REQ_001", newId);
    useTraceabilityStore.getState().copyRequirementLinks("REQ_001", newId);

    // The remaining occurrence (still REQ_001) is completely untouched.
    expect(useReviewCommentsStore.getState().getComments("REQ_001")).toHaveLength(1);
    expect(useTraceabilityStore.getState().coverage.REQ_001).toBe("FULL");
    // The reassigned duplicate (REQ_002) has its own copy of everything.
    expect(useReviewCommentsStore.getState().getComments("REQ_002")).toHaveLength(1);
    expect(useTraceabilityStore.getState().coverage.REQ_002).toBe("FULL");
    expect(linkSet()).toEqual([
      "TC_001→REQ_001",
      "TC_001→REQ_002",
      "TC_002→REQ_001",
      "TC_002→REQ_002",
    ]);
  });

  it("three-way duplicate resolved one Fix click at a time: each click leaves prior fixes untouched", () => {
    loadLinks([{ tc: "TC_001", req: "REQ_001" }]);
    useReviewCommentsStore.getState().addComment("REQ_001", "Alice", "Note");

    // First "Fix" click: reassign one occurrence to REQ_002.
    useReviewCommentsStore.getState().copyRequirementComments("REQ_001", "REQ_002");
    useTraceabilityStore.getState().copyRequirementLinks("REQ_001", "REQ_002");

    // Second "Fix" click (document still has two REQ_001 occurrences left):
    // reassign another to REQ_003. REQ_002's data from the first click must
    // survive untouched.
    useReviewCommentsStore.getState().copyRequirementComments("REQ_001", "REQ_003");
    useTraceabilityStore.getState().copyRequirementLinks("REQ_001", "REQ_003");

    expect(useReviewCommentsStore.getState().getComments("REQ_001")).toHaveLength(1);
    expect(useReviewCommentsStore.getState().getComments("REQ_002")).toHaveLength(1);
    expect(useReviewCommentsStore.getState().getComments("REQ_003")).toHaveLength(1);
    expect(linkSet()).toEqual(["TC_001→REQ_001", "TC_001→REQ_002", "TC_001→REQ_003"]);
  });
});
