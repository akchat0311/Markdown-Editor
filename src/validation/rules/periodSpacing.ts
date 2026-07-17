import type { ValidationIssue } from "@/types/validation";
import type { RequirementRef } from "@/services/documentValidationService";
import type { QualityRule, MessageRuleConfig } from "../types";
import { scrubNonTerminalPeriods } from "./_sentenceScrub";

/**
 * Detection strategy: scrub non-terminal periods first (decimals, multi-
 * part numbers, e.g./i.e./vs., single-letter initials — see
 * _sentenceScrub.ts), then check spacing only around the periods that
 * SURVIVE scrubbing — i.e. real sentence/clause-ending periods. Because
 * the scrub is length-preserving, a position found in the scrubbed text is
 * also correct against the original bodyText, so `range` needs no
 * translation. Two independent checks, each one issue per occurrence:
 *
 *   1. Space before a period ("foo .") — almost always a typo.
 *   2. Missing space after an INTERNAL period (one with more text
 *      following) — excludes a period at the very end of the body
 *      entirely (that's expected and is missingTerminalPunctuation's
 *      concern, not this rule's).
 *
 * Expected false positives, and how they're handled:
 *
 * - Decimals, multi-part numbers, common abbreviations, and initials are
 *   excluded by construction (the scrub step) — not a residual risk.
 * - Check 2 (missing space after an internal period) has ONE known,
 *   accepted risk: useDocumentValidation.ts joins every block within a
 *   requirement's body with NO separator (see repeatedWords.ts's comment
 *   on the same fact). A requirement body spanning multiple paragraphs or
 *   list items — an ordinary, common authoring pattern — will have the
 *   final period of one block sitting directly against the first
 *   character of the next block with zero separator, which this rule
 *   cannot distinguish from a genuine same-block spacing typo. NOT fixed
 *   here — fixing it means changing shared bodyText construction used by
 *   every other rule, out of scope for this rule; flagged prominently
 *   (including to the user reviewing this implementation) rather than
 *   silently shipped. See tests/unit/writingHygieneRules.test.ts for a
 *   test that documents this exact scenario and its current behavior.
 * - Check 1 (space before period) carries no equivalent risk — it only
 *   depends on what comes BEFORE the period, which block-joining with no
 *   separator never introduces (joining can only remove a would-be gap,
 *   never insert a spurious one before a period).
 */
export const periodSpacingRule: QualityRule = {
  id: "periodSpacing",
  check(req: RequirementRef, config: unknown): ValidationIssue[] {
    const { enabled, severity, category, message } = config as MessageRuleConfig;
    if (!enabled) return [];

    const body = req.bodyText;
    const scrubbed = scrubNonTerminalPeriods(body);
    const issues: ValidationIssue[] = [];

    // Check 1: whitespace before a (real, surviving) period.
    const spaceBefore = /\s+\./g;
    let m: RegExpExecArray | null;
    while ((m = spaceBefore.exec(scrubbed)) !== null) {
      issues.push({
        id: `period-spacing-before-${req.id}-${m.index}`,
        severity,
        type: "period-spacing",
        category,
        message: message.replace("{id}", req.id).replace("{issue}", "space before period"),
        targetId: req.id,
        range: { from: m.index, to: m.index + m[0].length },
      });
    }

    // Check 2: missing space after an internal (non-final) period.
    const missingSpaceAfter = /\.(?=\S)/g;
    while ((m = missingSpaceAfter.exec(scrubbed)) !== null) {
      issues.push({
        id: `period-spacing-after-${req.id}-${m.index}`,
        severity,
        type: "period-spacing",
        category,
        message: message.replace("{id}", req.id).replace("{issue}", "missing space after period"),
        targetId: req.id,
        range: { from: m.index, to: m.index + 1 },
      });
    }

    return issues;
  },
};
