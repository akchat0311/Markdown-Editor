/**
 * Traceability CSV export (aggregated format) + shared csvUtils.
 *
 * Format contract: two columns (Requirement ID, Test Cases), ONE row per
 * requirement in document order; all linked test case IDs aggregated into a
 * single always-quoted cell separated by embedded newlines; untraced
 * requirements appear with an empty quoted cell; broken links after all valid
 * rows; IDs only, never titles.
 */
import { describe, it, expect } from "vitest";
import {
  collectTraceabilityCsvRows,
  generateTraceabilityCsv,
} from "@/services/traceabilityExportService";
import { csvCell, csvQuotedCell, assembleCsv } from "@/services/csvUtils";
import type { TestCase, TraceLink } from "@/types/traceability";

const TCS: TestCase[] = [
  { id: "TC_001", title: "Never exported" },
  { id: "TC_002", title: "Never exported either" },
  { id: "TC_003", title: "" },
  { id: "TC_009", title: "Orphan" },
];

const LINKS: TraceLink[] = [
  { tc: "TC_001", req: "REQ_001" },
  { tc: "TC_002", req: "REQ_001" },
  { tc: "TC_003", req: "REQ_001" },
  { tc: "TC_002", req: "REQ_003" },
  { tc: "TC_001", req: "REQ_GONE" }, // broken
  { tc: "TC_002", req: "REQ_GONE" }, // broken, same stored req → same cell
];

const DOC_ORDER = ["REQ_001", "REQ_002", "REQ_003"];

describe("collectTraceabilityCsvRows — aggregation", () => {
  it("emits ONE row per requirement with newline-joined test case IDs in link order", () => {
    const rows = collectTraceabilityCsvRows(DOC_ORDER, TCS, LINKS);
    expect(rows).toEqual([
      ["REQ_001", "TC_001\nTC_002\nTC_003"],
      ["REQ_002", ""], // untraced requirement still appears
      ["REQ_003", "TC_002"],
      ["REQ_GONE", "TC_001\nTC_002"], // broken links after all valid rows, aggregated
    ]);
  });

  it("preserves document order of requirements, not link insertion order", () => {
    const rows = collectTraceabilityCsvRows(["REQ_003", "REQ_001"], TCS, [
      { tc: "TC_001", req: "REQ_001" },
      { tc: "TC_002", req: "REQ_003" },
    ]);
    expect(rows.map((r) => r[0])).toEqual(["REQ_003", "REQ_001"]);
  });

  it("preserves the links-array order of test cases within a cell", () => {
    const rows = collectTraceabilityCsvRows(["REQ_001"], TCS, [
      { tc: "TC_003", req: "REQ_001" },
      { tc: "TC_001", req: "REQ_001" },
    ]);
    expect(rows[0][1]).toBe("TC_003\nTC_001");
  });

  it("collapses duplicate requirement IDs to the first occurrence", () => {
    const rows = collectTraceabilityCsvRows(["REQ_001", "REQ_001"], TCS, [
      { tc: "TC_001", req: "REQ_001" },
    ]);
    expect(rows).toEqual([["REQ_001", "TC_001"]]);
  });

  it("does not emit orphan test cases (no requirement to key on)", () => {
    const rows = collectTraceabilityCsvRows(DOC_ORDER, TCS, LINKS);
    expect(rows.map((r) => r[1]).join("\n")).not.toContain("TC_009");
  });

  it("emits empty cells for every requirement when there are no links", () => {
    expect(collectTraceabilityCsvRows(DOC_ORDER, TCS, [])).toEqual([
      ["REQ_001", ""],
      ["REQ_002", ""],
      ["REQ_003", ""],
    ]);
  });

  it("is empty when there are no requirements and no links", () => {
    expect(collectTraceabilityCsvRows([], TCS, [])).toEqual([]);
  });
});

describe("generateTraceabilityCsv — quoting", () => {
  it("quotes every Test Cases cell — multi, single, and empty — and never titles", () => {
    const csv = generateTraceabilityCsv(collectTraceabilityCsvRows(DOC_ORDER, TCS, LINKS));
    expect(csv.startsWith("﻿")).toBe(true);
    expect(csv.endsWith("\r\n")).toBe(true);

    const body = csv.slice(1, -2); // strip BOM and trailing CRLF
    // Split on CRLF only — embedded \n inside quoted cells must survive.
    const lines = body.split("\r\n");
    expect(lines).toEqual([
      "Requirement ID,Test Cases",
      'REQ_001,"TC_001\nTC_002\nTC_003"',
      'REQ_002,""', // empty quoted cell
      'REQ_003,"TC_002"', // single ID still quoted
      'REQ_GONE,"TC_001\nTC_002"',
    ]);
    expect(csv).not.toContain("Never exported");
  });

  it("matches the specified example shape", () => {
    const csv = generateTraceabilityCsv([
      ["REQ_001", "TC001"],
      ["REQ_002", "TC001\nTC002\nTC003"],
      ["REQ_003", "TC010\nTC011"],
    ]);
    expect(csv).toBe(
      "﻿Requirement ID,Test Cases\r\n" +
        'REQ_001,"TC001"\r\n' +
        'REQ_002,"TC001\nTC002\nTC003"\r\n' +
        'REQ_003,"TC010\nTC011"\r\n',
    );
  });

  it("escapes quotes inside aggregated cells and metacharacters in requirement IDs", () => {
    const csv = generateTraceabilityCsv([['REQ_001, "quoted"', 'TC_"A"\nTC_B']]);
    expect(csv).toContain('"REQ_001, ""quoted""","TC_""A""\nTC_B"');
  });
});

describe("csvUtils", () => {
  it("csvCell quotes only when needed", () => {
    expect(csvCell("plain")).toBe("plain");
    expect(csvCell("")).toBe("");
    expect(csvCell("a,b")).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell("line\nbreak")).toBe('"line\nbreak"');
  });

  it("csvQuotedCell always quotes, including empty and plain values", () => {
    expect(csvQuotedCell("")).toBe('""');
    expect(csvQuotedCell("plain")).toBe('"plain"');
    expect(csvQuotedCell("a\nb")).toBe('"a\nb"');
    expect(csvQuotedCell('has "quotes"')).toBe('"has ""quotes"""');
  });

  it("assembleCsv produces BOM + CRLF + header + rows", () => {
    const csv = assembleCsv(["A", "B"], [["1", "2"]]);
    expect(csv).toBe("﻿A,B\r\n1,2\r\n");
  });
});
