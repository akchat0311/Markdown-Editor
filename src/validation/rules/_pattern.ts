function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Builds a case-insensitive pattern that matches `term` when it is not
 * immediately preceded or followed by a word character.
 * Handles multi-word terms ("ought to") and terms ending with punctuation
 * ("etc.", "N/A") correctly.
 */
export function termPattern(term: string): RegExp {
  return new RegExp(`(?<!\\w)${escapeRegExp(term)}(?!\\w)`, "i");
}
