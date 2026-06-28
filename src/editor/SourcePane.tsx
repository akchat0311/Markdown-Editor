import { useCallback, useEffect, useRef, useState } from "react";
import type { Editor } from "@tiptap/core";
import { serializeDocToMarkdown, parseMarkdownToDoc } from "@/markdown";
import { useTabStore } from "@/stores/tabStore";

interface SourcePaneProps {
  editor: Editor;
  active: boolean;
  /** The active tab's ID. Enables per-tab lifecycle: timer cancellation on switch,
   *  initialisation from the correct store entry, and tab-ID guards in the debounce. */
  activeTabId: string | undefined;
}

export function SourcePane({ editor, active, activeTabId }: SourcePaneProps) {
  const [text, setText] = useState("");

  // Never captured in a closure — always reflects the latest prop value so that
  // setTimeout callbacks can check "am I still on the same tab?" without being
  // in the dependency array.
  const activeTabIdRef = useRef(activeTabId);
  activeTabIdRef.current = activeTabId;

  const syncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Initialisation ──────────────────────────────────────────────────────────
  //
  // Fires when source mode activates or when the active tab changes while source
  // mode is already on. Reads from the store — not editor.getJSON() — so the
  // textarea always shows the authoritative markdown (kept current by the
  // immediate store write in handleChange below).
  useEffect(() => {
    if (!active) return;
    const tab = useTabStore.getState().tabs.find((t) => t.id === activeTabId);
    // Fallback to serialising TipTap only if no store entry exists yet (edge case).
    setText(tab?.markdown ?? serializeDocToMarkdown(editor.getJSON()));
  }, [active, activeTabId, editor]);

  // ── Debounce cancellation on tab / mode change ──────────────────────────────
  //
  // By including activeTabId and active in the deps, React runs the cleanup
  // (clearTimeout) whenever either changes. This is the primary guard: a timer
  // scheduled for Tab A is cancelled before any Tab B work begins.
  useEffect(() => {
    return () => {
      if (syncTimerRef.current !== null) {
        clearTimeout(syncTimerRef.current);
        syncTimerRef.current = null;
      }
    };
  }, [active, activeTabId]);

  // ── Text change handler ─────────────────────────────────────────────────────

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const newText = e.target.value;
      setText(newText);

      // 1. Immediate store write with the captured tab ID.
      //    This makes Ctrl+S always save the exact text visible in the textarea,
      //    regardless of whether the TipTap debounce has fired.
      const tabId = activeTabIdRef.current;
      if (tabId) {
        const store = useTabStore.getState();
        const tab = store.tabs.find((t) => t.id === tabId);
        if (tab && !tab.isReadOnly) {
          store.updateTab(tabId, { markdown: newText, isDirty: true });
        }
      }

      // 2. Debounced TipTap sync for live validation, word count, requirement
      //    index, etc. The captured tab ID prevents this from targeting a
      //    different tab if the timer fires after a switch.
      if (syncTimerRef.current !== null) clearTimeout(syncTimerRef.current);
      const capturedTabId = tabId;
      const capturedText = newText;
      syncTimerRef.current = setTimeout(() => {
        if (activeTabIdRef.current !== capturedTabId) return;
        editor.commands.setContent(parseMarkdownToDoc(capturedText));
      }, 250);
    },
    [editor],
  );

  if (!active) return null;

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <textarea
        value={text}
        onChange={handleChange}
        spellCheck={false}
        className="flex-1 resize-none bg-[var(--color-page-bg)] px-10 py-10 font-mono text-sm leading-relaxed text-[var(--color-text)] outline-none"
        style={{ tabSize: 2 }}
        aria-label="Markdown source"
      />
    </div>
  );
}
