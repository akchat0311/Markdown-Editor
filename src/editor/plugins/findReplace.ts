import { Plugin, PluginKey, TextSelection } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { Node as PMNode } from "@tiptap/pm/model";
import type { Transaction, EditorState } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";

// ── Types ──────────────────────────────────────────────────────────────────────

export interface FindMatch {
  from: number;
  to: number;
}

export interface FindReplacePluginState {
  query: string;
  caseSensitive: boolean;
  wholeWord: boolean;
  useRegex: boolean;
  currentMatchIndex: number;
  matches: FindMatch[];
  decorations: DecorationSet;
}

export type FindReplaceMeta =
  | { type: "setQuery"; query: string; caseSensitive: boolean; wholeWord: boolean; useRegex: boolean }
  | { type: "navigate"; currentMatchIndex: number }
  | { type: "clear" };

// ── Plugin key (exported for React components) ─────────────────────────────────

export const findReplaceKey = new PluginKey<FindReplacePluginState>("findReplace");

// ── Regex builder ──────────────────────────────────────────────────────────────

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function buildFindRegex(
  query: string,
  caseSensitive: boolean,
  wholeWord: boolean,
  useRegex: boolean
): RegExp | null {
  if (!query) return null;
  try {
    let pattern = useRegex ? query : escapeRegex(query);
    if (wholeWord) pattern = `\\b${pattern}\\b`;
    const flags = caseSensitive ? "g" : "gi";
    return new RegExp(pattern, flags);
  } catch {
    return null;
  }
}

// ── Match finder ───────────────────────────────────────────────────────────────

function findAllMatches(doc: PMNode, regex: RegExp): FindMatch[] {
  const matches: FindMatch[] = [];

  doc.descendants((node, pos) => {
    if (!node.isBlock) return true;

    // Build charIndex → PM-position mapping for this block's concatenated text
    const charPositions: number[] = [];
    node.descendants((child, childPos) => {
      if (!child.isText || !child.text) return;
      for (let i = 0; i < child.text.length; i++) {
        charPositions.push(pos + 1 + childPos + i);
      }
    });

    const text = node.textContent;
    if (!text) return false;

    regex.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = regex.exec(text)) !== null) {
      const start = m.index;
      const end = start + m[0].length;
      if (end === start) {
        regex.lastIndex = start + 1;
        continue;
      }
      if (end > charPositions.length) break;
      matches.push({
        from: charPositions[start],
        to: charPositions[end - 1] + 1,
      });
    }

    return false; // we already walked descendants
  });

  return matches;
}

// ── Decoration builder ────────────────────────────────────────────────────────

function buildDecorations(
  doc: PMNode,
  matches: FindMatch[],
  currentIndex: number
): DecorationSet {
  if (matches.length === 0) return DecorationSet.empty;
  const decos = matches.map((m, i) =>
    Decoration.inline(m.from, m.to, {
      class: i === currentIndex ? "find-match find-match-active" : "find-match",
    })
  );
  return DecorationSet.create(doc, decos);
}

// ── Initial state ─────────────────────────────────────────────────────────────

const EMPTY_STATE: FindReplacePluginState = {
  query: "",
  caseSensitive: false,
  wholeWord: false,
  useRegex: false,
  currentMatchIndex: -1,
  matches: [],
  decorations: DecorationSet.empty,
};

// ── Plugin ────────────────────────────────────────────────────────────────────

export const findReplacePlugin = new Plugin<FindReplacePluginState>({
  key: findReplaceKey,

  state: {
    init(): FindReplacePluginState {
      return EMPTY_STATE;
    },

    apply(
      tr: Transaction,
      pluginState: FindReplacePluginState,
      _oldEditorState: EditorState,
      newEditorState: EditorState
    ): FindReplacePluginState {
      const meta = tr.getMeta(findReplaceKey) as FindReplaceMeta | undefined;

      if (meta?.type === "clear") {
        return EMPTY_STATE;
      }

      // Navigate: if doc also changed (e.g. after replaceCurrent), rebuild first
      if (meta?.type === "navigate") {
        if (!tr.docChanged) {
          const idx = meta.currentMatchIndex;
          return {
            ...pluginState,
            currentMatchIndex: idx,
            decorations: buildDecorations(newEditorState.doc, pluginState.matches, idx),
          };
        }
        // Doc changed — fall through with desired index preserved in meta
        // (handled by the rebuild path below, which reads pluginState.currentMatchIndex;
        //  we'll inject it after rebuild)
        const regex = buildFindRegex(pluginState.query, pluginState.caseSensitive, pluginState.wholeWord, pluginState.useRegex);
        if (!regex) return { ...pluginState, matches: [], currentMatchIndex: -1, decorations: DecorationSet.empty };
        const freshMatches = findAllMatches(newEditorState.doc, regex);
        const desiredIdx = meta.currentMatchIndex;
        const idx = freshMatches.length === 0 ? -1 : Math.min(desiredIdx < 0 ? 0 : desiredIdx, freshMatches.length - 1);
        return {
          ...pluginState,
          currentMatchIndex: idx,
          matches: freshMatches,
          decorations: buildDecorations(newEditorState.doc, freshMatches, idx),
        };
      }

      // Determine which query params to use going forward
      const nextParams = meta?.type === "setQuery"
        ? { query: meta.query, caseSensitive: meta.caseSensitive, wholeWord: meta.wholeWord, useRegex: meta.useRegex }
        : { query: pluginState.query, caseSensitive: pluginState.caseSensitive, wholeWord: pluginState.wholeWord, useRegex: pluginState.useRegex };

      // If no meta and doc didn't change, just remap decoration positions
      if (!meta && !tr.docChanged) {
        return {
          ...pluginState,
          decorations: pluginState.decorations.map(tr.mapping, tr.doc),
        };
      }

      // Rebuild matches from current doc
      const regex = buildFindRegex(nextParams.query, nextParams.caseSensitive, nextParams.wholeWord, nextParams.useRegex);
      if (!regex) {
        return { ...pluginState, ...nextParams, matches: [], currentMatchIndex: -1, decorations: DecorationSet.empty };
      }

      const matches = findAllMatches(newEditorState.doc, regex);

      let currentMatchIndex = pluginState.currentMatchIndex;
      if (meta?.type === "setQuery") {
        // New query → jump to first match
        currentMatchIndex = matches.length > 0 ? 0 : -1;
      } else {
        // Doc changed → clamp index
        if (matches.length === 0) currentMatchIndex = -1;
        else if (currentMatchIndex >= matches.length) currentMatchIndex = matches.length - 1;
        else if (currentMatchIndex < 0) currentMatchIndex = 0;
      }

      return {
        ...nextParams,
        currentMatchIndex,
        matches,
        decorations: buildDecorations(newEditorState.doc, matches, currentMatchIndex),
      };
    },
  },

  props: {
    decorations(state: EditorState) {
      return findReplaceKey.getState(state)?.decorations ?? DecorationSet.empty;
    },
  },
});

// ── View helpers used by the React bar ────────────────────────────────────────

type MinimalView = Pick<EditorView, "state" | "dispatch">;

export function setFindQuery(
  view: MinimalView,
  params: { query: string; caseSensitive: boolean; wholeWord: boolean; useRegex: boolean }
): void {
  const tr = view.state.tr.setMeta(findReplaceKey, { type: "setQuery", ...params } satisfies FindReplaceMeta);
  // Scroll to the first match immediately so the user never has to manually
  // hunt for it. findAllMatches also runs inside the plugin's apply; the
  // duplication is intentional — we need the position before dispatch to set
  // the selection on the same transaction. Two passes over the doc is
  // negligible for any practical document size.
  const regex = buildFindRegex(params.query, params.caseSensitive, params.wholeWord, params.useRegex);
  if (regex) {
    const first = findAllMatches(view.state.doc, regex)[0];
    if (first) {
      tr.setSelection(TextSelection.create(view.state.doc, first.from, first.to))
        .scrollIntoView();
    }
  }
  view.dispatch(tr);
}

export function navigateToMatch(view: MinimalView, index: number): void {
  const ps = findReplaceKey.getState(view.state);
  if (!ps || ps.matches.length === 0) return;

  const match = ps.matches[index];
  const tr = view.state.tr
    .setMeta(findReplaceKey, { type: "navigate", currentMatchIndex: index } satisfies FindReplaceMeta)
    .setSelection(TextSelection.create(view.state.doc, match.from, match.to))
    .scrollIntoView();
  view.dispatch(tr);
}

export function replaceCurrent(view: MinimalView, replacement: string): void {
  const ps = findReplaceKey.getState(view.state);
  if (!ps || ps.currentMatchIndex < 0) return;

  const match = ps.matches[ps.currentMatchIndex];
  if (!match) return;

  // Replace then advance to the next match
  const nextIndex = ps.matches.length > 1
    ? ps.currentMatchIndex % (ps.matches.length - 1)
    : -1;

  const tr = view.state.tr.insertText(replacement, match.from, match.to);
  // After insertion the plugin will recompute; stash the desired next index
  // by sending it as meta on the same transaction
  tr.setMeta(findReplaceKey, {
    type: "navigate",
    currentMatchIndex: nextIndex,
  } satisfies FindReplaceMeta);
  view.dispatch(tr);
}

export function replaceAll(view: MinimalView, replacement: string): void {
  const ps = findReplaceKey.getState(view.state);
  if (!ps || ps.matches.length === 0) return;

  // Apply in reverse so earlier positions stay valid as we replace
  let tr = view.state.tr;
  for (const match of [...ps.matches].reverse()) {
    tr = tr.insertText(replacement, match.from, match.to);
  }
  view.dispatch(tr);
}

export function clearFind(view: MinimalView): void {
  view.dispatch(
    view.state.tr.setMeta(findReplaceKey, { type: "clear" } satisfies FindReplaceMeta)
  );
}
