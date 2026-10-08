import type { JSONContent } from "@tiptap/core";
import { parseHeadingFields, fieldsStartOffset } from "@/editor/utils/headingFields";
import { getRequirementStatuses } from "@/services/requirementStatusService";
import type { OutlineNode } from "@/types/outline";

/**
 * Pure functions that transform a doc.content[] array.
 * All functions are immutable — they return a new array and never mutate input.
 *
 * "Section" = a heading block at doc.content[nodeIndex] plus all following
 * blocks that belong to it (i.e., every block until the next heading at the
 * same or higher structural level, or until end of array).
 */

// ── Status reset helper ───────────────────────────────────────────────────────

/**
 * Status brackets are written ITALIC by default — "[*Draft*]" in markdown —
 * which in PM JSON is three text nodes: "[", "Draft" (italic), "]". Every
 * helper below therefore works on the heading's concatenated text with the
 * shared field tokenizer (headingFields.ts) and splices text nodes by
 * character range, instead of pattern-matching a single text node.
 */

/** Plain text of a heading's inline content (text nodes only — inline atoms
 *  such as rawHtmlInline contribute nothing, matching PM's textContent). */
function headingText(nodes: JSONContent[]): string {
  return nodes.map((n) => (typeof n.text === "string" ? n.text : "")).join("");
}

/**
 * Replaces the character range [from, to) of a heading's text with
 * `replacement` nodes, splitting text nodes at the boundaries and keeping
 * every mark on the untouched parts. `from === to` inserts.
 */
function spliceHeadingText(
  nodes: JSONContent[],
  from: number,
  to: number,
  replacement: JSONContent[],
): JSONContent[] {
  const out: JSONContent[] = [];
  let offset = 0;
  let inserted = false;
  const insertOnce = () => {
    if (!inserted) {
      out.push(...replacement);
      inserted = true;
    }
  };
  for (const n of nodes) {
    if (typeof n.text !== "string") {
      // Zero-width inline atom: stays on the side of the range it is on.
      if (offset > from) insertOnce();
      out.push(n);
      continue;
    }
    const start = offset;
    const end = start + n.text.length;
    offset = end;
    if (end <= from) {
      out.push(n);
      continue;
    }
    const beforeLen = Math.max(0, from - start);
    if (beforeLen > 0) out.push({ ...n, text: n.text.slice(0, beforeLen) });
    insertOnce();
    if (end > to) {
      const afterStart = Math.max(0, to - start);
      out.push({ ...n, text: n.text.slice(afterStart) });
    }
  }
  insertOnce();
  return out;
}

function draftLabel(statuses: ReturnType<typeof getRequirementStatuses>): string {
  return statuses.find((s) => s.id === "draft")?.label ?? "Draft";
}

/** "[" + italic label + "]" — the canonical new-status token (see requirementHeadingOps). */
export function statusBracketNodes(label: string): JSONContent[] {
  return [
    { type: "text", text: "[" },
    { type: "text", text: label, marks: [{ type: "italic" }] },
    { type: "text", text: "]" },
  ];
}

/**
 * Replaces the heading's [Status] bracket with an italic [Draft]. A trailing
 * [Variant] bracket is left in place; a heading without a status bracket is
 * returned unchanged. Only operates on a `type: "heading"` JSON node.
 */
function resetHeadingNodeStatusToDraft(heading: JSONContent): JSONContent {
  const nodes = heading.content as JSONContent[] | undefined;
  if (!nodes?.length) return heading;
  const statuses = getRequirementStatuses();
  const fields = parseHeadingFields(headingText(nodes), statuses);
  if (!fields.status) return heading;
  return {
    ...heading,
    content: spliceHeadingText(
      nodes,
      fields.status.charFrom,
      fields.status.charTo,
      statusBracketNodes(draftLabel(statuses)),
    ),
  };
}

/**
 * Resets the [Status] bracket on a section root to [Draft].
 * Handles both a plain heading and a blockquote/callout containing a heading.
 */
function resetHeadingStatusToDraft(block: JSONContent): JSONContent {
  if (block.type === "heading") return resetHeadingNodeStatusToDraft(block);
  if ((block.type === "blockquote" || block.type === "callout") && Array.isArray(block.content)) {
    let found = false;
    const inner = (block.content as JSONContent[]).map((child) => {
      if (!found && child.type === "heading") { found = true; return resetHeadingNodeStatusToDraft(child); }
      return child;
    });
    return { ...block, content: inner };
  }
  return block;
}

/**
 * Inserts "Copy" into the heading text immediately before its trailing field
 * brackets ("ID Title [*Draft*] [V2]" → "ID Title Copy [*Draft*] [V2]"), or
 * appends " Copy" at the end when the heading has no brackets.
 * Only operates on a `type: "heading"` JSON node.
 */
function insertCopyInHeadingNode(heading: JSONContent): JSONContent {
  const nodes = [...((heading.content ?? []) as JSONContent[])];
  const text = headingText(nodes);
  const fields = parseHeadingFields(text, getRequirementStatuses());
  const at = fieldsStartOffset(text, fields);
  if (at < text.length) {
    const needsSpace = at === 0 || !/\s/.test(text[at - 1]);
    return {
      ...heading,
      content: spliceHeadingText(nodes, at, at, [
        { type: "text", text: `${needsSpace ? " " : ""}Copy ` },
      ]),
    };
  }
  const last = nodes[nodes.length - 1];
  if (last?.type === "text") {
    nodes[nodes.length - 1] = { ...last, text: (last.text ?? "") + " Copy" };
  } else {
    nodes.push({ type: "text", text: " Copy" });
  }
  return { ...heading, content: nodes };
}

// ── Core helpers ──────────────────────────────────────────────────────────────

/**
 * Returns [from, to) indices delimiting the section that starts at nodeIndex.
 *
 * Handles two patterns for the section root:
 *   - Regular heading:  content[nodeIndex].type === "heading"
 *   - Container node:   content[nodeIndex].type === "blockquote" | "callout"
 *                       that holds a heading inside it (requirement pattern:
 *                       `> ### REQ_001 [Draft]` with body paragraphs outside)
 *
 * A section ends at the first subsequent block that is either:
 *   (a) a top-level heading at level <= `level`, or
 *   (b) a blockquote/callout whose first heading child is at level <= `level`.
 */
export function getNodeSectionRange(
  content: JSONContent[],
  nodeIndex: number,
  level: number
): [number, number] {
  let to = nodeIndex + 1;
  while (to < content.length) {
    const block = content[to];
    if (block.type === "heading") {
      if (((block.attrs?.level as number) ?? 1) <= level) break;
    } else if (block.type === "blockquote" || block.type === "callout") {
      const inner = block.content?.find(
        (c) => c.type === "heading" && ((c.attrs?.level as number) ?? 1) <= level
      );
      if (inner) break;
    }
    to++;
  }
  return [nodeIndex, to];
}

/**
 * Returns [from, to) for a section rooted at a top-level heading.
 * Kept for backward compatibility; prefer getNodeSectionRange for new callers.
 */
export function getSectionRange(
  content: JSONContent[],
  nodeIndex: number,
  level: number
): [number, number] {
  return getNodeSectionRange(content, nodeIndex, level);
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
  const [sFrom, sTo] = getNodeSectionRange(content, sourceIdx, sourceLevel);
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
  const [sFrom, sTo] = getNodeSectionRange(content, sourceIdx, sourceLevel);
  const [, tTo] = getNodeSectionRange(content, targetIdx, targetLevel);
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
  const [, to] = getNodeSectionRange(content, nodeIndex, level);
  const original = content.slice(nodeIndex, to);
  const clone = JSON.parse(JSON.stringify(original)) as JSONContent[];
  if (clone[0]?.type === "heading" && Array.isArray(clone[0].content)) {
    clone[0] = resetHeadingStatusToDraft(clone[0]);
  }
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
  const [from, to] = getNodeSectionRange(content, nodeIndex, level);
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
  const [from, to] = getNodeSectionRange(content, sectionNodeIndex, sectionLevel);
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
  const trimmed = newLabel.trim();
  const textContent = trimmed ? [{ type: "text", text: trimmed }] : [];
  return content.map((block, i) => {
    if (i !== nodeIndex) return block;
    if (block.type === "blockquote" || block.type === "callout") {
      let found = false;
      const inner = (block.content ?? []).map((child: JSONContent) => {
        if (!found && child.type === "heading") {
          found = true;
          return { ...child, content: textContent };
        }
        return child;
      });
      return { ...block, content: inner };
    }
    return { ...block, content: textContent };
  });
}

// ── Multi-select ──────────────────────────────────────────────────────────────

export interface SectionRange {
  node: OutlineNode;
  from: number;
  to: number;
}

/**
 * Resolves an OutlineNode[] to their section ranges and removes any range that
 * is fully contained within another selected range (parent+child selections).
 * Result is sorted by document order (ascending `from`).
 */
export function normalizeSelectedRanges(
  nodes: OutlineNode[],
  content: JSONContent[]
): SectionRange[] {
  const withRanges: SectionRange[] = nodes.map((node) => {
    const [from, to] = getNodeSectionRange(content, node.index, node.level ?? 1);
    return { node, from, to };
  });
  withRanges.sort((a, b) => a.from - b.from);
  // Keep only the outermost ranges — discard any range fully inside another.
  return withRanges.filter(
    (item) =>
      !withRanges.some(
        (other) =>
          other !== item &&
          other.from <= item.from &&
          other.to >= item.to
      )
  );
}

/**
 * Removes every section in `ranges` (must be pre-normalized and sorted by from)
 * in a single pass, processing in reverse order to preserve earlier indices.
 */
export function deleteMultipleSections(
  content: JSONContent[],
  ranges: SectionRange[]
): JSONContent[] {
  let result = [...content];
  for (const { from, to } of [...ranges].reverse()) {
    result = [...result.slice(0, from), ...result.slice(to)];
  }
  return result.length > 0 ? result : [{ type: "paragraph" }];
}

/**
 * Deep-clones every selected section, appends " Copy" to each root heading,
 * and inserts all copies immediately after the last selected section.
 */
export function duplicateMultipleSections(
  content: JSONContent[],
  ranges: SectionRange[]
): JSONContent[] {
  const insertAfter = ranges[ranges.length - 1].to;
  const copies = ranges.flatMap(({ from, to }) => {
    const section = JSON.parse(
      JSON.stringify(content.slice(from, to))
    ) as JSONContent[];
    const root = section[0];
    if (!root) return section;

    if (root.type === "heading" && Array.isArray(root.content)) {
      section[0] = insertCopyInHeadingNode(resetHeadingNodeStatusToDraft(root));
    } else if ((root.type === "blockquote" || root.type === "callout") && Array.isArray(root.content)) {
      let found = false;
      const inner = (root.content as JSONContent[]).map((child) => {
        if (!found && child.type === "heading") {
          found = true;
          return insertCopyInHeadingNode(resetHeadingNodeStatusToDraft(child));
        }
        return child;
      });
      section[0] = { ...root, content: inner };
    }

    return section;
  });
  return [
    ...content.slice(0, insertAfter),
    ...copies,
    ...content.slice(insertAfter),
  ];
}
