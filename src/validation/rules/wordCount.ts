import type { ValidationIssue } from "@/types/validation";
import type { RequirementRef } from "@/services/documentValidationService";
import type { QualityRule } from "../types";
import type { WordCountRuleConfig } from "../types";

export const wordCountRule: QualityRule = {
  id: "wordCount",
  check(req: RequirementRef, config: unknown): ValidationIssue[] {
    const { enabled, maxWords, message, severity, category } = config as WordCountRuleConfig;
    if (!enabled) return [];
    const words = req.bodyText.trim().split(/\s+/).filter((w) => w.length > 0);
    if (words.length <= maxWords) return [];
    return [
      {
        id: `word-count-${req.id}`,
        severity,
        type: "word-count",
        category,
        message: message
          .replace("{id}", req.id)
          .replace("{actual}", String(words.length))
          .replace("{maxWords}", String(maxWords)),
        targetId: req.id,
      },
    ];
  },
};
