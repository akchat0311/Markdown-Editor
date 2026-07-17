/**
 * Tests for the right-workspace TraceabilityDrawer (Phase 4).
 *
 * The drawer is a single-requirement contextual panel reusing the shared
 * dialogs from TraceabilityDialogs — tests cover the list, live sync with the
 * store, and the Link/Create/Edit/Unlink actions.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { TraceabilityDrawer } from "@/layout/TraceabilityDrawer";
import { useTraceabilityStore } from "@/stores/traceabilityStore";

const TCS = [
  { id: "TC_001", title: "Verify Engine Start" },
  { id: "TC_005", title: "Verify Restart" },
  { id: "TC_009", title: "Verify Shutdown" },
];

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

describe("TraceabilityDrawer", () => {
  beforeEach(resetStore);

  it("shows the requirement ID and its linked test cases with titles", () => {
    useTraceabilityStore.getState().load({
      version: 1,
      testCases: TCS,
      links: [
        { tc: "TC_001", req: "REQ_001" },
        { tc: "TC_005", req: "REQ_001" },
        { tc: "TC_009", req: "REQ_002" },
      ],
    });
    render(<TraceabilityDrawer reqId="REQ_001" onClose={vi.fn()} />);

    expect(screen.getByTestId("drawer-req-id")).toHaveTextContent("REQ_001");
    const rows = screen.getAllByTestId("drawer-tc-row");
    expect(rows).toHaveLength(2); // TC_009 belongs to REQ_002
    expect(rows[0]).toHaveTextContent("TC_001");
    expect(rows[0]).toHaveTextContent("Verify Engine Start");
    expect(rows[1]).toHaveTextContent("TC_005");
  });

  it("shows the empty state when nothing is linked", () => {
    useTraceabilityStore.getState().load({ version: 1, testCases: TCS, links: [] });
    render(<TraceabilityDrawer reqId="REQ_001" onClose={vi.fn()} />);
    expect(screen.getByTestId("drawer-empty")).toHaveTextContent("No linked test cases");
  });

  it("close button calls onClose", () => {
    const onClose = vi.fn();
    render(<TraceabilityDrawer reqId="REQ_001" onClose={onClose} />);
    fireEvent.click(screen.getByTestId("drawer-close"));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("unlinks a test case from this requirement only — the test case survives", () => {
    useTraceabilityStore.getState().load({
      version: 1,
      testCases: TCS,
      links: [
        { tc: "TC_001", req: "REQ_001" },
        { tc: "TC_001", req: "REQ_002" },
      ],
    });
    render(<TraceabilityDrawer reqId="REQ_001" onClose={vi.fn()} />);

    fireEvent.click(within(screen.getAllByTestId("drawer-tc-row")[0]).getByTestId("drawer-unlink-tc"));

    const s = useTraceabilityStore.getState();
    expect(s.links).toEqual([{ tc: "TC_001", req: "REQ_002" }]); // other req untouched
    expect(s.testCases).toHaveLength(3);
    expect(screen.getByTestId("drawer-empty")).toBeInTheDocument(); // live update
  });

  it("stays synchronized when links change elsewhere (store mutation)", async () => {
    useTraceabilityStore.getState().load({ version: 1, testCases: TCS, links: [] });
    render(<TraceabilityDrawer reqId="REQ_001" onClose={vi.fn()} />);
    expect(screen.getByTestId("drawer-empty")).toBeInTheDocument();

    useTraceabilityStore.getState().addLink("TC_005", "REQ_001");
    await waitFor(() =>
      expect(screen.getByTestId("drawer-tc-row")).toHaveTextContent("TC_005"),
    );
  });

  it("links an existing test case through the shared dialog", () => {
    useTraceabilityStore.getState().load({ version: 1, testCases: TCS, links: [] });
    render(<TraceabilityDrawer reqId="REQ_001" onClose={vi.fn()} />);

    fireEvent.click(screen.getByTestId("drawer-link-btn"));
    expect(screen.getByTestId("link-dialog-title")).toHaveTextContent("REQ_001");
    fireEvent.click(screen.getAllByTestId("link-existing-tc-checkbox")[1]); // TC_005
    fireEvent.click(screen.getByTestId("link-selected-btn"));

    expect(useTraceabilityStore.getState().links).toEqual([{ tc: "TC_005", req: "REQ_001" }]);
    expect(screen.queryByTestId("link-dialog-title")).toBeNull();
    expect(screen.getByTestId("drawer-tc-row")).toHaveTextContent("TC_005");
  });

  it("renders the Link Test Case action ABOVE the linked list (no scrolling)", () => {
    useTraceabilityStore.getState().load({
      version: 1,
      testCases: TCS,
      links: [{ tc: "TC_001", req: "REQ_001" }],
    });
    render(<TraceabilityDrawer reqId="REQ_001" onClose={vi.fn()} />);

    const drawer = screen.getByTestId("traceability-drawer");
    const btn = screen.getByTestId("drawer-link-btn");
    const row = screen.getByTestId("drawer-tc-row");
    // DOCUMENT_POSITION_FOLLOWING (4): the list row comes after the button.
    expect(btn.compareDocumentPosition(row) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(drawer.contains(btn)).toBe(true);
  });

  it("creates & links an untitled test case; the row shows only the ID", () => {
    render(<TraceabilityDrawer reqId="REQ_003" onClose={vi.fn()} />);

    fireEvent.click(screen.getByTestId("drawer-link-btn"));
    fireEvent.change(screen.getByTestId("new-tc-id"), { target: { value: "TC_200" } });
    fireEvent.click(screen.getByTestId("create-and-link-btn"));

    expect(useTraceabilityStore.getState().testCases).toEqual([{ id: "TC_200", title: "" }]);
    const row = screen.getByTestId("drawer-tc-row");
    expect(row).toHaveTextContent("TC_200");
    // ID + actions only — no empty title paragraph.
    expect(row.querySelectorAll("p")).toHaveLength(1);
  });

  it("clearing a title through the editor dialog is a valid edit", () => {
    useTraceabilityStore.getState().load({
      version: 1,
      testCases: TCS,
      links: [{ tc: "TC_001", req: "REQ_001" }],
    });
    render(<TraceabilityDrawer reqId="REQ_001" onClose={vi.fn()} />);

    fireEvent.click(screen.getByTestId("drawer-edit-tc"));
    fireEvent.change(screen.getByTestId("tc-editor-title-input"), { target: { value: "" } });
    fireEvent.click(screen.getByTestId("tc-editor-save"));

    expect(screen.queryByTestId("tc-editor-error")).toBeNull();
    expect(useTraceabilityStore.getState().testCases[0]).toEqual({ id: "TC_001", title: "" });
  });

  it("creates & links a new test case through the shared dialog", () => {
    render(<TraceabilityDrawer reqId="REQ_003" onClose={vi.fn()} />);

    fireEvent.click(screen.getByTestId("drawer-link-btn"));
    fireEvent.change(screen.getByTestId("new-tc-id"), { target: { value: "TC_100" } });
    fireEvent.change(screen.getByTestId("new-tc-title"), { target: { value: "Fresh case" } });
    fireEvent.click(screen.getByTestId("create-and-link-btn"));

    const s = useTraceabilityStore.getState();
    expect(s.testCases).toEqual([{ id: "TC_100", title: "Fresh case" }]);
    expect(s.links).toEqual([{ tc: "TC_100", req: "REQ_003" }]);
    expect(screen.getByTestId("drawer-tc-row")).toHaveTextContent("Fresh case");
  });

  it("hides the Coverage selector entirely when no test case is linked", () => {
    render(<TraceabilityDrawer reqId="REQ_001" onClose={vi.fn()} />);
    expect(screen.queryByTestId("drawer-coverage")).toBeNull();
  });

  it("shows only Partial and Yes once a test case is linked — no No option", () => {
    useTraceabilityStore.getState().load({
      version: 1,
      testCases: TCS,
      links: [{ tc: "TC_001", req: "REQ_001" }],
    });
    render(<TraceabilityDrawer reqId="REQ_001" onClose={vi.fn()} />);

    expect(screen.getByTestId("drawer-coverage")).toHaveTextContent("Partial");
    expect(screen.getByTestId("drawer-coverage")).toHaveTextContent("Yes");
    expect(screen.queryByTestId("drawer-coverage-radio-NONE")).toBeNull();
    expect(screen.getByTestId("drawer-coverage-radio-PARTIAL")).not.toBeChecked();
    expect(screen.getByTestId("drawer-coverage-radio-FULL")).not.toBeChecked();
  });

  it("selecting a coverage option updates the store, scoped to this requirement only", () => {
    useTraceabilityStore.getState().load({
      version: 1,
      testCases: TCS,
      links: [{ tc: "TC_001", req: "REQ_001" }],
    });
    render(<TraceabilityDrawer reqId="REQ_001" onClose={vi.fn()} />);
    fireEvent.click(screen.getByTestId("drawer-coverage-radio-PARTIAL"));
    expect(useTraceabilityStore.getState().coverage).toEqual({ REQ_001: "PARTIAL" });
    expect(screen.getByTestId("drawer-coverage-radio-PARTIAL")).toBeChecked();

    fireEvent.click(screen.getByTestId("drawer-coverage-radio-FULL"));
    expect(useTraceabilityStore.getState().coverage).toEqual({ REQ_001: "FULL" });
    expect(screen.getByTestId("drawer-coverage-radio-PARTIAL")).not.toBeChecked();
  });

  it("reflects the requirement's stored coverage on open, independent of other requirements", () => {
    useTraceabilityStore.getState().load({
      version: 1,
      testCases: TCS,
      links: [
        { tc: "TC_001", req: "REQ_001" },
        { tc: "TC_005", req: "REQ_002" },
      ],
      coverage: { REQ_001: "FULL", REQ_002: "PARTIAL" },
    });
    render(<TraceabilityDrawer reqId="REQ_002" onClose={vi.fn()} />);
    expect(screen.getByTestId("drawer-coverage-radio-PARTIAL")).toBeChecked();
    expect(screen.getByTestId("drawer-coverage-radio-FULL")).not.toBeChecked();
  });

  it("re-hides the Coverage selector after unlinking the last test case", () => {
    useTraceabilityStore.getState().load({
      version: 1,
      testCases: TCS,
      links: [{ tc: "TC_001", req: "REQ_001" }],
      coverage: { REQ_001: "FULL" },
    });
    render(<TraceabilityDrawer reqId="REQ_001" onClose={vi.fn()} />);
    expect(screen.getByTestId("drawer-coverage")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("drawer-unlink-tc"));
    expect(screen.queryByTestId("drawer-coverage")).toBeNull();
    expect(useTraceabilityStore.getState().coverage).toEqual({}); // reverted to the implicit NONE default
  });

  it("edits a test case through the shared editor dialog; the row updates live", () => {
    useTraceabilityStore.getState().load({
      version: 1,
      testCases: TCS,
      links: [{ tc: "TC_001", req: "REQ_001" }],
    });
    render(<TraceabilityDrawer reqId="REQ_001" onClose={vi.fn()} />);

    fireEvent.click(screen.getByTestId("drawer-edit-tc"));
    expect(screen.getByTestId("tc-editor-id")).toHaveValue("TC_001");
    fireEvent.change(screen.getByTestId("tc-editor-title-input"), {
      target: { value: "Retitled" },
    });
    fireEvent.click(screen.getByTestId("tc-editor-save"));

    expect(screen.getByTestId("drawer-tc-row")).toHaveTextContent("Retitled");
  });
});
