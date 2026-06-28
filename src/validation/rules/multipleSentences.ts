import type { ValidationIssue } from "@/types/validation";
import type { RequirementRef } from "@/services/documentValidationService";
import type { QualityRule, MessageRuleConfig } from "../types";

/**
 * Counts sentence-terminating punctuation (. ! ?) in requirement body text,
 * scrubbing patterns that produce false positives:
 *
 * Handled:
 *   - Multi-part numbers: 3.14, 3.2.1, 1.0.0
 *   - Common prose abbreviations never used as sentence terminators: e.g., i.e., vs.
 *   - Single-letter initials followed by a space: "J. Smith", "A. B."
 *
 * Known limitations (not handled in v1):
 *   - Multi-letter abbreviations other than e.g./i.e./vs. (e.g. "Fig.", "Sec.")
 *   - URLs containing dots (e.g. "http://example.com")
 *   - Acronyms with internal dots mid-sentence (e.g. "U.S.A. certified")
 */
function countSentences(text: string): number {
  const t = text.trim();
  if (!t) return 0;

  const s = t
    // Multi-part numbers: 3.14, 3.2.1, v1.0
    .replace(/\d+(?:\.\d+)+/g, "N")
    // Prose abbreviations that are never sentence terminators
    .replace(/\b(e\.g|i\.e|vs)\./gi, "X")
    // Single-letter initials followed by a space: "J. Smith"
    .replace(/\b[A-Za-z]\.\s/g, "X ");

  return (s.match(/[.!?](?=\s|$)/g) ?? []).length;
}

export const multipleSentencesRule: QualityRule = {
  id: "multipleSentences",
  check(req: RequirementRef, config: unknown): ValidationIssue[] {
    const { enabled, severity, category, message } = config as MessageRuleConfig;
    if (!enabled) return [];
    const count = countSentences(req.bodyText);
    if (count <= 1) return [];
    return [
      {
        id: `multiple-sentences-${req.id}`,
        severity,
        type: "multiple-sentences",
        category,
        message: message.replace("{id}", req.id).replace("{count}", String(count)),
        targetId: req.id,
      },
    ];
  },
};
