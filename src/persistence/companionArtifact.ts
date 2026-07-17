import { useReviewCommentsStore } from "@/stores/reviewCommentsStore";
import { useTraceabilityStore } from "@/stores/traceabilityStore";

/**
 * A companion sidecar file (review comments, test-case traceability, and any
 * future one) registered with the bundle save pipeline (bundleSave.ts).
 *
 * Each concrete artifact owns its own store access, handle storage, and
 * stale-handle recovery — saveBundle only needs to know whether an attempt
 * is worth making (isLoaded/isDirty) and whether it worked (isDirty() after
 * save() resolves: still dirty means the save didn't complete, whether from
 * a thrown error or a cancelled Save-As picker).
 */
export interface CompanionArtifact {
  /** Stable id — "review", "traceability", etc. Used only for result reporting. */
  id: string;
  isLoaded(): boolean;
  isDirty(): boolean;
  /**
   * Attempts to save this companion. Implementations are expected to catch
   * and toast their own errors (matching today's per-artifact UX) — but
   * saveBundle also catches anything that escapes, so a throwing
   * implementation degrades safely rather than aborting sibling companions.
   */
  save(): Promise<void>;
}

export type CompanionSaveStatus = "saved" | "skipped" | "unsaved" | "failed";

export interface CompanionSaveResult {
  id: string;
  status: CompanionSaveStatus;
  error?: string;
}

/**
 * A companion, minus its save handler — the part of a CompanionArtifact that
 * is identical no matter who's asking. This is the ONE canonical list of
 * "what companions exist," reused by:
 *   - App.tsx's bundleCompanions() — attaches each id's save handler to
 *     build the full CompanionArtifact[] the Ctrl+S pipeline saves.
 *   - useAnyCompanionDirty() — the top bundle-dirty status (Header.tsx) is
 *     `markdownDirty || <any registered companion here is loaded+dirty>`,
 *     computed generically over this list rather than a hardcoded
 *     `reviewDirty || traceabilityDirty` expression that a future companion
 *     could silently fall outside of.
 *
 * Registering a future companion (e.g. a requirements-status sidecar) means
 * adding one entry here — App.tsx wires its save handler, and both the top
 * and bottom save-status UI automatically pick it up with no further edits.
 */
export interface CompanionDescriptor {
  id: string;
  isLoaded(): boolean;
  isDirty(): boolean;
  /** Subscribes to this companion's underlying store for change notifications. */
  subscribe(listener: () => void): () => void;
}

export const COMPANION_REGISTRY: CompanionDescriptor[] = [
  {
    id: "review",
    isLoaded: () => useReviewCommentsStore.getState().loaded,
    isDirty: () => useReviewCommentsStore.getState().isDirty,
    subscribe: (listener) => useReviewCommentsStore.subscribe(() => listener()),
  },
  {
    id: "traceability",
    isLoaded: () => useTraceabilityStore.getState().loaded,
    isDirty: () => useTraceabilityStore.getState().isDirty,
    subscribe: (listener) => useTraceabilityStore.subscribe(() => listener()),
  },
];
