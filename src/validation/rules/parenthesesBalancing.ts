import type { ValidationIssue } from "@/types/validation";
import type { RequirementRef } from "@/services/documentValidationService";
import type { QualityRule, MessageRuleConfig } from "../types";

/**
 * Scans `text` left to right with a stack of open-paren positions. Returns
 * the position of the first problem found: an unmatched `)` (found during
 * the forward scan, the stack is empty when it's encountered) or, if the
 * scan completes with unmatched opens still on the stack, the position of
 * the EARLIEST of those. Returns null when balanced. This is the only
 * check in Phase 1 that needs real logic rather than a single regex — a
 * running counter alone can't distinguish "well-formed but nested" from
 * "genuinely unbalanced," and can't report a useful position either.
 */
function findUnbalancedParen(text: string): number | null {
  const stack: number[] = [];
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "(") stack.push(i);
    else if (text[i] === ")") {
      if (stack.length === 0) return i; // a close with nothing open to match
      stack.pop();
    }
  }
  return stack.length > 0 ? stack[0] : null; // earliest unmatched open, if any
}

/**
 * Detection strategy: see findUnbalancedParen above. One issue per
 * requirement — a single unbalanced-or-not verdict, since a plain
 * open/close count has no way to meaningfully attribute "the" problem to
 * more than one position once the first mismatch is found.
 *
 * Expected false positives, and how they're handled:
 *
 * - Nested parentheses ("(a (b) c)") are handled correctly by the stack —
 *   not a false-positive source.
 * - Markdown link syntax `[text](url)` might look like a risk, but isn't:
 *   ProseMirror represents a link as a MARK on the visible text (carrying
 *   the URL in `attrs.href`), not as literal "(url)" characters in the
 *   node's own `.text`. extractBodyText only ever reads `.text` — the
 *   literal parenthesis characters from link syntax never reach bodyText
 *   in the first place, so this rule never sees them.
 * - Cross-block joining (requirement bodies spanning multiple paragraphs/
 *   list items are joined with no separator — see repeatedWords.ts and
 *   periodSpacing.ts for the same underlying fact) could in principle
 *   make two independently-well-formed blocks look unbalanced when
 *   concatenated, or mask a genuine same-block mistake by coincidental
 *   pairing with an unrelated character in the next block. Considered
 *   lower-probability than the equivalent risk for period spacing
 *   (parenthetical asides spanning a paragraph break are rare), so not
 *   separately mitigated — flagged here for transparency.
 */
export const parenthesesBalancingRule: QualityRule = {
  id: "parenthesesBalancing",
  check(req: RequirementRef, config: unknown): ValidationIssue[] {
    const { enabled, severity, category, message } = config as MessageRuleConfig;
    if (!enabled) return [];

    const pos = findUnbalancedParen(req.bodyText);
    if (pos === null) return [];

    return [
      {
        id: `parentheses-balancing-${req.id}`,
        severity,
        type: "parentheses-balancing",
        category,
        message: message.replace("{id}", req.id),
        targetId: req.id,
        range: { from: pos, to: pos + 1 },
      },
    ];
  },
};
