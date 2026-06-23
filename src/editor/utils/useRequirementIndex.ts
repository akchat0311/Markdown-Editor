import { useEffect, useRef, useState } from "react";
import { useEditorState } from "@tiptap/react";
import type { Editor } from "@tiptap/react";
import { deriveOutline, flattenOutline } from "./deriveOutline";
import { buildRequirementIndex } from "./requirementOps";
import type { RequirementIndex } from "./requirementOps";
import { useStatusConfigStore } from "@/stores/statusConfigStore";

const DEBOUNCE_MS = 300;

/**
 * Derives a RequirementIndex from the live editor, debounced.
 *
 * - Subscribes only to doc content changes (not cursor movement).
 * - Reads statuses from statusConfigStore — no additional fetch.
 * - Runs a single O(n) analysis pass per debounce tick.
 * - Returns null when no pattern is configured or the pattern is invalid.
 */
export function useRequirementIndex(
  editor: Editor | null,
  patternExample: string | null
): RequirementIndex | null {
  const [index, setIndex] = useState<RequirementIndex | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const statuses = useStatusConfigStore((s) => s.statuses);

  // Subscribe to doc changes (ignores cursor-only transactions via equalityFn).
  // Using the doc node reference rather than content.size: PM creates a new doc
  // object on every content-modifying transaction and reuses the same reference
  // for selection-only transactions.  content.size is not a unique fingerprint —
  // same-length replacements (e.g. REQ_003 → REQ_001) leave it unchanged.
  const doc = useEditorState({
    editor,
    selector: ({ editor: e }) => e?.state.doc ?? null,
    equalityFn: (a, b) => a === b,
  });

  useEffect(() => {
    if (!editor || !patternExample) {
      setIndex(null);
      return;
    }

    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      const flat = flattenOutline(deriveOutline(editor));
      setIndex(buildRequirementIndex(flat, patternExample, statuses));
    }, DEBOUNCE_MS);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  // doc and statuses are the reactive triggers.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, patternExample, doc, statuses]);

  return index;
}
