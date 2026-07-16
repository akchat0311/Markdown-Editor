import type { JSONContent } from "@tiptap/core";
import type { OutlineNode } from "@/types/outline";
import type { RequirementStatus } from "@/types/requirementStatus";
import type { RequirementPattern } from "@/stores/configStore";
import { getNodeSectionRange, getSectionRange, renameHeading } from "@/editor/utils/outlineOps";
import { resolveRequirementStatus } from "@/services/requirementStatusService";

// ── Pattern derivation ────────────────────────────────────────────────────────

export interface DerivedPattern {
  prefix: string;
  digits: number;
}

/**
 * Derives prefix and digit-width from a user-supplied example ID string.
 *
 * Algorithm:
 *   1. Find the trailing numeric run with /(\d+)$/.
 *   2. If none exists the example is invalid → return null.
 *   3. prefix = everything before that run; digits = run length.
 *
 * Examples:
 *   "TRANS_TOS_001" → { prefix: "TRANS_TOS_", digits: 3 }
 *   "SYS_REQ_0001"  → { prefix: "SYS_REQ_",   digits: 4 }
 *   "UC1"           → { prefix: "UC",           digits: 1 }
 *   "FR-001"        → { prefix: "FR-",          digits: 3 }
 */
export function derivePattern(example: string): DerivedPattern | null {
  const match = example.match(/(\d+)$/);
  if (!match) return null;
  const numStr = match[1];
  return {
    prefix: example.slice(0, example.length - numStr.length),
    digits: numStr.length,
  };
}

/**
 * Formats a numeric value as a requirement ID using the derived prefix and
 * zero-padding width.  Numbers exceeding the width are not truncated.
 *
 * formatId(1, "REQ-", 3)  → "REQ-001"
 * formatId(42, "TRANS_TOS_", 3) → "TRANS_TOS_042"
 * formatId(1000, "REQ-", 3)  → "REQ-1000"  (exceeds width, still valid)
 */
export function formatId(num: number, prefix: string, digits: number): string {
  return prefix + String(num).padStart(digits, "0");
}

// ── Regex helpers ─────────────────────────────────────────────────────────────

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Builds the detection regex: ^{escapedPrefix}(\d+)
 * The capture group returns the raw digit string exactly as it appears in the
 * heading — preserving the original zero-padding for exact-match deduplication.
 */
export function buildDetectionRegex(prefix: string): RegExp {
  return new RegExp("^" + escapeRegex(prefix) + "(\\d+)");
}

// ── Compiled pattern (simple OR regex mode) ────────────────────────────────────
//
// Every consumer (extraction, navigation, validation, outline) goes through
// compileRequirementPattern() + matchRequirementId() instead of deriving a
// regex by hand. This is what lets regex mode slot in everywhere simple mode
// already worked, and is also where the "compile once, reuse it" performance
// requirement is satisfied: the compiled RegExp is cached and only rebuilt
// when the underlying pattern config actually changes (see below).

// Discriminated union (on both `mode` and `supportsNumbering`) so that
// narrowing on either field gives TypeScript-checked access to prefix/digits
// — callers don't need non-null assertions after checking supportsNumbering.
export type CompiledPattern =
  | {
      mode: "simple";
      /** Always anchored to match at the start of the heading label (index 0). */
      regex: RegExp;
      prefix: string;
      digits: number;
      supportsNumbering: true;
    }
  | {
      mode: "regex";
      regex: RegExp;
      prefix: null;
      digits: null;
      /**
       * Regex mode has no way to *generate* a new ID (a regex describes
       * matching, not construction), so ID-generating mutations — Insert
       * Requirement, Renumber, Reassign Duplicate, and the "/requirement"
       * slash command — are unavailable in regex mode. Callers must check
       * this before invoking nextAvailableId / renumberRequirements /
       * insertRequirementAfter / computeRenumberReplacements.
       */
      supportsNumbering: false;
    };

/**
 * Accepted anywhere a requirement pattern is needed. A plain string is
 * treated as a simple-mode example (this is the pre-regex-mode calling
 * convention and remains fully supported for backward compatibility — every
 * existing call site and persisted document keeps working unchanged).
 */
export type RequirementPatternInput = RequirementPattern | string | null | undefined;

function normalizePatternInput(input: RequirementPatternInput): RequirementPattern | null {
  if (input == null) return null;
  if (typeof input === "string") return input ? { mode: "simple", example: input } : null;
  return input;
}

/**
 * Counts the capturing groups in a regex source, including named groups
 * (which also occupy a positional slot). Standard technique: append an
 * empty alternative so the regex always matches, then read how many
 * elements `.exec("")` returns beyond the full-match slot.
 */
function countCapturingGroups(source: string, flags: string): number {
  const probe = new RegExp(source + "|", flags.replace(/[gy]/g, ""));
  const m = probe.exec("");
  return m ? m.length - 1 : 0;
}

function sanitizeFlags(flags: string): string {
  // 'g'/'y' make the RegExp stateful (lastIndex) across repeated exec() calls
  // on different strings, which every call site here does in a loop over
  // headings. Stripping them keeps matching stateless and correct.
  return flags.replace(/[gy]/g, "");
}

export interface RegexValidationResult {
  valid: boolean;
  error: string | null;
}

/**
 * Validates a user-supplied regex-mode pattern. An invalid pattern must
 * never reach compileRequirementPattern()/be used by the validator — this
 * is the single gate both the settings UI and the store should check before
 * committing a regex pattern.
 *
 * Requirements for validity:
 *   1. Non-empty source.
 *   2. Compiles as a RegExp (no syntax errors).
 *   3. Has at least one capturing group — this is what supplies the
 *      requirement ID. A named group called `id` is preferred when present;
 *      otherwise the first capturing group is used. A pattern with no
 *      capture group at all is rejected outright rather than silently
 *      falling back to the whole match, so authors get an explicit error
 *      instead of surprising extraction results.
 */
export function validateRequirementRegex(source: string, flags: string = ""): RegexValidationResult {
  const trimmed = source.trim();
  if (!trimmed) return { valid: false, error: "Pattern cannot be empty." };

  let groupCount: number;
  try {
    // eslint-disable-next-line no-new -- constructed only to surface a SyntaxError
    new RegExp(trimmed, sanitizeFlags(flags));
    groupCount = countCapturingGroups(trimmed, flags);
  } catch (e) {
    return { valid: false, error: e instanceof Error ? e.message : "Invalid regular expression." };
  }

  if (groupCount === 0) {
    return {
      valid: false,
      error: "Pattern must include a capture group for the requirement ID, e.g. (\\d+) or (?<id>...).",
    };
  }

  return { valid: true, error: null };
}

interface CompiledCacheEntry {
  key: string;
  compiled: CompiledPattern | null;
}

// Single-slot cache: in practice exactly one requirement pattern is active
// app-wide at a time (it's global config, see configStore.ts), so a single
// last-compiled slot gives an effectively 100% hit rate between pattern
// changes — which is exactly the hot path, since this is invoked on every
// ProseMirror transaction across three plugins. Recompiling only happens
// when the pattern itself changes, not on every heading scan.
let compiledCache: CompiledCacheEntry | null = null;

function patternCacheKey(pattern: RequirementPattern): string {
  return pattern.mode === "regex"
    ? `regex:${pattern.flags}:${pattern.source}`
    : `simple:${pattern.example}`;
}

function compilePatternUncached(pattern: RequirementPattern): CompiledPattern | null {
  if (pattern.mode === "simple") {
    const derived = derivePattern(pattern.example);
    if (!derived) return null;
    return {
      mode: "simple",
      regex: buildDetectionRegex(derived.prefix),
      prefix: derived.prefix,
      digits: derived.digits,
      supportsNumbering: true,
    };
  }

  const validation = validateRequirementRegex(pattern.source, pattern.flags);
  if (!validation.valid) return null;

  let regex: RegExp;
  try {
    regex = new RegExp(pattern.source.trim(), sanitizeFlags(pattern.flags));
  } catch {
    return null;
  }

  return { mode: "regex", regex, prefix: null, digits: null, supportsNumbering: false };
}

/**
 * Compiles a requirement pattern (simple example or regex) into a reusable
 * CompiledPattern, or null when the pattern is unconfigured or invalid.
 * An invalid regex (fails validateRequirementRegex) always compiles to null
 * here — this is the single choke point that guarantees invalid patterns
 * are never used by extraction, navigation, validation, or the outline.
 *
 * Cached: repeated calls with an equal pattern reuse the same compiled
 * RegExp instance instead of rebuilding it (see compiledCache above).
 */
export function compileRequirementPattern(input: RequirementPatternInput): CompiledPattern | null {
  const pattern = normalizePatternInput(input);
  if (!pattern) return null;

  const key = patternCacheKey(pattern);
  if (compiledCache && compiledCache.key === key) return compiledCache.compiled;

  const compiled = compilePatternUncached(pattern);
  compiledCache = { key, compiled };
  return compiled;
}

/** Human-readable summary for UI display, independent of mode. */
export function describeRequirementPattern(pattern: RequirementPattern | null): string {
  if (!pattern) return "";
  return pattern.mode === "simple" ? pattern.example : `/${pattern.source}/${pattern.flags}`;
}

export interface MatchedRequirement {
  /** Exact ID string: simple mode reconstructs prefix + digits; regex mode
   *  uses the named `id` group (or first capture group) verbatim. */
  id: string;
  /** Length of the full match (group 0) — use this, not id.length, to slice
   *  off the ID portion of a heading label (regex mode's capture group does
   *  not necessarily start at, or span, the whole match). */
  matchLength: number;
  /** Parsed integer when `id` is purely numeric, else null. Simple mode is
   *  always non-null (buildDetectionRegex's capture group is `(\d+)` by
   *  construction). Regex mode is null whenever the captured ID isn't a bare
   *  digit string — gap detection and renumbering are skipped in that case
   *  (see analyzeRequirements' `missing` field and CompiledPattern.supportsNumbering). */
  num: number | null;
}

/**
 * Matches a heading label against a compiled pattern. Matches must start at
 * the beginning of the label (mirrors simple mode's implicit `^` anchor) —
 * a regex-mode pattern that matches mid-string is not considered a
 * requirement heading.
 */
export function matchRequirementId(label: string, compiled: CompiledPattern): MatchedRequirement | null {
  const m = compiled.regex.exec(label);
  if (!m || m.index !== 0) return null;

  if (compiled.mode === "simple") {
    const digits = m[1]; // guaranteed present: buildDetectionRegex always captures (\d+)
    return {
      id: (compiled.prefix ?? "") + digits,
      matchLength: m[0].length,
      num: parseInt(digits, 10),
    };
  }

  const id = String(m.groups?.id ?? m[1] ?? m[0]);
  const num = /^\d+$/.test(id) ? parseInt(id, 10) : null;
  return { id, matchLength: m[0].length, num };
}

// ── Analysis output types ─────────────────────────────────────────────────────

export interface RequirementEntry {
  node: OutlineNode;
  /** Exact ID string (see MatchedRequirement.id). */
  id: string;
  /** Integer value of the numeric suffix (see MatchedRequirement.num). Always
   *  non-null for simple-mode patterns; may be null for regex-mode patterns
   *  whose captured ID isn't purely numeric. */
  num: number | null;
}

export interface RequirementAnalysis {
  requirements: RequirementEntry[];
  /**
   * Map from exact ID string to all nodes with that ID.
   * Only entries with ≥ 2 nodes are included.
   *
   * Duplicate detection uses the EXACT reconstructed id string, so
   * "TRANS_TOS_01" and "TRANS_TOS_001" are distinct IDs and are NOT flagged
   * as duplicates (they are formatting inconsistencies, not duplicates).
   */
  duplicates: Map<string, OutlineNode[]>;
  /** Formatted IDs for every integer gap between min and max. */
  missing: string[];
  /**
   * Map from OutlineNode.key to the count of requirement headings whose
   * doc.content index falls within that node's section range.
   * Includes the section heading itself if it is a requirement.
   */
  countsBySection: Map<string, number>;
}

// ── Core analysis ─────────────────────────────────────────────────────────────

/**
 * Analyses the flat outline against the given requirement pattern (simple
 * example string, or a simple/regex RequirementPattern config). Returns null
 * when the pattern is unconfigured or invalid — an invalid regex pattern is
 * never used here (see compileRequirementPattern).
 *
 * @param flatOutline  Document-order flat list from flattenOutline().
 * @param docContent   editor.getJSON().content — needed for section range computation.
 * @param pattern      A plain example string (simple mode, e.g. "TRANS_TOS_001")
 *                     or a full RequirementPattern (simple or regex mode).
 */
export function analyzeRequirements(
  flatOutline: OutlineNode[],
  docContent: JSONContent[],
  pattern: RequirementPatternInput
): RequirementAnalysis | null {
  const compiled = compileRequirementPattern(pattern);
  if (!compiled) return null;

  // ── Detect requirement headings — single O(n) pass over the outline ──────
  const requirements: RequirementEntry[] = [];
  for (const node of flatOutline) {
    const matched = matchRequirementId(node.label, compiled);
    if (!matched) continue;
    requirements.push({ node, id: matched.id, num: matched.num });
  }

  // ── Duplicate detection (exact id string) ────────────────────────────────
  const byId = new Map<string, OutlineNode[]>();
  for (const entry of requirements) {
    const list = byId.get(entry.id) ?? [];
    list.push(entry.node);
    byId.set(entry.id, list);
  }
  const duplicates = new Map<string, OutlineNode[]>();
  for (const [id, nodes] of byId) {
    if (nodes.length > 1) duplicates.set(id, nodes);
  }

  // ── Missing ID detection (numeric gaps within existing range) ────────────
  // Only meaningful in simple mode: it needs a prefix + digit width to
  // reconstruct the missing IDs' formatted strings, and a total order over
  // every requirement's numeric suffix. Regex mode IDs are not guaranteed to
  // be sequential integers (or even numeric at all), so this is skipped
  // entirely for regex-mode patterns — documented behavior, not an oversight.
  const missing: string[] = [];
  if (compiled.supportsNumbering && requirements.length >= 2) {
    const nums = requirements.map((r) => r.num).filter((n): n is number => n !== null);
    if (nums.length === requirements.length) {
      const prefix = compiled.prefix ?? "";
      const digits = compiled.digits ?? 0;
      const min = Math.min(...nums);
      const max = Math.max(...nums);
      const present = new Set(nums);
      for (let n = min + 1; n < max; n++) {
        if (!present.has(n)) {
          missing.push(formatId(n, prefix, digits));
        }
      }
    }
  }

  // ── Section requirement counts ───────────────────────────────────────────
  const countsBySection = new Map<string, number>();
  for (const sectionNode of flatOutline) {
    const [from, to] = getNodeSectionRange(
      docContent,
      sectionNode.index,
      sectionNode.level ?? 1
    );
    const count = requirements.filter(
      (r) => r.node.index >= from && r.node.index < to
    ).length;
    countsBySection.set(sectionNode.key, count);
  }

  return { requirements, duplicates, missing, countsBySection };
}

// ── Requirements Index ────────────────────────────────────────────────────────

export interface RequirementRecord {
  id: string;
  /** Canonical status id from config (e.g. "draft", "review") or "unknown". */
  status: string;
  /** Label of the nearest non-requirement ancestor heading, or "—" if none. */
  section: string;
  /** ProseMirror absolute offset for click-to-navigate. */
  pmPos: number;
  /** Heading label with ID prefix and optional " [Status]" suffix stripped. */
  title: string;
}

export interface RequirementIndex {
  total: number;
  /** Counts keyed by status.id; always includes "unknown". */
  statusCounts: Record<string, number>;
  requirements: RequirementRecord[];
}

/**
 * Extracts the raw text inside the last `[…]` bracket group from a heading label.
 * Returns null when no bracket group is found.
 *
 * "REQ_001 [Draft]"   → "Draft"
 * "REQ_001 [In Review]" → "In Review"
 * "REQ_001"           → null
 */
export function extractStatusText(label: string): string | null {
  const match = label.match(/\[([^\]]+)\]\s*$/);
  return match ? match[1].trim() : null;
}

/**
 * Builds a RequirementIndex from the flat outline in a single O(n) pass.
 *
 * Section resolution: walks document order, maintaining a level→label map of
 * the most-recent non-requirement headings.  When a requirement is found, the
 * nearest ancestor level (highest level number strictly below the requirement's
 * level) is used as the section name.
 *
 * @param statuses  Loaded from statusConfigStore — alias resolution table.
 * @param pattern   A plain example string (simple mode) or a full
 *                  RequirementPattern (simple or regex mode).
 * Returns null when the pattern is unconfigured or invalid.
 */
export function buildRequirementIndex(
  flatOutline: OutlineNode[],
  pattern: RequirementPatternInput,
  statuses: RequirementStatus[]
): RequirementIndex | null {
  const compiled = compileRequirementPattern(pattern);
  if (!compiled) return null;

  // First pass: match every node once, both flagging requirements (by key)
  // and caching the match so the second pass doesn't re-run the regex.
  const reqKeySet = new Set<string>();
  const matchByKey = new Map<string, MatchedRequirement>();
  for (const node of flatOutline) {
    const matched = matchRequirementId(node.label, compiled);
    if (matched) {
      reqKeySet.add(node.key);
      matchByKey.set(node.key, matched);
    }
  }

  // Second pass: single walk to resolve section + build records.
  const sectionByLevel: Record<number, string> = {};
  const requirements: RequirementRecord[] = [];

  for (const node of flatOutline) {
    const level = node.level ?? 1;

    if (!reqKeySet.has(node.key)) {
      // Non-requirement heading: update the section stack.
      // Evict all entries at levels >= this level (shallower heading resets scope).
      for (const l of Object.keys(sectionByLevel).map(Number)) {
        if (l >= level) delete sectionByLevel[l];
      }
      sectionByLevel[level] = node.label;
    } else {
      // Requirement heading: resolve nearest parent section.
      const parentLevels = Object.keys(sectionByLevel)
        .map(Number)
        .filter((l) => l < level);
      const nearestLevel = parentLevels.length ? Math.max(...parentLevels) : null;
      const section = nearestLevel !== null ? sectionByLevel[nearestLevel] : "—";

      const rawLabel = node.label;
      const matched = matchByKey.get(node.key)!;
      const { id, matchLength } = matched;

      const rawStatusText = extractStatusText(rawLabel);
      const status = rawStatusText
        ? resolveRequirementStatus(rawStatusText, statuses)
        : "unknown";

      // Derive title: strip the matched ID portion and optional " [Status]"
      // suffix from the label. Uses matchLength (full match), not id.length,
      // since regex mode's capture group may be shorter than the full match
      // (e.g. a literal prefix outside the capturing group).
      const titleRaw = rawLabel.slice(matchLength).replace(/\s*\[[^\]]*\]\s*$/, "").trim();

      requirements.push({ id, status, section, pmPos: node.pmPos, title: titleRaw });
    }
  }

  // Build statusCounts dynamically from config ids + "unknown".
  const statusCounts: Record<string, number> = { unknown: 0 };
  for (const s of statuses) statusCounts[s.id] = 0;
  for (const r of requirements) {
    if (r.status in statusCounts) statusCounts[r.status]++;
    else statusCounts.unknown++;
  }

  return { total: requirements.length, statusCounts, requirements };
}

// ── PM-aware renumber helpers ─────────────────────────────────────────────────

export interface RenumberReplacement {
  /** Absolute PM position of the heading node (same as entry.node.pmPos). */
  pmPos: number;
  /** Only the new ID string (e.g. "REQ_002") — use this to replace just the
   *  ID prefix so that status-bracket formatting marks are never touched. */
  newId: string;
  /** Full heading text after renumbering: newId + original suffix (kept for
   *  reference / debugging; callers should prefer newId for PM edits). */
  newLabel: string;
  entry: RequirementEntry;
}

/**
 * Computes the label replacements required to renumber requirements sequentially,
 * without mutating any document state.
 *
 * Uses document-order index position (1, 2, 3…) — NOT the existing numeric
 * suffix — so gaps and duplicates are both resolved in a single pass.
 *
 * Each result carries the heading's absolute `pmPos` so callers can build a
 * ProseMirror transaction that works for both top-level headings and headings
 * nested inside blockquotes/callouts (where content-array indexing fails).
 *
 * Apply results in **reverse document order** (highest pmPos first) inside a
 * single transaction so that position offsets stay valid throughout.
 */
export function computeRenumberReplacements(
  requirements: RequirementEntry[],
  prefix: string,
  digits: number,
): RenumberReplacement[] {
  return requirements.map((entry, i) => {
    const newId = formatId(i + 1, prefix, digits);
    const suffix = entry.node.label.slice(entry.id.length);
    return { pmPos: entry.node.pmPos, newId, newLabel: newId + suffix, entry };
  });
}

// ── Mutation helpers ──────────────────────────────────────────────────────────

/**
 * Returns the next available requirement ID: max(existing nums) + 1, formatted.
 * Returns formatId(1, ...) when requirements is empty (or none have a numeric
 * id — this helper is only meaningful for simple-mode patterns, where every
 * entry's num is guaranteed non-null; see CompiledPattern.supportsNumbering).
 */
export function nextAvailableId(
  requirements: RequirementEntry[],
  prefix: string,
  digits: number
): string {
  const nums = requirements.map((r) => r.num).filter((n): n is number => n !== null);
  if (nums.length === 0) return formatId(1, prefix, digits);
  const max = Math.max(...nums);
  return formatId(max + 1, prefix, digits);
}

/**
 * Inserts a new heading of `nodeLevel` containing `newId` text immediately
 * after the section that starts at `nodeIndex`.
 */
export function insertRequirementAfter(
  content: JSONContent[],
  nodeIndex: number,
  nodeLevel: number,
  newId: string
): JSONContent[] {
  const [, to] = getSectionRange(content, nodeIndex, nodeLevel);
  const heading: JSONContent = {
    type: "heading",
    attrs: { level: nodeLevel },
    content: [{ type: "text", text: newId + " [Draft]" }],
  };
  // Mirror the container type of the source node so `> ### REQ` stays in blockquotes.
  const containerType = content[nodeIndex]?.type;
  const newSection: JSONContent =
    containerType === "blockquote" || containerType === "callout"
      ? { type: containerType, content: [heading] }
      : heading;
  return [...content.slice(0, to), newSection, ...content.slice(to)];
}

/**
 * Rewrites all requirement headings in document order as 001, 002, 003…,
 * normalizing digit width to `digits` and preserving title suffixes.
 *
 * Title suffix = everything after the matched id string in the label.
 * "TRANS_TOS_003 - Auth" renumbered as #1 → "TRANS_TOS_001 - Auth"
 *
 * This resolves both duplicate IDs and numbering gaps in a single pass.
 * `requirements` must be in document order (as returned by analyzeRequirements).
 */
export function renumberRequirements(
  content: JSONContent[],
  requirements: RequirementEntry[],
  prefix: string,
  digits: number
): JSONContent[] {
  const newContent = [...content];
  let counter = 1;
  requirements.forEach((entry) => {
    // Requirements inside containers (blockquote/callout) have node.index pointing
    // to the container, not a heading. Skip them to avoid corrupting the document;
    // still increment counter so numbering of editable siblings stays sequential.
    if (content[entry.node.index]?.type !== "heading") {
      counter++;
      return;
    }
    const newId = formatId(counter++, prefix, digits);
    const suffix = entry.node.label.slice(entry.id.length); // preserve title after ID
    newContent[entry.node.index] = {
      ...newContent[entry.node.index],
      content: [{ type: "text", text: newId + suffix }],
    };
  });
  return newContent;
}

/**
 * Replaces the ID portion of a single heading while preserving its title suffix.
 * Used by the "Reassign Duplicate" action: gives one occurrence a new ID without
 * touching the rest of the document.
 *
 * "TRANS_TOS_001 - Auth" with oldId="TRANS_TOS_001", newId="TRANS_TOS_005"
 *   → "TRANS_TOS_005 - Auth"
 */
export function reassignRequirementId(
  content: JSONContent[],
  nodeIndex: number,
  currentLabel: string,
  oldId: string,
  newId: string
): JSONContent[] {
  // Guard: nodeIndex may point to a container (blockquote/callout) rather than a
  // heading when the requirement lives inside one. Bail out to avoid corruption.
  if (content[nodeIndex]?.type !== "heading") return content;
  const suffix = currentLabel.slice(oldId.length);
  return renameHeading(content, nodeIndex, newId + suffix);
}
