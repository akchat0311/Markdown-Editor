import { describe, it, expect } from "vitest";
import { normalizeStatusText, resolveRequirementStatus } from "@/services/requirementStatusService";
import type { RequirementStatus } from "@/types/requirementStatus";

const STATUSES: RequirementStatus[] = [
  { id: "draft", label: "Draft", color: "", aliases: ["draft"] } as never,
  { id: "approved", label: "Approved", color: "", aliases: ["approved"] } as never,
];

describe("status text normalization", () => {
  it("is case-insensitive", () => {
    expect(resolveRequirementStatus("DRAFT", STATUSES)).toBe("draft");
    expect(resolveRequirementStatus("aPpRoVeD", STATUSES)).toBe("approved");
  });

  it("ignores emphasis characters (italic-by-default statuses)", () => {
    expect(normalizeStatusText("*Draft*")).toBe("draft");
    expect(normalizeStatusText("_approved_")).toBe("approved");
    expect(resolveRequirementStatus("*Draft*", STATUSES)).toBe("draft");
  });

  it("collapses whitespace", () => {
    expect(normalizeStatusText("  Ready   for review ")).toBe("ready for review");
  });
});
