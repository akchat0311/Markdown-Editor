/**
 * Tests for ReviewDashboard pure helper functions.
 *
 * Covers:
 * - buildDashboardRows: joins review comments with requirement index records
 * - sortRows: all four sort keys, both directions
 * - filterRows: all four filter dimensions
 *
 * Component-level tests for the Reviews tab and Dashboard live in dashboard.test.tsx.
 */
import { describe, it, expect } from "vitest";
import {
  buildDashboardRows,
  sortRows,
  filterRows,
} from "@/layout/ReviewDashboard";
import type { DashboardRow } from "@/layout/ReviewDashboard";
import type { ReviewComment } from "@/types/reviewComment";
import type { RequirementRecord } from "@/editor/utils/requirementOps";

// ── Factories ──────────────────────────────────────────────────────────────────

let commentCounter = 0;
function makeComment(overrides: Partial<ReviewComment> = {}): ReviewComment {
  commentCounter++;
  return {
    id: `c_${commentCounter}`,
    author: "Alice",
    text: `Comment ${commentCounter}`,
    createdAt: `2024-01-${String(commentCounter).padStart(2, "0")}T10:00:00Z`,
    status: "open",
    ...overrides,
  };
}

function makeRecord(id: string, overrides: Partial<RequirementRecord> = {}): RequirementRecord {
  return {
    id,
    status: "draft",
    section: "1. Introduction",
    pmPos: 42,
    ...overrides,
  };
}

function makeRow(overrides: Partial<DashboardRow> = {}): DashboardRow {
  return {
    id: "REQ_001",
    section: "1. Introduction",
    reqStatus: "draft",
    open: 1,
    responded: 0,
    closed: 0,
    total: 1,
    lastUpdated: "2024-01-01T10:00:00Z",
    pmPos: 42,
    ...overrides,
  };
}

// ── buildDashboardRows ────────────────────────────────────────────────────────

describe("buildDashboardRows — basic cases", () => {
  it("returns empty array when no comments", () => {
    expect(buildDashboardRows({}, [])).toHaveLength(0);
  });

  it("skips _version and other underscore keys", () => {
    const comments = { _version: 1 };
    expect(buildDashboardRows(comments, [])).toHaveLength(0);
  });

  it("skips targets with empty comment arrays", () => {
    const comments = { REQ_001: [] as ReviewComment[] };
    expect(buildDashboardRows(comments, [])).toHaveLength(0);
  });

  it("produces one row per non-empty target", () => {
    const comments = {
      REQ_001: [makeComment()],
      REQ_002: [makeComment(), makeComment()],
    };
    expect(buildDashboardRows(comments, [])).toHaveLength(2);
  });

  it("counts open/responded/closed correctly", () => {
    const comments = {
      REQ_001: [
        makeComment({ status: "open" }),
        makeComment({ status: "responded" }),
        makeComment({ status: "closed" }),
        makeComment({ status: "closed" }),
      ],
    };
    const [row] = buildDashboardRows(comments, []);
    expect(row.open).toBe(1);
    expect(row.responded).toBe(1);
    expect(row.closed).toBe(2);
    expect(row.total).toBe(4);
  });

  it("enriches row from matching requirement record", () => {
    const rec = makeRecord("REQ_001", { status: "approved", section: "2. Scope", pmPos: 100 });
    const comments = { REQ_001: [makeComment()] };
    const [row] = buildDashboardRows(comments, [rec]);
    expect(row.section).toBe("2. Scope");
    expect(row.reqStatus).toBe("approved");
    expect(row.pmPos).toBe(100);
  });

  it("uses null reqStatus and — section when no matching record", () => {
    const comments = { REQ_099: [makeComment()] };
    const [row] = buildDashboardRows(comments, []);
    expect(row.reqStatus).toBeNull();
    expect(row.section).toBe("—");
    expect(row.pmPos).toBeNull();
  });

  it("picks the latest timestamp from closedAt, respondedAt, createdAt", () => {
    const comments = {
      REQ_001: [
        makeComment({ createdAt: "2024-01-01T10:00:00Z", status: "closed", closedAt: "2024-03-15T12:00:00Z" }),
        makeComment({ createdAt: "2024-02-01T10:00:00Z", respondedAt: "2024-02-20T08:00:00Z", status: "responded" }),
      ],
    };
    const [row] = buildDashboardRows(comments, []);
    expect(row.lastUpdated).toBe("2024-03-15T12:00:00Z");
  });

  it("handles section review targets (section: prefix, no record match)", () => {
    const comments = { "section:2.1": [makeComment()] };
    const [row] = buildDashboardRows(comments, []);
    expect(row.id).toBe("section:2.1");
    expect(row.reqStatus).toBeNull();
    expect(row.pmPos).toBeNull();
  });
});

// ── sortRows ──────────────────────────────────────────────────────────────────

describe("sortRows", () => {
  const rows: DashboardRow[] = [
    makeRow({ id: "REQ_003", open: 2, lastUpdated: "2024-03-01T00:00:00Z", reqStatus: "draft" }),
    makeRow({ id: "REQ_001", open: 0, lastUpdated: "2024-01-01T00:00:00Z", reqStatus: "approved" }),
    makeRow({ id: "REQ_002", open: 5, lastUpdated: "2024-02-01T00:00:00Z", reqStatus: "in-review" }),
  ];

  it("sorts by id ascending (numeric suffix)", () => {
    const sorted = sortRows(rows, "id", "asc");
    expect(sorted.map((r) => r.id)).toEqual(["REQ_001", "REQ_002", "REQ_003"]);
  });

  it("sorts by id descending", () => {
    const sorted = sortRows(rows, "id", "desc");
    expect(sorted.map((r) => r.id)).toEqual(["REQ_003", "REQ_002", "REQ_001"]);
  });

  it("sorts by open ascending", () => {
    const sorted = sortRows(rows, "open", "asc");
    expect(sorted.map((r) => r.open)).toEqual([0, 2, 5]);
  });

  it("sorts by open descending", () => {
    const sorted = sortRows(rows, "open", "desc");
    expect(sorted.map((r) => r.open)).toEqual([5, 2, 0]);
  });

  it("sorts by lastUpdated ascending", () => {
    const sorted = sortRows(rows, "lastUpdated", "asc");
    expect(sorted.map((r) => r.lastUpdated)).toEqual([
      "2024-01-01T00:00:00Z",
      "2024-02-01T00:00:00Z",
      "2024-03-01T00:00:00Z",
    ]);
  });

  it("sorts by lastUpdated descending", () => {
    const sorted = sortRows(rows, "lastUpdated", "desc");
    expect(sorted[0].lastUpdated).toBe("2024-03-01T00:00:00Z");
  });

  it("sorts by reqStatus ascending (lexicographic)", () => {
    const sorted = sortRows(rows, "reqStatus", "asc");
    const statuses = sorted.map((r) => r.reqStatus);
    expect(statuses).toEqual([...statuses].sort());
  });

  it("does not mutate the original array", () => {
    const copy = [...rows];
    sortRows(rows, "open", "desc");
    expect(rows).toEqual(copy);
  });
});

// ── filterRows ────────────────────────────────────────────────────────────────

describe("filterRows", () => {
  const base = {
    reqStatus: "all",
    commentStatus: "all",
    type: "all",
    hasOpen: false,
  };

  const rows: DashboardRow[] = [
    makeRow({ id: "REQ_001", reqStatus: "draft",    open: 2, responded: 0, closed: 0, total: 2 }),
    makeRow({ id: "REQ_002", reqStatus: "approved", open: 0, responded: 1, closed: 0, total: 1 }),
    makeRow({ id: "REQ_003", reqStatus: "approved", open: 0, responded: 0, closed: 3, total: 3 }),
    makeRow({ id: "section:1.1", reqStatus: null,   open: 1, responded: 0, closed: 0, total: 1 }),
  ];

  it("returns all rows when no filters applied", () => {
    expect(filterRows(rows, base)).toHaveLength(4);
  });

  it("filters by reqStatus", () => {
    const result = filterRows(rows, { ...base, reqStatus: "approved" });
    expect(result.map((r) => r.id)).toEqual(["REQ_002", "REQ_003"]);
  });

  it("filters by reqStatus — null reqStatus rows are excluded when a status is active", () => {
    const result = filterRows(rows, { ...base, reqStatus: "draft" });
    expect(result.every((r) => r.reqStatus === "draft")).toBe(true);
  });

  it("hasOpen filter removes rows with no open comments", () => {
    const result = filterRows(rows, { ...base, hasOpen: true });
    expect(result.every((r) => r.open > 0)).toBe(true);
    expect(result).toHaveLength(2);
  });

  it("commentStatus=open removes rows without open comments", () => {
    const result = filterRows(rows, { ...base, commentStatus: "open" });
    expect(result.every((r) => r.open > 0)).toBe(true);
  });

  it("commentStatus=responded removes rows without responded comments", () => {
    const result = filterRows(rows, { ...base, commentStatus: "responded" });
    expect(result.every((r) => r.responded > 0)).toBe(true);
  });

  it("commentStatus=closed removes rows without closed comments", () => {
    const result = filterRows(rows, { ...base, commentStatus: "closed" });
    expect(result.every((r) => r.closed > 0)).toBe(true);
  });

  it("type=requirement excludes section targets", () => {
    const result = filterRows(rows, { ...base, type: "requirement" });
    expect(result.every((r) => !r.id.startsWith("section:"))).toBe(true);
  });

  it("type=section excludes requirement targets", () => {
    const result = filterRows(rows, { ...base, type: "section" });
    expect(result.every((r) => r.id.startsWith("section:"))).toBe(true);
  });

  it("combining hasOpen + type=requirement further narrows results", () => {
    const result = filterRows(rows, { ...base, hasOpen: true, type: "requirement" });
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("REQ_001");
  });
});
