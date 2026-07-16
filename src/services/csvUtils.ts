/** Shared CSV generation helpers (RFC 4180) — used by the review and
 *  traceability export services. */

export function csvCell(value: string): string {
  // RFC 4180: quote fields that contain commas, double-quotes, or line breaks.
  if (value === "") return "";
  if (value.includes(",") || value.includes('"') || value.includes("\n") || value.includes("\r")) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/**
 * Always-quoted variant of csvCell — for columns whose cells are quoted by
 * contract regardless of content (e.g. aggregated multi-line cells, where
 * even the empty and single-value cases must render as `"…"`).
 */
export function csvQuotedCell(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

/**
 * Assembles a complete CSV document: UTF-8 BOM (Excel encoding detection),
 * CRLF line endings (RFC 4180), one header row, then data rows.
 */
export function assembleCsv(header: string[], rows: string[][]): string {
  const CRLF = "\r\n";
  const lines = [
    header.map(csvCell).join(","),
    ...rows.map((row) => row.map(csvCell).join(",")),
  ];
  return "﻿" + lines.join(CRLF) + CRLF;
}
