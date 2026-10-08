import { resolveRequirementStatus } from "@/services/requirementStatusService";
import type { RequirementStatus } from "@/types/requirementStatus";

/**
 * Shared tokenizer for the trailing bracket fields of a requirement heading
 * (design D10/D11 — approved 2026-09-01).
 *
 * Grammar:  <ID> <optional title> [Status] [Variant]
 *
 * At most TWO whitespace-separated `[...]` groups anchored at the end of the
 * heading text are recognized; canonical write order is status first,
 * variant last. Classification is vocabulary-first, position-second:
 *
 *   two groups [A] [B]:
 *     A resolves to a configured status  → status = A, variant = B
 *     only B resolves                    → status = B, A stays in the title
 *       (preserves pre-variant behavior for "REQ_001 T [see §3] [Draft]")
 *     neither resolves                   → status = B reported "unknown",
 *       A stays in the title (byte-for-byte the pre-variant behavior)
 *   one group → it is the status whether or not it resolves ("unknown"
 *       when not) — a variant therefore requires a status to be present.
 *
 * Every heading shape that parsed before variants exist parses identically
 * through this function; the ONLY new outcome is the canonical two-group
 * form. This is the single replacement for the last-bracket regexes that
 * used to live in requirementStatusPlugin, reviewCommentBadgePlugin,
 * requirementOps (index + title), reviewExportService, and
 * useDocumentValidation.
 */

export interface HeadingBracket {
  /** The bracket group verbatim, including "[" and "]". */
  raw: string;
  /** Trimmed text inside the brackets (emphasis chars NOT stripped). */
  inner: string;
  /** Character offsets of the bracket group within the heading text. */
  charFrom: number;
  charTo: number;
}

export interface HeadingFields {
  status: (HeadingBracket & { statusId: string }) | null;
  variant: HeadingBracket | null;
}

const TRAILING_BRACKET = /(\[[^\]]+\])\s*$/;

function bracketAtEnd(text: string): HeadingBracket | null {
  const m = text.match(TRAILING_BRACKET);
  if (!m) return null;
  const charFrom = text.lastIndexOf(m[1]);
  return {
    raw: m[1],
    inner: m[1].slice(1, -1).trim(),
    charFrom,
    charTo: charFrom + m[1].length,
  };
}

export function parseHeadingFields(
  text: string,
  statuses: RequirementStatus[],
): HeadingFields {
  const last = bracketAtEnd(text);
  if (!last) return { status: null, variant: null };

  const before = bracketAtEnd(text.slice(0, last.charFrom));
  if (before) {
    const beforeId = resolveRequirementStatus(before.inner, statuses);
    if (beforeId !== "unknown") {
      return { status: { ...before, statusId: beforeId }, variant: last };
    }
  }
  return {
    status: { ...last, statusId: resolveRequirementStatus(last.inner, statuses) },
    variant: null,
  };
}

/**
 * Display form of a variant bracket's text: emphasis characters stripped the
 * same way status labels are normalized for comparison, but case preserved.
 */
export function variantDisplayText(inner: string): string {
  return inner.replace(/^[*_]+|[*_]+$/g, "").trim();
}

/**
 * Character offset where the trailing fields begin (for title derivation:
 * the title is everything between the matched ID and this offset). Equals
 * text.length when the heading has no trailing fields.
 */
export function fieldsStartOffset(text: string, fields: HeadingFields): number {
  const firsts = [fields.status?.charFrom, fields.variant?.charFrom].filter(
    (v): v is number => typeof v === "number",
  );
  return firsts.length ? Math.min(...firsts) : text.length;
}
