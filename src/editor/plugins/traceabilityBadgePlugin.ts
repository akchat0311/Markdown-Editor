import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { EditorState } from "@tiptap/pm/state";
import type { Node as PMNode } from "@tiptap/pm/model";
import { useConfigStore } from "@/stores/configStore";
import { useTraceabilityStore } from "@/stores/traceabilityStore";
import { useTraceabilityPanelStore } from "@/stores/traceabilityPanelStore";
import { useCommentDrawerStore } from "@/stores/commentDrawerStore";
import { buildLinksByReq } from "@/services/traceabilityQuery";
import { compileRequirementPattern, matchRequirementId } from "@/editor/utils/requirementOps";
import type { TestCase } from "@/types/traceability";

export const traceabilityBadgeKey = new PluginKey<DecorationSet>("traceabilityBadge");

// ── Widget factory ────────────────────────────────────────────────────────────

function createBadgeWidget(reqId: string, linked: TestCase[]): () => HTMLElement {
  return () => {
    const count = linked.length;

    // Wrapper hosts the CSS hover tooltip; the button is the clickable badge.
    const wrap = document.createElement("span");
    wrap.className = "req-trace-badge-wrap";
    wrap.setAttribute("contenteditable", "false");

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = count === 0 ? "req-trace-badge req-trace-badge--empty" : "req-trace-badge";
    btn.setAttribute(
      "aria-label",
      count === 0
        ? `No linked test cases for ${reqId} — click to link`
        : `${count} linked test case${count !== 1 ? "s" : ""} for ${reqId} — click to manage`,
    );

    const icon = document.createElement("span");
    icon.textContent = "🧪";
    icon.style.fontSize = "0.9em";
    btn.appendChild(icon);

    const label = document.createElement("span");
    label.textContent = String(count);
    btn.appendChild(label);

    // Hover tooltip: linked test case IDs + titles (spec: no titles in the
    // heading itself — the tooltip is where titles appear).
    const tip = document.createElement("div");
    tip.className = "req-trace-tooltip";
    if (count === 0) {
      const none = document.createElement("div");
      none.className = "req-trace-tooltip-empty";
      none.textContent = "No linked test cases";
      tip.appendChild(none);
    } else {
      const header = document.createElement("div");
      header.className = "req-trace-tooltip-header";
      header.textContent = "Linked Test Cases";
      tip.appendChild(header);
      for (const tc of linked) {
        const row = document.createElement("div");
        row.className = "req-trace-tooltip-row";
        const id = document.createElement("span");
        id.className = "req-trace-tooltip-id";
        id.textContent = tc.id;
        row.appendChild(id);
        if (tc.title) {
          // Title is optional — untitled test cases show only their ID.
          const title = document.createElement("span");
          title.className = "req-trace-tooltip-title";
          title.textContent = tc.title;
          row.appendChild(title);
        }
        tip.appendChild(row);
      }
    }

    btn.addEventListener("mousedown", (e) => {
      e.preventDefault();
      e.stopPropagation();
      // The right workspace hosts one contextual panel at a time — opening
      // traceability displaces an open comment drawer (and vice versa,
      // enforced in App.tsx).
      useCommentDrawerStore.getState().close();
      useTraceabilityPanelStore.getState().open(reqId);
    });

    wrap.append(btn, tip);
    return wrap;
  };
}

// ── Decoration builder ────────────────────────────────────────────────────────

function buildDecorations(editorState: EditorState): DecorationSet {
  const { requirementPattern } = useConfigStore.getState();
  const compiled = requirementPattern ? compileRequirementPattern(requirementPattern) : null;
  if (!compiled) return DecorationSet.empty;

  const { testCases, links } = useTraceabilityStore.getState();
  // Shared projection (services/traceabilityQuery) — same source the
  // dashboard table and the workspace panel consume.
  const byReq = buildLinksByReq(testCases, links);
  const decorations: Decoration[] = [];
  // Occurrence counter disambiguates duplicate requirement IDs without tying
  // the widget key to a document position.
  const occurrences = new Map<string, number>();

  function processHeading(node: PMNode, nodePos: number) {
    const text = node.textContent;
    const matched = matchRequirementId(text, compiled!);
    if (!matched) return;

    const reqId = matched.id;
    const linked = byReq.get(reqId) ?? [];
    const occ = occurrences.get(reqId) ?? 0;
    occurrences.set(reqId, occ + 1);

    // Same anchor position as the review badge; side +1 places 🧪 after 💬.
    const bracketMatch = text.match(/(\[[^\]]+\])\s*$/);
    const badgePos = bracketMatch
      ? nodePos + 1 + text.lastIndexOf(bracketMatch[1]) + bracketMatch[1].length
      : nodePos + 1 + text.length;
    const badgeSide = bracketMatch ? 2 : 3;

    decorations.push(
      Decoration.widget(badgePos, createBadgeWidget(reqId, linked), {
        side: badgeSide,
        // Key encodes the identity (reqId + occurrence — deliberately NOT the
        // node position, so unrelated edits that shift positions don't force
        // PM to recreate every widget's DOM) and the projection (so the badge
        // and tooltip DO rebuild whenever links or test-case titles change).
        key: `tb-${reqId}#${occ}-${JSON.stringify(linked)}`,
        stopEvent: () => true,
      }),
    );
  }

  editorState.doc.forEach((node, offset) => {
    if (node.type.name === "heading") {
      processHeading(node, offset);
    } else if (node.type.name === "blockquote" || node.type.name === "callout") {
      node.forEach((child, childOffset) => {
        if (child.type.name === "heading") {
          processHeading(child, offset + 1 + childOffset);
        }
      });
    }
  });

  return DecorationSet.create(editorState.doc, decorations);
}

// ── Plugin ────────────────────────────────────────────────────────────────────

export const traceabilityBadgePlugin = new Plugin<DecorationSet>({
  key: traceabilityBadgeKey,

  state: {
    init(_, state) {
      return buildDecorations(state);
    },
    apply(tr, old, _, newState) {
      const meta = tr.getMeta(traceabilityBadgeKey) as { refresh?: boolean } | undefined;
      if (tr.docChanged || meta?.refresh) return buildDecorations(newState);
      return old.map(tr.mapping, tr.doc);
    },
  },

  props: {
    decorations(state) {
      return traceabilityBadgeKey.getState(state);
    },
  },

  view(editorView) {
    const refresh = () => {
      if (!editorView.isDestroyed) {
        editorView.dispatch(
          editorView.state.tr.setMeta(traceabilityBadgeKey, { refresh: true }),
        );
      }
    };

    // Rebuild whenever links or test cases change (add/remove/rename/load/reset).
    let prevTestCases = useTraceabilityStore.getState().testCases;
    let prevLinks = useTraceabilityStore.getState().links;
    const unsubscribeTrace = useTraceabilityStore.subscribe((s) => {
      if (s.testCases !== prevTestCases || s.links !== prevLinks) {
        prevTestCases = s.testCases;
        prevLinks = s.links;
        refresh();
      }
    });

    // Rebuild when the requirement pattern changes (reference inequality —
    // the config store replaces the pattern object on every set/clear).
    let prevPattern = useConfigStore.getState().requirementPattern;
    const unsubscribeConfig = useConfigStore.subscribe((s) => {
      if (s.requirementPattern !== prevPattern) {
        prevPattern = s.requirementPattern;
        refresh();
      }
    });

    return {
      update() {},
      destroy() {
        unsubscribeTrace();
        unsubscribeConfig();
      },
    };
  },
});
