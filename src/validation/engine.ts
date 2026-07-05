import qualityRules from "@/config/quality-rules.json";
import type { JSONContent } from "@tiptap/core";
import {
  checkRequirementOrder,
  checkDuplicateIds,
  checkMissingStatus,
  checkEmptyBody,
} from "@/services/documentValidationService";
import type { RequirementRef } from "@/services/documentValidationService";
import type { ValidationIssue, ValidationCategory } from "@/types/validation";
import type { RuleId } from "./types";
import { RULE_REGISTRY, DOC_RULE_REGISTRY } from "./registry";

const r = qualityRules.rules;

function tag(issues: ValidationIssue[], category: ValidationCategory): ValidationIssue[] {
  return issues.map((i) => ({ ...i, category }));
}

/**
 * Runs all enabled quality rules against the supplied requirement list and
 * returns a flat issue array.
 *
 * Structural rules delegate to documentValidationService (existing logic);
 * the engine tags their results with the category from quality-rules.json.
 *
 * Requirement-level rules are driven by RULE_REGISTRY (one req at a time).
 * Document-level rules are driven by DOC_RULE_REGISTRY (full array at once).
 * The engine has no knowledge of individual rule names or config shapes.
 */
export function runAllValidations(
  requirements: ReadonlyArray<RequirementRef>,
  validAliases: ReadonlySet<string>,
  docContent?: ReadonlyArray<JSONContent>,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  if (r.requirementOrder.enabled) {
    issues.push(...tag(checkRequirementOrder(requirements), r.requirementOrder.category as ValidationCategory));
  }
  if (r.duplicateId.enabled) {
    issues.push(...tag(checkDuplicateIds(requirements), r.duplicateId.category as ValidationCategory));
  }
  if (r.missingStatus.enabled) {
    issues.push(...tag(checkMissingStatus(requirements, validAliases), r.missingStatus.category as ValidationCategory));
  }
  if (r.emptyBody.enabled) {
    issues.push(...tag(checkEmptyBody(requirements), r.emptyBody.category as ValidationCategory));
  }

  for (const req of requirements) {
    for (const rule of RULE_REGISTRY) {
      const config = r[rule.id as RuleId];
      issues.push(...rule.check(req, config));
    }
  }

  for (const rule of DOC_RULE_REGISTRY) {
    const config = r[rule.id as RuleId];
    issues.push(...rule.check(requirements, config, docContent));
  }

  return issues;
}
