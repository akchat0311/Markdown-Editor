import type { JSONContent } from "@tiptap/core";
import type { ValidationIssue, ValidationSeverity, ValidationCategory } from "@/types/validation";
import type { RequirementRef } from "@/services/documentValidationService";
import type { DocumentQualityRule, AcronymRuleConfig } from "../types";
import { extractBodyText } from "@/editor/utils/extractBodyText";

// Structural exclusions: tokens that are unambiguously requirement-language
// constructs, logical/grammatical connectives, universal quantifiers, or
// universal boolean/state literals — never domain acronyms.
// Applied after lexical candidate discovery and before configured-ignore filtering.
const BUILTIN_EXCLUDED = new Set([
  // Requirement-language keywords
  "SHALL", "SHOULD", "MAY", "MUST", "WILL",
  // Logical/grammatical connectives
  "NOT", "AND", "OR", "IF", "NOR",
  // Requirement quantifiers
  "ALL", "ANY", "NONE", "EACH", "EVERY", "SOME",
  // Universal boolean and activation-state literals
  "TRUE", "FALSE", "ENABLED", "DISABLED",
  "ACTIVE", "INACTIVE", "ON", "OFF",
]);

// Matches definitions of the form: "Two Or More Words (ACRONYM)" including
// hyphenated full names such as "End-of-Line (EOL)".
// [-\s]+ as the inter-unit separator treats hyphens as word separators in
// addition to spaces, so "End-" / "of-" / "Line " each count as one unit.
// Requires ≥ 2 units before the parenthesised acronym to prevent short
// phrases like "the (ECU) bus" from being treated as definitions.
const DEFINITION_SRC = String.raw`\b(?:[A-Za-z]+[-\s]+){2,}\(([A-Z][A-Z0-9]{1,})\)`;

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

// ── Acronym table detection ───────────────────────────────────────────────────

const ACRONYM_COL_HEADERS = new Set([
  "acronym", "acronyms", "abbreviation", "abbreviations", "abbr", "term",
]);
const DEF_COL_HEADERS = new Set([
  "definition", "definitions", "meaning", "meanings", "description", "full name", "expansion",
]);

function isAcronymTable(block: JSONContent): boolean {
  if (block.type !== "table") return false;
  const rows = block.content;
  if (!Array.isArray(rows) || rows.length < 2) return false;
  const firstRow = rows[0];
  if (!Array.isArray(firstRow.content) || firstRow.content.length < 2) return false;
  if (!firstRow.content.every((c: JSONContent) => c.type === "tableHeader")) return false;
  const col0 = extractBodyText(firstRow.content[0]).trim().toLowerCase();
  const col1 = extractBodyText(firstRow.content[1]).trim().toLowerCase();
  return ACRONYM_COL_HEADERS.has(col0) && DEF_COL_HEADERS.has(col1);
}

function extractAcronymTableDefs(block: JSONContent): string[] {
  const defs: string[] = [];
  const rows = Array.isArray(block.content) ? block.content : [];
  // Skip first row (header); skip any subsequent rows where all cells are tableHeader
  for (const row of rows.slice(1)) {
    if (!Array.isArray(row.content) || row.content.length < 2) continue;
    if (row.content.every((c: JSONContent) => c.type === "tableHeader")) continue;
    const acronym = extractBodyText(row.content[0]).trim();
    const definition = extractBodyText(row.content[1]).trim();
    if (!acronym || !definition) continue;
    if (/^[A-Z][A-Z0-9]{1,}$/.test(acronym)) {
      defs.push(acronym);
    }
  }
  return defs;
}

// ── Heading → requirement ID matching ────────────────────────────────────────

function matchRequirementId(headingText: string, reqIdSet: Set<string>): string | null {
  const t = headingText.trim();
  for (const id of reqIdSet) {
    if (t === id) return id;
    if (t.length > id.length && t.startsWith(id)) {
      // Require a non-identifier character after the ID (prevents REQ_001 matching REQ_0010)
      if (!/[A-Za-z0-9_]/.test(t[id.length])) return id;
    }
  }
  return null;
}

// ── Document-wide scan ────────────────────────────────────────────────────────

function checkWithDocContent(
  docContent: ReadonlyArray<JSONContent>,
  requirements: ReadonlyArray<RequirementRef>,
  ignoredSet: Set<string>,
  severity: ValidationSeverity,
  category: ValidationCategory,
  message: string,
): ValidationIssue[] {
  const defined = new Set<string>();
  const issues: ValidationIssue[] = [];
  const reqIdSet = new Set(requirements.map((r) => r.id));
  let currentRequirementId: string | null = null;
  // Dedup key: "<reqId>-<acronym>" for requirement context, "__doc__-<acronym>" for document context.
  // Prevents the same (context, acronym) pair from generating multiple issues across paragraphs.
  const seenInContext = new Set<string>();

  for (let i = 0; i < docContent.length; i++) {
    const block = docContent[i];

    // Headings update context but are not scanned for acronym usages.
    if (block.type === "heading") {
      const text = extractBodyText(block);
      currentRequirementId = matchRequirementId(text, reqIdSet);
      continue;
    }

    // Recognized acronym tables: collect definitions, skip usage scan.
    if (isAcronymTable(block)) {
      for (const acronym of extractAcronymTableDefs(block)) {
        defined.add(acronym);
      }
      continue;
    }

    // All other blocks: extract prose, collect definitions first, then check usages.
    const text = extractBodyText(block);

    for (const acronym of extractDefinitions(text)) {
      defined.add(acronym);
    }

    const usages = new Set(extractUsages(text));
    for (const acronym of usages) {
      if (BUILTIN_EXCLUDED.has(acronym) || ignoredSet.has(acronym) || defined.has(acronym)) {
        continue;
      }
      const contextKey = `${currentRequirementId ?? "__doc__"}-${acronym}`;
      if (seenInContext.has(contextKey)) continue;
      seenInContext.add(contextKey);

      const targetId = currentRequirementId ?? undefined;
      const rawMsg = message.replace("{id}", currentRequirementId ?? "").replace("{term}", acronym);
      // Strip leading ": " when there is no requirement id in the template slot.
      const formattedMessage = currentRequirementId ? rawMsg : rawMsg.replace(/^: /, "");
      issues.push({
        id: `undefined-acronym-${currentRequirementId ?? `doc-${i}`}-${acronym}`,
        severity,
        type: "undefined-acronym",
        category,
        message: formattedMessage,
        targetId,
        documentIndex: i,
      });
    }
  }

  return issues;
}

// ── Rule ──────────────────────────────────────────────────────────────────────

export const undefinedAcronymsRule: DocumentQualityRule = {
  id: "undefinedAcronyms",
  check(
    requirements: ReadonlyArray<RequirementRef>,
    config: unknown,
    docContent?: ReadonlyArray<JSONContent>,
  ): ValidationIssue[] {
    const { enabled, ignored, message, severity, category } = config as AcronymRuleConfig;
    if (!enabled) return [];

    const ignoredSet = new Set(ignored);

    // Document-wide path: ordered scan over the full content array.
    if (docContent && docContent.length > 0) {
      return checkWithDocContent(docContent, requirements, ignoredSet, severity, category, message);
    }

    // Fallback path: requirement-only scan (preserves existing behavior when docContent absent).
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
        if (
          !BUILTIN_EXCLUDED.has(acronym) &&
          !ignoredSet.has(acronym) &&
          !defined.has(acronym)
        ) {
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
