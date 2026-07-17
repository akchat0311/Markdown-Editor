/**
 * Single choke point for propagating requirement-ID renames to every store
 * that keys data by requirement ID. Any flow that changes requirement IDs —
 * the rename-detection plugin, bulk renumber, or a future feature — must call
 * this (or, for renumber-style batches, the same primitives it wraps) so no
 * store is ever forgotten.
 *
 * Semantics per store:
 * - Traceability links: ONE atomic remap over the complete mapping
 *   (chain-safe, union-dedupe — see traceabilityStore.remapRequirementIds).
 * - Review comments: per-target migration, preserving the review system's
 *   existing conflict semantics ("conflict" = target already has comments;
 *   migration blocked, caller surfaces it). Behaviour is byte-identical to
 *   the pre-Phase-5 inline loop in requirementIdMigrationPlugin.
 *
 * Section review targets ("section:2.1") are review-only — traceability links
 * never reference sections, so they are excluded from the trace mapping.
 */

import { useReviewCommentsStore } from "@/stores/reviewCommentsStore";
import { useTraceabilityStore } from "@/stores/traceabilityStore";
import { isSectionReviewTarget } from "@/editor/utils/sectionReviewOps";

export interface RequirementIdRename {
  oldId: string;
  newId: string;
}

export interface ReviewMigrationOutcome extends RequirementIdRename {
  result: "migrated" | "conflict" | "noop";
}

export function migrateRequirementIdTargets(
  renames: readonly RequirementIdRename[],
): ReviewMigrationOutcome[] {
  // Traceability: complete rename list, applied atomically. If the same
  // oldId appears twice in one transaction (e.g. two headings changed at
  // once), remapRequirementIds fans out correctly — links copy onto every
  // destination rather than only the first-processed one. Self-pairs
  // (newId === oldId) are intentionally NOT filtered out here: when they
  // coexist with a genuine change for the same oldId, they're the only
  // signal that the ID was shared by more than one occurrence — the store
  // already no-ops correctly on a pair that is purely self-mapped.
  const traceRenames = renames.filter(
    ({ oldId, newId }) => !isSectionReviewTarget(oldId) && !isSectionReviewTarget(newId),
  );
  useTraceabilityStore.getState().remapRequirementIds(traceRenames);

  // Reviews: unchanged per-target migration; outcomes returned so the caller
  // can keep its existing conflict toasts.
  const reviewStore = useReviewCommentsStore.getState();
  return renames.map(({ oldId, newId }) => ({
    oldId,
    newId,
    result: reviewStore.migrateReviewTarget(oldId, newId),
  }));
}
