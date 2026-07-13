/**
 * Unit tests for the requirement status plugin's pure helpers.
 *
 * The full ProseMirror plugin (DOM creation, dispatch) is tested via
 * interaction tests; here we cover the pure logic that can be exercised
 * without a browser DOM.
 */
import { describe, it, expect } from "vitest";
import { resolveRequirementStatus } from "@/services/requirementStatusService";
import { buildDetectionRegex, derivePattern, extractStatusText } from "@/editor/utils/requirementOps";
import type { RequirementStatus } from "@/types/requirementStatus";

// ── Shared fixtures ───────────────────────────────────────────────────────────

const STATUSES: RequirementStatus[] = [
  { id: "draft",    label: "Draft",    order: 1, aliases: ["Draft", "draft", "DRAFT"] },
  { id: "review",   label: "Review",   order: 2, aliases: ["Review", "review", "In Review"] },
  { id: "approved", label: "Approved", order: 3, aliases: ["Approved", "approved", "APPROVED"] },
];

// ── extractStatusText (bracket extraction) ────────────────────────────────────

describe("extractStatusText — bracket extraction", () => {
  it("extracts status from standard format", () => {
    expect(extractStatusText("REQ_001 [Draft]")).toBe("Draft");
    expect(extractStatusText("REQ_001 [Review]")).toBe("Review");
    expect(extractStatusText("REQ_001 [Approved]")).toBe("Approved");
  });

  it("returns null when no bracket present", () => {
    expect(extractStatusText("REQ_001")).toBeNull();
    expect(extractStatusText("Brake Monitoring")).toBeNull();
  });

  it("handles multi-word status text", () => {
    expect(extractStatusText("REQ_001 [In Review]")).toBe("In Review");
    expect(extractStatusText("REQ_001 [Not Started]")).toBe("Not Started");
  });

  it("handles uppercase variants", () => {
    expect(extractStatusText("REQ_001 [DRAFT]")).toBe("DRAFT");
    expect(extractStatusText("REQ_001 [APPROVED]")).toBe("APPROVED");
  });

  it("trims internal whitespace from bracket contents", () => {
    expect(extractStatusText("REQ_001 [ Draft ]")).toBe("Draft");
  });

  it("picks the last bracket group when multiple appear", () => {
    // Heading with both a parenthetical and a status badge
    expect(extractStatusText("REQ_001 (System) [Draft]")).toBe("Draft");
    expect(extractStatusText("REQ_001 [old] [Approved]")).toBe("Approved");
  });

  it("ignores trailing whitespace after closing bracket", () => {
    expect(extractStatusText("REQ_001 [Draft]   ")).toBe("Draft");
  });
});

// ── resolveRequirementStatus (alias matching) ─────────────────────────────────

describe("resolveRequirementStatus — alias matching", () => {
  it("matches exact aliases", () => {
    expect(resolveRequirementStatus("Draft",    STATUSES)).toBe("draft");
    expect(resolveRequirementStatus("draft",    STATUSES)).toBe("draft");
    expect(resolveRequirementStatus("DRAFT",    STATUSES)).toBe("draft");
    expect(resolveRequirementStatus("Review",   STATUSES)).toBe("review");
    expect(resolveRequirementStatus("In Review",STATUSES)).toBe("review");
    expect(resolveRequirementStatus("Approved", STATUSES)).toBe("approved");
    expect(resolveRequirementStatus("APPROVED", STATUSES)).toBe("approved");
  });

  it("returns unknown for unrecognized text", () => {
    expect(resolveRequirementStatus("Pending",   STATUSES)).toBe("unknown");
    expect(resolveRequirementStatus("Obsolete",  STATUSES)).toBe("unknown");
    expect(resolveRequirementStatus("",          STATUSES)).toBe("unknown");
  });

  it("still returns unknown for text that isn't any case/whitespace variant of a configured alias", () => {
    // "Approve" is a different word from "approved", not a case variant of it.
    expect(resolveRequirementStatus("Approve", STATUSES)).toBe("unknown");
  });

  it("is case-insensitive — an uppercase variant not explicitly listed still matches", () => {
    // "REVIEW" (all caps) is not literally in STATUSES's aliases list
    // (["Review", "review", "In Review"]), but normalizes to the same text
    // as the configured "review" alias.
    expect(resolveRequirementStatus("REVIEW", STATUSES)).toBe("review");
  });

  it("resolves custom status configs", () => {
    const custom: RequirementStatus[] = [
      { id: "proposed",    label: "Proposed",    order: 1, aliases: ["Proposed"] },
      { id: "verified",    label: "Verified",    order: 2, aliases: ["Verified", "VERIFIED"] },
    ];
    expect(resolveRequirementStatus("Proposed", custom)).toBe("proposed");
    expect(resolveRequirementStatus("VERIFIED", custom)).toBe("verified");
    expect(resolveRequirementStatus("Draft",    custom)).toBe("unknown");
  });
});

// ── resolveRequirementStatus — case & whitespace normalization regression ────
//
// The canonical alias is configured as "Ready for review" (mirrors the real
// FALLBACK_STATUSES entry in requirementStatusService.ts). Every case variant
// and whitespace irregularity below must resolve to the same configured
// status, while the configured alias/label itself is never rewritten.

describe("resolveRequirementStatus — case and whitespace insensitivity regression", () => {
  const READY_STATUSES: RequirementStatus[] = [
    { id: "draft", label: "Draft", order: 1, aliases: ["Draft"] },
    { id: "ready", label: "Ready for review", order: 2, aliases: ["Ready for review"] },
  ];

  it.each([
    "Ready For Review",
    "READY FOR REVIEW",
    "Ready for review",
    "ready For Review",
    "ready for review",
  ])("resolves %j to the configured \"ready\" status", (variant) => {
    expect(resolveRequirementStatus(variant, READY_STATUSES)).toBe("ready");
  });

  it("resolves with leading/trailing whitespace", () => {
    expect(resolveRequirementStatus("  Ready for review  ", READY_STATUSES)).toBe("ready");
    expect(resolveRequirementStatus("\tREADY FOR REVIEW\n", READY_STATUSES)).toBe("ready");
  });

  it("resolves with multiple internal spaces collapsed", () => {
    expect(resolveRequirementStatus("Ready   for    review", READY_STATUSES)).toBe("ready");
    expect(resolveRequirementStatus("READY  FOR   REVIEW", READY_STATUSES)).toBe("ready");
  });

  it("combines whitespace and case irregularities in a single input", () => {
    expect(resolveRequirementStatus("  ready For   REVIEW  ", READY_STATUSES)).toBe("ready");
  });

  it("does not mutate the configured status's canonical label or aliases", () => {
    resolveRequirementStatus("READY FOR REVIEW", READY_STATUSES);
    expect(READY_STATUSES[1].label).toBe("Ready for review");
    expect(READY_STATUSES[1].aliases).toEqual(["Ready for review"]);
  });
});

// ── buildDetectionRegex — requirement heading detection ───────────────────────

describe("buildDetectionRegex — requirement heading detection", () => {
  it("matches requirement headings", () => {
    const regex = buildDetectionRegex("REQ_");
    expect(regex.test("REQ_001")).toBe(true);
    expect(regex.test("REQ_001 [Draft]")).toBe(true);
    expect(regex.test("REQ_042 [Approved]")).toBe(true);
    expect(regex.test("REQ_100")).toBe(true);
  });

  it("does not match section headings", () => {
    const regex = buildDetectionRegex("REQ_");
    expect(regex.test("Brake Monitoring")).toBe(false);
    expect(regex.test("Introduction")).toBe(false);
    expect(regex.test("System Overview")).toBe(false);
  });

  it("works with custom prefix (SYS_)", () => {
    const regex = buildDetectionRegex("SYS_");
    expect(regex.test("SYS_001 [Draft]")).toBe(true);
    expect(regex.test("REQ_001 [Draft]")).toBe(false);
  });

  it("works with alphanumeric prefix", () => {
    const derived = derivePattern("FR-001");
    expect(derived).not.toBeNull();
    const regex = buildDetectionRegex(derived!.prefix);
    expect(regex.test("FR-001 [Draft]")).toBe(true);
    expect(regex.test("FR-042")).toBe(true);
    expect(regex.test("NF-001")).toBe(false);
  });
});

// ── Position math (simulated, no PM) ─────────────────────────────────────────

describe("bracket position calculation", () => {
  /**
   * Simulates the position math done by findStatusRange:
   *   bracketFrom = nodePos + 1 + charOffset
   *   bracketTo   = bracketFrom + bracketText.length
   *
   * This validates the formula without needing a real ProseMirror document.
   */
  function simulateBracketPos(
    headingText: string,
    nodePos: number
  ): { bracketFrom: number; bracketTo: number } | null {
    const match = headingText.match(/(\[[^\]]+\])\s*$/);
    if (!match) return null;
    const charOffset = headingText.lastIndexOf(match[1]);
    const bracketFrom = nodePos + 1 + charOffset;
    const bracketTo = bracketFrom + match[1].length;
    return { bracketFrom, bracketTo };
  }

  it("computes correct positions for simple heading", () => {
    // "REQ_001 [Draft]" at nodePos=2
    // text: R E Q _ 0 0 1   [ D r a f t ]
    //       0 1 2 3 4 5 6 7 8 9 ...
    // [ is at charOffset 8 → bracketFrom = 2+1+8 = 11
    // ] is at charOffset 14 → bracketTo = 11+7 = 18  ("[Draft]" = 7 chars)
    const result = simulateBracketPos("REQ_001 [Draft]", 2);
    expect(result).not.toBeNull();
    expect(result!.bracketFrom).toBe(11);
    expect(result!.bracketTo).toBe(18);
  });

  it("accounts for longer IDs", () => {
    // "REQ_042 [Approved]" at nodePos=0
    const result = simulateBracketPos("REQ_042 [Approved]", 0);
    expect(result).not.toBeNull();
    const text = "REQ_042 [Approved]";
    expect(result!.bracketFrom).toBe(1 + text.indexOf("["));
    expect(result!.bracketTo).toBe(1 + text.length);
  });

  it("returns null for heading without brackets", () => {
    expect(simulateBracketPos("REQ_001", 0)).toBeNull();
  });

  it("handles multi-word status in bracket", () => {
    const result = simulateBracketPos("REQ_001 [In Review]", 10);
    expect(result).not.toBeNull();
    const text = "REQ_001 [In Review]";
    expect(result!.bracketFrom).toBe(10 + 1 + text.indexOf("["));
    expect(result!.bracketTo - result!.bracketFrom).toBe("[In Review]".length);
  });
});

// ── Status update text ────────────────────────────────────────────────────────

describe("status update text generation", () => {
  it("uses status label (not id) for markdown text", () => {
    // The document stores [Draft], [Review], [Approved] — the label, not the id.
    // This test documents the expected text written to the document.
    const buildUpdateText = (label: string) => "[" + label + "]";
    expect(buildUpdateText("Draft")).toBe("[Draft]");
    expect(buildUpdateText("In Review")).toBe("[In Review]");
    expect(buildUpdateText("Approved")).toBe("[Approved]");
    // Custom statuses
    expect(buildUpdateText("Proposed")).toBe("[Proposed]");
    expect(buildUpdateText("Verified")).toBe("[Verified]");
  });
});
