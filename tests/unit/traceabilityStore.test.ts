import { describe, it, expect, beforeEach } from "vitest";
import { useTraceabilityStore, migrateTraceabilityFile } from "@/stores/traceabilityStore";

function resetStore() {
  useTraceabilityStore.setState({
    testCases: [],
    links: [],
    coverage: {},
    isDirty: false,
    loaded: false,
    loadError: false,
  });
}

const VALID_FILE = {
  version: 1,
  testCases: [
    { id: "TC-001", title: "Login with valid credentials" },
    { id: "TC-002", title: "Login lockout" },
  ],
  links: [
    { tc: "TC-001", req: "REQ_001" },
    { tc: "TC-002", req: "REQ_001" },
    { tc: "TC-002", req: "REQ_007" },
  ],
  coverage: { REQ_001: "PARTIAL" as const },
};

// ── migrateTraceabilityFile ───────────────────────────────────────────────────

describe("migrateTraceabilityFile", () => {
  it("passes a valid file through unchanged, not repaired", () => {
    const { data, repaired } = migrateTraceabilityFile(VALID_FILE);
    expect(data.testCases).toEqual(VALID_FILE.testCases);
    expect(data.links).toEqual(VALID_FILE.links);
    expect(data.version).toBe(1);
    expect(repaired).toBe(false);
  });

  it("treats a missing version as 1 without flagging repair", () => {
    const { data, repaired } = migrateTraceabilityFile({
      testCases: [{ id: "TC-1", title: "T" }],
      links: [],
    });
    expect(data.version).toBe(1);
    expect(repaired).toBe(false);
  });

  it("reads a newer version best-effort (known fields only)", () => {
    const { data } = migrateTraceabilityFile({
      version: 2,
      testCases: [{ id: "TC-1", title: "T", futureField: "x" }],
      links: [{ tc: "TC-1", req: "REQ_001", coverage: "full" }],
      futureTopLevel: {},
    });
    expect(data.testCases).toEqual([{ id: "TC-1", title: "T" }]);
    expect(data.links).toEqual([{ tc: "TC-1", req: "REQ_001" }]);
  });

  it.each([null, undefined, "text", 42, []])(
    "coerces non-object input %j to an empty repaired file",
    (input) => {
      const { data, repaired } = migrateTraceabilityFile(input);
      expect(data).toEqual({ version: 1, testCases: [], links: [], coverage: {} });
      expect(repaired).toBe(true);
    },
  );

  it("drops test cases with missing, non-string, or empty id — title is optional", () => {
    const { data, repaired } = migrateTraceabilityFile({
      testCases: [
        { id: "TC-1", title: "Valid" },
        { id: "", title: "No id" },
        { id: "TC-2", title: "   " }, // whitespace title → kept, normalized to ""
        { id: 3, title: "Numeric id" },
        { title: "Missing id" },
        "not-an-object",
      ],
      links: [],
    });
    expect(data.testCases).toEqual([
      { id: "TC-1", title: "Valid" },
      { id: "TC-2", title: "" },
    ]);
    expect(repaired).toBe(true);
  });

  it("keeps untitled test cases: empty title is valid, missing title normalizes to \"\"", () => {
    const clean = migrateTraceabilityFile({
      testCases: [{ id: "TC-1", title: "" }],
      links: [{ tc: "TC-1", req: "REQ_001" }],
    });
    expect(clean.data.testCases).toEqual([{ id: "TC-1", title: "" }]);
    expect(clean.repaired).toBe(false); // empty title needs no repair

    const missing = migrateTraceabilityFile({ testCases: [{ id: "TC-2" }], links: [] });
    expect(missing.data.testCases).toEqual([{ id: "TC-2", title: "" }]);
    expect(missing.repaired).toBe(true); // field normalized → written on next save
  });

  it("trims whitespace on id and title, flagging repair", () => {
    const { data, repaired } = migrateTraceabilityFile({
      testCases: [{ id: "  TC-1 ", title: " Padded " }],
      links: [{ tc: "TC-1", req: " REQ_001 " }],
    });
    expect(data.testCases).toEqual([{ id: "TC-1", title: "Padded" }]);
    expect(data.links).toEqual([{ tc: "TC-1", req: "REQ_001" }]);
    expect(repaired).toBe(true);
  });

  it("keeps the first occurrence on duplicate test case IDs (exact string)", () => {
    const { data, repaired } = migrateTraceabilityFile({
      testCases: [
        { id: "TC-1", title: "First" },
        { id: "TC-1", title: "Second" },
        { id: "tc-1", title: "Different case is a different ID" },
      ],
      links: [],
    });
    expect(data.testCases).toEqual([
      { id: "TC-1", title: "First" },
      { id: "tc-1", title: "Different case is a different ID" },
    ]);
    expect(repaired).toBe(true);
  });

  it("drops links whose tc references no surviving test case", () => {
    const { data, repaired } = migrateTraceabilityFile({
      testCases: [{ id: "TC-1", title: "T" }],
      links: [
        { tc: "TC-1", req: "REQ_001" },
        { tc: "TC-999", req: "REQ_001" },
      ],
    });
    expect(data.links).toEqual([{ tc: "TC-1", req: "REQ_001" }]);
    expect(repaired).toBe(true);
  });

  it("KEEPS links whose req matches no requirement — broken links are preserved", () => {
    // The loader has no knowledge of the document; any non-empty req is kept.
    const { data, repaired } = migrateTraceabilityFile({
      testCases: [{ id: "TC-1", title: "T" }],
      links: [{ tc: "TC-1", req: "REQ_DELETED_LONG_AGO" }],
    });
    expect(data.links).toEqual([{ tc: "TC-1", req: "REQ_DELETED_LONG_AGO" }]);
    expect(repaired).toBe(false);
  });

  it("deduplicates identical (tc, req) pairs", () => {
    const { data, repaired } = migrateTraceabilityFile({
      testCases: [{ id: "TC-1", title: "T" }],
      links: [
        { tc: "TC-1", req: "REQ_001" },
        { tc: "TC-1", req: "REQ_001" },
      ],
    });
    expect(data.links).toEqual([{ tc: "TC-1", req: "REQ_001" }]);
    expect(repaired).toBe(true);
  });

  it("does not falsely deduplicate pairs whose concatenation collides", () => {
    const { data } = migrateTraceabilityFile({
      testCases: [
        { id: "A B", title: "T1" },
        { id: "A", title: "T2" },
      ],
      links: [
        { tc: "A B", req: "C" },
        { tc: "A", req: "B C" },
      ],
    });
    expect(data.links).toHaveLength(2);
  });

  it("drops malformed link entries and non-array links/testCases fields", () => {
    const { data, repaired } = migrateTraceabilityFile({
      testCases: { not: "an array" },
      links: [{ tc: "TC-1" }, { req: "REQ_001" }, null, 7],
    });
    expect(data).toEqual({ version: 1, testCases: [], links: [], coverage: {} });
    expect(repaired).toBe(true);
  });

  it("drops coverage entries with an empty key or a non-enum value, flagging repair", () => {
    const { data, repaired } = migrateTraceabilityFile({
      testCases: [],
      links: [],
      coverage: { REQ_001: "FULL", "": "PARTIAL", REQ_002: "bogus", REQ_003: 1 },
    });
    expect(data.coverage).toEqual({ REQ_001: "FULL" });
    expect(repaired).toBe(true);
  });

  it("trims whitespace on coverage keys", () => {
    const { data, repaired } = migrateTraceabilityFile({
      testCases: [],
      links: [],
      coverage: { " REQ_001 ": "PARTIAL" },
    });
    expect(data.coverage).toEqual({ REQ_001: "PARTIAL" });
    expect(repaired).toBe(true);
  });

  it("keeps a coverage entry for a requirement absent from the document — heals like broken links", () => {
    const { data, repaired } = migrateTraceabilityFile({
      testCases: [],
      links: [],
      coverage: { REQ_GONE: "FULL" },
    });
    expect(data.coverage).toEqual({ REQ_GONE: "FULL" });
    expect(repaired).toBe(false);
  });

  it("treats a non-object coverage field as empty, flagging repair", () => {
    const { data, repaired } = migrateTraceabilityFile({
      testCases: [],
      links: [],
      coverage: ["not", "a", "record"],
    });
    expect(data.coverage).toEqual({});
    expect(repaired).toBe(true);
  });
});

// ── Store: load / reset / dirty lifecycle ─────────────────────────────────────

describe("traceabilityStore load/reset/dirty", () => {
  beforeEach(resetStore);

  it("load() of a clean file sets loaded and is NOT dirty", () => {
    useTraceabilityStore.getState().load(VALID_FILE);
    const s = useTraceabilityStore.getState();
    expect(s.testCases).toHaveLength(2);
    expect(s.links).toHaveLength(3);
    expect(s.loaded).toBe(true);
    expect(s.isDirty).toBe(false);
    expect(s.loadError).toBe(false);
  });

  it("load() of a repaired file IS dirty so the next save normalizes the file", () => {
    useTraceabilityStore.getState().load({
      testCases: [{ id: "TC-1", title: "T" }, { id: "", title: "dropped" }],
      links: [],
    });
    expect(useTraceabilityStore.getState().isDirty).toBe(true);
  });

  it("load() replaces previous content entirely", () => {
    useTraceabilityStore.getState().load(VALID_FILE);
    useTraceabilityStore.getState().load({ testCases: [{ id: "X", title: "Y" }], links: [] });
    const s = useTraceabilityStore.getState();
    expect(s.testCases).toEqual([{ id: "X", title: "Y" }]);
    expect(s.links).toEqual([]);
  });

  it("reset() clears content, dirty, loaded, and loadError", () => {
    useTraceabilityStore.getState().load(VALID_FILE);
    useTraceabilityStore.getState().addTestCase("TC-9", "New");
    useTraceabilityStore.getState().reset();
    const s = useTraceabilityStore.getState();
    expect(s.testCases).toEqual([]);
    expect(s.links).toEqual([]);
    expect(s.coverage).toEqual({});
    expect(s.isDirty).toBe(false);
    expect(s.loaded).toBe(false);
    expect(s.loadError).toBe(false);
  });

  it("markSaved() clears only the dirty flag", () => {
    useTraceabilityStore.getState().load(VALID_FILE);
    useTraceabilityStore.getState().addTestCase("TC-9", "New");
    expect(useTraceabilityStore.getState().isDirty).toBe(true);
    useTraceabilityStore.getState().markSaved();
    const s = useTraceabilityStore.getState();
    expect(s.isDirty).toBe(false);
    expect(s.testCases).toHaveLength(3);
    expect(s.loaded).toBe(true);
  });

  it("setLoadError() empties the store, marks the error, and is not dirty", () => {
    useTraceabilityStore.getState().load(VALID_FILE);
    useTraceabilityStore.getState().setLoadError();
    const s = useTraceabilityStore.getState();
    expect(s.loadError).toBe(true);
    expect(s.loaded).toBe(false);
    expect(s.isDirty).toBe(false);
    expect(s.testCases).toEqual([]);
  });

  it("a successful load() clears a prior loadError", () => {
    useTraceabilityStore.getState().setLoadError();
    useTraceabilityStore.getState().load(VALID_FILE);
    expect(useTraceabilityStore.getState().loadError).toBe(false);
    expect(useTraceabilityStore.getState().loaded).toBe(true);
  });
});

// ── Store: test case CRUD ─────────────────────────────────────────────────────

describe("traceabilityStore test cases", () => {
  beforeEach(resetStore);

  it("addTestCase trims, appends, marks dirty and loaded", () => {
    const ok = useTraceabilityStore.getState().addTestCase("  TC-1 ", " Login ");
    expect(ok).toBe(true);
    const s = useTraceabilityStore.getState();
    expect(s.testCases).toEqual([{ id: "TC-1", title: "Login" }]);
    expect(s.isDirty).toBe(true);
    expect(s.loaded).toBe(true);
  });

  it("addTestCase rejects empty id and duplicate id; title is optional", () => {
    useTraceabilityStore.getState().addTestCase("TC-1", "T");
    expect(useTraceabilityStore.getState().addTestCase("  ", "T")).toBe(false);
    expect(useTraceabilityStore.getState().addTestCase("TC-1", "Other")).toBe(false);
    expect(useTraceabilityStore.getState().addTestCase("TC-2", "  ")).toBe(true); // untitled
    expect(useTraceabilityStore.getState().testCases).toEqual([
      { id: "TC-1", title: "T" },
      { id: "TC-2", title: "" },
    ]);
  });

  it("updateTestCase edits the title in place", () => {
    useTraceabilityStore.getState().addTestCase("TC-1", "Old");
    useTraceabilityStore.getState().markSaved();
    const result = useTraceabilityStore.getState().updateTestCase("TC-1", { title: "New" });
    expect(result).toBe("updated");
    expect(useTraceabilityStore.getState().testCases[0]).toEqual({ id: "TC-1", title: "New" });
    expect(useTraceabilityStore.getState().isDirty).toBe(true);
  });

  it("updateTestCase ID rename cascades to links atomically", () => {
    const store = useTraceabilityStore.getState();
    store.addTestCase("TC-1", "T1");
    store.addTestCase("TC-2", "T2");
    useTraceabilityStore.getState().addLink("TC-1", "REQ_001");
    useTraceabilityStore.getState().addLink("TC-1", "REQ_002");
    useTraceabilityStore.getState().addLink("TC-2", "REQ_001");

    const result = useTraceabilityStore.getState().updateTestCase("TC-1", { id: "TC-100" });
    expect(result).toBe("updated");
    const s = useTraceabilityStore.getState();
    expect(s.testCases.map((t) => t.id)).toEqual(["TC-100", "TC-2"]);
    expect(s.links).toEqual([
      { tc: "TC-100", req: "REQ_001" },
      { tc: "TC-100", req: "REQ_002" },
      { tc: "TC-2", req: "REQ_001" },
    ]);
  });

  it("updateTestCase rejects a rename onto an existing ID, changing nothing", () => {
    useTraceabilityStore.getState().addTestCase("TC-1", "T1");
    useTraceabilityStore.getState().addTestCase("TC-2", "T2");
    useTraceabilityStore.getState().addLink("TC-1", "REQ_001");
    useTraceabilityStore.getState().markSaved();

    const result = useTraceabilityStore.getState().updateTestCase("TC-1", { id: "TC-2" });
    expect(result).toBe("duplicate");
    const s = useTraceabilityStore.getState();
    expect(s.testCases.map((t) => t.id)).toEqual(["TC-1", "TC-2"]);
    expect(s.links).toEqual([{ tc: "TC-1", req: "REQ_001" }]);
    expect(s.isDirty).toBe(false);
  });

  it("updateTestCase returns not-found / invalid without mutating", () => {
    useTraceabilityStore.getState().addTestCase("TC-1", "T");
    useTraceabilityStore.getState().markSaved();
    expect(useTraceabilityStore.getState().updateTestCase("TC-9", { title: "X" })).toBe("not-found");
    expect(useTraceabilityStore.getState().updateTestCase("TC-1", { id: "" })).toBe("invalid");
    expect(useTraceabilityStore.getState().isDirty).toBe(false);
  });

  it("updateTestCase can clear the title — title is optional", () => {
    useTraceabilityStore.getState().addTestCase("TC-1", "Had a title");
    useTraceabilityStore.getState().markSaved();
    expect(useTraceabilityStore.getState().updateTestCase("TC-1", { title: "  " })).toBe("updated");
    expect(useTraceabilityStore.getState().testCases[0]).toEqual({ id: "TC-1", title: "" });
    expect(useTraceabilityStore.getState().isDirty).toBe(true);
  });

  it("deleteTestCase removes the case and cascades its links only", () => {
    useTraceabilityStore.getState().addTestCase("TC-1", "T1");
    useTraceabilityStore.getState().addTestCase("TC-2", "T2");
    useTraceabilityStore.getState().addLink("TC-1", "REQ_001");
    useTraceabilityStore.getState().addLink("TC-2", "REQ_001");

    useTraceabilityStore.getState().deleteTestCase("TC-1");
    const s = useTraceabilityStore.getState();
    expect(s.testCases.map((t) => t.id)).toEqual(["TC-2"]);
    expect(s.links).toEqual([{ tc: "TC-2", req: "REQ_001" }]);
  });

  it("deleteTestCase of an unknown id is a no-op that stays clean", () => {
    useTraceabilityStore.getState().addTestCase("TC-1", "T");
    useTraceabilityStore.getState().markSaved();
    useTraceabilityStore.getState().deleteTestCase("TC-9");
    expect(useTraceabilityStore.getState().isDirty).toBe(false);
  });
});

// ── Store: coverage ────────────────────────────────────────────────────────────

describe("traceabilityStore coverage", () => {
  beforeEach(() => {
    resetStore();
    // Set up links directly (bypassing addLink) so the auto-promotion tested
    // in its own describe block below doesn't pre-populate coverage here.
    useTraceabilityStore.setState({
      testCases: [{ id: "TC-1", title: "T1" }],
      links: [
        { tc: "TC-1", req: "REQ_001" },
        { tc: "TC-1", req: "REQ_002" },
      ],
      coverage: {},
      isDirty: false,
    });
  });

  it("defaults to NONE for a requirement with no explicit coverage", () => {
    expect(useTraceabilityStore.getState().coverage.REQ_001).toBeUndefined();
  });

  it("setCoverage records the status and marks dirty", () => {
    useTraceabilityStore.getState().setCoverage("REQ_001", "FULL");
    const s = useTraceabilityStore.getState();
    expect(s.coverage).toEqual({ REQ_001: "FULL" });
    expect(s.isDirty).toBe(true);
  });

  it("setCoverage is a clean no-op when re-selecting the same status", () => {
    useTraceabilityStore.getState().setCoverage("REQ_001", "PARTIAL");
    useTraceabilityStore.getState().markSaved();
    useTraceabilityStore.getState().setCoverage("REQ_001", "PARTIAL");
    expect(useTraceabilityStore.getState().isDirty).toBe(false);
  });

  it("setCoverage to NONE on an unset requirement is a clean no-op against the implicit default", () => {
    useTraceabilityStore.getState().setCoverage("REQ_001", "NONE");
    expect(useTraceabilityStore.getState().isDirty).toBe(false);
    expect(useTraceabilityStore.getState().coverage).toEqual({});
  });

  it("setCoverage is keyed per requirement and never touches other entries", () => {
    useTraceabilityStore.getState().setCoverage("REQ_001", "FULL");
    useTraceabilityStore.getState().setCoverage("REQ_002", "PARTIAL");
    expect(useTraceabilityStore.getState().coverage).toEqual({
      REQ_001: "FULL",
      REQ_002: "PARTIAL",
    });
  });

  it("setCoverage ignores an empty requirement ID", () => {
    useTraceabilityStore.getState().setCoverage("   ", "FULL");
    expect(useTraceabilityStore.getState().coverage).toEqual({});
    expect(useTraceabilityStore.getState().isDirty).toBe(false);
  });

  it("setCoverage rejects PARTIAL/FULL for a requirement with no linked test case", () => {
    expect(useTraceabilityStore.getState().coverage.REQ_404).toBeUndefined();
    useTraceabilityStore.getState().setCoverage("REQ_404", "PARTIAL");
    useTraceabilityStore.getState().setCoverage("REQ_404", "FULL");
    expect(useTraceabilityStore.getState().coverage).toEqual({});
    expect(useTraceabilityStore.getState().isDirty).toBe(false);
  });

  it("setCoverage to NONE is always allowed, even without a linked test case", () => {
    useTraceabilityStore.getState().setCoverage("REQ_001", "FULL");
    useTraceabilityStore.getState().setCoverage("REQ_001", "NONE");
    expect(useTraceabilityStore.getState().coverage).toEqual({ REQ_001: "NONE" });
  });

  it("removeLink reverts coverage to NONE only when the requirement's last link is removed", () => {
    useTraceabilityStore.getState().addTestCase("TC-2", "T2");
    useTraceabilityStore.getState().addLink("TC-2", "REQ_001"); // REQ_001 now has 2 links
    useTraceabilityStore.getState().setCoverage("REQ_001", "FULL");
    useTraceabilityStore.getState().markSaved();

    useTraceabilityStore.getState().removeLink("TC-1", "REQ_001"); // one link remains
    expect(useTraceabilityStore.getState().coverage).toEqual({ REQ_001: "FULL" });

    useTraceabilityStore.getState().removeLink("TC-2", "REQ_001"); // last link gone
    expect(useTraceabilityStore.getState().coverage).toEqual({});
    expect(useTraceabilityStore.getState().isDirty).toBe(true);
  });

  it("removeLinks reverts coverage to NONE for every requirement that loses its last link", () => {
    useTraceabilityStore.getState().setCoverage("REQ_001", "PARTIAL");
    useTraceabilityStore.getState().setCoverage("REQ_002", "FULL");
    useTraceabilityStore.getState().removeLinks([
      { tc: "TC-1", req: "REQ_001" },
      { tc: "TC-1", req: "REQ_002" },
    ]);
    expect(useTraceabilityStore.getState().coverage).toEqual({});
  });

  it("deleteTestCase reverts coverage to NONE for requirements orphaned by the deletion", () => {
    useTraceabilityStore.getState().setCoverage("REQ_001", "PARTIAL");
    useTraceabilityStore.getState().deleteTestCase("TC-1");
    expect(useTraceabilityStore.getState().coverage).toEqual({});
  });

  it("removeLink leaves coverage untouched when the requirement still has other links", () => {
    useTraceabilityStore.getState().addTestCase("TC-2", "T2");
    useTraceabilityStore.getState().addLink("TC-2", "REQ_001");
    useTraceabilityStore.getState().setCoverage("REQ_001", "FULL");
    useTraceabilityStore.getState().markSaved();

    useTraceabilityStore.getState().removeLink("TC-1", "REQ_001");
    expect(useTraceabilityStore.getState().coverage).toEqual({ REQ_001: "FULL" });
    // Only the link removal marks it dirty — coverage itself was untouched.
    expect(useTraceabilityStore.getState().isDirty).toBe(true);
  });
});

// ── Store: links ──────────────────────────────────────────────────────────────

describe("traceabilityStore links", () => {
  beforeEach(() => {
    resetStore();
    useTraceabilityStore.getState().addTestCase("TC-1", "T1");
    useTraceabilityStore.getState().markSaved();
  });

  it("addLink appends a pair and marks dirty", () => {
    expect(useTraceabilityStore.getState().addLink("TC-1", "REQ_001")).toBe(true);
    const s = useTraceabilityStore.getState();
    expect(s.links).toEqual([{ tc: "TC-1", req: "REQ_001" }]);
    expect(s.isDirty).toBe(true);
  });

  it("addLink has set semantics: an existing pair is a clean no-op", () => {
    useTraceabilityStore.getState().addLink("TC-1", "REQ_001");
    useTraceabilityStore.getState().markSaved();
    expect(useTraceabilityStore.getState().addLink("TC-1", "REQ_001")).toBe(true);
    const s = useTraceabilityStore.getState();
    expect(s.links).toHaveLength(1);
    expect(s.isDirty).toBe(false);
  });

  it("addLink rejects an unknown test case and an empty requirement", () => {
    expect(useTraceabilityStore.getState().addLink("TC-9", "REQ_001")).toBe(false);
    expect(useTraceabilityStore.getState().addLink("TC-1", "  ")).toBe(false);
    expect(useTraceabilityStore.getState().links).toEqual([]);
    expect(useTraceabilityStore.getState().isDirty).toBe(false);
  });

  it("many-to-many: one requirement to many test cases and vice versa", () => {
    useTraceabilityStore.getState().addTestCase("TC-2", "T2");
    useTraceabilityStore.getState().addLink("TC-1", "REQ_001");
    useTraceabilityStore.getState().addLink("TC-1", "REQ_002");
    useTraceabilityStore.getState().addLink("TC-2", "REQ_001");
    expect(useTraceabilityStore.getState().links).toHaveLength(3);
  });

  it("removeLink removes exactly the named pair", () => {
    useTraceabilityStore.getState().addLink("TC-1", "REQ_001");
    useTraceabilityStore.getState().addLink("TC-1", "REQ_002");
    useTraceabilityStore.getState().removeLink("TC-1", "REQ_001");
    expect(useTraceabilityStore.getState().links).toEqual([{ tc: "TC-1", req: "REQ_002" }]);
  });

  it("removeLink of a missing pair is a clean no-op", () => {
    useTraceabilityStore.getState().removeLink("TC-1", "REQ_404");
    expect(useTraceabilityStore.getState().isDirty).toBe(false);
  });
});

// ── Store: coverage auto-promotion on first link ──────────────────────────────

describe("traceabilityStore coverage auto-promotion", () => {
  beforeEach(() => {
    resetStore();
    useTraceabilityStore.getState().addTestCase("TC-1", "T1");
    useTraceabilityStore.getState().addTestCase("TC-2", "T2");
    useTraceabilityStore.getState().markSaved();
  });

  it("addLink promotes NONE to PARTIAL the moment a requirement gets its first link", () => {
    useTraceabilityStore.getState().addLink("TC-1", "REQ_001");
    expect(useTraceabilityStore.getState().coverage).toEqual({ REQ_001: "PARTIAL" });
  });

  it("addLink does NOT re-promote a requirement that already had a link", () => {
    useTraceabilityStore.getState().addLink("TC-1", "REQ_001");
    useTraceabilityStore.getState().setCoverage("REQ_001", "FULL");
    useTraceabilityStore.getState().addLink("TC-2", "REQ_001"); // second link, same req
    expect(useTraceabilityStore.getState().coverage).toEqual({ REQ_001: "FULL" });
  });

  it("addLink re-adding an already-linked pair (set-semantics no-op) does not touch coverage", () => {
    useTraceabilityStore.getState().addLink("TC-1", "REQ_001");
    useTraceabilityStore.getState().setCoverage("REQ_001", "NONE");
    useTraceabilityStore.getState().addLink("TC-1", "REQ_001"); // already linked
    expect(useTraceabilityStore.getState().coverage).toEqual({ REQ_001: "NONE" });
  });

  it("addLinks (batch) promotes NONE to PARTIAL exactly once for the target requirement", () => {
    useTraceabilityStore.getState().addLinks(["TC-1", "TC-2"], "REQ_001");
    expect(useTraceabilityStore.getState().coverage).toEqual({ REQ_001: "PARTIAL" });
  });

  it("addLinks does not promote when the requirement already had a link", () => {
    useTraceabilityStore.getState().addLink("TC-1", "REQ_001");
    useTraceabilityStore.getState().setCoverage("REQ_001", "FULL");
    useTraceabilityStore.getState().addLinks(["TC-2"], "REQ_001");
    expect(useTraceabilityStore.getState().coverage).toEqual({ REQ_001: "FULL" });
  });

  it("promotion is keyed per requirement — unrelated requirements are untouched", () => {
    useTraceabilityStore.getState().addLink("TC-1", "REQ_001");
    expect(useTraceabilityStore.getState().coverage).toEqual({ REQ_001: "PARTIAL" });
    expect(useTraceabilityStore.getState().coverage.REQ_002).toBeUndefined();
  });

  it("unlinking down to zero then relinking promotes to PARTIAL again", () => {
    useTraceabilityStore.getState().addLink("TC-1", "REQ_001");
    useTraceabilityStore.getState().setCoverage("REQ_001", "FULL");
    useTraceabilityStore.getState().removeLink("TC-1", "REQ_001"); // reverts to NONE (implicit)
    useTraceabilityStore.getState().addLink("TC-2", "REQ_001"); // first link again
    expect(useTraceabilityStore.getState().coverage).toEqual({ REQ_001: "PARTIAL" });
  });
});

// ── Store: copyRequirementLinks ────────────────────────────────────────────────

describe("traceabilityStore copyRequirementLinks", () => {
  beforeEach(() => {
    resetStore();
    useTraceabilityStore.getState().addTestCase("TC-1", "T1");
    useTraceabilityStore.getState().addTestCase("TC-2", "T2");
  });

  it("copies links onto the destination without removing them from the source", () => {
    useTraceabilityStore.getState().addLink("TC-1", "REQ_001");
    useTraceabilityStore.getState().addLink("TC-2", "REQ_001");
    useTraceabilityStore.getState().copyRequirementLinks("REQ_001", "REQ_003");

    const s = useTraceabilityStore.getState();
    expect(s.links).toEqual(
      expect.arrayContaining([
        { tc: "TC-1", req: "REQ_001" },
        { tc: "TC-2", req: "REQ_001" },
        { tc: "TC-1", req: "REQ_003" },
        { tc: "TC-2", req: "REQ_003" },
      ]),
    );
    expect(s.links).toHaveLength(4); // source links preserved, not moved
  });

  it("copies the source's explicit coverage onto an unset destination", () => {
    useTraceabilityStore.getState().addLink("TC-1", "REQ_001");
    useTraceabilityStore.getState().setCoverage("REQ_001", "FULL");
    useTraceabilityStore.getState().copyRequirementLinks("REQ_001", "REQ_003");
    expect(useTraceabilityStore.getState().coverage).toEqual({ REQ_001: "FULL", REQ_003: "FULL" });
  });

  it("never overwrites the destination's own existing coverage", () => {
    useTraceabilityStore.getState().addLink("TC-1", "REQ_001");
    useTraceabilityStore.getState().setCoverage("REQ_001", "FULL");
    useTraceabilityStore.getState().addLink("TC-2", "REQ_003");
    useTraceabilityStore.getState().setCoverage("REQ_003", "PARTIAL");

    useTraceabilityStore.getState().copyRequirementLinks("REQ_001", "REQ_003");
    expect(useTraceabilityStore.getState().coverage).toEqual({ REQ_001: "FULL", REQ_003: "PARTIAL" });
  });

  it("promotes an unset destination to PARTIAL when the source has no explicit status", () => {
    useTraceabilityStore.getState().addLink("TC-1", "REQ_001"); // auto-promotes REQ_001 to PARTIAL
    useTraceabilityStore.getState().setCoverage("REQ_001", "NONE"); // explicitly reset back to No
    useTraceabilityStore.getState().copyRequirementLinks("REQ_001", "REQ_003");
    // Source stays explicitly "No"; destination gets the standard first-link promotion.
    expect(useTraceabilityStore.getState().coverage).toEqual({ REQ_001: "NONE", REQ_003: "PARTIAL" });
  });

  it("is a no-op when the source has no links", () => {
    useTraceabilityStore.getState().markSaved();
    useTraceabilityStore.getState().copyRequirementLinks("REQ_001", "REQ_003");
    expect(useTraceabilityStore.getState().links).toEqual([]);
    expect(useTraceabilityStore.getState().isDirty).toBe(false);
  });

  it("is a no-op when fromReq equals toReq", () => {
    useTraceabilityStore.getState().addLink("TC-1", "REQ_001");
    useTraceabilityStore.getState().markSaved();
    useTraceabilityStore.getState().copyRequirementLinks("REQ_001", "REQ_001");
    expect(useTraceabilityStore.getState().isDirty).toBe(false);
  });

  it("does not duplicate a pair the destination already has", () => {
    useTraceabilityStore.getState().addLink("TC-1", "REQ_001");
    useTraceabilityStore.getState().addLink("TC-1", "REQ_003"); // already present on destination
    useTraceabilityStore.getState().markSaved();
    useTraceabilityStore.getState().copyRequirementLinks("REQ_001", "REQ_003");
    expect(useTraceabilityStore.getState().links.filter((l) => l.req === "REQ_003")).toEqual([
      { tc: "TC-1", req: "REQ_003" },
    ]);
  });
});

// ── Store: batch link actions ─────────────────────────────────────────────────

describe("traceabilityStore batch link actions", () => {
  beforeEach(() => {
    resetStore();
    useTraceabilityStore.getState().addTestCase("TC-1", "T1");
    useTraceabilityStore.getState().addTestCase("TC-2", "T2");
    useTraceabilityStore.getState().addTestCase("TC-3", "T3");
    useTraceabilityStore.getState().markSaved();
  });

  it("addLinks links several test cases to one requirement in one update", () => {
    useTraceabilityStore.getState().addLinks(["TC-1", "TC-3"], "REQ_001");
    const s = useTraceabilityStore.getState();
    expect(s.links).toEqual([
      { tc: "TC-1", req: "REQ_001" },
      { tc: "TC-3", req: "REQ_001" },
    ]);
    expect(s.isDirty).toBe(true);
  });

  it("addLinks skips unknown test cases and already-linked pairs", () => {
    useTraceabilityStore.getState().addLink("TC-1", "REQ_001");
    useTraceabilityStore.getState().markSaved();
    useTraceabilityStore.getState().addLinks(["TC-1", "TC-9", "TC-2"], "REQ_001");
    const s = useTraceabilityStore.getState();
    expect(s.links).toEqual([
      { tc: "TC-1", req: "REQ_001" },
      { tc: "TC-2", req: "REQ_001" },
    ]);
  });

  it("addLinks stays clean when nothing actually changes", () => {
    useTraceabilityStore.getState().addLink("TC-1", "REQ_001");
    useTraceabilityStore.getState().markSaved();
    useTraceabilityStore.getState().addLinks(["TC-1", "TC-9"], "REQ_001");
    useTraceabilityStore.getState().addLinks([], "REQ_001");
    useTraceabilityStore.getState().addLinks(["TC-2"], "   ");
    expect(useTraceabilityStore.getState().isDirty).toBe(false);
    expect(useTraceabilityStore.getState().links).toHaveLength(1);
  });

  it("addLinks trims the requirement ID", () => {
    useTraceabilityStore.getState().addLinks(["TC-1"], "  REQ_001  ");
    expect(useTraceabilityStore.getState().links).toEqual([{ tc: "TC-1", req: "REQ_001" }]);
  });

  it("removeLinks removes exactly the named pairs in one update", () => {
    useTraceabilityStore.getState().addLinks(["TC-1", "TC-2", "TC-3"], "REQ_001");
    useTraceabilityStore.getState().addLinks(["TC-1"], "REQ_002");
    useTraceabilityStore.getState().removeLinks([
      { tc: "TC-1", req: "REQ_001" },
      { tc: "TC-3", req: "REQ_001" },
    ]);
    expect(useTraceabilityStore.getState().links).toEqual([
      { tc: "TC-2", req: "REQ_001" },
      { tc: "TC-1", req: "REQ_002" },
    ]);
  });

  it("removeLinks ignores missing pairs and stays clean on a pure no-op", () => {
    useTraceabilityStore.getState().addLink("TC-1", "REQ_001");
    useTraceabilityStore.getState().markSaved();
    useTraceabilityStore.getState().removeLinks([{ tc: "TC-9", req: "REQ_404" }]);
    useTraceabilityStore.getState().removeLinks([]);
    const s = useTraceabilityStore.getState();
    expect(s.links).toHaveLength(1);
    expect(s.isDirty).toBe(false);
  });
});

// ── Store: getFileData round-trip ─────────────────────────────────────────────

describe("traceabilityStore getFileData", () => {
  beforeEach(resetStore);

  it("snapshots the on-disk schema with version 1", () => {
    useTraceabilityStore.getState().load(VALID_FILE);
    expect(useTraceabilityStore.getState().getFileData()).toEqual(VALID_FILE);
  });

  it("round-trips through migrate without further repair", () => {
    useTraceabilityStore.getState().addTestCase("TC-1", "T");
    useTraceabilityStore.getState().addLink("TC-1", "REQ_001");
    const fileData = useTraceabilityStore.getState().getFileData();
    const { data, repaired } = migrateTraceabilityFile(JSON.parse(JSON.stringify(fileData)));
    expect(repaired).toBe(false);
    expect(data).toEqual(fileData);
  });
});
