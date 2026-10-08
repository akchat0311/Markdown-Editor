import { describe, it, expect } from "vitest";
import {
  splitIdNumericTail,
  computeStemRenumberReplacements,
  nextAvailableIdForStem,
} from "@/editor/utils/requirementOps";
import type { RequirementEntry } from "@/editor/utils/requirementOps";
import type { OutlineNode } from "@/types/outline";

/**
 * Per-stem renumbering for regex-mode requirement patterns
 * (TRANS_<Feature>_NNN and similar): group by everything before the trailing
 * number, renumber each group 1..n in document order, keep the group's digit
 * width. Built 2026-08-30 on user request — regex mode previously could not
 * renumber at all (an ID cannot be generated from a recognition regex alone).
 */

function entry(id: string, label: string, pmPos: number): RequirementEntry {
  const node: OutlineNode = {
    key: `heading:${pmPos}`,
    type: "heading",
    level: 2,
    label,
    pmPos,
    index: 0,
    children: [],
  };
  return { node, id, num: null };
}

describe("splitIdNumericTail", () => {
  it("splits stem, number, and width", () => {
    expect(splitIdNumericTail("TRANS_Parking_007")).toEqual({
      stem: "TRANS_Parking_",
      num: 7,
      width: 3,
    });
    expect(splitIdNumericTail("REQ-42")).toEqual({ stem: "REQ-", num: 42, width: 2 });
  });

  it("returns null for IDs without a trailing digit run", () => {
    expect(splitIdNumericTail("TRANS_Parking")).toBeNull();
    expect(splitIdNumericTail("REQ_001_final")).toBeNull();
  });
});

describe("computeStemRenumberReplacements", () => {
  it("renumbers each stem group independently in document order", () => {
    const entries = [
      entry("TRANS_Parking_004", "TRANS_Parking_004 Engage park", 10),
      entry("TRANS_Reverse_009", "TRANS_Reverse_009 Inhibit reverse", 20),
      entry("TRANS_Parking_004", "TRANS_Parking_004 Duplicate", 30),
      entry("TRANS_Reverse_001", "TRANS_Reverse_001 Out of order", 40),
    ];
    const result = computeStemRenumberReplacements(entries);
    expect(result.map((r) => r.newId)).toEqual([
      "TRANS_Parking_001",
      "TRANS_Reverse_001",
      "TRANS_Parking_002",
      "TRANS_Reverse_002",
    ]);
    expect(result[0].newLabel).toBe("TRANS_Parking_001 Engage park");
  });

  it("keeps each group's digit width from its first occurrence", () => {
    const result = computeStemRenumberReplacements([
      entry("A_01", "A_01 x", 1),
      entry("B_0007", "B_0007 y", 2),
      entry("A_99", "A_99 z", 3),
    ]);
    expect(result.map((r) => r.newId)).toEqual(["A_01", "B_0001", "A_02"]);
  });

  it("skips IDs without a numeric tail", () => {
    const result = computeStemRenumberReplacements([
      entry("TRANS_Parking", "TRANS_Parking no tail", 1),
      entry("TRANS_Parking_002", "TRANS_Parking_002 tailed", 2),
    ]);
    expect(result).toHaveLength(1);
    expect(result[0].newId).toBe("TRANS_Parking_001");
  });
});

describe("nextAvailableIdForStem", () => {
  const entries = [
    entry("TRANS_Parking_001", "a", 1),
    entry("TRANS_Parking_007", "b", 2),
    entry("TRANS_Reverse_002", "c", 3),
  ];

  it("returns max within the stem group + 1, at the ID's width", () => {
    expect(nextAvailableIdForStem(entries, "TRANS_Parking_001")).toBe("TRANS_Parking_008");
    expect(nextAvailableIdForStem(entries, "TRANS_Reverse_002")).toBe("TRANS_Reverse_003");
  });

  it("returns null for IDs without a numeric tail", () => {
    expect(nextAvailableIdForStem(entries, "TRANS_Parking")).toBeNull();
  });
});
