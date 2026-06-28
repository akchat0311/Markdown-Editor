import type { ValidationIssue } from "@/types/validation";
import type { RequirementRef } from "@/services/documentValidationService";
import type { QualityRule } from "../types";
import type { MultipleShallRuleConfig } from "../types";

export const multipleShallRule: QualityRule = {
  id: "multipleShall",
  check(req: RequirementRef, config: unknown): ValidationIssue[] {
    const { enabled, maxCount, message, severity, category } = config as MultipleShallRuleConfig;
    if (!enabled) return [];
    const count = (req.bodyText.match(/\bshall\b/gi) ?? []).length;
    if (count <= maxCount) return [];
    return [
      {
        id: `multiple-shall-${req.id}`,
        severity,
        type: "multiple-shall",
        category,
        message: message
          .replace("{id}", req.id)
          .replace("{count}", String(count)),
        targetId: req.id,
      },
    ];
  },
};
