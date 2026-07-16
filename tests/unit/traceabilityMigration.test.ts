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

const TCS = [
  { id: "TC_001", title: "T1" },
  { id: "TC_002", title: "T2" },
  { id: "TC_003", title: "T3" },
];

function resetStores() {
  useTraceabilityStore.setState({
    testCases: [],
    links: [],
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
    useTraceabilityStore.getState().remapRequirementIds(new Map([["REQ_005", "REQ_007"]]));
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
    useTraceabilityStore.getState().remapRequirementIds(
      new Map([
        ["REQ_001", "REQ_002"],
        ["REQ_002", "REQ_003"],
        ["REQ_003", "REQ_001"],
      ]),
    );
    expect(linkSet()).toEqual(["TC_001→REQ_002", "TC_002→REQ_003", "TC_003→REQ_001"]);
  });

  it("union-merges when a rename lands on an ID that already has links", () => {
    loadLinks([
      { tc: "TC_001", req: "REQ_005" },
      { tc: "TC_001", req: "REQ_007" }, // same tc already linked to the target
      { tc: "TC_002", req: "REQ_007" },
    ]);
    useTraceabilityStore.getState().remapRequirementIds(new Map([["REQ_005", "REQ_007"]]));
    // TC_001→REQ_007 deduped to one pair; TC_002 untouched. Never loses a link.
    expect(linkSet()).toEqual(["TC_001→REQ_007", "TC_002→REQ_007"]);
  });

  it("is a clean no-op for an empty mapping or a mapping that touches nothing", () => {
    loadLinks([{ tc: "TC_001", req: "REQ_001" }]);
    useTraceabilityStore.getState().markSaved();
    useTraceabilityStore.getState().remapRequirementIds(new Map());
    useTraceabilityStore.getState().remapRequirementIds(new Map([["REQ_404", "REQ_405"]]));
    expect(useTraceabilityStore.getState().isDirty).toBe(false);
    expect(linkSet()).toEqual(["TC_001→REQ_001"]);
  });

  it("preserves link order for untouched links", () => {
    loadLinks([
      { tc: "TC_001", req: "REQ_001" },
      { tc: "TC_002", req: "REQ_002" },
      { tc: "TC_003", req: "REQ_001" },
    ]);
    useTraceabilityStore.getState().remapRequirementIds(new Map([["REQ_002", "REQ_099"]]));
    expect(useTraceabilityStore.getState().links).toEqual([
      { tc: "TC_001", req: "REQ_001" },
      { tc: "TC_002", req: "REQ_099" },
      { tc: "TC_003", req: "REQ_001" },
    ]);
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

  it("first occurrence wins when the same oldId appears twice (matches review loop)", () => {
    loadLinks([{ tc: "TC_001", req: "REQ_005" }]);
    migrateRequirementIdTargets([
      { oldId: "REQ_005", newId: "REQ_007" },
      { oldId: "REQ_005", newId: "REQ_009" },
    ]);
    expect(linkSet()).toEqual(["TC_001→REQ_007"]);
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
