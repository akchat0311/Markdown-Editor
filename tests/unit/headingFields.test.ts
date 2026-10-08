import { describe, it, expect } from "vitest";
import { parseHeadingFields, variantDisplayText, fieldsStartOffset } from "@/editor/utils/headingFields";
import type { RequirementStatus } from "@/types/requirementStatus";

/**
 * Tokenizer matrix for the trailing heading fields (design D10/D11,
 * approved 2026-09-01). The backward-compatibility rows mirror the design
 * doc's matrix: every pre-variant heading shape must classify exactly as
 * the old last-bracket-is-status code did.
 */
const STATUSES: RequirementStatus[] = [
  { id: "draft", label: "Draft", order: 1, aliases: ["Draft"] },
  { id: "approved", label: "Approved", order: 2, aliases: ["Approved"] },
];

function classify(text: string) {
  const f = parseHeadingFields(text, STATUSES);
  return {
    status: f.status ? { id: f.status.statusId, inner: f.status.inner } : null,
    variant: f.variant ? f.variant.inner : null,
  };
}

describe("parseHeadingFields — backward compatibility (must match pre-variant behavior)", () => {
  it("single resolving bracket is the status", () => {
    expect(classify("REQ_001 [Draft]")).toEqual({ status: { id: "draft", inner: "Draft" }, variant: null });
  });

  it("italic status resolves (emphasis-insensitive)", () => {
    expect(classify("REQ_001 [*Draft*]")).toEqual({ status: { id: "draft", inner: "*Draft*" }, variant: null });
  });

  it("no brackets → no fields", () => {
    expect(classify("REQ_001 Title")).toEqual({ status: null, variant: null });
  });

  it("single NON-resolving bracket is still the status (unknown) — never a variant", () => {
    expect(classify("REQ_001 [Banana]")).toEqual({ status: { id: "unknown", inner: "Banana" }, variant: null });
  });

  it("bracket in the title before the status stays in the title", () => {
    expect(classify("REQ_001 T [see 3.2] [Draft]")).toEqual({
      status: { id: "draft", inner: "Draft" },
      variant: null,
    });
  });

  it("two non-resolving brackets: last is unknown status, first stays in title", () => {
    expect(classify("REQ_001 [foo] [bar]")).toEqual({
      status: { id: "unknown", inner: "bar" },
      variant: null,
    });
  });
});

describe("parseHeadingFields — the new canonical form", () => {
  it("status then variant", () => {
    expect(classify("TRANS_feat_001 [*Draft*] [V2]")).toEqual({
      status: { id: "draft", inner: "*Draft*" },
      variant: "V2",
    });
  });

  it("variant with spaces and punctuation is opaque", () => {
    expect(classify("REQ_001 Title [Approved] [EU market, HW-B]")).toEqual({
      status: { id: "approved", inner: "Approved" },
      variant: "EU market, HW-B",
    });
  });

  it("both resolve as statuses → canonical order wins (first is status)", () => {
    expect(classify("REQ_001 [Draft] [Approved]")).toEqual({
      status: { id: "draft", inner: "Draft" },
      variant: "Approved",
    });
  });

  it("charFrom/charTo cover the bracket groups exactly", () => {
    const text = "REQ_001 [Draft] [V2]";
    const f = parseHeadingFields(text, STATUSES);
    expect(text.slice(f.status!.charFrom, f.status!.charTo)).toBe("[Draft]");
    expect(text.slice(f.variant!.charFrom, f.variant!.charTo)).toBe("[V2]");
  });

  it("fieldsStartOffset yields the title boundary", () => {
    const text = "REQ_001 My title [Draft] [V2]";
    const f = parseHeadingFields(text, STATUSES);
    expect(text.slice(0, fieldsStartOffset(text, f)).trim()).toBe("REQ_001 My title");
    const bare = "REQ_001 Plain";
    expect(fieldsStartOffset(bare, parseHeadingFields(bare, STATUSES))).toBe(bare.length);
  });
});

describe("variantDisplayText", () => {
  it("strips emphasis, keeps case", () => {
    expect(variantDisplayText("*V2*")).toBe("V2");
    expect(variantDisplayText("_eu-Market_")).toBe("eu-Market");
    expect(variantDisplayText("V2")).toBe("V2");
  });
});
