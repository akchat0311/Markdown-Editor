import { useContext } from "react";
import { useEditorState } from "@tiptap/react";
import { EditorContext } from "@/editor/EditorContext";
import { useUIStore, useTabStore, getActiveTab } from "@/stores";

function countWords(text: string): number {
  return text.trim() ? text.trim().split(/\s+/).length : 0;
}

function readingTime(words: number): string {
  const mins = Math.max(1, Math.round(words / 200));
  return `${mins} min read`;
}

export function StatusBar() {
  const editor = useContext(EditorContext);
  const sourceMode = useUIStore((s) => s.sourceMode);
  const toggleSourceMode = useUIStore((s) => s.toggleSourceMode);
  const isDirty = useTabStore((s) => getActiveTab(s)?.isDirty ?? false);

  const stats = useEditorState({
    editor,
    selector: ({ editor: e }) => {
      if (!e) return { words: 0, chars: 0, pos: 0 };
      const text = e.getText();
      return {
        words: countWords(text),
        chars: text.length,
        pos: e.state.selection.from,
      };
    },
    equalityFn: (a, b) =>
      a?.words === b?.words && a?.chars === b?.chars && a?.pos === b?.pos,
  });

  const words = stats?.words ?? 0;
  const chars = stats?.chars ?? 0;

  return (
    <div className="flex h-7 shrink-0 items-center gap-3 border-t border-[var(--color-border)] bg-[var(--color-page-bg)] px-3 text-[10px] text-[var(--color-muted)] select-none">
      <span>{words.toLocaleString()} words</span>
      <span className="opacity-40">·</span>
      <span>{chars.toLocaleString()} chars</span>
      <span className="opacity-40">·</span>
      <span>{readingTime(words)}</span>

      <div className="ml-auto flex items-center gap-2">
        {isDirty ? (
          <span className="flex items-center gap-1">
            <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
            Unsaved Changes
          </span>
        ) : (
          <span className="opacity-40">Saved</span>
        )}
        <span className="opacity-40">·</span>
        <span className="opacity-40">UTF-8</span>
        <button
          onClick={toggleSourceMode}
          title={sourceMode ? "Switch to WYSIWYG (⌘/)" : "View source (⌘/)"}
          className={[
            "flex items-center gap-1 rounded px-1.5 py-0.5 font-mono transition-colors",
            sourceMode
              ? "bg-[var(--color-accent)] text-white"
              : "hover:bg-[var(--color-border)] hover:text-[var(--color-text)]",
          ].join(" ")}
        >
          <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M5 4L1 8l4 4M11 4l4 4-4 4" />
          </svg>
          {sourceMode ? "Source" : "<>"}
        </button>
      </div>
    </div>
  );
}
