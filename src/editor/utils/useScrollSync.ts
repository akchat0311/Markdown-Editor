import { useCallback, useEffect, useRef } from "react";
import type { RefObject } from "react";
import type { Editor } from "@tiptap/core";
import { useEditorState } from "@tiptap/react";
import { deriveOutline, flattenOutline } from "./deriveOutline";
import {
  scanSourceHeadingLines,
  buildHeadingAnchors,
  findActiveAnchorIndex,
  computeFollowerScrollTarget,
} from "./scrollSync";
import type { HeadingAnchor, PaneId } from "./scrollSync";
import { useTabStore } from "@/stores/tabStore";

interface UseScrollSyncArgs {
  editor: Editor | null;
  richContainerRef: RefObject<HTMLDivElement | null>;
  sourceTextareaRef: RefObject<HTMLTextAreaElement | null>;
  activeTabId: string | undefined;
  /** scrollSyncMode === "linked" && both split-view panes are visible. */
  enabled: boolean;
}

/**
 * Split-view scroll synchronization — Phase 1 (heading-anchor only, no
 * interpolation). See docs/split-view-scroll-sync-design.md.
 *
 * Coordinate reads (coordsAtPos / textarea line-height math) are never
 * cached ahead of time — only the STRUCTURAL pairing (heading ordinal ↔
 * pmPos ↔ source line) is cached. Pixel Y-positions are recomputed live on
 * every sync. This is deliberate: an audit of the NodeViews found that
 * headings after an in-flight Mermaid render (async `mermaid.render()`,
 * no reserved height) or the very first KaTeX node of a session (dynamic
 * `import("katex")`) can have transiently-wrong pixel coordinates while
 * that async work is in flight. Caching coordinates would freeze that
 * staleness; computing them fresh on each sync means a mistimed sync just
 * self-corrects on the next scroll tick once rendering settles.
 */
export function useScrollSync({
  editor,
  richContainerRef,
  sourceTextareaRef,
  activeTabId,
  enabled,
}: UseScrollSyncArgs): void {
  // ── Anchor cache: lazy — marked dirty on change, rebuilt only when the
  //    next sync actually needs it (not eagerly on every keystroke). ───────
  const anchorsRef = useRef<HeadingAnchor[] | null>(null);
  const markAnchorsDirty = useCallback(() => {
    anchorsRef.current = null;
  }, []);

  useEffect(() => {
    markAnchorsDirty();
  }, [activeTabId, markAnchorsDirty]);

  // Doc-reference identity change = a content-modifying transaction landed
  // (PM reuses the doc reference for selection-only transactions) — same
  // signal useRequirementIndex.ts uses to detect structural changes.
  const doc = useEditorState({
    editor,
    selector: ({ editor: e }) => e?.state.doc ?? null,
    equalityFn: (a, b) => a === b,
  });
  useEffect(() => {
    markAnchorsDirty();
  }, [doc, markAnchorsDirty]);

  const sourceMarkdown = useTabStore(
    (s) => s.tabs.find((t) => t.id === activeTabId)?.markdown,
  );
  useEffect(() => {
    markAnchorsDirty();
  }, [sourceMarkdown, markAnchorsDirty]);

  const ensureAnchors = useCallback((): HeadingAnchor[] => {
    if (anchorsRef.current !== null) return anchorsRef.current;
    if (!editor) {
      anchorsRef.current = [];
      return anchorsRef.current;
    }
    const richPositions = flattenOutline(deriveOutline(editor)).map((n) => n.pmPos);
    const markdown = useTabStore.getState().tabs.find((t) => t.id === activeTabId)?.markdown ?? "";
    const sourceLines = scanSourceHeadingLines(markdown);
    anchorsRef.current = buildHeadingAnchors(richPositions, sourceLines);
    return anchorsRef.current;
  }, [editor, activeTabId]);

  // ── Master-pane tracking ──────────────────────────────────────────────────
  //
  // Recorded explicitly (not just inferred from the loop-prevention guard
  // below) so "which pane is currently driving" is its own piece of state —
  // available to future consumers (e.g. a debug affordance, or a future
  // follow-cursor mode) even though v1's loop prevention only needs the
  // per-pane programmatic-write flag to behave correctly.
  const masterPaneRef = useRef<PaneId | null>(null);

  // ── Loop prevention ────────────────────────────────────────────────────────
  //
  // Set right before writing a follower's scrollTop; cleared two animation
  // frames later. Programmatic writes must never be misread as a genuine
  // user scroll (which would steal master status and/or bounce back a sync
  // in the other direction) — a single rAF isn't always enough margin for
  // the browser's own (sometimes coalesced) scroll-event dispatch to land
  // first, so the flag is held for two.
  const programmaticWriteRef = useRef<PaneId | null>(null);

  const clearProgrammaticFlag = useCallback((pane: PaneId) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (programmaticWriteRef.current === pane) programmaticWriteRef.current = null;
      });
    });
  }, []);

  // Line-height/padding are read once (fixed font/styles — nothing in this
  // app changes them at runtime) and reused; only the coordsAtPos-derived
  // rich-pane Y and the line-number-derived source-pane Y are recomputed
  // live per sync, per the module doc comment above.
  const sourceMetricsRef = useRef<{ lineHeight: number; paddingTop: number } | null>(null);

  const richContentY = useCallback(
    (pmPos: number): number => {
      const container = richContainerRef.current;
      if (!editor || !container) return 0;
      const coords = editor.view.coordsAtPos(pmPos);
      const rect = container.getBoundingClientRect();
      return coords.top - rect.top + container.scrollTop;
    },
    [editor, richContainerRef],
  );

  const sourceContentY = useCallback(
    (line: number): number => {
      const textarea = sourceTextareaRef.current;
      if (!textarea) return 0;
      if (sourceMetricsRef.current === null) {
        const cs = getComputedStyle(textarea);
        sourceMetricsRef.current = {
          lineHeight: parseFloat(cs.lineHeight) || 20,
          paddingTop: parseFloat(cs.paddingTop) || 0,
        };
      }
      const { lineHeight, paddingTop } = sourceMetricsRef.current;
      return paddingTop + line * lineHeight;
    },
    [sourceTextareaRef],
  );

  const processSync = useCallback(
    (pane: PaneId, masterScrollTop: number) => {
      const richContainer = richContainerRef.current;
      const sourceTextarea = sourceTextareaRef.current;
      if (!editor || !richContainer || !sourceTextarea) return;

      const anchors = ensureAnchors();
      // Phase 1 is heading-anchor sync ONLY — a headingless document (or a
      // mid-edit heading-count mismatch that dropped every pair) has no
      // fallback yet and is intentionally left un-synced.
      if (anchors.length === 0) return;

      if (pane === "rich") {
        const masterYs = anchors.map((a) => richContentY(a.pmPos));
        const activeIdx = findActiveAnchorIndex(masterYs, masterScrollTop);
        const targetY = activeIdx === -1 ? 0 : sourceContentY(anchors[activeIdx].sourceLine);
        const next = computeFollowerScrollTarget(sourceTextarea.scrollTop, targetY);
        if (next === null) return;
        programmaticWriteRef.current = "source";
        sourceTextarea.scrollTop = next;
        clearProgrammaticFlag("source");
      } else {
        const masterYs = anchors.map((a) => sourceContentY(a.sourceLine));
        const activeIdx = findActiveAnchorIndex(masterYs, masterScrollTop);
        const targetY = activeIdx === -1 ? 0 : richContentY(anchors[activeIdx].pmPos);
        const next = computeFollowerScrollTarget(richContainer.scrollTop, targetY);
        if (next === null) return;
        programmaticWriteRef.current = "rich";
        richContainer.scrollTop = next;
        clearProgrammaticFlag("rich");
      }
    },
    [editor, richContainerRef, sourceTextareaRef, ensureAnchors, richContentY, sourceContentY, clearProgrammaticFlag],
  );

  // ── rAF-batched scroll scheduling ──────────────────────────────────────────
  //
  // Standard pattern: the scroll event only records the latest position; a
  // single rAF (not one per event) drains it. Deliberately not debounced —
  // debouncing a live scroll-follow makes the follower visibly lag behind
  // the master instead of tracking it.
  const pendingRef = useRef<{ pane: PaneId; scrollTop: number } | null>(null);
  const rafScheduledRef = useRef(false);

  const scheduleSync = useCallback(
    (pane: PaneId, scrollTop: number) => {
      pendingRef.current = { pane, scrollTop };
      if (rafScheduledRef.current) return;
      rafScheduledRef.current = true;
      requestAnimationFrame(() => {
        rafScheduledRef.current = false;
        const pending = pendingRef.current;
        pendingRef.current = null;
        if (pending) processSync(pending.pane, pending.scrollTop);
      });
    },
    [processSync],
  );

  useEffect(() => {
    if (!enabled) return;
    const richEl = richContainerRef.current;
    const sourceEl = sourceTextareaRef.current;
    if (!richEl || !sourceEl) return;

    const onRichScroll = () => {
      // A programmatic echo of our own follower write — never treat it as a
      // genuine user gesture, and never let it steal master status.
      if (programmaticWriteRef.current === "rich") return;
      masterPaneRef.current = "rich";
      scheduleSync("rich", richEl.scrollTop);
    };
    const onSourceScroll = () => {
      if (programmaticWriteRef.current === "source") return;
      masterPaneRef.current = "source";
      scheduleSync("source", sourceEl.scrollTop);
    };

    richEl.addEventListener("scroll", onRichScroll, { passive: true });
    sourceEl.addEventListener("scroll", onSourceScroll, { passive: true });
    return () => {
      richEl.removeEventListener("scroll", onRichScroll);
      sourceEl.removeEventListener("scroll", onSourceScroll);
    };
  }, [enabled, richContainerRef, sourceTextareaRef, scheduleSync]);
}
