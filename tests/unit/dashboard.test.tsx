/**
 * Tests for the unified Dashboard component (full-page workspace).
 *
 * Covers:
 * - Visibility (always mounted)
 * - Tab switching
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
    onNavigateToEditor: (pmPos: number) => void;
    onLoadReview: () => void;
    onSaveReview: () => void;
    onSaveReviewAs: () => void;
  }> = {},
) {
  return render(
    <Dashboard
      onNavigateToEditor={props.onNavigateToEditor ?? vi.fn()}
      onLoadReview={props.onLoadReview ?? vi.fn()}
      onSaveReview={props.onSaveReview ?? vi.fn()}
      onSaveReviewAs={props.onSaveReviewAs ?? vi.fn()}
    />,
  );
}

// ── Visibility ────────────────────────────────────────────────────────────────

describe("Dashboard — visibility", () => {
  beforeEach(resetStores);

  it("renders when mounted", () => {
    renderDashboard();
    expect(screen.getByRole("main")).toBeInTheDocument();
  });

  it("has the correct aria-label", () => {
    renderDashboard();
    expect(screen.getByRole("main")).toHaveAttribute("aria-label", "Dashboard");
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
    expect(screen.getByTestId("tab-quality")).toBeInTheDocument();
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

  it("switches to Quality tab on click", () => {
    renderDashboard();
    fireEvent.click(screen.getByTestId("tab-quality"));
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

// ── Quality tab ───────────────────────────────────────────────────────────────

describe("Dashboard — Quality tab", () => {
  beforeEach(resetStores);

  function goToInsights() {
    renderDashboard();
    fireEvent.click(screen.getByTestId("tab-quality"));
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

  it("renders category sections and rule sections when issues exist", () => {
    useValidationStore.setState({
      issues: [makeIssue({ severity: "error" }), makeIssue({ severity: "warning" })],
    });
    goToInsights();
    expect(screen.getAllByTestId("category-section").length).toBeGreaterThan(0);
    expect(screen.getAllByTestId("rule-section").length).toBeGreaterThan(0);
  });

  it("renders one row per affected requirement when rule is expanded", () => {
    useValidationStore.setState({
      issues: [makeIssue(), makeIssue(), makeIssue({ severity: "warning" })],
    });
    goToInsights();
    // Rules default to collapsed; expand the first rule to reveal requirement rows
    fireEvent.click(screen.getAllByTestId("rule-toggle")[0]);
    expect(screen.getAllByTestId("req-row")).toHaveLength(3);
  });
});

// ── Reviews tab ───────────────────────────────────────────────────────────────

describe("Dashboard — Reviews tab", () => {
  beforeEach(resetStores);

  function goToReviews() {
    renderDashboard();
    fireEvent.click(screen.getByTestId("tab-reviews"));
  }

  it("shows Review File section always", () => {
    goToReviews();
    expect(screen.getByTestId("review-file-section")).toBeInTheDocument();
  });

  it("shows 'No review file loaded' when not loaded", () => {
    goToReviews();
    expect(screen.getByTestId("review-file-status")).toHaveTextContent("No review file loaded");
  });

  it("shows Load Review button when not loaded", () => {
    goToReviews();
    expect(screen.getByTestId("load-review-btn")).toHaveTextContent("Load Review…");
  });

  it("shows Load Different button when loaded", () => {
    useReviewCommentsStore.setState({ comments: {}, loaded: true, isDirty: false });
    goToReviews();
    expect(screen.getByTestId("load-review-btn")).toHaveTextContent("Load Different…");
  });

  it("shows Save button when loaded and dirty", () => {
    useReviewCommentsStore.setState({ comments: {}, loaded: true, isDirty: true });
    goToReviews();
    expect(screen.getByTestId("save-review-btn")).toBeInTheDocument();
  });

  it("does not show Save button when not dirty", () => {
    useReviewCommentsStore.setState({ comments: {}, loaded: true, isDirty: false });
    goToReviews();
    expect(screen.queryByTestId("save-review-btn")).not.toBeInTheDocument();
  });

  it("shows Save As button when loaded", () => {
    useReviewCommentsStore.setState({ comments: {}, loaded: true, isDirty: false });
    goToReviews();
    expect(screen.getByTestId("save-review-as-btn")).toBeInTheDocument();
  });

  it("calls onLoadReview when Load Review button is clicked", () => {
    const onLoadReview = vi.fn();
    renderDashboard({ onLoadReview });
    fireEvent.click(screen.getByTestId("tab-reviews"));
    fireEvent.click(screen.getByTestId("load-review-btn"));
    expect(onLoadReview).toHaveBeenCalledOnce();
  });

  it("calls onSaveReview when Save button is clicked", () => {
    const onSaveReview = vi.fn();
    useReviewCommentsStore.setState({ comments: {}, loaded: true, isDirty: true });
    renderDashboard({ onSaveReview });
    fireEvent.click(screen.getByTestId("tab-reviews"));
    fireEvent.click(screen.getByTestId("save-review-btn"));
    expect(onSaveReview).toHaveBeenCalledOnce();
  });

  it("calls onSaveReviewAs when Save As button is clicked", () => {
    const onSaveReviewAs = vi.fn();
    useReviewCommentsStore.setState({ comments: {}, loaded: true, isDirty: false });
    renderDashboard({ onSaveReviewAs });
    fireEvent.click(screen.getByTestId("tab-reviews"));
    fireEvent.click(screen.getByTestId("save-review-as-btn"));
    expect(onSaveReviewAs).toHaveBeenCalledOnce();
  });

  it("shows Saved status when loaded and not dirty", () => {
    useReviewCommentsStore.setState({ comments: {}, loaded: true, isDirty: false });
    goToReviews();
    expect(screen.getByTestId("review-file-status")).toHaveTextContent("✓ Saved");
  });

  it("shows Modified status when loaded and dirty", () => {
    useReviewCommentsStore.setState({ comments: {}, loaded: true, isDirty: true });
    goToReviews();
    expect(screen.getByTestId("review-file-status")).toHaveTextContent("● Modified");
  });

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
