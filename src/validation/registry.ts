import type { QualityRule, DocumentQualityRule } from "./types";
import { weakModalRule } from "./rules/weakModal";
import { ambiguousWordsRule } from "./rules/ambiguousWords";
import { forbiddenTermsRule } from "./rules/forbiddenTerms";
import { wordCountRule } from "./rules/wordCount";
import { multipleShallRule } from "./rules/multipleShall";
import { vagueQuantifiersRule } from "./rules/vagueQuantifiers";
import { escapeClausesRule } from "./rules/escapeClauses";
import { multipleSentencesRule } from "./rules/multipleSentences";
import { undefinedAcronymsRule } from "./rules/undefinedAcronyms";

export type { QualityRule, DocumentQualityRule };

/**
 * Requirement-level rules. Each rule receives one RequirementRef at a time.
 * The engine iterates requirements × RULE_REGISTRY.
 *
 * To add a new requirement-level rule:
 *   1. Create src/validation/rules/<ruleId>.ts exporting a QualityRule object.
 *   2. Import and add it to this array.
 *   3. Add the corresponding entry to src/config/quality-rules.json.
 */
export const RULE_REGISTRY: QualityRule[] = [
  weakModalRule,
  ambiguousWordsRule,
  forbiddenTermsRule,
  wordCountRule,
  multipleShallRule,
  vagueQuantifiersRule,
  escapeClausesRule,
  multipleSentencesRule,
];

/**
 * Document-level rules. Each rule receives the full requirement array and is
 * responsible for its own ordering/accumulation logic.
 *
 * To add a new document-level rule:
 *   1. Create src/validation/rules/<ruleId>.ts exporting a DocumentQualityRule object.
 *   2. Import and add it to this array.
 *   3. Add the corresponding entry to src/config/quality-rules.json.
 */
export const DOC_RULE_REGISTRY: DocumentQualityRule[] = [
  undefinedAcronymsRule,
];
