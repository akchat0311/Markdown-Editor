/**
 * Tests for the Traceability dashboard tab (Phase 2).
 *
 * Pure-helper tests cover row building, search filtering, and ID suggestion.
 * Component tests render the tab inside an EditorContext with a real headless
 * TipTap editor so the requirement index derives from actual headings
 * (useRequirementIndex debounces 300 ms — assertions use waitFor).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { Editor } from "@tiptap/core";
import Document from "@tiptap/extension-document";
import Paragraph from "@tiptap/extension-paragraph";
import Text from "@tiptap/extension-text";
import Heading from "@tiptap/extension-heading";
import type { JSONContent } from "@tiptap/core";
import { EditorContext } from "@/editor/EditorContext";
import { TraceabilityTab } from "@/layout/tabs/TraceabilityTab";
import {
  buildTraceabilityRows,
  filterTraceabilityRows,
  findBrokenLinks,
  summarizeTraceability,
  suggestNextTestCaseId,
} from "@/layout/tabs/traceabilityRows";
import { useTraceabilityStore } from "@/stores/traceabilityStore";
import { useConfigStore } from "@/stores/configStore";
import type { TestCase, TraceLink } from "@/types/traceability";

// ── Fixtures ──────────────────────────────────────────────────────────────────

const TCS: TestCase[] = [
  { id: "TC_001", title: "Login with valid credentials" },
  { id: "TC_002", title: "Login lockout" },
  { id: "TC_005", title: "Password reset" },
];

const LINKS: TraceLink[] = [
  { tc: "TC_001", req: "REQ_001" },
  { tc: "TC_002", req: "REQ_001" },
  { tc: "TC_005", req: "REQ_003" },
];

// ── buildTraceabilityRows ─────────────────────────────────────────────────────

describe("buildTraceabilityRows", () => {
  it("produces one row per requirement in the given order", () => {
    const rows = buildTraceabilityRows(["REQ_001", "REQ_002", "REQ_003"], TCS, LINKS);
    expect(rows.map((r) => r.reqId)).toEqual(["REQ_001", "REQ_002", "REQ_003"]);
  });

  it("attaches linked test cases in links-array order and leaves others empty", () => {
    const rows = buildTraceabilityRows(["REQ_001", "REQ_002", "REQ_003"], TCS, LINKS);
    expect(rows[0].testCases.map((t) => t.id)).toEqual(["TC_001", "TC_002"]);
    expect(rows[1].testCases).toEqual([]);
    expect(rows[2].testCases.map((t) => t.id)).toEqual(["TC_005"]);
  });

  it("collapses duplicate requirement IDs to the first occurrence", () => {
    const rows = buildTraceabilityRows(["REQ_001", "REQ_001"], TCS, LINKS);
    expect(rows).toHaveLength(1);
  });

  it("ignores broken links (req not in the index) without crashing", () => {
    const rows = buildTraceabilityRows(["REQ_001"], TCS, [
      ...LINKS,
      { tc: "TC_001", req: "REQ_DELETED" },
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].testCases.map((t) => t.id)).toEqual(["TC_001", "TC_002"]);
  });

  it("skips links whose test case is unknown", () => {
    const rows = buildTraceabilityRows(["REQ_001"], TCS, [{ tc: "TC_999", req: "REQ_001" }]);
    expect(rows[0].testCases).toEqual([]);
  });

  it("returns no rows when the index is empty", () => {
    expect(buildTraceabilityRows([], TCS, LINKS)).toEqual([]);
  });
});

// ── filterTraceabilityRows ────────────────────────────────────────────────────

describe("filterTraceabilityRows", () => {
  const rows = buildTraceabilityRows(["REQ_001", "REQ_002", "REQ_003"], TCS, LINKS);

  it("returns all rows for an empty or whitespace query", () => {
    expect(filterTraceabilityRows(rows, "")).toHaveLength(3);
    expect(filterTraceabilityRows(rows, "   ")).toHaveLength(3);
  });

  it("matches by requirement ID (case-insensitive)", () => {
    expect(filterTraceabilityRows(rows, "req_002").map((r) => r.reqId)).toEqual(["REQ_002"]);
  });

  it("matches by test case ID", () => {
    expect(filterTraceabilityRows(rows, "TC_005").map((r) => r.reqId)).toEqual(["REQ_003"]);
  });

  it("matches by test case TITLE even though only IDs are displayed", () => {
    expect(filterTraceabilityRows(rows, "lockout").map((r) => r.reqId)).toEqual(["REQ_001"]);
  });

  it("returns nothing when no field matches", () => {
    expect(filterTraceabilityRows(rows, "zebra")).toEqual([]);
  });
});

// ── findBrokenLinks ───────────────────────────────────────────────────────────

describe("findBrokenLinks", () => {
  it("returns links whose requirement is absent from the index", () => {
    const broken = findBrokenLinks(["REQ_001"], TCS, [
      { tc: "TC_001", req: "REQ_001" },
      { tc: "TC_002", req: "REQ_GONE" },
      { tc: "TC_005", req: "REQ_ALSO_GONE" },
    ]);
    expect(broken).toEqual([
      { req: "REQ_GONE", testCase: TCS[1] },
      { req: "REQ_ALSO_GONE", testCase: TCS[2] },
    ]);
  });

  it("returns nothing when every link resolves", () => {
    expect(findBrokenLinks(["REQ_001", "REQ_003"], TCS, LINKS)).toEqual([]);
  });

  it("skips links whose test case is unknown", () => {
    expect(findBrokenLinks([], TCS, [{ tc: "TC_999", req: "REQ_GONE" }])).toEqual([]);
  });
});

// ── summarizeTraceability ─────────────────────────────────────────────────────

describe("summarizeTraceability", () => {
  it("counts requirements, linked requirements, test cases, links, and broken links", () => {
    const reqIds = ["REQ_001", "REQ_002", "REQ_003"];
    const links = [...LINKS, { tc: "TC_001", req: "REQ_GONE" }];
    const rows = buildTraceabilityRows(reqIds, TCS, links);
    const broken = findBrokenLinks(reqIds, TCS, links);
    expect(summarizeTraceability(rows, TCS, links, broken)).toEqual({
      requirementCount: 3,
      linkedRequirementCount: 2, // REQ_001, REQ_003 — REQ_002 has no links
      testCaseCount: 3,
      linkCount: 4,
      brokenLinkCount: 1,
    });
  });

  it("is all zeros for empty inputs", () => {
    expect(summarizeTraceability([], [], [], [])).toEqual({
      requirementCount: 0,
      linkedRequirementCount: 0,
      testCaseCount: 0,
      linkCount: 0,
      brokenLinkCount: 0,
    });
  });
});

// ── suggestNextTestCaseId ─────────────────────────────────────────────────────

describe("suggestNextTestCaseId", () => {
  it("increments the numeric suffix of the last test case, preserving padding", () => {
    expect(suggestNextTestCaseId(TCS)).toBe("TC_006");
    expect(suggestNextTestCaseId([{ id: "UT-09", title: "t" }])).toBe("UT-10");
  });

  it("returns empty when there are no test cases or no numeric suffix", () => {
    expect(suggestNextTestCaseId([])).toBe("");
    expect(suggestNextTestCaseId([{ id: "SMOKE", title: "t" }])).toBe("");
  });
});

// ── Component tests ───────────────────────────────────────────────────────────

function makeEditor(headings: string[]): Editor {
  const content: JSONContent = {
    type: "doc",
    content: headings.map((text) => ({
      type: "heading",
      attrs: { level: 2 },
      content: [{ type: "text", text }],
    })),
  };
  return new Editor({ extensions: [Document, Paragraph, Text, Heading], content });
}

function resetStores() {
  useTraceabilityStore.setState({
    testCases: [],
    links: [],
    isDirty: false,
    loaded: false,
    loadError: false,
  });
  useConfigStore.setState({ requirementPattern: { mode: "simple", example: "REQ_001" } });
}

let editor: Editor | null = null;
afterEach(() => {
  editor?.destroy();
  editor = null;
});

function renderTab(
  headings: string[] = ["REQ_001 Auth", "REQ_002 Session", "REQ_003 Reset"],
  props: Partial<{
    onLoadTraceability: () => void;
    onSaveTraceability: () => void;
    onSaveTraceabilityAs: () => void;
  }> = {},
) {
  editor = makeEditor(headings);
  return render(
    <EditorContext.Provider value={editor}>
      <TraceabilityTab
        onLoadTraceability={props.onLoadTraceability ?? vi.fn()}
        onSaveTraceability={props.onSaveTraceability ?? vi.fn()}
        onSaveTraceabilityAs={props.onSaveTraceabilityAs ?? vi.fn()}
      />
    </EditorContext.Provider>,
  );
}

/** Rows appear only after useRequirementIndex's 300 ms debounce. */
async function waitForRows() {
  await waitFor(
    () => expect(screen.getAllByTestId("traceability-row").length).toBeGreaterThan(0),
    { timeout: 2000 },
  );
}

describe("TraceabilityTab — table", () => {
  beforeEach(resetStores);

  it("renders one row per requirement in document order, ID column only", async () => {
    renderTab();
    await waitForRows();
    const rows = screen.getAllByTestId("traceability-row");
    // cell[0] is the selection checkbox; cell[1] is the Requirement ID.
    expect(rows.map((r) => within(r).getAllByRole("cell")[1].textContent)).toEqual([
      "REQ_001",
      "REQ_002",
      "REQ_003",
    ]);
    // Requirement titles are intentionally NOT displayed.
    expect(screen.queryByText("Auth")).toBeNull();
  });

  it("shows linked test cases as chips with the title as tooltip, and — when empty", async () => {
    useTraceabilityStore.getState().load({ version: 1, testCases: TCS, links: LINKS });
    renderTab();
    await waitForRows();

    const rows = screen.getAllByTestId("traceability-row");
    const chips = within(rows[0]).getAllByTestId("tc-chip");
    expect(chips.map((c) => c.textContent)).toEqual(["TC_001", "TC_002"]);
    expect(chips[0]).toHaveAttribute("title", "Login with valid credentials");

    expect(within(rows[1]).getByTestId("empty-tc-cell")).toHaveTextContent("—");
    expect(within(rows[1]).queryAllByTestId("tc-chip")).toHaveLength(0);
  });

  it("filters rows by test case title through the search box", async () => {
    useTraceabilityStore.getState().load({ version: 1, testCases: TCS, links: LINKS });
    renderTab();
    await waitForRows();

    fireEvent.change(screen.getByTestId("traceability-search"), {
      target: { value: "lockout" },
    });
    const rows = screen.getAllByTestId("traceability-row");
    expect(rows).toHaveLength(1);
    expect(within(rows[0]).getAllByRole("cell")[1]).toHaveTextContent("REQ_001");
    expect(screen.getByText("Showing 1 of 3 requirements")).toBeInTheDocument();
  });

  it("shows the no-pattern notice when no requirement pattern is configured", () => {
    useConfigStore.setState({ requirementPattern: null });
    renderTab();
    expect(screen.getByText("No requirement pattern configured.")).toBeInTheDocument();
    expect(screen.queryByTestId("traceability-search")).toBeNull();
  });
});

describe("TraceabilityTab — link dialog", () => {
  beforeEach(resetStores);

  it("opens from the empty cell, links an existing test case, and renders the chip", async () => {
    useTraceabilityStore.getState().load({ version: 1, testCases: TCS, links: [] });
    renderTab();
    await waitForRows();

    fireEvent.click(within(screen.getAllByTestId("traceability-row")[1]).getByTestId("empty-tc-cell"));
    expect(screen.getByTestId("link-dialog-title")).toHaveTextContent("REQ_002");

    const options = screen.getAllByTestId("link-existing-tc");
    expect(options).toHaveLength(3);
    fireEvent.click(within(options[1]).getByTestId("link-existing-tc-checkbox")); // TC_002
    fireEvent.click(screen.getByTestId("link-selected-btn"));

    expect(useTraceabilityStore.getState().links).toEqual([{ tc: "TC_002", req: "REQ_002" }]);
    expect(screen.queryByTestId("link-dialog-title")).toBeNull(); // dialog closed
    const row = screen.getAllByTestId("traceability-row")[1];
    expect(within(row).getByTestId("tc-chip")).toHaveTextContent("TC_002");
  });

  it("links several selected test cases at once (multi-select)", async () => {
    useTraceabilityStore.getState().load({ version: 1, testCases: TCS, links: [] });
    renderTab();
    await waitForRows();

    fireEvent.click(within(screen.getAllByTestId("traceability-row")[0]).getByTestId("empty-tc-cell"));
    const boxes = screen.getAllByTestId("link-existing-tc-checkbox");
    fireEvent.click(boxes[0]); // TC_001
    fireEvent.click(boxes[2]); // TC_005
    expect(screen.getByTestId("link-selected-btn")).toHaveTextContent("Link Selected (2)");
    fireEvent.click(screen.getByTestId("link-selected-btn"));

    expect(useTraceabilityStore.getState().links).toEqual([
      { tc: "TC_001", req: "REQ_001" },
      { tc: "TC_005", req: "REQ_001" },
    ]);
    const row = screen.getAllByTestId("traceability-row")[0];
    expect(within(row).getAllByTestId("tc-chip").map((c) => c.textContent)).toEqual([
      "TC_001", "TC_005",
    ]);
  });

  it("disables Link Selected until something is checked", async () => {
    useTraceabilityStore.getState().load({ version: 1, testCases: TCS, links: [] });
    renderTab();
    await waitForRows();
    fireEvent.click(within(screen.getAllByTestId("traceability-row")[0]).getByTestId("empty-tc-cell"));
    expect(screen.getByTestId("link-selected-btn")).toBeDisabled();
  });

  it("excludes already-linked test cases from the existing list", async () => {
    useTraceabilityStore.getState().load({ version: 1, testCases: TCS, links: LINKS });
    renderTab();
    await waitForRows();

    fireEvent.click(within(screen.getAllByTestId("traceability-row")[0]).getByTestId("add-link-btn"));
    // REQ_001 already has TC_001 and TC_002 — only TC_005 remains linkable.
    const options = screen.getAllByTestId("link-existing-tc");
    expect(options.map((o) => o.textContent)).toEqual(["TC_005Password reset"]);
  });

  it("creates a new test case with only ID + title and auto-links it", async () => {
    renderTab();
    await waitForRows();

    fireEvent.click(within(screen.getAllByTestId("traceability-row")[0]).getByTestId("empty-tc-cell"));
    fireEvent.change(screen.getByTestId("new-tc-id"), { target: { value: "TC_100" } });
    fireEvent.change(screen.getByTestId("new-tc-title"), { target: { value: "Smoke test" } });
    fireEvent.click(screen.getByTestId("create-and-link-btn"));

    const s = useTraceabilityStore.getState();
    expect(s.testCases).toEqual([{ id: "TC_100", title: "Smoke test" }]);
    expect(s.links).toEqual([{ tc: "TC_100", req: "REQ_001" }]);
    expect(s.isDirty).toBe(true);
  });

  it("pre-fills the ID with the next suggestion and rejects duplicates inline", async () => {
    useTraceabilityStore.getState().load({ version: 1, testCases: TCS, links: [] });
    renderTab();
    await waitForRows();

    fireEvent.click(within(screen.getAllByTestId("traceability-row")[0]).getByTestId("add-link-btn"));
    expect(screen.getByTestId("new-tc-id")).toHaveValue("TC_006");

    fireEvent.change(screen.getByTestId("new-tc-id"), { target: { value: "TC_001" } });
    fireEvent.change(screen.getByTestId("new-tc-title"), { target: { value: "Dup" } });
    fireEvent.click(screen.getByTestId("create-and-link-btn"));

    expect(screen.getByTestId("link-dialog-error")).toHaveTextContent('"TC_001" already exists');
    expect(useTraceabilityStore.getState().testCases).toHaveLength(3); // unchanged
  });

  it("requires only the ID before creating — title is optional", async () => {
    renderTab();
    await waitForRows();
    fireEvent.click(within(screen.getAllByTestId("traceability-row")[0]).getByTestId("empty-tc-cell"));

    // No ID → blocked with an ID-specific error.
    fireEvent.click(screen.getByTestId("create-and-link-btn"));
    expect(screen.getByTestId("link-dialog-error")).toHaveTextContent("ID is required.");
    expect(useTraceabilityStore.getState().testCases).toHaveLength(0);

    // ID only, no title → creates and links an untitled test case.
    fireEvent.change(screen.getByTestId("new-tc-id"), { target: { value: "TC_100" } });
    fireEvent.click(screen.getByTestId("create-and-link-btn"));
    const s = useTraceabilityStore.getState();
    expect(s.testCases).toEqual([{ id: "TC_100", title: "" }]);
    expect(s.links).toEqual([{ tc: "TC_100", req: "REQ_001" }]);
  });

  it("untitled test cases render as ID-only chips with no error anywhere", async () => {
    useTraceabilityStore.getState().load({
      version: 1,
      testCases: [{ id: "TC_100", title: "" }],
      links: [{ tc: "TC_100", req: "REQ_001" }],
    });
    renderTab();
    await waitForRows();
    const chip = within(screen.getAllByTestId("traceability-row")[0]).getByTestId("tc-chip");
    expect(chip).toHaveTextContent("TC_100");
    expect(screen.queryByTestId("link-dialog-error")).toBeNull();
  });
});

describe("TraceabilityTab — test case editor dialog", () => {
  beforeEach(() => {
    resetStores();
    useTraceabilityStore.getState().load({ version: 1, testCases: TCS, links: LINKS });
  });

  it("opens from a chip and edits the title", async () => {
    renderTab();
    await waitForRows();

    fireEvent.click(within(screen.getAllByTestId("traceability-row")[0]).getAllByTestId("tc-chip")[0]);
    expect(screen.getByTestId("tc-editor-id")).toHaveValue("TC_001");
    fireEvent.change(screen.getByTestId("tc-editor-title-input"), {
      target: { value: "Login happy path" },
    });
    fireEvent.click(screen.getByTestId("tc-editor-save"));

    expect(screen.queryByTestId("tc-editor-title")).toBeNull();
    expect(useTraceabilityStore.getState().testCases[0]).toEqual({
      id: "TC_001",
      title: "Login happy path",
    });
  });

  it("renames the ID and the chip follows (link cascade)", async () => {
    renderTab();
    await waitForRows();

    fireEvent.click(within(screen.getAllByTestId("traceability-row")[0]).getAllByTestId("tc-chip")[0]);
    fireEvent.change(screen.getByTestId("tc-editor-id"), { target: { value: "TC_900" } });
    fireEvent.click(screen.getByTestId("tc-editor-save"));

    const row = screen.getAllByTestId("traceability-row")[0];
    expect(within(row).getAllByTestId("tc-chip").map((c) => c.textContent)).toEqual([
      "TC_900",
      "TC_002",
    ]);
  });

  it("shows an inline error when renaming onto an existing ID", async () => {
    renderTab();
    await waitForRows();

    fireEvent.click(within(screen.getAllByTestId("traceability-row")[0]).getAllByTestId("tc-chip")[0]);
    fireEvent.change(screen.getByTestId("tc-editor-id"), { target: { value: "TC_002" } });
    fireEvent.click(screen.getByTestId("tc-editor-save"));

    expect(screen.getByTestId("tc-editor-error")).toHaveTextContent('"TC_002" already exists');
    expect(useTraceabilityStore.getState().testCases.map((t) => t.id)).toEqual([
      "TC_001", "TC_002", "TC_005",
    ]);
  });

  it("unlinks from the clicked requirement only — the test case survives", async () => {
    renderTab();
    await waitForRows();

    fireEvent.click(within(screen.getAllByTestId("traceability-row")[0]).getAllByTestId("tc-chip")[0]);
    fireEvent.click(screen.getByTestId("tc-editor-unlink"));

    const s = useTraceabilityStore.getState();
    expect(s.links).toEqual([
      { tc: "TC_002", req: "REQ_001" },
      { tc: "TC_005", req: "REQ_003" },
    ]);
    expect(s.testCases).toHaveLength(3);
    const row = screen.getAllByTestId("traceability-row")[0];
    expect(within(row).getAllByTestId("tc-chip").map((c) => c.textContent)).toEqual(["TC_002"]);
  });
});

describe("TraceabilityTab — multi-select & bulk unlink", () => {
  beforeEach(() => {
    resetStores();
    useTraceabilityStore.getState().load({ version: 1, testCases: TCS, links: LINKS });
  });

  it("shows the selection toolbar when rows are checked and clears it on Clear", async () => {
    renderTab();
    await waitForRows();
    expect(screen.queryByTestId("selection-toolbar")).toBeNull();

    const boxes = screen.getAllByTestId("row-checkbox");
    fireEvent.click(boxes[0]); // REQ_001 → 2 links
    fireEvent.click(boxes[2]); // REQ_003 → 1 link
    expect(screen.getByTestId("selection-toolbar")).toHaveTextContent("2 selected · 3 links");

    fireEvent.click(screen.getByTestId("clear-selection-btn"));
    expect(screen.queryByTestId("selection-toolbar")).toBeNull();
  });

  it("bulk-unlinks all links of the selected requirements after confirmation", async () => {
    renderTab();
    await waitForRows();

    fireEvent.click(screen.getAllByTestId("row-checkbox")[0]); // REQ_001
    fireEvent.click(screen.getByTestId("bulk-unlink-btn"));
    expect(screen.getByTestId("confirm-unlink-message")).toHaveTextContent(
      "Remove 2 links from 1 selected requirement?",
    );
    fireEvent.click(screen.getByTestId("confirm-unlink-btn"));

    const s = useTraceabilityStore.getState();
    expect(s.links).toEqual([{ tc: "TC_005", req: "REQ_003" }]);
    expect(s.testCases).toHaveLength(3); // test cases survive
    expect(screen.queryByTestId("selection-toolbar")).toBeNull(); // selection cleared
  });

  it("cancel leaves links untouched", async () => {
    renderTab();
    await waitForRows();
    fireEvent.click(screen.getAllByTestId("row-checkbox")[0]);
    fireEvent.click(screen.getByTestId("bulk-unlink-btn"));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(useTraceabilityStore.getState().links).toHaveLength(3);
  });

  it("disables Unlink All when the selection has no links", async () => {
    renderTab();
    await waitForRows();
    fireEvent.click(screen.getAllByTestId("row-checkbox")[1]); // REQ_002 — unlinked
    expect(screen.getByTestId("bulk-unlink-btn")).toBeDisabled();
  });

  it("select-all checkbox selects every filtered row", async () => {
    renderTab();
    await waitForRows();

    fireEvent.change(screen.getByTestId("traceability-search"), { target: { value: "lockout" } });
    fireEvent.click(screen.getByTestId("select-all-checkbox"));
    // Only the single filtered row (REQ_001) got selected.
    expect(screen.getByTestId("selection-toolbar")).toHaveTextContent("1 selected");

    fireEvent.change(screen.getByTestId("traceability-search"), { target: { value: "" } });
    const boxes = screen.getAllByTestId("row-checkbox");
    expect((boxes[0] as HTMLInputElement).checked).toBe(true);
    expect((boxes[1] as HTMLInputElement).checked).toBe(false);
    expect((boxes[2] as HTMLInputElement).checked).toBe(false);
  });
});

describe("TraceabilityTab — broken links", () => {
  const LINKS_WITH_BROKEN = [
    ...LINKS,
    { tc: "TC_002", req: "REQ_GONE" },
    { tc: "TC_005", req: "REQ_LOST" },
  ];

  beforeEach(() => {
    resetStores();
    useTraceabilityStore.getState().load({ version: 1, testCases: TCS, links: LINKS_WITH_BROKEN });
  });

  it("lists broken links in a dedicated section with the summary counting them", async () => {
    renderTab();
    await waitForRows();

    const section = screen.getByTestId("broken-links-section");
    expect(section).toHaveTextContent("Broken Links (2)");
    const rows = within(section).getAllByTestId("broken-link-row");
    expect(rows[0]).toHaveTextContent("REQ_GONE");
    expect(within(rows[0]).getByTestId("broken-link-chip")).toHaveTextContent("TC_002");
    // No literal space in textContent — the gap between value and label is CSS margin.
    expect(screen.getByTestId("traceability-summary")).toHaveTextContent("2Broken");
  });

  it("does not render the section when every link resolves", async () => {
    useTraceabilityStore.getState().load({ version: 1, testCases: TCS, links: LINKS });
    renderTab();
    await waitForRows();
    expect(screen.queryByTestId("broken-links-section")).toBeNull();
  });

  it("unlinks a single broken link without touching others", async () => {
    renderTab();
    await waitForRows();

    fireEvent.click(within(screen.getAllByTestId("broken-link-row")[0]).getByTestId("broken-link-unlink"));
    const s = useTraceabilityStore.getState();
    expect(s.links).toHaveLength(4);
    expect(s.links.some((l) => l.req === "REQ_GONE")).toBe(false);
    expect(s.links.some((l) => l.req === "REQ_LOST")).toBe(true);
  });

  it("removes all broken links after confirmation, keeping healthy links", async () => {
    renderTab();
    await waitForRows();

    fireEvent.click(screen.getByTestId("remove-all-broken-btn"));
    expect(screen.getByTestId("confirm-unlink-message")).toHaveTextContent(
      "Remove all 2 broken links?",
    );
    fireEvent.click(screen.getByTestId("confirm-unlink-btn"));

    expect(useTraceabilityStore.getState().links).toEqual(LINKS);
    expect(screen.queryByTestId("broken-links-section")).toBeNull();
  });

  it("broken chips open the test case editor with the broken requirement as unlink context", async () => {
    renderTab();
    await waitForRows();

    fireEvent.click(screen.getAllByTestId("broken-link-chip")[0]);
    expect(screen.getByTestId("tc-editor-unlink")).toHaveTextContent("Unlink from REQ_GONE");
    fireEvent.click(screen.getByTestId("tc-editor-unlink"));
    expect(useTraceabilityStore.getState().links.some((l) => l.req === "REQ_GONE")).toBe(false);
  });
});

describe("TraceabilityTab — summary strip", () => {
  beforeEach(resetStores);

  it("shows the four core stats and omits Broken at zero", async () => {
    useTraceabilityStore.getState().load({ version: 1, testCases: TCS, links: LINKS });
    renderTab();
    await waitForRows();

    // No literal space in textContent — the gap between value and label is CSS margin.
    const summary = screen.getByTestId("traceability-summary");
    expect(summary).toHaveTextContent("3Requirements");
    expect(summary).toHaveTextContent("2Linked");
    expect(summary).toHaveTextContent("3Test Cases");
    expect(summary).toHaveTextContent("3Links");
    expect(summary).not.toHaveTextContent("Broken");
  });

  it("updates live as links change", async () => {
    useTraceabilityStore.getState().load({ version: 1, testCases: TCS, links: [] });
    renderTab();
    await waitForRows();
    expect(screen.getByTestId("traceability-summary")).toHaveTextContent("0Linked");

    useTraceabilityStore.getState().addLink("TC_001", "REQ_002");
    await waitFor(() =>
      expect(screen.getByTestId("traceability-summary")).toHaveTextContent("1Linked"),
    );
  });
});

describe("TraceabilityTab — file section", () => {
  beforeEach(resetStores);

  it("shows the empty state and only the Load button before anything is loaded", () => {
    renderTab();
    expect(screen.getByTestId("traceability-file-status")).toHaveTextContent(
      "No traceability file loaded",
    );
    expect(screen.getByTestId("load-traceability-btn")).toHaveTextContent("Load File…");
    expect(screen.queryByTestId("save-traceability-btn")).toBeNull();
    expect(screen.queryByTestId("save-traceability-as-btn")).toBeNull();
  });

  it("shows Modified + Save when dirty, Saved when clean, and wires the callbacks", async () => {
    const onSave = vi.fn();
    const onSaveAs = vi.fn();
    const onLoad = vi.fn();
    useTraceabilityStore.getState().load({ version: 1, testCases: TCS, links: [] });
    renderTab(undefined, {
      onSaveTraceability: onSave,
      onSaveTraceabilityAs: onSaveAs,
      onLoadTraceability: onLoad,
    });

    expect(screen.getByTestId("traceability-file-status")).toHaveTextContent("✓ Saved");

    useTraceabilityStore.getState().addTestCase("TC_100", "New");
    await waitFor(() =>
      expect(screen.getByTestId("traceability-file-status")).toHaveTextContent("● Modified"),
    );

    fireEvent.click(screen.getByTestId("save-traceability-btn"));
    fireEvent.click(screen.getByTestId("save-traceability-as-btn"));
    fireEvent.click(screen.getByTestId("load-traceability-btn"));
    expect(onSave).toHaveBeenCalledOnce();
    expect(onSaveAs).toHaveBeenCalledOnce();
    expect(onLoad).toHaveBeenCalledOnce();
  });

  it("surfaces the unreadable-file state", () => {
    useTraceabilityStore.getState().setLoadError();
    renderTab();
    expect(screen.getByTestId("traceability-file-status")).toHaveTextContent(
      "could not be read",
    );
  });
});
