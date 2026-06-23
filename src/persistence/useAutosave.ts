import { useEffect, useRef, useCallback } from "react";
import { useTabStore, getActiveTab } from "@/stores";
import { saveDocument, loadDocument } from "./db";

const AUTOSAVE_DELAY_MS = 2000;

export function useAutosave() {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flush = useCallback(async () => {
    const state = useTabStore.getState();
    const tab = getActiveTab(state);
    if (!tab || !tab.isDirty || !tab.markdown) return;

    await saveDocument({
      id: tab.id,
      name: tab.title,
      state: {
        markdown: tab.markdown,
        json: { type: "doc", content: [] },
        updatedAt: Date.now(),
      },
      fileName: tab.fileName,
    });
    // Only clear isDirty for tabs that have no disk file. If a fileHandle
    // exists the user must ⌘S to write back to disk — autosave to IndexedDB
    // is just crash recovery, not the authoritative save.
    if (!tab.fileHandle) {
      useTabStore.getState().markTabSaved();
    }
  }, []);

  useEffect(() => {
    const { activeTabId } = useTabStore.getState();
    loadDocument(activeTabId).then((persisted) => {
      if (!persisted) return;
      const state = useTabStore.getState();
      const tab = getActiveTab(state);
      if (tab && !tab.isDirty) {
        useTabStore.getState().updateActiveTab({
          markdown: persisted.state.markdown,
          title: persisted.name,
        });
      }
    }).catch(() => {});

    const unsubscribe = useTabStore.subscribe((state, prev) => {
      const tab = getActiveTab(state);
      const prevTab = getActiveTab(prev);
      if (!tab?.isDirty || tab.markdown === prevTab?.markdown) return;
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(flush, AUTOSAVE_DELAY_MS);
    });

    return () => {
      unsubscribe();
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [flush]);

  return { flush };
}
