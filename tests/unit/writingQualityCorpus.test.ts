/**
 * Runs the permanent regression corpus (tests/fixtures/writingQualityCorpus.ts)
 * against the real RULE_REGISTRY, using the actual quality-rules.json config —
 * the same wiring runAllValidations uses for requirement-level rules. See the
 * fixture file for scope notes (requirement-level RULE_REGISTRY rules only).
 */
import { describe, it, expect } from "vitest";
import { RULE_REGISTRY } from "@/validation/registry";
import qualityRules from "@/config/quality-rules.json";
import type { RequirementRef } from "@/services/documentValidationService";
import { VALID_CORPUS, INVALID_CORPUS, EDGE_CASE_CORPUS, type CorpusEntry } from "../fixtures/writingQualityCorpus";

const CONFIG = qualityRules.rules as Record<string, unknown>;

/** Returns the sorted, deduplicated set of rule ids that produced at least one issue. */
function firedRuleIds(bodyText: string): string[] {
  const req: RequirementRef = { id: "REQ_CORPUS", num: 1, statusText: "Draft", bodyText };
  const fired = new Set<string>();
  for (const rule of RULE_REGISTRY) {
    if (rule.check(req, CONFIG[rule.id]).length > 0) fired.add(rule.id);
  }
  return Array.from(fired).sort();
}

function runCorpus(entries: CorpusEntry[]) {
  for (const entry of entries) {
    it(`${entry.reqId} — ${entry.note}`, () => {
      expect(firedRuleIds(entry.bodyText)).toEqual([...entry.expectedRuleIds].sort());
    });
  }
}

describe("Writing Quality regression corpus", () => {
  describe("valid requirements — must never trigger any RULE_REGISTRY rule", () => {
    runCorpus(VALID_CORPUS);
  });

  describe("invalid requirements — must trigger exactly the expected rule(s)", () => {
    runCorpus(INVALID_CORPUS);
  });

  describe("edge cases — documented boundary behavior", () => {
    runCorpus(EDGE_CASE_CORPUS);
  });

  describe("corpus integrity", () => {
    it("every entry has a unique reqId across all three buckets", () => {
      const all = [...VALID_CORPUS, ...INVALID_CORPUS, ...EDGE_CASE_CORPUS];
      const ids = all.map((e) => e.reqId);
      expect(new Set(ids).size).toBe(ids.length);
    });

    it("every invalid entry declares at least one expected rule", () => {
      for (const entry of INVALID_CORPUS) {
        expect(entry.expectedRuleIds.length).toBeGreaterThan(0);
      }
    });

    it("every valid entry declares zero expected rules", () => {
      for (const entry of VALID_CORPUS) {
        expect(entry.expectedRuleIds).toEqual([]);
      }
    });

    it("invalid entries collectively cover every RULE_REGISTRY rule at least once", () => {
      const covered = new Set(INVALID_CORPUS.flatMap((e) => e.expectedRuleIds));
      const allRuleIds = RULE_REGISTRY.map((r) => r.id);
      for (const id of allRuleIds) {
        expect(covered.has(id), `no invalid corpus entry covers rule '${id}'`).toBe(true);
      }
    });

    it("the required engineering terminology appears somewhere in the corpus", () => {
      const all = [...VALID_CORPUS, ...INVALID_CORPUS, ...EDGE_CASE_CORPUS];
      const haystack = all.map((e) => e.bodyText).join(" \n ");
      const required = [
        "ECU", "CAN", "LIN", "SPI", "I2C", "AUTOSAR", "ISO 26262",
        "REQ_", "TC_", "500 ms", "10 km/h", "UUID", "CRC", "bootloader",
      ];
      for (const term of required) {
        expect(haystack.toLowerCase().includes(term.toLowerCase()), `missing required term '${term}'`).toBe(true);
      }
    });
  });
});
