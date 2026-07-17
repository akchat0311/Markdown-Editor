import type { ValidationIssue } from "@/types/validation";
import type { RequirementRef } from "@/services/documentValidationService";
import type { QualityRule, MessageRuleConfig } from "../types";
import { scrubNonTerminalPeriods } from "./_sentenceScrub";

/**
 * Counts sentence-terminating punctuation (. ! ?) in requirement body text,
 * after scrubbing periods that don't actually terminate a sentence (see
 * _sentenceScrub.ts for exactly what's handled and its known limitations —
 * unchanged from before this rule's scrubbing logic was extracted into
 * that shared file so periodSpacing/missingTerminalPunctuation could reuse
 * it without duplicating or drifting from this implementation).
 */
function countSentences(text: string): number {
  const t = text.trim();
  if (!t) return 0;
  const s = scrubNonTerminalPeriods(t);
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
