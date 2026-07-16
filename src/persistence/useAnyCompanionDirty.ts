import { useCallback, useSyncExternalStore } from "react";
import { COMPANION_REGISTRY } from "./companionArtifact";

/**
 * True when any loaded companion artifact — review, traceability, or any
 * future one added to COMPANION_REGISTRY — is dirty.
 *
 * This backs the top-level bundle save status (Header.tsx's "Unsaved
 * changes" / "All changes saved"), which must never disagree with the
 * bottom per-companion indicators in StatusBar.tsx: if any companion shows
 * "Unsaved X" down there, this must be true, or the two indicators
 * contradict each other.
 *
 * Implemented with useSyncExternalStore (not one useXStore() hook call per
 * companion) specifically so a future companion needs only a
 * COMPANION_REGISTRY entry — no edit here, no edit in Header.tsx.
 */
export function useAnyCompanionDirty(): boolean {
  const subscribe = useCallback((onStoreChange: () => void) => {
    const unsubscribes = COMPANION_REGISTRY.map((c) => c.subscribe(onStoreChange));
    return () => unsubscribes.forEach((unsubscribe) => unsubscribe());
  }, []);

  const getSnapshot = useCallback(
    () => COMPANION_REGISTRY.some((c) => c.isLoaded() && c.isDirty()),
    [],
  );

  return useSyncExternalStore(subscribe, getSnapshot);
}
