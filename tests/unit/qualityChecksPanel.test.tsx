/**
 * Tests for QualityChecksPanel.
 *
 * Covers:
 * - groupAndSortIssues pure helper (grouping + sorting)
 * - Empty state rendering
 * - Issue rendering (severity icons, targetId, message)
 * - Group section rendering (errors before warnings)
 * - Navigation callback invocation
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { groupAndSortIssues, QualityChecksPanel } from "@/layout/QualityChecksPanel";
import { useValidationStore } from "@/stores/validationStore";
import type { ValidationIssue } from "@/types/validation";

// ── Factories ──────────────────────────────────────────────────────────────────

let issueCounter = 0;
function issue(
  severity: "error" | "warning",
  type: string,
  targetId: string,
  message = `${type} on ${targetId}`,
): ValidationIssue {
  issueCounter++;
  return { id: `${type}-${issueCounter}-${targetId}`, severity, type, message, targetId };
}

function errorIssue(targetId: string, type = "duplicate-requirement-id") {
  return issue("error", type, targetId);
}
function warningIssue(targetId: string, type = "requirement-order") {
  return issue("warning", type, targetId);
}

// ── groupAndSortIssues ────────────────────────────────────────────────────────

describe("groupAndSortIssues — grouping", () => {
  it("returns empty groups for an empty list", () => {
    const { errors, warnings } = groupAndSortIssues([]);
    expect(errors).toHaveLength(0);
    expect(warnings).toHaveLength(0);
  });

  it("routes errors and warnings into separate groups", () => {
    const issues = [
      errorIssue("REQ_001"),
      warningIssue("REQ_002"),
      errorIssue("REQ_003"),
    ];
    const { errors, warnings } = groupAndSortIssues(issues);
    expect(errors).toHaveLength(2);
    expect(warnings).toHaveLength(1);
  });

  it("all-error input produces empty warnings group", () => {
    const issues = [errorIssue("REQ_001"), errorIssue("REQ_002")];
    const { errors, warnings } = groupAndSortIssues(issues);
    expect(errors).toHaveLength(2);
    expect(warnings).toHaveLength(0);
  });

  it("all-warning input produces empty errors group", () => {
    const issues = [warningIssue("REQ_001"), warningIssue("REQ_003")];
    const { errors, warnings } = groupAndSortIssues(issues);
    expect(errors).toHaveLength(0);
    expect(warnings).toHaveLength(2);
  });

  it("preserves all issue fields after grouping", () => {
    const src = errorIssue("REQ_005");
    const { errors } = groupAndSortIssues([src]);
    expect(errors[0]).toEqual(src);
  });
});

describe("groupAndSortIssues — sorting within groups", () => {
  it("sorts errors by ascending numeric suffix of targetId", () => {
    const issues = [errorIssue("REQ_010"), errorIssue("REQ_001"), errorIssue("REQ_005")];
    const { errors } = groupAndSortIssues(issues);
    expect(errors.map((e) => e.targetId)).toEqual(["REQ_010", "REQ_001", "REQ_005"]
      .sort((a, b) => parseInt(a.match(/(\d+)$/)![1]) - parseInt(b.match(/(\d+)$/)![1])));
  });

  it("sorts warnings by ascending numeric suffix of targetId", () => {
    const issues = [warningIssue("REQ_030"), warningIssue("REQ_002"), warningIssue("REQ_015")];
    const { warnings } = groupAndSortIssues(issues);
    expect(warnings.map((w) => w.targetId)).toEqual(["REQ_002", "REQ_015", "REQ_030"]);
  });

  it("issues without targetId are sorted to the end", () => {
    const noTarget: ValidationIssue = { id: "no-target", severity: "warning", type: "x", message: "m" };
    const withTarget = warningIssue("REQ_001");
    const { warnings } = groupAndSortIssues([noTarget, withTarget]);
    expect(warnings[0].targetId).toBe("REQ_001");
    expect(warnings[1].targetId).toBeUndefined();
  });

  it("maintains stable grouping across mixed severities", () => {
    const issues = [
      warningIssue("REQ_010"),
      errorIssue("REQ_005"),
      warningIssue("REQ_001"),
      errorIssue("REQ_003"),
    ];
    const { errors, warnings } = groupAndSortIssues(issues);
    expect(errors.map((e) => e.targetId)).toEqual(["REQ_003", "REQ_005"]);
    expect(warnings.map((w) => w.targetId)).toEqual(["REQ_001", "REQ_010"]);
  });

  it("handles non-standard prefixes (SRS-001, FR001, etc.)", () => {
    const issues = [
      issue("warning", "req-order", "SRS-010"),
      issue("warning", "req-order", "SRS-001"),
    ];
    const { warnings } = groupAndSortIssues(issues);
    expect(warnings.map((w) => w.targetId)).toEqual(["SRS-001", "SRS-010"]);
  });

  it("is idempotent — calling twice gives the same result", () => {
    const issues = [warningIssue("REQ_003"), warningIssue("REQ_001"), warningIssue("REQ_002")];
    const first = groupAndSortIssues(issues);
    const second = groupAndSortIssues(issues);
    expect(first.warnings.map((w) => w.targetId)).toEqual(
      second.warnings.map((w) => w.targetId),
    );
  });
});

// ── Panel component tests ──────────────────────────────────────────────────────

function resetStore() {
  useValidationStore.setState({ issues: [] });
}

function renderPanel(
  props: Partial<{ open: boolean; onClose: () => void; onNavigate: (id: string) => void }> = {},
) {
  const onClose = props.onClose ?? vi.fn();
  const onNavigate = props.onNavigate ?? vi.fn();
  const open = props.open ?? true;
  return render(
    <QualityChecksPanel open={open} onClose={onClose} onNavigate={onNavigate} />,
  );
}

describe("QualityChecksPanel — empty state", () => {
  beforeEach(resetStore);

  it("renders nothing when open=false", () => {
    renderPanel({ open: false });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("renders the dialog when open=true and store is empty", () => {
    renderPanel();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("shows the empty-state message when there are no issues", () => {
    renderPanel();
    expect(screen.getByTestId("empty-state")).toBeInTheDocument();
    expect(screen.getByText("No quality issues found")).toBeInTheDocument();
  });

  it("does not show error or warning sections when store is empty", () => {
    renderPanel();
    expect(screen.queryByTestId("errors-section")).toBeNull();
    expect(screen.queryByTestId("warnings-section")).toBeNull();
  });

  it("does not show the issue count badge when there are no issues", () => {
    renderPanel();
    expect(screen.queryByTestId("issue-count-badge")).toBeNull();
  });
});

describe("QualityChecksPanel — issue rendering", () => {
  beforeEach(resetStore);

  it("renders one row per issue", () => {
    useValidationStore.setState({
      issues: [errorIssue("REQ_001"), warningIssue("REQ_002")],
    });
    renderPanel();
    expect(screen.getAllByTestId("issue-row")).toHaveLength(2);
  });

  it("shows the targetId in each row", () => {
    useValidationStore.setState({ issues: [errorIssue("REQ_007")] });
    renderPanel();
    expect(screen.getByTestId("issue-target-id")).toHaveTextContent("REQ_007");
  });

  it("shows the message in each row", () => {
    const msg = "REQ_007 appears after REQ_010 but has a lower numeric ID.";
    useValidationStore.setState({
      issues: [{ id: "x", severity: "warning", type: "req-order", message: msg, targetId: "REQ_007" }],
    });
    renderPanel();
    expect(screen.getByTestId("issue-message")).toHaveTextContent(msg);
  });

  it("shows the issue count badge equal to total number of issues", () => {
    useValidationStore.setState({
      issues: [errorIssue("REQ_001"), warningIssue("REQ_002"), warningIssue("REQ_003")],
    });
    renderPanel();
    expect(screen.getByTestId("issue-count-badge")).toHaveTextContent("3");
  });

  it("does not show empty-state message when issues exist", () => {
    useValidationStore.setState({ issues: [errorIssue("REQ_001")] });
    renderPanel();
    expect(screen.queryByTestId("empty-state")).toBeNull();
  });
});

describe("QualityChecksPanel — grouping", () => {
  beforeEach(resetStore);

  it("renders an Errors section when there are error issues", () => {
    useValidationStore.setState({ issues: [errorIssue("REQ_001")] });
    renderPanel();
    expect(screen.getByTestId("errors-section")).toBeInTheDocument();
  });

  it("renders a Warnings section when there are warning issues", () => {
    useValidationStore.setState({ issues: [warningIssue("REQ_001")] });
    renderPanel();
    expect(screen.getByTestId("warnings-section")).toBeInTheDocument();
  });

  it("renders Errors section before Warnings section in the DOM", () => {
    useValidationStore.setState({
      issues: [errorIssue("REQ_001"), warningIssue("REQ_002")],
    });
    renderPanel();
    const errorsSection = screen.getByTestId("errors-section");
    const warningsSection = screen.getByTestId("warnings-section");
    // compareDocumentPosition: 4 = following (errors before warnings)
    expect(errorsSection.compareDocumentPosition(warningsSection)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
  });

  it("does not render Errors section when there are no errors", () => {
    useValidationStore.setState({ issues: [warningIssue("REQ_001")] });
    renderPanel();
    expect(screen.queryByTestId("errors-section")).toBeNull();
  });

  it("does not render Warnings section when there are no warnings", () => {
    useValidationStore.setState({ issues: [errorIssue("REQ_001")] });
    renderPanel();
    expect(screen.queryByTestId("warnings-section")).toBeNull();
  });
});

describe("QualityChecksPanel — navigation callback", () => {
  beforeEach(resetStore);

  it("calls onNavigate with the targetId when a row is clicked", () => {
    const onNavigate = vi.fn();
    useValidationStore.setState({ issues: [errorIssue("REQ_005")] });
    renderPanel({ onNavigate });
    fireEvent.click(screen.getByTestId("issue-row"));
    expect(onNavigate).toHaveBeenCalledWith("REQ_005");
  });

  it("calls onClose after clicking a row", () => {
    const onClose = vi.fn();
    useValidationStore.setState({ issues: [warningIssue("REQ_003")] });
    renderPanel({ onClose });
    fireEvent.click(screen.getByTestId("issue-row"));
    expect(onClose).toHaveBeenCalled();
  });

  it("calls onClose without calling onNavigate when issue has no targetId", () => {
    const onNavigate = vi.fn();
    const onClose = vi.fn();
    useValidationStore.setState({
      issues: [{ id: "x", severity: "warning", type: "x", message: "no target" }],
    });
    renderPanel({ onNavigate, onClose });
    fireEvent.click(screen.getByTestId("issue-row"));
    expect(onNavigate).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it("calls onNavigate once per click, with the correct id, for multiple rows", () => {
    const onNavigate = vi.fn();
    useValidationStore.setState({
      issues: [errorIssue("REQ_001"), warningIssue("REQ_002")],
    });
    renderPanel({ onNavigate });
    const rows = screen.getAllByTestId("issue-row");
    // Click second row (warnings are sorted, so REQ_001 error is first, REQ_002 warning is second)
    fireEvent.click(rows[1]);
    expect(onNavigate).toHaveBeenCalledTimes(1);
    expect(onNavigate).toHaveBeenCalledWith("REQ_002");
  });

  it("closes on Escape key", () => {
    const onClose = vi.fn();
    useValidationStore.setState({ issues: [warningIssue("REQ_001")] });
    renderPanel({ onClose });
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });

  it("closes when clicking the backdrop", () => {
    const onClose = vi.fn();
    useValidationStore.setState({ issues: [warningIssue("REQ_001")] });
    renderPanel({ onClose });
    // The backdrop is the outermost dialog wrapper
    const dialog = screen.getByRole("dialog");
    fireEvent.mouseDown(dialog);
    expect(onClose).toHaveBeenCalled();
  });

  it("calls onClose when the × button is clicked", () => {
    const onClose = vi.fn();
    useValidationStore.setState({ issues: [errorIssue("REQ_001")] });
    renderPanel({ onClose });
    fireEvent.click(screen.getByRole("button", { name: "Close Quality Checks" }));
    expect(onClose).toHaveBeenCalled();
  });
});
