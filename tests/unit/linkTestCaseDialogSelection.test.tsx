/**
 * Tests for the bulk-selection UX in LinkTestCaseDialog's "Existing Test
 * Cases" list — Select All (with indeterminate state), Shift+Click range
 * selection, and Ctrl/Cmd+Click toggle-without-clearing.
 *
 * Rendered directly (not through the drawer/tab) since LinkTestCaseDialog
 * only depends on useTraceabilityStore.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { LinkTestCaseDialog } from "@/layout/traceability/TraceabilityDialogs";
import { useTraceabilityStore } from "@/stores/traceabilityStore";
import type { TestCase, TraceLink } from "@/types/traceability";

const TCS: TestCase[] = [
  { id: "TC_001", title: "Login with valid credentials" },
  { id: "TC_002", title: "Login lockout" },
  { id: "TC_003", title: "Password reset" },
  { id: "TC_004", title: "Session timeout" },
  { id: "TC_005", title: "Remember me" },
];

function resetStore() {
  useTraceabilityStore.setState({
    testCases: [],
    links: [],
    isDirty: false,
    loaded: false,
    loadError: false,
  });
}

function load(testCases: TestCase[] = TCS, links: TraceLink[] = []) {
  useTraceabilityStore.getState().load({ version: 1, testCases, links });
}

function renderDialog(reqId = "REQ_001", onClose = vi.fn()) {
  render(<LinkTestCaseDialog reqId={reqId} onClose={onClose} />);
  return onClose;
}

function checkboxes() {
  return screen.getAllByTestId("link-existing-tc-checkbox") as HTMLInputElement[];
}

function selectAllCheckbox() {
  return screen.getByTestId("link-select-all-checkbox") as HTMLInputElement;
}

describe("LinkTestCaseDialog — bulk selection", () => {
  beforeEach(resetStore);

  it("shows the visible-count header and a zero selected count initially", () => {
    load();
    renderDialog();
    expect(screen.getByTestId("link-existing-header")).toHaveTextContent("Existing Test Cases (5)");
    expect(screen.getByTestId("link-selected-count")).toHaveTextContent("Selected: 0");
    expect(screen.getByTestId("link-selected-btn")).toHaveTextContent("Link Selected");
    expect(screen.getByTestId("link-selected-btn")).toBeDisabled();
  });

  it("Select All checks every visible item and updates the header/button", () => {
    load();
    renderDialog();
    fireEvent.click(selectAllCheckbox());

    checkboxes().forEach((box) => expect(box.checked).toBe(true));
    expect(screen.getByTestId("link-selected-count")).toHaveTextContent("Selected: 5");
    expect(screen.getByTestId("link-selected-btn")).toHaveTextContent("Link Selected (5)");
    expect(screen.getByTestId("link-selected-btn")).not.toBeDisabled();
    expect(selectAllCheckbox().checked).toBe(true);
    expect(selectAllCheckbox().indeterminate).toBe(false);
  });

  it("Deselect All (clicking Select All again) clears every selection", () => {
    load();
    renderDialog();
    fireEvent.click(selectAllCheckbox());
    fireEvent.click(selectAllCheckbox());

    checkboxes().forEach((box) => expect(box.checked).toBe(false));
    expect(screen.getByTestId("link-selected-count")).toHaveTextContent("Selected: 0");
    expect(screen.getByTestId("link-selected-btn")).toBeDisabled();
    expect(selectAllCheckbox().checked).toBe(false);
  });

  it("shows an indeterminate Select All checkbox when only some items are checked", () => {
    load();
    renderDialog();
    fireEvent.click(checkboxes()[0]);

    expect(selectAllCheckbox().checked).toBe(false);
    expect(selectAllCheckbox().indeterminate).toBe(true);

    // Checking the rest clears the indeterminate state.
    checkboxes().slice(1).forEach((box) => fireEvent.click(box));
    expect(selectAllCheckbox().indeterminate).toBe(false);
    expect(selectAllCheckbox().checked).toBe(true);
  });

  it("clicking Select All while indeterminate selects everything", () => {
    load();
    renderDialog();
    fireEvent.click(checkboxes()[1]); // one item checked -> indeterminate
    fireEvent.click(selectAllCheckbox());

    checkboxes().forEach((box) => expect(box.checked).toBe(true));
    expect(screen.getByTestId("link-selected-count")).toHaveTextContent("Selected: 5");
  });

  it("Shift+Click selects the forward range from the anchor", () => {
    load();
    renderDialog();
    const boxes = checkboxes();
    fireEvent.click(boxes[0]); // anchor = TC_001
    fireEvent.click(boxes[3], { shiftKey: true }); // range TC_001..TC_004

    expect(boxes.map((b) => b.checked)).toEqual([true, true, true, true, false]);
    expect(screen.getByTestId("link-selected-count")).toHaveTextContent("Selected: 4");
  });

  it("Shift+Click selects the backward range from the anchor", () => {
    load();
    renderDialog();
    const boxes = checkboxes();
    fireEvent.click(boxes[4]); // anchor = TC_005
    fireEvent.click(boxes[1], { shiftKey: true }); // range TC_002..TC_005

    expect(boxes.map((b) => b.checked)).toEqual([false, true, true, true, true]);
    expect(screen.getByTestId("link-selected-count")).toHaveTextContent("Selected: 4");
  });

  it("Ctrl/Cmd+Click toggles a single item without clearing the existing selection", () => {
    load();
    renderDialog();
    const boxes = checkboxes();
    fireEvent.click(boxes[0]);
    fireEvent.click(boxes[2], { ctrlKey: true });

    expect(boxes.map((b) => b.checked)).toEqual([true, false, true, false, false]);
    expect(screen.getByTestId("link-selected-count")).toHaveTextContent("Selected: 2");

    // Cmd (metaKey) toggling the same item back off preserves the other selection.
    fireEvent.click(boxes[2], { metaKey: true });
    expect(boxes.map((b) => b.checked)).toEqual([true, false, false, false, false]);
  });

  it("Ctrl/Cmd+Click moves the anchor for subsequent Shift+Click ranges", () => {
    load();
    renderDialog();
    const boxes = checkboxes();
    fireEvent.click(boxes[0]); // anchor = TC_001
    fireEvent.click(boxes[3], { ctrlKey: true }); // toggles TC_004, anchor -> TC_004
    fireEvent.click(boxes[4], { shiftKey: true }); // range from new anchor TC_004..TC_005

    expect(boxes.map((b) => b.checked)).toEqual([true, false, false, true, true]);
  });

  it("mixes Shift and Ctrl/Cmd selections additively", () => {
    load();
    renderDialog();
    const boxes = checkboxes();
    fireEvent.click(boxes[0]); // anchor = TC_001, checked
    fireEvent.click(boxes[2], { shiftKey: true }); // range TC_001..TC_003
    fireEvent.click(boxes[4], { ctrlKey: true }); // + TC_005, anchor -> TC_005

    expect(boxes.map((b) => b.checked)).toEqual([true, true, true, false, true]);
    expect(screen.getByTestId("link-selected-count")).toHaveTextContent("Selected: 4");
  });

  it("normal click without modifiers behaves as a plain toggle", () => {
    load();
    renderDialog();
    const boxes = checkboxes();
    fireEvent.click(boxes[1]);
    expect(boxes[1].checked).toBe(true);
    fireEvent.click(boxes[1]);
    expect(boxes[1].checked).toBe(false);
  });

  it("Link Selected calls addLinks with the checked IDs and closes the dialog", () => {
    load();
    const onClose = renderDialog();
    fireEvent.click(selectAllCheckbox());
    fireEvent.click(screen.getByTestId("link-selected-btn"));

    expect(useTraceabilityStore.getState().links).toEqual(
      TCS.map((tc) => ({ tc: tc.id, req: "REQ_001" })),
    );
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("hides the existing-test-cases section and Select All entirely for an empty list", () => {
    load([], []);
    renderDialog();

    expect(screen.queryByTestId("link-existing-header")).toBeNull();
    expect(screen.queryByTestId("link-select-all-checkbox")).toBeNull();
    expect(screen.queryByTestId("link-existing-tc")).toBeNull();
    expect(screen.queryByTestId("link-selected-btn")).toBeNull();
  });

  it("Select All only affects visible (unlinked) test cases, leaving already-linked ones untouched", () => {
    // TC_001 is already linked to REQ_001, so only 4 remain visible/linkable.
    load(TCS, [{ tc: "TC_001", req: "REQ_001" }]);
    renderDialog();

    expect(screen.getByTestId("link-existing-header")).toHaveTextContent("Existing Test Cases (4)");
    const options = screen.getAllByTestId("link-existing-tc");
    expect(options.map((o) => within(o).getByRole("checkbox"))).toHaveLength(4);
    expect(screen.queryByText("Login with valid credentials")).toBeNull(); // TC_001 not listed

    fireEvent.click(selectAllCheckbox());
    fireEvent.click(screen.getByTestId("link-selected-btn"));

    // Only the 4 visible test cases were linked — TC_001 was never a candidate.
    expect(useTraceabilityStore.getState().links).toEqual([
      { tc: "TC_001", req: "REQ_001" },
      { tc: "TC_002", req: "REQ_001" },
      { tc: "TC_003", req: "REQ_001" },
      { tc: "TC_004", req: "REQ_001" },
      { tc: "TC_005", req: "REQ_001" },
    ]);
  });
});
