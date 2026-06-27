import type { ValidationIssue } from "@/types/validation";
import type { RequirementRef } from "@/services/documentValidationService";
import type { QualityRule, TermListRuleConfig } from "../types";
import { termPattern } from "./_pattern";

export const vagueQuantifiersRule: QualityRule = {
  id: "vagueQuantifiers",
  check(req: RequirementRef, config: unknown): ValidationIssue[] {
    const { enabled, terms, message, severity, category } = config as TermListRuleConfig;
    if (!enabled) return [];
    const issues: ValidationIssue[] = [];
    for (const term of terms) {
      if (termPattern(term).test(req.bodyText)) {
        issues.push({
          id: `vague-quantifier-${req.id}-${term.replace(/\s+/g, "-")}`,
          severity,
          type: "vague-quantifier",
          category,
          message: message.replace("{id}", req.id).replace("{term}", term),
          targetId: req.id,
        });
      }
    }
    return issues;
  },
};
