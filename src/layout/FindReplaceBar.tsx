import {
  useEffect,
  useRef,
  useState,
  useCallback,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { useEditorState } from "@tiptap/react";
import { useContext } from "react";
import { EditorContext } from "@/editor/EditorContext";
import {
  findReplaceKey,
  setFindQuery,
  navigateToMatch,
  scrollActiveMatchIntoView,
  replaceCurrent,
  replaceAll,
  clearFind,
  buildFindRegex,
} from "@/editor/plugins/findReplace";

interface Props {
  open: boolean;
  showReplace: boolean;
  onClose: () => void;
}

export function FindReplaceBar({ open, showReplace, onClose }: Props) {
  const editor = useContext(EditorContext);

  const [query, setQuery] = useState("");
  const [replacement, setReplacement] = useState("");
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [wholeWord, setWholeWord] = useState(false);
  const [useRegex, setUseRegex] = useState(false);
  const [regexError, setRegexError] = useState(false);
  const [replaceOpen, setReplaceOpen] = useState(showReplace);

  const queryInputRef = useRef<HTMLInputElement>(null);
  const replaceInputRef = useRef<HTMLInputElement>(null);

  // Sync showReplace prop → local state
  useEffect(() => {
    setReplaceOpen(showReplace);
  }, [showReplace]);

  // Focus search input when bar opens; clear when it closes
  useEffect(() => {
    if (open) {
      queryInputRef.current?.focus();
      queryInputRef.current?.select();
    } else if (editor) {
      clearFind(editor.view);
      editor.commands.focus();
    }
  }, [open, editor]);

  // Validate regex and dispatch query update
  const dispatchQuery = useCallback(
    (q: string, cs: boolean, ww: boolean, rx: boolean) => {
      if (!editor) return;
      if (rx && q) {
        const ok = buildFindRegex(q, cs, ww, rx);
        setRegexError(!ok);
        if (!ok) return;
      } else {
        setRegexError(false);
      }
      setFindQuery(editor.view, { query: q, caseSensitive: cs, wholeWord: ww, useRegex: rx });
      scrollActiveMatchIntoView(editor.view);
    },
    [editor]
  );

  // Re-dispatch whenever query or flags change
  useEffect(() => {
    if (!open) return;
    dispatchQuery(query, caseSensitive, wholeWord, useRegex);
  }, [open, query, caseSensitive, wholeWord, useRegex, dispatchQuery]);

  // Read match state from plugin
  const pluginState = useEditorState({
    editor: editor ?? null,
    selector: (ctx) => ctx.editor ? findReplaceKey.getState(ctx.editor.state) : null,
  });

  const matchCount = pluginState?.matches.length ?? 0;
  const currentIndex = pluginState?.currentMatchIndex ?? -1;

  const goNext = useCallback(() => {
    if (!editor || matchCount === 0) return;
    const next = currentIndex < 0 ? 0 : (currentIndex + 1) % matchCount;
    navigateToMatch(editor.view, next);
    scrollActiveMatchIntoView(editor.view);
  }, [editor, currentIndex, matchCount]);

  const goPrev = useCallback(() => {
    if (!editor || matchCount === 0) return;
    const prev = currentIndex <= 0 ? matchCount - 1 : currentIndex - 1;
    navigateToMatch(editor.view, prev);
    scrollActiveMatchIntoView(editor.view);
  }, [editor, currentIndex, matchCount]);

  const handleReplaceOne = useCallback(() => {
    if (!editor) return;
    replaceCurrent(editor.view, replacement);
  }, [editor, replacement]);

  const handleReplaceAll = useCallback(() => {
    if (!editor) return;
    replaceAll(editor.view, replacement);
  }, [editor, replacement]);

  const handleClose = useCallback(() => {
    onClose();
  }, [onClose]);

  // Keyboard shortcuts inside the search input
  const onQueryKeyDown = useCallback(
    (e: ReactKeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Escape") {
        handleClose();
      } else if (e.key === "Enter") {
        e.preventDefault();
        if (e.shiftKey) goPrev();
        else goNext();
      }
    },
    [handleClose, goNext, goPrev]
  );

  const onReplaceKeyDown = useCallback(
    (e: ReactKeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Escape") handleClose();
      else if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleReplaceOne();
      }
    },
    [handleClose, handleReplaceOne]
  );

  // Forward Cmd/Ctrl+Z (undo) and Cmd/Ctrl+Shift+Z (redo) to the editor
  // regardless of which child has focus, so the bar never swallows them.
  const handleContainerKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== "z") return;
      e.preventDefault();
      if (e.shiftKey) {
        editor?.commands.redo();
      } else {
        editor?.commands.undo();
      }
    },
    [editor]
  );

  if (!open) return null;

  const matchLabel =
    matchCount === 0
      ? "No results"
      : `${currentIndex + 1} / ${matchCount}`;

  const toggleBtn = (
    active: boolean,
    title: string,
    onClick: () => void,
    children: React.ReactNode
  ) => (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className={[
        "flex h-6 w-6 items-center justify-center rounded text-[11px] transition-colors",
        active
          ? "bg-[var(--color-accent)] text-white"
          : "text-[var(--color-muted)] hover:bg-[var(--color-border)] hover:text-[var(--color-text)]",
      ].join(" ")}
    >
      {children}
    </button>
  );

  return (
    <div
      role="search"
      aria-label="Find and replace"
      onKeyDown={handleContainerKeyDown}
      className="absolute right-4 top-2 z-40 flex flex-col gap-1 rounded-lg border border-[var(--color-border)] bg-[var(--color-paper)] p-2 shadow-lg"
      style={{ minWidth: 340 }}
    >
      {/* ── Find row ──────────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-1">
        {/* Toggle replace row */}
        <button
          type="button"
          title={replaceOpen ? "Hide replace" : "Show replace"}
          onClick={() => setReplaceOpen((o) => !o)}
          className="flex h-6 w-5 shrink-0 items-center justify-center rounded text-[var(--color-muted)] transition-colors hover:bg-[var(--color-border)] hover:text-[var(--color-text)]"
        >
          <svg
            width="9"
            height="9"
            viewBox="0 0 10 10"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{ transform: replaceOpen ? "rotate(90deg)" : "none", transition: "transform 0.15s" }}
          >
            <path d="M3 2l4 3-4 3" />
          </svg>
        </button>

        {/* Search input */}
        <div
          className={[
            "flex flex-1 items-center gap-1 rounded border px-2 py-0.5 transition-colors focus-within:border-[var(--color-accent)]",
            regexError ? "border-red-400" : "border-[var(--color-border)]",
          ].join(" ")}
        >
          <input
            ref={queryInputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onQueryKeyDown}
            placeholder="Find"
            spellCheck={false}
            aria-label="Search text"
            className="min-w-0 flex-1 bg-transparent text-[13px] text-[var(--color-text)] outline-none placeholder:text-[var(--color-muted)]"
          />
          {/* Match count */}
          <span className="shrink-0 text-[11px] text-[var(--color-muted)] tabular-nums">
            {query ? matchLabel : ""}
          </span>
        </div>

        {/* Option toggles: Aa Ww .* */}
        <div className="flex items-center gap-0.5">
          {toggleBtn(caseSensitive, "Case sensitive (Alt+C)", () => setCaseSensitive((v) => !v),
            <span className="font-mono font-bold leading-none">Aa</span>
          )}
          {toggleBtn(wholeWord, "Whole word (Alt+W)", () => setWholeWord((v) => !v),
            <span className="font-mono leading-none" style={{ fontSize: 10 }}>W</span>
          )}
          {toggleBtn(useRegex, "Use regular expression (Alt+R)", () => setUseRegex((v) => !v),
            <span className="font-mono leading-none">.*</span>
          )}
        </div>

        {/* Navigation arrows */}
        <div className="flex items-center gap-0.5">
          <button
            type="button"
            title="Previous match (Shift+Enter)"
            onClick={goPrev}
            disabled={matchCount === 0}
            className="flex h-6 w-6 items-center justify-center rounded text-[var(--color-muted)] transition-colors hover:bg-[var(--color-border)] hover:text-[var(--color-text)] disabled:opacity-30"
          >
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M2 6.5l3-3 3 3" />
            </svg>
          </button>
          <button
            type="button"
            title="Next match (Enter)"
            onClick={goNext}
            disabled={matchCount === 0}
            className="flex h-6 w-6 items-center justify-center rounded text-[var(--color-muted)] transition-colors hover:bg-[var(--color-border)] hover:text-[var(--color-text)] disabled:opacity-30"
          >
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M2 3.5l3 3 3-3" />
            </svg>
          </button>
        </div>

        {/* Close */}
        <button
          type="button"
          title="Close (Escape)"
          onClick={handleClose}
          className="flex h-6 w-6 items-center justify-center rounded text-[var(--color-muted)] transition-colors hover:bg-[var(--color-border)] hover:text-[var(--color-text)]"
        >
          <svg width="9" height="9" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
            <path d="M2 2l6 6M8 2l-6 6" />
          </svg>
        </button>
      </div>

      {/* ── Replace row ───────────────────────────────────────────────────────── */}
      {replaceOpen && (
        <div className="flex items-center gap-1 pl-6">
          <div className="flex flex-1 items-center rounded border border-[var(--color-border)] px-2 py-0.5 transition-colors focus-within:border-[var(--color-accent)]">
            <input
              ref={replaceInputRef}
              value={replacement}
              onChange={(e) => setReplacement(e.target.value)}
              onKeyDown={onReplaceKeyDown}
              placeholder="Replace"
              spellCheck={false}
              aria-label="Replace text"
              className="min-w-0 flex-1 bg-transparent text-[13px] text-[var(--color-text)] outline-none placeholder:text-[var(--color-muted)]"
            />
          </div>
          <button
            type="button"
            title="Replace (Enter)"
            onClick={handleReplaceOne}
            disabled={matchCount === 0}
            className="shrink-0 rounded border border-[var(--color-border)] px-2 py-0.5 text-[12px] text-[var(--color-text)] transition-colors hover:bg-[var(--color-border)] disabled:opacity-30"
          >
            Replace
          </button>
          <button
            type="button"
            title="Replace all"
            onClick={handleReplaceAll}
            disabled={matchCount === 0}
            className="shrink-0 rounded border border-[var(--color-border)] px-2 py-0.5 text-[12px] text-[var(--color-text)] transition-colors hover:bg-[var(--color-border)] disabled:opacity-30"
          >
            All
          </button>
        </div>
      )}

      {/* Regex error hint */}
      {regexError && (
        <p className="pl-6 text-[11px] text-red-400">Invalid regular expression</p>
      )}
    </div>
  );
}
