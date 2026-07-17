import type { ValidationIssue } from "@/types/validation";
import type { RequirementRef } from "@/services/documentValidationService";
import type { QualityRule, MessageRuleConfig } from "../types";

const DIGIT = /\d/;

/**
 * Detection strategy: two independent checks over the requirement body,
 * each producing one issue per occurrence:
 *
 *   1. Missing space after a comma — `,` immediately followed by a
 *      non-whitespace character.
 *   2. Space before a comma — one or more whitespace characters
 *      immediately preceding a `,`.
 *
 * Expected false positives, and how they're handled:
 *
 * - Numeric formatting ("10,000", "1,234,567") legitimately has no space
 *   after the comma — a real, common pattern in engineering documents
 *   (part counts, tolerances). Handled explicitly: check 1 skips any
 *   comma with a digit immediately before AND after it. This does not
 *   attempt full locale-aware number parsing — just the one unambiguous
 *   digit-comma-digit shape that's never a prose-spacing mistake.
 * - Cross-block-boundary joining (requirement bodies spanning multiple
 *   paragraphs/list items are joined with NO separator — see
 *   repeatedWords.ts's comment on the same underlying fact) COULD in
 *   principle produce a spurious "missing space after comma" if one block
 *   ended in a bare comma and the next began immediately — but a block
 *   ending in a comma (rather than terminal punctuation) is already an
 *   unusual, arguably-malformed authoring pattern independent of this
 *   rule, not a realistic false-positive source in practice. Not
 *   specially excluded; flagged here for transparency, not fixed.
 * - extractBodyText's code-span-to-single-space substitution (documented
 *   in doubleSpacesRule) can occasionally produce a spurious "space before
 *   comma" when inline code sits immediately before a comma in the
 *   original markdown (e.g. "Set `a`, `b`."). KNOWN, ACCEPTED limitation,
 *   same reasoning and same fix boundary as doubleSpacesRule — see
 *   tests/unit/writingHygieneRules.test.ts for a documenting test.
 */
export const commaSpacingRule: QualityRule = {
  id: "commaSpacing",
  check(req: RequirementRef, config: unknown): ValidationIssue[] {
    const { enabled, severity, category, message } = config as MessageRuleConfig;
    if (!enabled) return [];

    const body = req.bodyText;
    const issues: ValidationIssue[] = [];

    // Check 1: missing space after comma (excluding numeric formatting).
    const missingSpaceAfter = /,(?=\S)/g;
    let m: RegExpExecArray | null;
    while ((m = missingSpaceAfter.exec(body)) !== null) {
      const before = body[m.index - 1];
      const after = body[m.index + 1];
      if (before && after && DIGIT.test(before) && DIGIT.test(after)) continue; // "10,000"
      issues.push({
        id: `comma-spacing-after-${req.id}-${m.index}`,
        severity,
        type: "comma-spacing",
        category,
        message: message.replace("{id}", req.id).replace("{issue}", "missing space after comma"),
        targetId: req.id,
        range: { from: m.index, to: m.index + 1 },
      });
    }

    // Check 2: whitespace before comma.
    const spaceBefore = /\s+,/g;
    while ((m = spaceBefore.exec(body)) !== null) {
      issues.push({
        id: `comma-spacing-before-${req.id}-${m.index}`,
        severity,
        type: "comma-spacing",
        category,
        message: message.replace("{id}", req.id).replace("{issue}", "space before comma"),
        targetId: req.id,
        range: { from: m.index, to: m.index + m[0].length },
      });
    }

    return issues;
  },
};
