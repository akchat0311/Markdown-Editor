import type { CommentStatus } from "@/types/reviewComment";

// Single source of truth for review comment status colors.
// Open = red, Responded/Pending = amber, Closed = green.
export const REVIEW_STATUS_CHIP_CLS: Record<CommentStatus, string> = {
  open:      "bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-400",
  responded: "bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400",
  closed:    "bg-green-100 text-green-700 dark:bg-green-950/40 dark:text-green-400",
};

// Selected (active/pressed) variant — solid background.
export const REVIEW_STATUS_SELECTED_CLS: Record<CommentStatus, string> = {
  open:      "bg-red-600 text-white",
  responded: "bg-amber-600 text-white",
  closed:    "bg-green-600 text-white",
};

// Hover variant — slightly darker background for interactive chips.
export const REVIEW_STATUS_HOVER_CLS: Record<CommentStatus, string> = {
  open:      "hover:bg-red-200 dark:hover:bg-red-950/60",
  responded: "hover:bg-amber-200 dark:hover:bg-amber-950/60",
  closed:    "hover:bg-green-200 dark:hover:bg-green-950/60",
};
