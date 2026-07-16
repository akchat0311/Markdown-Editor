import { useEffect, useRef, useState } from "react";
import { useEditorState } from "@tiptap/react";
import type { Editor } from "@tiptap/react";
import type { JSONContent } from "@tiptap/core";
import { deriveOutline, flattenOutline } from "./deriveOutline";
import { compileRequirementPattern, matchRequirementId, extractStatusText } from "./requirementOps";
import type { RequirementPatternInput } from "./requirementOps";
import { getNodeSectionRange } from "./outlineOps";
import { extractBodyText } from "./extractBodyText";
import { useStatusConfigStore } from "@/stores/statusConfigStore";
import type { RequirementRef } from "@/services/documentValidationService";
import type { ValidationIssue } from "@/types/validation";
import { runAllValidations } from "@/validation/engine";

const DEBOUNCE_MS = 500;

/**
 * Derives document-quality validation issues from the live editor, debounced.
 *
 * - Subscribes to doc content changes (cursor-only transactions are ignored)
 *   and to status configuration changes.
 * - Returns [] when no requirement pattern is configured or the pattern is invalid.
 * - Each RequirementRef carries all fields needed by all validation rules, so
 *   a single pass produces data for ordering, duplicate, status, and body checks.
 */
export function useDocumentValidation(
  editor: Editor | null,
  pattern: RequirementPatternInput,
): ValidationIssue[] {
  const [issues, setIssues] = useState<ValidationIssue[]>([]);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // React to doc content changes (not cursor movement).
  const doc = useEditorState({
    editor,
    selector: ({ editor: e }) => e?.state.doc ?? null,
    equalityFn: (a, b) => a === b,
  });

  // React to status configuration changes (alias set affects missing-status rule).
  const statuses = useStatusConfigStore((s) => s.statuses);

  useEffect(() => {
    if (!editor || !pattern) {
      setIssues([]);
      return;
    }

    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      const compiled = compileRequirementPattern(pattern);
      if (!compiled) { setIssues([]); return; }

      const flat = flattenOutline(deriveOutline(editor));
      const docContent = editor.state.doc.content.toJSON() as JSONContent[];

      // Build the complete alias set recognised by the current status configuration.
      // Each status entry contributes its full aliases array, exactly as configured;
      // checkMissingStatus normalizes case/whitespace when comparing against this set.
      const validAliases = new Set(statuses.flatMap((s) => s.aliases));

      const requirements: RequirementRef[] = [];
      for (const node of flat) {
        const matched = matchRequirementId(node.label, compiled);
        if (!matched) continue;

        const [, to] = getNodeSectionRange(docContent, node.index, node.level ?? 1);
        const bodyText = docContent
          .slice(node.index + 1, to)
          .map(extractBodyText)
          .join("")
          .trim();

        requirements.push({
          id: matched.id,
          num: matched.num,
          statusText: extractStatusText(node.label),
          bodyText,
        });
      }

      setIssues(runAllValidations(requirements, validAliases, docContent));
    }, DEBOUNCE_MS);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  // doc and statuses are the reactive triggers.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, pattern, doc, statuses]);

  return issues;
}
