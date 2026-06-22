import type { JSONContent } from "@tiptap/core";
import type { OutlineNode } from "@/types/outline";
import type { RequirementStatus } from "@/types/requirementStatus";
import { getSectionRange, renameHeading } from "@/editor/utils/outlineOps";
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

// ── Requirements Index ────────────────────────────────────────────────────────

export interface RequirementRecord {
  id: string;
  /** Canonical status id from config (e.g. "draft", "review") or "unknown". */
  status: string;
  /** Label of the nearest non-requirement ancestor heading, or "—" if none. */
  section: string;
  /** ProseMirror absolute offset for click-to-navigate. */
  pmPos: number;
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
 * Returns null when patternExample is not a valid pattern.
 */
export function buildRequirementIndex(
  flatOutline: OutlineNode[],
  patternExample: string,
  statuses: RequirementStatus[]
): RequirementIndex | null {
  const derived = derivePattern(patternExample);
  if (!derived) return null;

  const { prefix } = derived;
  const regex = buildDetectionRegex(prefix);

  // First pass: determine which nodes are requirements (by key) so we can skip
  // them when building the section stack.
  const reqKeySet = new Set<string>();
  for (const node of flatOutline) {
    if (regex.test(node.label)) reqKeySet.add(node.key);
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
      const idMatch = rawLabel.match(regex);
      const id = idMatch ? prefix + idMatch[1] : rawLabel;

      const rawStatusText = extractStatusText(rawLabel);
      const status = rawStatusText
        ? resolveRequirementStatus(rawStatusText, statuses)
        : "unknown";

      requirements.push({ id, status, section, pmPos: node.pmPos });
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
  /** Full heading text after renumbering: newId + original suffix. */
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
    return { pmPos: entry.node.pmPos, newLabel: newId + suffix, entry };
  });
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
