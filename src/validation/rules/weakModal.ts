import type { ValidationIssue } from "@/types/validation";
import type { RequirementRef } from "@/services/documentValidationService";
import type { QualityRule } from "../types";
import type { TermListRuleConfig } from "../types";
import { termPattern } from "./_pattern";

// "CAN" all-uppercase is the Controller Area Network acronym in automotive specs.
// Match any mixed-case/lowercase variant of "can" but never the all-uppercase form.
// "May YYYY" / "May DD" are month references; match lowercase "may" always and
// title-case "May" only when not immediately followed by whitespace + a digit.
const MODAL_OVERRIDES: Record<string, RegExp> = {
  can: /(?<!\w)(?!CAN(?!\w))[Cc][Aa][Nn](?!\w)/,
  may: /(?<!\w)(?:may|May(?!\s+\d))(?!\w)/,
};

export const weakModalRule: QualityRule = {
  id: "weakModal",
  check(req: RequirementRef, config: unknown): ValidationIssue[] {
    const { enabled, terms, message, severity, category } = config as TermListRuleConfig;
    if (!enabled) return [];
    const issues: ValidationIssue[] = [];
    for (const term of terms) {
      const pattern = MODAL_OVERRIDES[term] ?? termPattern(term);
      if (pattern.test(req.bodyText)) {
        issues.push({
          id: `weak-modal-${req.id}-${term.replace(/\s+/g, "-")}`,
          severity,
          type: "weak-modal",
          category,
          message: message.replace("{id}", req.id).replace("{term}", term),
          targetId: req.id,
        });
      }
    }
    return issues;
  },
};
