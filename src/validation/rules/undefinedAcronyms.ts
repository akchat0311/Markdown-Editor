import type { ValidationIssue } from "@/types/validation";
import type { RequirementRef } from "@/services/documentValidationService";
import type { DocumentQualityRule, AcronymRuleConfig } from "../types";

// Matches definitions of the form: "Two Or More Words (ACRONYM)"
// Requires ≥ 2 words before the parenthesised acronym to avoid treating
// articles like "the (ECU) bus" as definitions.
const DEFINITION_SRC = String.raw`\b(?:[A-Za-z][-A-Za-z]*\s+){2,}\(([A-Z][A-Z0-9]{1,})\)`;

// Matches standalone uppercase tokens of two or more characters.
const ACRONYM_SRC = String.raw`\b([A-Z][A-Z0-9]{1,})\b`;

function extractDefinitions(text: string): string[] {
  const defs: string[] = [];
  const re = new RegExp(DEFINITION_SRC, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) defs.push(m[1]);
  return defs;
}

function extractUsages(text: string): string[] {
  // Scrub definition patterns first so the acronym inside "(ECU)" is not
  // treated as a standalone usage.
  const scrubbed = text.replace(new RegExp(DEFINITION_SRC, "g"), "defined");
  const usages: string[] = [];
  const re = new RegExp(ACRONYM_SRC, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(scrubbed)) !== null) usages.push(m[1]);
  return usages;
}

export const undefinedAcronymsRule: DocumentQualityRule = {
  id: "undefinedAcronyms",
  check(requirements: ReadonlyArray<RequirementRef>, config: unknown): ValidationIssue[] {
    const { enabled, ignored, message, severity, category } = config as AcronymRuleConfig;
    if (!enabled) return [];

    const ignoredSet = new Set(ignored);
    const defined = new Set<string>();
    const issues: ValidationIssue[] = [];

    for (const req of requirements) {
      // Collect definitions from this requirement before checking usages so
      // that an acronym defined and used within the same requirement is valid.
      for (const acronym of extractDefinitions(req.bodyText)) {
        defined.add(acronym);
      }

      const usages = new Set(extractUsages(req.bodyText));
      for (const acronym of usages) {
        if (!defined.has(acronym) && !ignoredSet.has(acronym)) {
          issues.push({
            id: `undefined-acronym-${req.id}-${acronym}`,
            severity,
            type: "undefined-acronym",
            category,
            message: message.replace("{id}", req.id).replace("{term}", acronym),
            targetId: req.id,
          });
        }
      }
    }

    return issues;
  },
};
