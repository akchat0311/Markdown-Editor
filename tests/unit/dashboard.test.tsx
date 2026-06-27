/**
 * Tests for the unified Dashboard component.
 *
 * Covers:
 * - Visibility (open/closed)
 * - Tab switching
 * - Escape and backdrop close
 * - Insights tab content (issue rendering, empty state)
 * - Reviews tab content (overview cards, table, filters)
 * - Overview tab (stat cards, needs-attention section)
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Dashboard } from "@/layout/Dashboard";
import { useReviewCommentsStore } from "@/stores/reviewCommentsStore";
import { useStatusConfigStore } from "@/stores/statusConfigStore";
import { useValidationStore } from "@/stores/validationStore";
import { useConfigStore } from "@/stores/configStore";
import type { ReviewComment } from "@/types/reviewComment";
import type { ValidationIssue } from "@/types/validation";

// ── Factories ──────────────────────────────────────────────────────────────────

let commentCounter = 0;
function makeComment(overrides: Partial<ReviewComment> = {}): ReviewComment {
  commentCounter++;
  return {
    id: `c_${commentCounter}`,
    author: "Alice",
    text: `Comment ${commentCounter}`,
    createdAt: `2024-01-${String(commentCounter % 28 + 1).padStart(2, "0")}T10:00:00Z`,
    status: "open",
    ...overrides,
  };
}

let issueCounter = 0;
function makeIssue(overrides: Partial<ValidationIssue> = {}): ValidationIssue {
  issueCounter++;
  return {
    id: `issue-${issueCounter}`,
    severity: "error",
    type: "duplicate-requirement-id",
    message: `Error ${issueCounter}`,
    targetId: `REQ_00${issueCounter}`,
    ...overrides,
  };
}

// ── Store reset ────────────────────────────────────────────────────────────────

function resetStores() {
  useReviewCommentsStore.setState({ comments: {}, isDirty: false, loaded: false });
  useStatusConfigStore.setState({ statuses: [] });
  useValidationStore.setState({ issues: [] });
  useConfigStore.setState({ requirementPattern: null });
}

// ── Render helper ─────────────────────────────────────────────────────────────

function renderDashboard(
  props: Partial<{
    open: boolean;
    onClose: () => void;
    onLoadReview: () => void;
    onSaveReview: () => void;
    onSaveReviewAs: () => void;
  }> = {},
) {
  const open = props.open ?? true;
  const onClose = props.onClose ?? vi.fn();
  return render(
    <Dashboard
      open={open}
      onClose={onClose}
      onLoadReview={props.onLoadReview ?? vi.fn()}
      onSaveReview={props.onSaveReview ?? vi.fn()}
      onSaveReviewAs={props.onSaveReviewAs ?? vi.fn()}
    />,
  );
}

// ── Visibility ────────────────────────────────────────────────────────────────

describe("Dashboard — visibility", () => {
  beforeEach(resetStores);

  it("renders nothing when open=false", () => {
    renderDashboard({ open: false });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("renders the dialog when open=true", () => {
    renderDashboard();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("has the correct aria-label", () => {
    renderDashboard();
    expect(screen.getByRole("dialog")).toHaveAttribute("aria-label", "Dashboard");
  });
});

// ── Tab bar ────────────────────────────────────────────────────────────────────

describe("Dashboard — tab bar", () => {
  beforeEach(resetStores);

  it("renders all four tabs", () => {
    renderDashboard();
    expect(screen.getByTestId("tab-overview")).toBeInTheDocument();
    expect(screen.getByTestId("tab-requirements")).toBeInTheDocument();
    expect(screen.getByTestId("tab-reviews")).toBeInTheDocument();
    expect(screen.getByTestId("tab-insights")).toBeInTheDocument();
  });

  it("defaults to the Overview tab", () => {
    renderDashboard();
    expect(screen.getByTestId("overview-tab")).toBeInTheDocument();
  });

  it("switches to Requirements tab on click", () => {
    renderDashboard();
    fireEvent.click(screen.getByTestId("tab-requirements"));
    expect(screen.getByTestId("requirements-tab")).toBeInTheDocument();
  });

  it("switches to Reviews tab on click", () => {
    renderDashboard();
    fireEvent.click(screen.getByTestId("tab-reviews"));
    expect(screen.getByTestId("reviews-tab")).toBeInTheDocument();
  });

  it("switches to Insights tab on click", () => {
    renderDashboard();
    fireEvent.click(screen.getByTestId("tab-insights"));
    expect(screen.getByTestId("insights-content")).toBeInTheDocument();
  });

  it("only renders one tab's content at a time", () => {
    renderDashboard();
    // Overview is default — Requirements content not mounted yet
    expect(screen.queryByTestId("requirements-tab")).toBeNull();
    fireEvent.click(screen.getByTestId("tab-requirements"));
    expect(screen.queryByTestId("overview-tab")).toBeNull();
    expect(screen.getByTestId("requirements-tab")).toBeInTheDocument();
  });
});

// ── Close behaviours ──────────────────────────────────────────────────────────

describe("Dashboard — close behaviours", () => {
  beforeEach(resetStores);

  it("calls onClose when × button is clicked", () => {
    const onClose = vi.fn();
    renderDashboard({ onClose });
    fireEvent.click(screen.getByRole("button", { name: "Close Dashboard" }));
    expect(onClose).toHaveBeenCalled();
  });

  it("calls onClose on Escape key", () => {
    const onClose = vi.fn();
    renderDashboard({ onClose });
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });

  it("calls onClose on backdrop mousedown", () => {
    const onClose = vi.fn();
    renderDashboard({ onClose });
    const dialog = screen.getByRole("dialog");
    fireEvent.mouseDown(dialog);
    expect(onClose).toHaveBeenCalled();
  });

  it("does not call onClose when clicking inside the dialog content", () => {
    const onClose = vi.fn();
    renderDashboard({ onClose });
    // Click a tab button — should not close
    fireEvent.click(screen.getByTestId("tab-requirements"));
    expect(onClose).not.toHaveBeenCalled();
  });
});

// ── Insights tab ──────────────────────────────────────────────────────────────

describe("Dashboard — Insights tab", () => {
  beforeEach(resetStores);

  function goToInsights() {
    renderDashboard();
    fireEvent.click(screen.getByTestId("tab-insights"));
  }

  it("shows empty state when no issues", () => {
    goToInsights();
    expect(screen.getByTestId("empty-state")).toBeInTheDocument();
    expect(screen.getByText("No quality issues found")).toBeInTheDocument();
  });

  it("shows issue count badge when there are issues", () => {
    useValidationStore.setState({ issues: [makeIssue(), makeIssue({ severity: "warning" })] });
    goToInsights();
    expect(screen.getByTestId("issue-count-badge")).toHaveTextContent("2");
  });

  it("renders error and warning sections", () => {
    useValidationStore.setState({
      issues: [makeIssue({ severity: "error" }), makeIssue({ severity: "warning" })],
    });
    goToInsights();
    expect(screen.getByTestId("errors-section")).toBeInTheDocument();
    expect(screen.getByTestId("warnings-section")).toBeInTheDocument();
  });

  it("renders one issue row per issue", () => {
    useValidationStore.setState({
      issues: [makeIssue(), makeIssue(), makeIssue({ severity: "warning" })],
    });
    goToInsights();
    expect(screen.getAllByTestId("issue-row")).toHaveLength(3);
  });
});

// ── Reviews tab ───────────────────────────────────────────────────────────────

describe("Dashboard — Reviews tab", () => {
  beforeEach(resetStores);

  function goToReviews() {
    renderDashboard();
    fireEvent.click(screen.getByTestId("tab-reviews"));
  }

  it("shows empty state when no review comments", () => {
    goToReviews();
    expect(screen.getByTestId("empty-state")).toBeInTheDocument();
  });

  it("shows overview cards when comments exist", () => {
    useReviewCommentsStore.setState({
      comments: {
        REQ_001: [makeComment({ status: "open" }), makeComment({ status: "closed" })],
      },
      loaded: true,
      isDirty: false,
    });
    goToReviews();
    expect(screen.getByTestId("overview-cards")).toBeInTheDocument();
  });

  it("shows correct total in card-total", () => {
    useReviewCommentsStore.setState({
      comments: {
        REQ_001: [makeComment(), makeComment()],
        REQ_002: [makeComment()],
      },
      loaded: true,
      isDirty: false,
    });
    goToReviews();
    expect(screen.getByTestId("card-total")).toHaveTextContent("3");
  });

  it("shows the activity table when comments exist", () => {
    useReviewCommentsStore.setState({
      comments: { REQ_001: [makeComment()] },
      loaded: true,
      isDirty: false,
    });
    goToReviews();
    expect(screen.getByTestId("activity-table")).toBeInTheDocument();
    expect(screen.getAllByTestId("dashboard-row")).toHaveLength(1);
  });

  it("shows Export CSV button when comments exist", () => {
    useReviewCommentsStore.setState({
      comments: { REQ_001: [makeComment()] },
      loaded: true,
      isDirty: false,
    });
    goToReviews();
    expect(screen.getByTestId("export-csv-btn")).toBeInTheDocument();
  });

  it("type filter hides section targets when set to requirement", () => {
    useReviewCommentsStore.setState({
      comments: {
        REQ_001: [makeComment()],
        "section:1.1": [makeComment()],
      },
      loaded: true,
      isDirty: false,
    });
    goToReviews();
    const select = screen.getByTestId("type-filter");
    fireEvent.change(select, { target: { value: "requirement" } });
    const rows = screen.getAllByTestId("dashboard-row");
    expect(rows.every((r) => !r.textContent?.includes("section:"))).toBe(true);
  });

  it("sort buttons toggle sort direction on second click", () => {
    useReviewCommentsStore.setState({
      comments: {
        REQ_003: [makeComment({ status: "open" }), makeComment({ status: "open" })],
        REQ_001: [makeComment({ status: "closed" })],
      },
      loaded: true,
      isDirty: false,
    });
    goToReviews();
    // Default sort is id asc → REQ_001 first
    const rows = screen.getAllByTestId("dashboard-row");
    expect(rows[0].textContent).toContain("REQ_001");
    // Click sort-open → asc (0 open first)
    fireEvent.click(screen.getByTestId("sort-open"));
    const rows2 = screen.getAllByTestId("dashboard-row");
    expect(rows2[0].textContent).toContain("REQ_001"); // 0 open = first
    // Click again → desc (2 open first)
    fireEvent.click(screen.getByTestId("sort-open"));
    const rows3 = screen.getAllByTestId("dashboard-row");
    expect(rows3[0].textContent).toContain("REQ_003");
  });
});

// ── Overview tab ──────────────────────────────────────────────────────────────

describe("Dashboard — Overview tab", () => {
  beforeEach(resetStores);

  it("shows the stat grid", () => {
    renderDashboard();
    expect(screen.getByTestId("stat-grid")).toBeInTheDocument();
  });

  it("shows stat-requirements card", () => {
    renderDashboard();
    expect(screen.getByTestId("stat-requirements")).toBeInTheDocument();
  });

  it("shows stat-comments card with 0 when no comments", () => {
    renderDashboard();
    expect(screen.getByTestId("stat-comments")).toHaveTextContent("0");
  });

  it("shows stat-issues with correct count", () => {
    useValidationStore.setState({ issues: [makeIssue(), makeIssue()] });
    renderDashboard();
    expect(screen.getByTestId("stat-issues")).toHaveTextContent("2");
  });

  it("shows stat-comments card with correct count when comments exist", () => {
    useReviewCommentsStore.setState({
      comments: {
        REQ_001: [makeComment(), makeComment()],
        REQ_002: [makeComment()],
      },
      loaded: true,
      isDirty: false,
    });
    renderDashboard();
    expect(screen.getByTestId("stat-comments")).toHaveTextContent("3");
  });

  it("shows open/pending/closed breakdown when comments exist", () => {
    useReviewCommentsStore.setState({
      comments: {
        REQ_001: [
          makeComment({ status: "open" }),
          makeComment({ status: "responded" }),
          makeComment({ status: "closed" }),
        ],
      },
      loaded: true,
      isDirty: false,
    });
    renderDashboard();
    expect(screen.getByTestId("stat-open")).toHaveTextContent("1");
    expect(screen.getByTestId("stat-pending")).toHaveTextContent("1");
    expect(screen.getByTestId("stat-closed")).toHaveTextContent("1");
  });

  it("shows the needs-attention section", () => {
    renderDashboard();
    expect(screen.getByTestId("needs-attention")).toBeInTheDocument();
  });

  it("shows all-clear when no issues and no open comments", () => {
    renderDashboard();
    expect(screen.getByTestId("all-clear")).toBeInTheDocument();
  });

  it("shows attention items when open comments exist", () => {
    useReviewCommentsStore.setState({
      comments: { REQ_001: [makeComment({ status: "open" })] },
      loaded: true,
      isDirty: false,
    });
    renderDashboard();
    expect(screen.queryByTestId("all-clear")).not.toBeInTheDocument();
    expect(screen.getAllByTestId("attention-item").length).toBeGreaterThan(0);
  });

  it("shows attention item for validation errors", () => {
    useValidationStore.setState({ issues: [makeIssue({ severity: "error" })] });
    renderDashboard();
    expect(screen.getAllByTestId("attention-item").some((el) =>
      el.textContent?.includes("validation error"),
    )).toBe(true);
  });

  it("clicking a stat card switches to the relevant tab", () => {
    useValidationStore.setState({ issues: [makeIssue()] });
    renderDashboard();
    // stat-issues card should switch to Insights
    fireEvent.click(screen.getByTestId("stat-issues"));
    expect(screen.getByTestId("insights-content")).toBeInTheDocument();
  });

  it("clicking an attention item View button switches to the relevant tab", () => {
    useReviewCommentsStore.setState({
      comments: { REQ_001: [makeComment({ status: "open" })] },
      loaded: true,
      isDirty: false,
    });
    renderDashboard();
    // Find first attention item's View button and click it
    const viewBtn = screen.getAllByText("View →")[0];
    fireEvent.click(viewBtn);
    // Should switch to reviews tab
    expect(screen.getByTestId("reviews-tab")).toBeInTheDocument();
  });
});
