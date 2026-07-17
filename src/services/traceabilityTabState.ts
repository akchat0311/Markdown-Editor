/**
 * Per-tab session cache for traceability state.
 *
 * The traceability store is a singleton mirroring the ACTIVE document's
 * sidecar. When the user switches tabs, App.tsx stashes the departing tab's
 * state here and restores the arriving tab's — so badges, the drawer, and the
 * dashboard always show the active document's links, and unsaved edits on a
 * background tab are never lost (they come back when the tab reactivates and
 * still guard the beforeunload prompt via anyStashedTraceabilityDirty).
 *
 * In-memory only: cleared on reload (unsaved sidecar edits never survive a
 * reload — same contract as review comments).
 */

import { useTraceabilityStore } from "@/stores/traceabilityStore";
import type { TestCase, TraceLink, CoverageStatus } from "@/types/traceability";

export interface TraceabilitySnapshot {
  testCases: TestCase[];
  links: TraceLink[];
  coverage: Record<string, CoverageStatus>;
  isDirty: boolean;
  loaded: boolean;
  loadError: boolean;
}

const cache = new Map<string, TraceabilitySnapshot>();

/** Snapshots the current store state under the given (departing) tab ID. */
export function stashTraceabilityState(tabId: string): void {
  const s = useTraceabilityStore.getState();
  cache.set(tabId, {
    testCases: s.testCases,
    links: s.links,
    coverage: s.coverage,
    isDirty: s.isDirty,
    loaded: s.loaded,
    loadError: s.loadError,
  });
}

/**
 * Restores the snapshot for the given (arriving) tab ID into the store.
 * Returns false when no snapshot exists — the caller then falls back to
 * reading the tab's sidecar handle, or an empty store.
 */
export function restoreTraceabilityState(tabId: string): boolean {
  const snap = cache.get(tabId);
  if (!snap) return false;
  useTraceabilityStore.setState({ ...snap });
  return true;
}

/** Drops a tab's snapshot (tab closed). */
export function dropTraceabilityState(tabId: string): void {
  cache.delete(tabId);
}

/** True when any background tab holds unsaved traceability edits. */
export function anyStashedTraceabilityDirty(): boolean {
  for (const snap of cache.values()) {
    if (snap.isDirty) return true;
  }
  return false;
}

/** Test hook — resets the cache between test cases. */
export function clearTraceabilityTabState(): void {
  cache.clear();
}
