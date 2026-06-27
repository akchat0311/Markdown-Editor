import { useMemo } from "react";
import { useReviewCommentsStore } from "@/stores/reviewCommentsStore";
import type { ReviewComment } from "@/types/reviewComment";

export interface CommentDetail {
  total: number;
  open: number;
  responded: number;
  closed: number;
}

/**
 * Derives per-target comment counts from the review comments store.
 *
 * Returns a Record keyed by target ID (requirement ID or section review ID).
 * Only targets with at least one comment are included.
 *
 * This is the shared source of truth for comment counts — both RequirementsTab
 * and OverviewTab use it. ReviewsTab uses buildDashboardRows() from
 * ReviewDashboard.ts which performs a similar but richer derivation that also
 * computes lastUpdated timestamps for sorting.
 */
export function useCommentDetails(): Record<string, CommentDetail> {
  const comments = useReviewCommentsStore((s) => s.comments);
  return useMemo(() => {
    const details: Record<string, CommentDetail> = {};
    for (const [targetId, val] of Object.entries(comments)) {
      if (targetId.startsWith("_") || !Array.isArray(val)) continue;
      const arr = val as ReviewComment[];
      if (arr.length === 0) continue;
      details[targetId] = {
        total: arr.length,
        open:      arr.filter((c) => c.status === "open").length,
        responded: arr.filter((c) => c.status === "responded").length,
        closed:    arr.filter((c) => c.status === "closed").length,
      };
    }
    return details;
  }, [comments]);
}
