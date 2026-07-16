/**
 * Traceability CSV export.
 *
 * Format: two columns — Requirement ID, Test Cases. ONE row per requirement;
 * all linked test case IDs are aggregated into a single always-quoted cell,
 * separated by embedded newlines. Requirements with no links still appear
 * (empty quoted cell); broken links follow the valid rows, aggregated under
 * their stored requirement ID. Document order; links-array order within a
 * cell; IDs only, never titles.
 *
 *   Requirement ID,Test Cases
 *   REQ_001,"TC_001"
 *   REQ_002,"TC_001
 *   TC_002"
 *   REQ_003,""
 *
 * Callers must pass a FRESH document-order requirement ID list computed
 * synchronously at export time (never the debounced index — it can be 300 ms
 * stale). Projection comes from services/traceabilityQuery, the same source
 * the badge, drawer, and dashboard consume.
 */

import { buildLinksByReq, findBrokenLinks } from "@/services/traceabilityQuery";
import { csvCell, csvQuotedCell } from "@/services/csvUtils";
import type { TestCase, TraceLink } from "@/types/traceability";

export const TRACEABILITY_CSV_HEADER = ["Requirement ID", "Test Cases"];

/**
 * One [Requirement ID, aggregated test-case IDs] tuple per requirement, in
 * export order. The second element is the RAW newline-joined ID list ("" when
 * unlinked) — quoting happens in generateTraceabilityCsv.
 */
export function collectTraceabilityCsvRows(
  requirementIds: string[],
  testCases: TestCase[],
  links: TraceLink[],
): string[][] {
  const byReq = buildLinksByReq(testCases, links);
  const rows: string[][] = [];

  // Valid rows in document order (duplicate requirement IDs collapse to the
  // first occurrence — same rule as the dashboard table).
  const seen = new Set<string>();
  for (const reqId of requirementIds) {
    if (seen.has(reqId)) continue;
    seen.add(reqId);
    const linked = byReq.get(reqId) ?? [];
    rows.push([reqId, linked.map((tc) => tc.id).join("\n")]);
  }

  // Broken links after all valid rows — aggregated per stored requirement ID,
  // links-array order within each cell.
  const brokenByReq = new Map<string, string[]>();
  for (const broken of findBrokenLinks(requirementIds, testCases, links)) {
    const list = brokenByReq.get(broken.req) ?? [];
    list.push(broken.testCase.id);
    brokenByReq.set(broken.req, list);
  }
  for (const [req, tcIds] of brokenByReq) {
    rows.push([req, tcIds.join("\n")]);
  }

  return rows;
}

export function generateTraceabilityCsv(rows: string[][]): string {
  const CRLF = "\r\n";
  const lines = [
    TRACEABILITY_CSV_HEADER.map(csvCell).join(","),
    // The Test Cases cell is quoted by contract — even when empty or a single
    // ID — because it is a multi-line aggregate column.
    ...rows.map(([reqId, tcIds]) => `${csvCell(reqId)},${csvQuotedCell(tcIds)}`),
  ];
  // UTF-8 BOM ensures Excel opens the file with correct encoding.
  return "﻿" + lines.join(CRLF) + CRLF;
}

/**
 * Triggers a browser file-save dialog for the generated CSV.
 * "spec.md" → "spec.test-traceability.csv".
 */
export function downloadTraceabilityCsv(csvContent: string, documentName: string): void {
  const stem = documentName.replace(/\.md$/i, "");
  const fileName = `${stem}.test-traceability.csv`;

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
