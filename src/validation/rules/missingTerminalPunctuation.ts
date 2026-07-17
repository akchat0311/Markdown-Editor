import type { ValidationIssue } from "@/types/validation";
import type { RequirementRef } from "@/services/documentValidationService";
import type { QualityRule, MessageRuleConfig } from "../types";
import { scrubNonTerminalPeriods } from "./_sentenceScrub";

// Widened beyond .!? to reduce false positives (see comment below): a
// requirement body legitimately ending in a colon (introducing a list) or
// semicolon (a valid clause-ending in formal/technical writing) is not
// missing punctuation, just using a different valid ender.
const ACCEPTABLE_ENDERS = new Set([".", "!", "?", ":", ";"]);

/**
 * Detection strategy: does the (trimmed, non-terminal-period-scrubbed)
 * requirement body end in one of ACCEPTABLE_ENDERS? At most one issue per
 * requirement — there is exactly one "end" to check. `range` is a
 * zero-width point at the end of the body (an absence has nothing to
 * underline, but a future quick fix would know exactly where to insert).
 * Empty bodies are skipped entirely — that's emptyBody's concern, not
 * this rule's.
 *
 * Expected false positives, and how they're handled:
 *
 * - A requirement body ending its intro clause with a colon before a list,
 *   or joining two clauses with a semicolon, is NOT missing punctuation —
 *   handled by widening ACCEPTABLE_ENDERS beyond `.!?` to also accept `:`
 *   and `;`.
 * - A requirement body ending in a decimal number, abbreviation, or
 *   initial whose period would otherwise look "present" — not actually a
 *   false-positive risk for THIS rule specifically, since scrubbing only
 *   matters when it would otherwise cause a WRONGLY-ACCEPTED body (a
 *   trailing "3.14" ending in a scrubbed, non-terminal period must NOT
 *   count as "properly terminated") — scrubbing here prevents a false
 *   NEGATIVE (missing the real issue), not a false positive.
 * - A requirement body whose LAST content actually comes from a bulleted
 *   list item with no trailing punctuation of its own (a common, accepted
 *   requirements-document pattern — e.g. an intro sentence ending in ":"
 *   followed by short noun-phrase bullets) is a KNOWN, ACCEPTED
 *   limitation: useDocumentValidation.ts's bodyText extraction
 *   concatenates every block in a requirement's body with no structural
 *   separator, so this rule has no way to know the final characters came
 *   from a list item rather than a plain paragraph. Not fixed here —
 *   fixing it means changing shared bodyText construction, out of scope
 *   for this rule. See tests/unit/writingHygieneRules.test.ts for a test
 *   documenting this exact case.
 */
export const missingTerminalPunctuationRule: QualityRule = {
  id: "missingTerminalPunctuation",
  check(req: RequirementRef, config: unknown): ValidationIssue[] {
    const { enabled, severity, category, message } = config as MessageRuleConfig;
    if (!enabled) return [];

    const body = req.bodyText.trim();
    if (!body) return [];

    const scrubbed = scrubNonTerminalPeriods(body);
    const last = scrubbed.charAt(scrubbed.length - 1);
    if (ACCEPTABLE_ENDERS.has(last)) return [];

    return [
      {
        id: `missing-terminal-punctuation-${req.id}`,
        severity,
        type: "missing-terminal-punctuation",
        category,
        message: message.replace("{id}", req.id),
        targetId: req.id,
        range: { from: body.length, to: body.length },
      },
    ];
  },
};
