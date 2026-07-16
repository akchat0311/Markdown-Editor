import { forwardRef, useCallback, useEffect, useRef, useState } from "react";
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

export const SourcePane = forwardRef<HTMLTextAreaElement, SourcePaneProps>(function SourcePane(
  { editor, active, activeTabId },
  textareaRef,
) {
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

  // ── Live sync from external changes (e.g. rich-editor edits while this ─────
  //    pane is simultaneously visible, in split view) ──────────────────────────
  //
  // App.tsx's onUpdate already keeps tab.markdown continuously fresh on every
  // WYSIWYG edit (microtask-deferred serialization — no change made here).
  // This effect's only job is to mirror that value into this pane's local
  // `text` state as soon as it changes, instead of only picking it up on the
  // next mount/tab-switch. `lastSelfWrittenRef` distinguishes "the store
  // changed because this pane itself just wrote it" (skip — already showing
  // it, and re-setting would reset the caret while the user is mid-keystroke)
  // from "the store changed because something else wrote it" (adopt it).
  // This relies purely on the existing store subscription — no diffing,
  // patching, or position mapping, and no unmount/remount.
  const storeMarkdown = useTabStore(
    (s) => s.tabs.find((t) => t.id === activeTabId)?.markdown
  );
  const lastSelfWrittenRef = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (!active) return;
    if (storeMarkdown === undefined) return;
    if (storeMarkdown === lastSelfWrittenRef.current) return;
    setText(storeMarkdown);
  }, [active, storeMarkdown]);

  // ── Debounce cancellation on tab / mode change ──────────────────────────────
  //
  // By including activeTabId and active in the deps, React runs the cleanup
  // (clearTimeout) whenever either changes. This is the primary guard: a timer
  // scheduled for Tab A is cancelled before any Tab B work begins. Also resets
  // the self-write tracker so a stale value from the previous tab/activation
  // can never suppress a legitimate external update on the new one.
  useEffect(() => {
    return () => {
      if (syncTimerRef.current !== null) {
        clearTimeout(syncTimerRef.current);
        syncTimerRef.current = null;
      }
      lastSelfWrittenRef.current = undefined;
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
      // Record this as a self-authored write BEFORE the store update, so the
      // live-sync effect above recognizes the resulting store change as an
      // echo of this pane's own edit rather than an external change to mirror.
      lastSelfWrittenRef.current = newText;
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
      syncTimerRef.current = setTimeout(() => {
        if (activeTabIdRef.current !== capturedTabId) return;
        // Re-read the store at fire time instead of parsing the text that was
        // frozen 250ms ago at schedule time. In split view, a rich-editor
        // edit can land in this same window and already be reflected in the
        // store (via onUpdate) and in this pane's own live-sync effect above;
        // parsing the stale captured string here would silently discard that
        // edit when it overwrites the doc below. Reading the store's current
        // value keeps this a "resync the doc from the source of truth"
        // operation rather than a replay of an outdated keystroke — the
        // 250ms interval itself, and everything else about this debounce,
        // is unchanged.
        const freshest = useTabStore.getState().tabs.find((t) => t.id === capturedTabId)?.markdown;
        if (freshest === undefined) return;
        // emitUpdate:false — this pane already wrote `markdown` to the store
        // directly above; suppressing the update event prevents App.tsx's
        // onUpdate from re-serializing and writing a redundant (and possibly
        // reformatted/canonicalized) copy back over what the user just typed.
        // Previously this was a no-op in practice because onUpdate's own
        // `sourceModeRef.current` guard already skipped it whenever this pane
        // could be active; that guard no longer holds once this pane can be
        // visible at the same time as the rich editor (split view), so the
        // suppression now has to be explicit here instead of implicit there.
        editor.commands.setContent(parseMarkdownToDoc(freshest), { emitUpdate: false });
      }, 250);
    },
    [editor],
  );

  if (!active) return null;

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <textarea
        ref={textareaRef}
        value={text}
        onChange={handleChange}
        spellCheck={false}
        className="flex-1 resize-none bg-[var(--color-page-bg)] px-10 py-10 font-mono text-sm leading-relaxed text-[var(--color-text)] outline-none"
        style={{ tabSize: 2 }}
        aria-label="Markdown source"
      />
    </div>
  );
});
