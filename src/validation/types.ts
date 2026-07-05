import type qualityRules from "@/config/quality-rules.json";
import type { JSONContent } from "@tiptap/core";
import type { ValidationSeverity, ValidationCategory, ValidationIssue } from "@/types/validation";
import type { RequirementRef } from "@/services/documentValidationService";

/** Union of every rule ID present in quality-rules.json. */
export type RuleId = keyof typeof qualityRules.rules;

/**
 * Contract every configurable quality rule must satisfy.
 *
 * `config` is `unknown` at this boundary — each rule casts to its specific
 * config type internally. This is safe because the engine always passes the
 * config slice whose key matches `rule.id`.
 */
export interface QualityRule {
  readonly id: RuleId;
  check(req: RequirementRef, config: unknown): ValidationIssue[];
}

export interface BaseRuleConfig {
  readonly id: string;
  readonly category: ValidationCategory;
  readonly enabled: boolean;
  readonly severity: ValidationSeverity;
  readonly title: string;
  readonly description: string;
}

/** Rule config that carries a human-readable message template. */
export interface MessageRuleConfig extends BaseRuleConfig {
  readonly message: string;
}

export interface TermListRuleConfig extends MessageRuleConfig {
  readonly terms: readonly string[];
}

export interface WordCountRuleConfig extends MessageRuleConfig {
  readonly maxWords: number;
}

export interface MultipleShallRuleConfig extends MessageRuleConfig {
  readonly maxCount: number;
}

export interface AcronymRuleConfig extends MessageRuleConfig {
  readonly ignored: readonly string[];
}

/**
 * Contract for rules that operate on the full document rather than a single
 * requirement. The engine iterates DOC_RULE_REGISTRY and passes the entire
 * requirement array; the rule is responsible for its own ordering logic.
 */
export interface DocumentQualityRule {
  readonly id: RuleId;
  check(
    requirements: ReadonlyArray<RequirementRef>,
    config: unknown,
    docContent?: ReadonlyArray<JSONContent>,
  ): ValidationIssue[];
}
