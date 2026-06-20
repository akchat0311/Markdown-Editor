import { useState, useEffect, useRef, useContext, useCallback } from "react";
import type { Node as PMNode } from "@tiptap/pm/model";
import { EditorContext } from "@/editor/EditorContext";

interface SearchResult {
  label: string;
  type: "heading" | "text";
  snippet: string;
  pmPos: number;
}

function search(query: string, doc: import("@tiptap/pm/model").Node): SearchResult[] {
  if (!query.trim()) return [];
  const q = query.toLowerCase();
  const results: SearchResult[] = [];

  doc.descendants((node: PMNode, pos: number) => {
    if (node.type.name === "heading") {
      const text = node.textContent;
      if (text.toLowerCase().includes(q)) {
        results.push({ label: text, type: "heading", snippet: text, pmPos: pos });
      }
    } else if (node.type.name === "paragraph" || node.type.name === "text") {
      const text = node.textContent;
      if (text.toLowerCase().includes(q)) {
        const matchIdx = text.toLowerCase().indexOf(q);
        const snippet = text.slice(Math.max(0, matchIdx - 30), matchIdx + 60);
        results.push({ label: snippet, type: "text", snippet, pmPos: pos });
      }
    }
  });

  return results.slice(0, 40);
}

function HighlightedText({ text, query }: { text: string; query: string }) {
  if (!query.trim()) return <span>{text}</span>;
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const parts = text.split(new RegExp(`(${escaped})`, "gi"));
  return (
    <>
      {parts.map((part, i) =>
        part.toLowerCase() === query.toLowerCase() ? (
          <mark key={i} className="bg-yellow-200 text-yellow-900 dark:bg-yellow-700 dark:text-yellow-100 rounded px-0.5">
            {part}
          </mark>
        ) : (
          <span key={i}>{part}</span>
        )
      )}
    </>
  );
}

const TYPE_ICON: Record<string, string> = {
  heading: "#",
  text: "¶",
};

const TYPE_COLOR: Record<string, string> = {
  heading: "text-violet-500 dark:text-violet-400",
  text: "text-[var(--color-muted)]",
};

export function GlobalSearch() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const editor = useContext(EditorContext);

  const results: SearchResult[] = open && editor && query.trim()
    ? search(query, editor.state.doc)
    : [];

  const close = useCallback(() => {
    setOpen(false);
    setQuery("");
    setSelected(0);
  }, []);

  const jump = useCallback(
    (result: SearchResult) => {
      if (!editor) return;
      editor.chain().focus().setTextSelection(result.pmPos).scrollIntoView().run();
      close();
    },
    [editor, close]
  );

  // Keyboard shortcut: Cmd+K / Ctrl+K
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setOpen((o) => {
          if (o) close();
          else return true;
          return false;
        });
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [close]);

  // Focus input when opened
  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  // Arrow key navigation inside modal
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelected((s) => Math.min(s + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelected((s) => Math.max(s - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (results[selected]) jump(results[selected]);
    } else if (e.key === "Escape") {
      close();
    }
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 pt-[15vh] backdrop-blur-sm"
      onClick={close}
    >
      <div
        className="w-full max-w-lg rounded-xl border border-[var(--color-border)] bg-[var(--color-paper)] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        {/* Search input */}
        <div className="flex items-center gap-2 border-b border-[var(--color-border)] px-4 py-3">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="shrink-0 text-[var(--color-muted)]">
            <circle cx="7" cy="7" r="5" />
            <path d="m10.5 10.5 3 3" />
          </svg>
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => { setQuery(e.target.value); setSelected(0); }}
            placeholder="Search headings and text…"
            className="flex-1 bg-transparent text-sm text-[var(--color-text)] outline-none placeholder:text-[var(--color-muted)]"
          />
          <kbd className="shrink-0 rounded border border-[var(--color-border)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--color-muted)]">
            Esc
          </kbd>
        </div>

        {/* Results */}
        <div className="max-h-72 overflow-y-auto py-1">
          {query.trim() && results.length === 0 && (
            <p className="px-4 py-6 text-center text-sm text-[var(--color-muted)]">
              No results for "{query}"
            </p>
          )}
          {!query.trim() && (
            <p className="px-4 py-4 text-center text-xs text-[var(--color-muted)]">
              Type to search across headings and text
            </p>
          )}
          {results.map((r, i) => (
            <button
              key={i}
              className={`flex w-full items-start gap-3 px-4 py-2 text-left transition-colors ${
                i === selected
                  ? "bg-[var(--color-accent)] text-white"
                  : "hover:bg-[var(--color-border)]"
              }`}
              onClick={() => jump(r)}
              onMouseEnter={() => setSelected(i)}
            >
              <span
                className={`mt-0.5 shrink-0 rounded px-1.5 py-px font-mono text-[10px] font-bold ${
                  i === selected
                    ? "bg-white/20 text-white"
                    : TYPE_COLOR[r.type]
                }`}
              >
                {TYPE_ICON[r.type]}
              </span>
              <div className="min-w-0">
                <p className={`text-sm font-medium ${i === selected ? "text-white" : "text-[var(--color-text)]"}`}>
                  <HighlightedText text={r.label} query={i === selected ? "" : query} />
                </p>
                {r.snippet !== r.label && (
                  <p className={`mt-0.5 truncate text-xs ${i === selected ? "text-white/70" : "text-[var(--color-muted)]"}`}>
                    {r.snippet}
                  </p>
                )}
              </div>
            </button>
          ))}
        </div>

        {/* Footer */}
        <div className="flex items-center gap-3 border-t border-[var(--color-border)] px-4 py-2 text-[10px] text-[var(--color-muted)]">
          <span><kbd className="font-mono">↑↓</kbd> navigate</span>
          <span><kbd className="font-mono">↵</kbd> jump</span>
          <span><kbd className="font-mono">Esc</kbd> close</span>
          {results.length > 0 && (
            <span className="ml-auto">{results.length} result{results.length !== 1 ? "s" : ""}</span>
          )}
        </div>
      </div>
    </div>
  );
}
