import type { ValidationIssue } from "@/types/validation";
import type { RequirementRef } from "@/services/documentValidationService";
import type { QualityRule, MessageRuleConfig } from "../types";

/**
 * Detection strategy: flags a requirement body whose first non-whitespace
 * character is a LOWERCASE LETTER specifically — not "anything other than
 * an uppercase letter." Deliberately narrow: a body starting with a digit
 * ("10 samples shall..."), a symbol, or an already-uppercase letter is
 * never flagged. Only a-z is a clear, unambiguous signal that the author
 * meant to start a sentence and forgot to capitalize it. At most one issue
 * per requirement (there's only one "start" to check).
 *
 * Expected false positives, and how they're handled:
 *
 * - A requirement body that legitimately starts with an inline-code
 *   identifier (e.g. "`can_id` shall not exceed 0x7FF.") has that code
 *   span replaced with a single space by extractBodyText, so after
 *   trimming the body reads "shall not exceed..." — a real lowercase
 *   start this rule cannot distinguish from a genuine missing-capital
 *   typo. KNOWN, ACCEPTED limitation for the same reason as
 *   doubleSpacesRule — fixing it means changing shared extraction
 *   infrastructure, out of scope here. See
 *   tests/unit/writingHygieneRules.test.ts for a test documenting this
 *   exact case rather than a silent surprise.
 * - Restricting to a-z (not "not uppercase") already avoids the much more
 *   common false-positive class: numeric or symbol-led requirements
 *   ("500 ms shall...", "-40°C to +85°C shall...") are never flagged,
 *   since neither a digit nor a symbol has a "should be capitalized" case.
 */
export const sentenceCapitalizationRule: QualityRule = {
  id: "sentenceCapitalization",
  check(req: RequirementRef, config: unknown): ValidationIssue[] {
    const { enabled, severity, category, message } = config as MessageRuleConfig;
    if (!enabled) return [];

    const body = req.bodyText;
    const first = body.charAt(0);
    if (!/[a-z]/.test(first)) return [];

    return [
      {
        id: `sentence-capitalization-${req.id}`,
        severity,
        type: "sentence-capitalization",
        category,
        message: message.replace("{id}", req.id),
        targetId: req.id,
        range: { from: 0, to: 1 },
      },
    ];
  },
};
