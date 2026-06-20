import { useEffect, useRef, useState } from "react";
import type { Editor } from "@tiptap/core";
import { serializeDocToMarkdown, parseMarkdownToDoc } from "@/markdown";

interface SourcePaneProps {
  editor: Editor;
  active: boolean;
}

export function SourcePane({ editor, active }: SourcePaneProps) {
  const [text, setText] = useState("");
  const syncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSyncedTextRef = useRef("");

  // Initialize text from editor when activated
  useEffect(() => {
    if (active) {
      const md = serializeDocToMarkdown(editor.getJSON());
      setText(md);
      lastSyncedTextRef.current = md;
    }
  }, [active, editor]);

  // Debounce writes back to Tiptap
  useEffect(() => {
    if (!active || text === lastSyncedTextRef.current) return;
    if (syncTimerRef.current) clearTimeout(syncTimerRef.current);
    syncTimerRef.current = setTimeout(() => {
      lastSyncedTextRef.current = text;
      editor.commands.setContent(parseMarkdownToDoc(text));
    }, 250);
    return () => {
      if (syncTimerRef.current) clearTimeout(syncTimerRef.current);
    };
  }, [text, active, editor]);

  if (!active) return null;

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        spellCheck={false}
        className="flex-1 resize-none bg-[var(--color-page-bg)] px-10 py-10 font-mono text-sm leading-relaxed text-[var(--color-text)] outline-none"
        style={{ tabSize: 2 }}
        aria-label="Markdown source"
      />
    </div>
  );
}
