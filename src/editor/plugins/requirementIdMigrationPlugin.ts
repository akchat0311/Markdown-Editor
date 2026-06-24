import { Plugin, PluginKey } from "@tiptap/pm/state";
import type { EditorState } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import { useConfigStore } from "@/stores/configStore";
import { useReviewCommentsStore } from "@/stores/reviewCommentsStore";
import { useToastStore } from "@/stores/toastStore";
import { derivePattern, buildDetectionRegex } from "@/editor/utils/requirementOps";
import { rewriteHeadingId } from "@/editor/utils/requirementHeadingOps";
import {
  extractSectionNumber,
  sectionReviewId,
  sectionNumberFromReviewId,
  isSectionReviewTarget,
  rewriteSectionNumber,
} from "@/editor/utils/sectionReviewOps";

export const requirementIdMigrationKey = new PluginKey<PluginState>("requirementIdMigration");

// ── Types ─────────────────────────────────────────────────────────────────────

export interface RenameEntry {
  oldId: string;
  newId: string;
  /** True when newId already exists at a different position in the new document state. */
  isDuplicate: boolean;
  /** Absolute PM position of the heading in the NEW state (used to revert duplicates). */
  pos: number;
}

interface PluginState {
  renames: RenameEntry[];
}

// ── Pure helpers (exported for testing) ───────────────────────────────────────

/**
 * Scans a ProseMirror state for all requirement heading IDs, returning a Map
 * from absolute node position → requirement ID string.
 *
 * Handles headings at the top level and one level inside blockquote / callout
 * containers, matching the scan pattern used by the status and badge plugins.
 */
export function collectHeadingIds(
  state: EditorState,
  regex: RegExp,
  prefix: string,
): Map<number, string> {
  const map = new Map<number, string>();
  state.doc.forEach((node, offset) => {
    if (node.type.name === "heading") {
      const m = node.textContent.match(regex);
      if (m) map.set(offset, prefix + m[1]);
    } else if (node.type.name === "blockquote" || node.type.name === "callout") {
      node.forEach((child, childOffset) => {
        if (child.type.name === "heading") {
          const m = child.textContent.match(regex);
          if (m) map.set(offset + 1 + childOffset, prefix + m[1]);
        }
      });
    }
  });
  return map;
}

/**
 * Scans a ProseMirror state for all section-numbered headings, returning a Map
 * from absolute node position → section review target ID ("section:2.1").
 *
 * Mirrors collectHeadingIds but uses the section-number pattern instead of
 * the user-configured requirement pattern.
 */
export function collectSectionIds(state: EditorState): Map<number, string> {
  const map = new Map<number, string>();
  state.doc.forEach((node, offset) => {
    if (node.type.name === "heading") {
      const sectionNum = extractSectionNumber(node.textContent);
      if (sectionNum) map.set(offset, sectionReviewId(sectionNum));
    } else if (node.type.name === "blockquote" || node.type.name === "callout") {
      node.forEach((child, childOffset) => {
        if (child.type.name === "heading") {
          const sectionNum = extractSectionNumber(child.textContent);
          if (sectionNum) map.set(offset + 1 + childOffset, sectionReviewId(sectionNum));
        }
      });
    }
  });
  return map;
}

/**
 * Compares previous and new heading-ID maps to produce a list of renames.
 *
 * A rename is detected when a heading that existed in prevIds now has a
 * different ID at the position it mapped to in newIds (via `mapPos`).
 *
 * `isDuplicate` is set when the new ID appears more than once in `newIds`,
 * i.e. the rename would create a collision with an existing requirement.
 *
 * `mapPos` is `tr.mapping.map` in production; tests can supply an identity
 * function when positions are not expected to shift.
 */
export function detectRenames(
  prevIds: ReadonlyMap<number, string>,
  newIds: ReadonlyMap<number, string>,
  mapPos: (pos: number) => number,
): RenameEntry[] {
  const newIdCounts = new Map<string, number>();
  for (const [, id] of newIds) {
    newIdCounts.set(id, (newIdCounts.get(id) ?? 0) + 1);
  }

  const result: RenameEntry[] = [];
  for (const [oldPos, oldId] of prevIds) {
    const newPos = mapPos(oldPos);
    const newId = newIds.get(newPos);
    if (newId === undefined || newId === oldId) continue;
    result.push({
      oldId,
      newId,
      isDuplicate: (newIdCounts.get(newId) ?? 0) > 1,
      pos: newPos,
    });
  }
  return result;
}

// ── Plugin ────────────────────────────────────────────────────────────────────

export const requirementIdMigrationPlugin = new Plugin<PluginState>({
  key: requirementIdMigrationKey,

  state: {
    init(): PluginState {
      return { renames: [] };
    },

    apply(tr, _old, prevState, newState): PluginState {
      // Callers that control ID changes directly (bulk renumber, duplicate reassign)
      // set this meta to suppress the plugin so it doesn't race their own handling.
      const meta = tr.getMeta(requirementIdMigrationKey) as { skip?: boolean } | undefined;
      if (meta?.skip || !tr.docChanged) return { renames: [] };

      // Collect requirement IDs (only when pattern is configured).
      let prevReqIds = new Map<number, string>();
      let newReqIds = new Map<number, string>();
      const { requirementPattern } = useConfigStore.getState();
      if (requirementPattern) {
        const derived = derivePattern(requirementPattern.example);
        if (derived) {
          const { prefix } = derived;
          const regex = buildDetectionRegex(prefix);
          prevReqIds = collectHeadingIds(prevState, regex, prefix);
          newReqIds = collectHeadingIds(newState, regex, prefix);
        }
      }

      // Collect section IDs (always; no configuration needed).
      const prevSecIds = collectSectionIds(prevState);
      const newSecIds = collectSectionIds(newState);

      // Merge: requirement IDs take precedence for headings that match both patterns
      // (a heading starting with a digit run and a requirement prefix).
      const prevIds = new Map([...prevSecIds, ...prevReqIds]);
      const newIds = new Map([...newSecIds, ...newReqIds]);

      if (prevIds.size === 0) return { renames: [] };

      const renames = detectRenames(prevIds, newIds, (pos) => tr.mapping.map(pos));
      return { renames };
    },
  },

  view(editorView: EditorView) {
    return {
      update(_view: EditorView) {
        const pluginState = requirementIdMigrationKey.getState(editorView.state);
        if (!pluginState || pluginState.renames.length === 0) return;

        const reviewStore = useReviewCommentsStore.getState();
        const toast = useToastStore.getState();

        const duplicates = pluginState.renames.filter((r) => r.isDuplicate);
        const safeRenames = pluginState.renames.filter((r) => !r.isDuplicate);

        // ── Safe renames: migrate review comments ──────────────────────────────
        for (const { oldId, newId } of safeRenames) {
          const result = reviewStore.migrateReviewTarget(oldId, newId);
          if (result === "conflict") {
            toast.show(
              `Review comments for ${oldId} not migrated: ${newId} already has comments. Undo the rename to restore the original ID.`,
              "error",
            );
          }
        }

        // ── Duplicate renames: revert the document change ──────────────────────
        if (duplicates.length === 0) return;

        const { state } = editorView;
        const revertTr = state.tr;
        // Keep this correction out of undo history so Cmd+Z undoes the user's
        // original edit, not our revert.
        revertTr.setMeta("addToHistory", false);
        // Suppress the migration plugin on the revert transaction itself.
        revertTr.setMeta(requirementIdMigrationKey, { skip: true });

        // Apply reverts in reverse document order (highest pos first) so that
        // each replacement doesn't shift positions used by subsequent ones.
        const sorted = [...duplicates].sort((a, b) => b.pos - a.pos);
        for (const { oldId, newId, pos } of sorted) {
          const node = state.doc.nodeAt(pos);
          if (!node || node.type.name !== "heading") continue;
          if (isSectionReviewTarget(oldId)) {
            // For section targets, rewrite the dotted number (e.g. "2.1") not the
            // prefixed key ("section:2.1"), since the key never appears in heading text.
            const curNum = sectionNumberFromReviewId(newId)!;
            const origNum = sectionNumberFromReviewId(oldId)!;
            rewriteSectionNumber(revertTr, pos, curNum, origNum);
          } else {
            rewriteHeadingId(revertTr, pos, newId, oldId);
          }
        }

        editorView.dispatch(revertTr);

        // Show one error per duplicate (after dispatch so the document is already corrected).
        const shown = new Set<string>();
        for (const { newId } of duplicates) {
          if (shown.has(newId)) continue;
          shown.add(newId);
          if (isSectionReviewTarget(newId)) {
            const num = sectionNumberFromReviewId(newId)!;
            toast.show(
              `Section number already exists: "${num}" is already assigned to another section. Section numbers must be unique.`,
              "error",
            );
          } else {
            toast.show(
              `Requirement ID already exists: "${newId}" is already assigned to another requirement. Requirement IDs must be unique.`,
              "error",
            );
          }
        }
      },
    };
  },
});
