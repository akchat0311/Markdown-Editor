/**
 * Scrubs known non-sentence-terminating periods from `text` so callers can
 * safely reason about REAL sentence/requirement-ending punctuation without
 * being confused by periods that are part of something else entirely.
 *
 * Handled:
 *   - Multi-part numbers: 3.14, 3.2.1, v1.0.0
 *   - Bare leading-dot decimals: .5, .25 (no digit before the dot —
 *     matched separately from multi-part numbers above, which require one)
 *   - Common prose abbreviations that are never sentence terminators:
 *     e.g., i.e., vs.
 *   - Single-letter initials followed by whitespace: "J. Smith", "A. B."
 *
 * Known limitations (not handled):
 *   - Multi-letter abbreviations other than e.g./i.e./vs. (e.g. "Fig.", "Sec.")
 *   - URLs containing dots (e.g. "http://example.com")
 *   - Acronyms with internal dots mid-sentence (e.g. "U.S.A. certified")
 *
 * LENGTH-PRESERVING BY DESIGN: every replacement swaps exactly one '.'
 * character for one '#' character within the matched span, leaving every
 * other character (digits, letters, whitespace) exactly where it was. This
 * means a character offset into the scrubbed string is ALSO a valid offset
 * into the original `text` — required so callers doing position-sensitive
 * work (e.g. periodSpacing, missingTerminalPunctuation) can compute a
 * ValidationIssue.range against the original bodyText, not just count
 * occurrences. (multipleSentencesRule, the original owner of this logic,
 * only ever needed a count and didn't care about this property — but
 * preserving length changes nothing about that count: the same '.'
 * characters are removed either way, only the filler differs.)
 */
export function scrubNonTerminalPeriods(text: string): string {
  return text
    // Multi-part numbers: 3.14, 3.2.1, v1.0.0
    .replace(/\d+(?:\.\d+)+/g, (m) => m.replace(/\./g, "#"))
    // Bare leading-dot decimals: .5, .25 — only when clearly numeric
    // (preceded by start-of-string or whitespace, followed by a digit),
    // so this never touches an end-of-sentence period that happens to be
    // followed by a number-starting word with no space (an already
    // unusual, arguably-malformed pattern in its own right).
    .replace(/(?<=^|\s)\.\d+/g, (m) => m.replace(/\./g, "#"))
    // Prose abbreviations that are never sentence terminators.
    .replace(/\b(?:e\.g|i\.e|vs)\./gi, (m) => m.replace(/\./g, "#"))
    // Single-letter initials followed by whitespace: "J. Smith".
    // Lookahead (not consuming the whitespace) keeps the replacement
    // strictly period-for-'#', so length preservation holds even here.
    .replace(/\b[A-Za-z]\.(?=\s)/g, (m) => m.replace(/\./g, "#"));
}
