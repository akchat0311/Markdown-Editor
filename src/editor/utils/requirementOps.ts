import type { JSONContent } from "@tiptap/core";
import type { OutlineNode } from "@/types/outline";
import { getSectionRange, renameHeading } from "@/editor/utils/outlineOps";

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
function buildDetectionRegex(prefix: string): RegExp {
  return new RegExp("^" + escapeRegex(prefix) + "(\\d+)");
}

// ── Analysis output types ─────────────────────────────────────────────────────

export interface RequirementEntry {
  node: OutlineNode;
  /** Exact reconstructed ID string: prefix + captured digits, e.g. "TRANS_TOS_001". */
  id: string;
  /** Integer value of the numeric suffix, e.g. 1. */
  num: number;
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
 * Analyses the flat outline against the given requirement pattern example.
 * Returns null when the example string is not a valid pattern (no trailing digits).
 *
 * @param flatOutline  Document-order flat list from flattenOutline().
 * @param docContent   editor.getJSON().content — needed for section range computation.
 * @param patternExample  The user's example string, e.g. "TRANS_TOS_001".
 */
export function analyzeRequirements(
  flatOutline: OutlineNode[],
  docContent: JSONContent[],
  patternExample: string
): RequirementAnalysis | null {
  const derived = derivePattern(patternExample);
  if (!derived) return null;

  const { prefix, digits } = derived;
  const regex = buildDetectionRegex(prefix);

  // ── Detect requirement headings ──────────────────────────────────────────
  const requirements: RequirementEntry[] = [];
  for (const node of flatOutline) {
    const match = node.label.match(regex);
    if (!match) continue;
    const captured = match[1]; // digits as they appear in the heading
    requirements.push({
      node,
      id: prefix + captured, // exact reconstructed ID string
      num: parseInt(captured, 10),
    });
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
  const missing: string[] = [];
  if (requirements.length >= 2) {
    const nums = requirements.map((r) => r.num);
    const min = Math.min(...nums);
    const max = Math.max(...nums);
    const present = new Set(nums);
    for (let n = min + 1; n < max; n++) {
      if (!present.has(n)) {
        missing.push(formatId(n, prefix, digits));
      }
    }
  }

  // ── Section requirement counts ───────────────────────────────────────────
  const countsBySection = new Map<string, number>();
  for (const sectionNode of flatOutline) {
    const [from, to] = getSectionRange(
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

// ── Mutation helpers ──────────────────────────────────────────────────────────

/**
 * Returns the next available requirement ID: max(existing nums) + 1, formatted.
 * Returns formatId(1, ...) when requirements is empty.
 */
export function nextAvailableId(
  requirements: RequirementEntry[],
  prefix: string,
  digits: number
): string {
  if (requirements.length === 0) return formatId(1, prefix, digits);
  const max = Math.max(...requirements.map((r) => r.num));
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
  const newHeading: JSONContent = {
    type: "heading",
    attrs: { level: nodeLevel },
    content: [{ type: "text", text: newId }],
  };
  return [...content.slice(0, to), newHeading, ...content.slice(to)];
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
  requirements.forEach((entry, i) => {
    const newId = formatId(i + 1, prefix, digits);
    const suffix = entry.node.label.slice(entry.id.length); // preserve title after ID
    const newLabel = newId + suffix;
    newContent[entry.node.index] = {
      ...newContent[entry.node.index],
      content: [{ type: "text", text: newLabel }],
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
  const suffix = currentLabel.slice(oldId.length);
  return renameHeading(content, nodeIndex, newId + suffix);
}
