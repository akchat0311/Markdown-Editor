import type { ValidationIssue } from "@/types/validation";
import type { RequirementRef } from "@/services/documentValidationService";
import type { QualityRule, MessageRuleConfig } from "../types";

// A small number of English words are legitimately doubled in normal prose
// ("the reason THAT THAT value...", "she HAD HAD enough"). Mirrors
// weakModal.ts's MODAL_OVERRIDES instinct: a hand-maintained exception set
// for known-legitimate collisions, rather than trying to detect grammatical
// legitimacy generically.
const LEGITIMATE_REPEATS = new Set(["that", "had"]);

/**
 * Detection strategy: `\b(\w+)\s+\1\b` (case-insensitive) over the
 * requirement body — flags a word immediately followed by itself. One
 * issue per occurrence (not one per requirement), each independently
 * locatable via `range`, which covers the full "word1 word2" span so a
 * quick fix (later, not now) would know exactly what to collapse.
 *
 * Expected false positives, and how they're handled:
 *
 * - Legitimately doubled words in standard English ("that that", "had
 *   had") — handled via the LEGITIMATE_REPEATS exception set above; the
 *   match is skipped (not flagged) when the repeated word, lowercased,
 *   is in that set.
 * - Cross-block-boundary false positives (a common risk for other Phase 1
 *   rules, since requirement bodies spanning multiple paragraphs/list
 *   items are joined with NO separator by useDocumentValidation.ts) are
 *   NOT a practical concern here: with zero separator between blocks,
 *   `\s+` (which requires at least one whitespace character) cannot match
 *   across a block boundary at all, so a repeated word can only be found
 *   within a single block's own authored text.
 * - Not excluded, deliberately: repeated requirement IDs or numbers (e.g.
 *   "REQ_001 REQ_001") are flagged like any other repeat — a genuine
 *   duplication is exactly the kind of copy-paste mistake this rule
 *   exists to catch, not a false positive.
 */
export const repeatedWordsRule: QualityRule = {
  id: "repeatedWords",
  check(req: RequirementRef, config: unknown): ValidationIssue[] {
    const { enabled, severity, category, message } = config as MessageRuleConfig;
    if (!enabled) return [];

    const issues: ValidationIssue[] = [];
    const pattern = /\b(\w+)\s+\1\b/gi;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(req.bodyText)) !== null) {
      const word = match[1];
      if (LEGITIMATE_REPEATS.has(word.toLowerCase())) continue;
      issues.push({
        id: `repeated-words-${req.id}-${match.index}`,
        severity,
        type: "repeated-words",
        category,
        message: message.replace("{id}", req.id).replace("{word}", word),
        targetId: req.id,
        range: { from: match.index, to: match.index + match[0].length },
      });
    }
    return issues;
  },
};
