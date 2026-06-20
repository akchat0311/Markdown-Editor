import type { JSONContent } from "@tiptap/core";

/**
 * Pure functions that transform a doc.content[] array.
 * All functions are immutable — they return a new array and never mutate input.
 *
 * "Section" = a heading block at doc.content[nodeIndex] plus all following
 * blocks that belong to it (i.e., every block until the next heading at the
 * same or higher structural level, or until end of array).
 */

// ── Core helper ───────────────────────────────────────────────────────────────

/**
 * Returns [from, to) indices delimiting the section that starts at nodeIndex.
 * `level` is the heading level of the section's root heading.
 */
export function getSectionRange(
  content: JSONContent[],
  nodeIndex: number,
  level: number
): [number, number] {
  let to = nodeIndex + 1;
  while (to < content.length) {
    const block = content[to];
    if (block.type === "heading") {
      const blockLevel = (block.attrs?.level as number) ?? 1;
      if (blockLevel <= level) break;
    }
    to++;
  }
  return [nodeIndex, to];
}

// ── Movement ──────────────────────────────────────────────────────────────────

/**
 * Moves the section at sourceIdx to immediately BEFORE the section at targetIdx.
 *
 * Example — moving C before A in [A, B, C]:
 *   moveSectionBefore(content, C.index, C.level, A.index) → [C, A, B]
 */
export function moveSectionBefore(
  content: JSONContent[],
  sourceIdx: number,
  sourceLevel: number,
  targetIdx: number
): JSONContent[] {
  const [sFrom, sTo] = getSectionRange(content, sourceIdx, sourceLevel);
  const section = content.slice(sFrom, sTo);
  const without = [...content.slice(0, sFrom), ...content.slice(sTo)];
  // If targetIdx is after the removed section, it shifts left by (sTo - sFrom)
  const insertAt = targetIdx > sFrom ? targetIdx - (sTo - sFrom) : targetIdx;
  return [...without.slice(0, insertAt), ...section, ...without.slice(insertAt)];
}

/**
 * Moves the section at sourceIdx to immediately AFTER the section at targetIdx.
 *
 * Example — moving A after C in [A, B, C]:
 *   moveSectionAfter(content, A.index, A.level, C.index, C.level) → [B, C, A]
 */
export function moveSectionAfter(
  content: JSONContent[],
  sourceIdx: number,
  sourceLevel: number,
  targetIdx: number,
  targetLevel: number
): JSONContent[] {
  const [sFrom, sTo] = getSectionRange(content, sourceIdx, sourceLevel);
  const [, tTo] = getSectionRange(content, targetIdx, targetLevel);
  const section = content.slice(sFrom, sTo);
  const without = [...content.slice(0, sFrom), ...content.slice(sTo)];
  // Adjust insert point: if target end was after the removed source, it shifts
  const insertAt = tTo > sFrom ? tTo - (sTo - sFrom) : tTo;
  return [...without.slice(0, insertAt), ...section, ...without.slice(insertAt)];
}

// ── Duplicate ─────────────────────────────────────────────────────────────────

/**
 * Deep-clones the section at nodeIndex and inserts the copy immediately after it.
 */
export function duplicateSection(
  content: JSONContent[],
  nodeIndex: number,
  level: number
): JSONContent[] {
  const [, to] = getSectionRange(content, nodeIndex, level);
  const original = content.slice(nodeIndex, to);
  const clone = JSON.parse(JSON.stringify(original)) as JSONContent[];
  return [...content.slice(0, to), ...clone, ...content.slice(to)];
}

// ── Delete ────────────────────────────────────────────────────────────────────

/**
 * Removes the section at nodeIndex (heading + all owned content blocks).
 * Returns a new content array with at least one paragraph so the doc is never empty.
 */
export function deleteSection(
  content: JSONContent[],
  nodeIndex: number,
  level: number
): JSONContent[] {
  const [from, to] = getSectionRange(content, nodeIndex, level);
  const result = [...content.slice(0, from), ...content.slice(to)];
  return result.length > 0 ? result : [{ type: "paragraph" }];
}

// ── Descendant protection ─────────────────────────────────────────────────────

/**
 * Returns true if the node at candidateIndex falls strictly inside the section
 * owned by the node at sectionNodeIndex/sectionLevel.
 *
 * With the same-level drag-target rule in M8, same-level nodes always terminate
 * sections via getSectionRange's `blockLevel <= level` stop condition, so this
 * returns false for every valid M8 drop candidate. Implemented now so future
 * hierarchy-editing phases that permit cross-level drops have an explicit
 * descendant guard rather than relying on the level-equality side-effect.
 */
export function isInsideSection(
  content: JSONContent[],
  sectionNodeIndex: number,
  sectionLevel: number,
  candidateIndex: number
): boolean {
  const [from, to] = getSectionRange(content, sectionNodeIndex, sectionLevel);
  return candidateIndex > from && candidateIndex < to;
}

// ── Rename ────────────────────────────────────────────────────────────────────

/**
 * Replaces the heading text at nodeIndex with newLabel (plain text).
 * Intentionally strips inline formatting — rename is a plain-text operation.
 */
export function renameHeading(
  content: JSONContent[],
  nodeIndex: number,
  newLabel: string
): JSONContent[] {
  return content.map((block, i) => {
    if (i !== nodeIndex) return block;
    const trimmed = newLabel.trim();
    return {
      ...block,
      content: trimmed ? [{ type: "text", text: trimmed }] : [],
    };
  });
}
