import type { JSONContent } from "@tiptap/core";
import type { OutlineNode } from "@/types/outline";
import type { RequirementStatus } from "@/types/requirementStatus";
import type { ReviewFile, ReviewComment } from "@/types/reviewComment";
import {
  analyzeRequirements,
  extractStatusText,
} from "@/editor/utils/requirementOps";
import type { RequirementPatternInput } from "@/editor/utils/requirementOps";
import { getNodeSectionRange } from "@/editor/utils/outlineOps";
import { resolveRequirementStatus } from "@/services/requirementStatusService";
import {
  extractSectionNumber,
  sectionReviewId,
  isSectionReviewTarget,
} from "@/editor/utils/sectionReviewOps";
import { assembleCsv } from "@/services/csvUtils";

// ── Row model ─────────────────────────────────────────────────────────────────
// One row per review comment. Future export formats (Excel, HTML, PDF) should
// consume ReviewExportRow[] directly so only generateReviewCsv() changes.

export interface ReviewExportRow {
  document: string;
  requirementId: string;
  requirementStatus: string;
  requirementText: string;
  commentId: string;
  commentState: string;
  commentText: string;
  author: string;
  createdAt: string;
  responseText: string;
  respondedBy: string;
  respondedAt: string;
  closedBy: string;
  closedAt: string;
}

// ── Text extraction from JSONContent ─────────────────────────────────────────

const BLOCK_TYPES = new Set([
  "paragraph", "heading", "blockquote", "callout",
  "listItem", "taskItem", "codeBlock",
]);

function extractText(node: JSONContent): string {
  if (node.type === "hardBreak") return "\n";
  if (typeof node.text === "string") return node.text;
  if (!node.content?.length) return "";
  const inner = (node.content as JSONContent[]).map(extractText).join("");
  return BLOCK_TYPES.has(node.type ?? "") ? inner + "\n" : inner;
}

function sectionBodyText(docContent: JSONContent[], nodeIndex: number, level: number): string {
  const [from, to] = getNodeSectionRange(docContent, nodeIndex, level);
  return docContent
    .slice(from + 1, to)
    .map(extractText)
    .join("")
    .trim();
}

// ── Data assembly ─────────────────────────────────────────────────────────────

/**
 * Joins requirement metadata (from the live document outline) with review
 * comments (from the store).  Returns one row per comment.
 *
 * @param flat        Flattened outline from flattenOutline(deriveOutline(editor)).
 * @param docContent  editor.state.doc.content.toJSON() as JSONContent[].
 * @param documentName  File name used in the "Document" column.
 * @param pattern     User's requirement pattern (simple example string, or a
 *                    full RequirementPattern config — simple or regex mode).
 * @param statuses    Loaded status definitions for label resolution.
 * @param commentsData  reviewCommentsStore.getState().comments.
 */
export function collectReviewExportRows(
  flat: OutlineNode[],
  docContent: JSONContent[],
  documentName: string,
  pattern: RequirementPatternInput,
  statuses: RequirementStatus[],
  commentsData: ReviewFile,
): ReviewExportRow[] {
  // Build requirement metadata lookup: reqId → { statusLabel, bodyText }
  const reqMeta = new Map<string, { statusLabel: string; bodyText: string }>();

  if (pattern) {
    const analysis = analyzeRequirements(flat, docContent, pattern);
    if (analysis) {
      for (const entry of analysis.requirements) {
        const rawStatus = extractStatusText(entry.node.label);
        const statusId = rawStatus
          ? resolveRequirementStatus(rawStatus, statuses)
          : "unknown";
        const statusLabel =
          statuses.find((s) => s.id === statusId)?.label ?? rawStatus ?? "";

        reqMeta.set(entry.id, {
          statusLabel,
          bodyText: sectionBodyText(docContent, entry.node.index, entry.node.level ?? 1),
        });
      }
    }
  }

  // Build section metadata lookup: sectionReviewId → heading text as title.
  // First occurrence wins when duplicate section numbers exist.
  const sectionMeta = new Map<string, { bodyText: string }>();
  for (const node of flat) {
    const sectionNum = extractSectionNumber(node.label);
    if (!sectionNum) continue;
    const targetId = sectionReviewId(sectionNum);
    if (!sectionMeta.has(targetId)) {
      sectionMeta.set(targetId, { bodyText: node.label });
    }
  }

  const rows: ReviewExportRow[] = [];

  for (const [reqId, value] of Object.entries(commentsData)) {
    if (reqId.startsWith("_")) continue;
    if (!Array.isArray(value)) continue;

    const meta = isSectionReviewTarget(reqId)
      ? sectionMeta.get(reqId)
        ? { statusLabel: "", bodyText: sectionMeta.get(reqId)!.bodyText }
        : undefined
      : reqMeta.get(reqId);
    const comments = value as ReviewComment[];

    for (const comment of comments) {
      const state =
        comment.status === "open"
          ? "Open"
          : comment.status === "responded"
            ? "Responded"
            : "Closed";

      rows.push({
        document: documentName,
        requirementId: reqId,
        requirementStatus: meta?.statusLabel ?? "",
        requirementText: meta?.bodyText ?? "",
        commentId: comment.id,
        commentState: state,
        commentText: comment.text,
        author: comment.author,
        createdAt: comment.createdAt,
        responseText: comment.response ?? "",
        respondedBy: comment.respondedBy ?? "",
        respondedAt: comment.respondedAt ?? "",
        closedBy: comment.closedBy ?? "",
        closedAt: comment.closedAt ?? "",
      });
    }
  }

  return rows;
}

// ── CSV generation ────────────────────────────────────────────────────────────

const CSV_HEADERS: Array<keyof ReviewExportRow> = [
  "document",
  "requirementId",
  "requirementStatus",
  "requirementText",
  "commentId",
  "commentState",
  "commentText",
  "author",
  "createdAt",
  "responseText",
  "respondedBy",
  "respondedAt",
  "closedBy",
  "closedAt",
];

const CSV_HEADER_LABELS: Record<keyof ReviewExportRow, string> = {
  document: "Document",
  requirementId: "Requirement ID",
  requirementStatus: "Requirement Status",
  requirementText: "Requirement Text",
  commentId: "Comment ID",
  commentState: "Comment State",
  commentText: "Comment Text",
  author: "Author",
  createdAt: "Created At",
  responseText: "Response Text",
  respondedBy: "Responded By",
  respondedAt: "Responded At",
  closedBy: "Closed By",
  closedAt: "Closed At",
};

/**
 * Converts rows to a UTF-8 CSV string (with BOM for Excel compatibility).
 * Uses CRLF line endings as required by RFC 4180.
 */
export function generateReviewCsv(rows: ReviewExportRow[]): string {
  return assembleCsv(
    CSV_HEADERS.map((k) => CSV_HEADER_LABELS[k]),
    rows.map((row) => CSV_HEADERS.map((k) => row[k])),
  );
}

// ── Download trigger ──────────────────────────────────────────────────────────

/**
 * Triggers a browser file-save dialog for the generated CSV.
 * The download file name is derived from documentName: "foo.md" → "foo.reviews.csv".
 */
export function downloadReviewCsv(csvContent: string, documentName: string): void {
  const stem = documentName.replace(/\.md$/i, "");
  const fileName = `${stem}.reviews.csv`;

  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
