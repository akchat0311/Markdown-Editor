import type { ValidationIssue } from "@/types/validation";
import type { RequirementRef } from "@/services/documentValidationService";
import type { QualityRule, MessageRuleConfig } from "../types";

/**
 * Detection strategy: flags every run of two or more consecutive regular
 * spaces in the requirement body. One issue per run (not one per
 * requirement) — each is independently locatable and the count itself is
 * informative on a body with several occurrences.
 *
 * Expected false positives, and how they're handled:
 *
 * - `extractBodyText` (src/editor/utils/extractBodyText.ts) replaces both
 *   fenced code blocks AND inline `code` spans with a single literal space
 *   character — never zero characters — specifically to avoid a DIFFERENT
 *   false positive (adjacent tokens fusing into a spurious acronym, e.g.
 *   "ECU"+"CAN" -> "ECUCAN"). A side effect: a requirement body containing
 *   inline code adjacent to normal spacing (e.g. "Set `a` to `b`.") can
 *   produce a run of 2-3 spaces that has nothing to do with the author's
 *   real typing. This is a KNOWN, ACCEPTED limitation, not fixed here —
 *   fixing it would mean changing extractBodyText's replacement strategy,
 *   which is shared, tested infrastructure other rules already depend on
 *   (undefinedAcronyms, multipleSentences); out of scope for this rule.
 *   See tests/unit/writingHygieneRules.test.ts for a test that documents
 *   this exact interaction rather than leaving it as a silent surprise.
 * - No other false-positive source identified: unlike commas or periods,
 *   there is no numeric-formatting or abbreviation convention in English
 *   prose where 2+ literal spaces are intentional.
 */
export const doubleSpacesRule: QualityRule = {
  id: "doubleSpaces",
  check(req: RequirementRef, config: unknown): ValidationIssue[] {
    const { enabled, severity, category, message } = config as MessageRuleConfig;
    if (!enabled) return [];

    const issues: ValidationIssue[] = [];
    const pattern = / {2,}/g;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(req.bodyText)) !== null) {
      issues.push({
        id: `double-spaces-${req.id}-${match.index}`,
        severity,
        type: "double-spaces",
        category,
        message: message.replace("{id}", req.id).replace("{count}", String(match[0].length)),
        targetId: req.id,
        range: { from: match.index, to: match.index + match[0].length },
      });
    }
    return issues;
  },
};
