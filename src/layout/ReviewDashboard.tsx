import type { ReviewComment } from "@/types/reviewComment";
import type { RequirementRecord } from "@/editor/utils/requirementOps";
import { isSectionReviewTarget } from "@/editor/utils/sectionReviewOps";

// ── Types ─────────────────────────────────────────────────────────────────────

type SortKey = "id" | "open" | "lastUpdated" | "reqStatus";
type SortDir = "asc" | "desc";

export interface DashboardRow {
  /** Review target ID — either a requirement ID or a section review ID. */
  id: string;
  /** Section label from the requirement index, or "—" for section targets. */
  section: string;
  /** Requirement status id ("draft", "approved", "unknown", …), or null for section targets. */
  reqStatus: string | null;
  open: number;
  responded: number;
  closed: number;
  total: number;
  /** ISO timestamp of the most-recent comment action (create / respond / close). */
  lastUpdated: string;
  /** Absolute PM offset for editor navigation. Null for section targets not in the index. */
  pmPos: number | null;
}

// ── Pure helpers (exported for tests and ReviewsTab) ─────────────────────────

function latestTimestamp(comments: ReviewComment[]): string {
  let ts = "";
  for (const c of comments) {
    if (c.closedAt && c.closedAt > ts) ts = c.closedAt;
    if (c.respondedAt && c.respondedAt > ts) ts = c.respondedAt;
    if (c.createdAt > ts) ts = c.createdAt;
  }
  return ts;
}

export function buildDashboardRows(
  reviewComments: Record<string, ReviewComment[] | number | undefined>,
  requirementRecords: RequirementRecord[],
): DashboardRow[] {
  const reqMap = new Map<string, RequirementRecord>();
  for (const r of requirementRecords) reqMap.set(r.id, r);

  const rows: DashboardRow[] = [];
  for (const [targetId, val] of Object.entries(reviewComments)) {
    if (targetId.startsWith("_") || !Array.isArray(val) || val.length === 0) continue;
    const comments = val as ReviewComment[];
    const rec = reqMap.get(targetId);
    rows.push({
      id: targetId,
      section: rec?.section ?? "—",
      reqStatus: rec?.status ?? null,
      open: comments.filter((c) => c.status === "open").length,
      responded: comments.filter((c) => c.status === "responded").length,
      closed: comments.filter((c) => c.status === "closed").length,
      total: comments.length,
      lastUpdated: latestTimestamp(comments),
      pmPos: rec?.pmPos ?? null,
    });
  }
  return rows;
}

export function sortRows(rows: DashboardRow[], key: SortKey, dir: SortDir): DashboardRow[] {
  const sorted = [...rows].sort((a, b) => {
    let cmp = 0;
    switch (key) {
      case "id": {
        const numA = parseInt(a.id.match(/(\d+)$/)?.[1] ?? "0", 10);
        const numB = parseInt(b.id.match(/(\d+)$/)?.[1] ?? "0", 10);
        cmp = numA !== numB ? numA - numB : a.id.localeCompare(b.id);
        break;
      }
      case "open":
        cmp = a.open - b.open;
        break;
      case "lastUpdated":
        cmp = a.lastUpdated < b.lastUpdated ? -1 : a.lastUpdated > b.lastUpdated ? 1 : 0;
        break;
      case "reqStatus":
        cmp = (a.reqStatus ?? "").localeCompare(b.reqStatus ?? "");
        break;
    }
    return dir === "asc" ? cmp : -cmp;
  });
  return sorted;
}

export function filterRows(
  rows: DashboardRow[],
  opts: {
    reqStatus: string;
    commentStatus: string;
    type: string;
    hasOpen: boolean;
  },
): DashboardRow[] {
  return rows.filter((r) => {
    if (opts.hasOpen && r.open === 0) return false;
    if (opts.reqStatus !== "all" && r.reqStatus !== opts.reqStatus) return false;
    if (opts.commentStatus !== "all") {
      const cs = opts.commentStatus;
      if (cs === "open" && r.open === 0) return false;
      if (cs === "responded" && r.responded === 0) return false;
      if (cs === "closed" && r.closed === 0) return false;
    }
    if (opts.type !== "all") {
      const isSection = isSectionReviewTarget(r.id);
      if (opts.type === "requirement" && isSection) return false;
      if (opts.type === "section" && !isSection) return false;
    }
    return true;
  });
}
