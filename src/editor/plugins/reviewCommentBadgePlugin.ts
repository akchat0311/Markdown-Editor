import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { EditorState } from "@tiptap/pm/state";
import type { Node as PMNode } from "@tiptap/pm/model";
import { useConfigStore } from "@/stores/configStore";
import { useReviewCommentsStore } from "@/stores/reviewCommentsStore";
import { useCommentDrawerStore } from "@/stores/commentDrawerStore";
import { getRequirementStatuses, resolveRequirementStatus } from "@/services/requirementStatusService";
import { compileRequirementPattern, matchRequirementId } from "@/editor/utils/requirementOps";
import { extractSectionNumber, sectionReviewId } from "@/editor/utils/sectionReviewOps";
import type { ReviewComment } from "@/types/reviewComment";

export const reviewCommentBadgeKey = new PluginKey<DecorationSet>("reviewCommentBadge");

// ── Widget factory ────────────────────────────────────────────────────────────

type BadgeState = "empty" | "open" | "pending" | "clear";

function badgeState(comments: ReviewComment[]): BadgeState {
  if (comments.length === 0) return "empty";
  if (comments.some((c) => c.status === "open")) return "open";
  if (comments.some((c) => c.status === "responded")) return "pending";
  return "clear";
}

function createBadgeWidget(
  reqId: string,
  statusId: string,
  comments: ReviewComment[],
): () => HTMLElement {
  return () => {
    const state = badgeState(comments);
    const total = comments.length;
    const openCount = comments.filter((c) => c.status === "open").length;
    const respondedCount = comments.filter((c) => c.status === "responded").length;

    const btn = document.createElement("button");
    btn.type = "button";
    btn.setAttribute("contenteditable", "false");

    let className = "req-comment-badge ";
    let indicator = "";
    let countText = "";
    let titleText = "";
    let ariaLabel = "";

    switch (state) {
      case "empty":
        className += "req-comment-badge--empty";
        indicator = "";
        countText = "+";
        titleText = "No comments yet — click to add one";
        ariaLabel = "Add review comment";
        break;
      case "open":
        className += "req-comment-badge--open";
        indicator = "●";
        countText = String(openCount);
        titleText = `${openCount} open comment${openCount !== 1 ? "s" : ""} — click to open`;
        ariaLabel = `${openCount} open review comment${openCount !== 1 ? "s" : ""}`;
        break;
      case "pending":
        className += "req-comment-badge--pending";
        indicator = "●";
        countText = String(respondedCount);
        titleText = `${respondedCount} comment${respondedCount !== 1 ? "s" : ""} awaiting closure — click to open`;
        ariaLabel = `${respondedCount} review comment${respondedCount !== 1 ? "s" : ""} awaiting closure`;
        break;
      case "clear":
        className += "req-comment-badge--clear";
        indicator = "✓";
        countText = String(total);
        titleText = `${total} comment${total !== 1 ? "s" : ""}, all resolved — click to open`;
        ariaLabel = `${total} resolved review comment${total !== 1 ? "s" : ""}`;
        break;
    }

    btn.className = className;
    btn.title = titleText;
    btn.setAttribute("aria-label", ariaLabel);

    if (indicator) {
      const dot = document.createElement("span");
      dot.textContent = indicator;
      dot.style.fontSize = "8px";
      btn.appendChild(dot);
    }

    const label = document.createElement("span");
    label.textContent = countText;
    btn.appendChild(label);

    btn.addEventListener("mousedown", (e) => {
      e.preventDefault();
      e.stopPropagation();
      useCommentDrawerStore.getState().open(reqId, statusId);
    });

    return btn;
  };
}

// ── Decoration builder ────────────────────────────────────────────────────────

function buildDecorations(editorState: EditorState): DecorationSet {
  const { requirementPattern } = useConfigStore.getState();
  const comments = useReviewCommentsStore.getState().comments;
  const statuses = getRequirementStatuses();
  const decorations: Decoration[] = [];

  // Pre-compile requirement pattern so processHeading can check it in one pass.
  const compiled = requirementPattern ? compileRequirementPattern(requirementPattern) : null;

  // Single traversal: each heading tries requirement badge first, then section badge.
  // This guarantees decorations are emitted in document order.
  function processHeading(node: PMNode, nodePos: number) {
    const text = node.textContent;

    // ── Requirement badge (takes priority over section badge) ─────────────────
    if (compiled) {
      const matched = matchRequirementId(text, compiled);
      if (matched) {
        const reqId = matched.id;
        const bracketMatch = text.match(/(\[[^\]]+\])\s*$/);
        const rawStatus = bracketMatch ? bracketMatch[1].slice(1, -1).trim() : "";
        const statusId = rawStatus
          ? resolveRequirementStatus(rawStatus, statuses)
          : "unknown";
        const reqComments = (comments[reqId] as ReviewComment[]) ?? [];
        const bState = badgeState(reqComments);
        // Badge position:
        //   WITH status bracket → after the hidden [Status] span (side: 1)
        //   WITHOUT status bracket → after the "Set Status" widget (side: 2)
        const badgePos = bracketMatch
          ? nodePos + 1 + text.lastIndexOf(bracketMatch[1]) + bracketMatch[1].length
          : nodePos + 1 + text.length;
        const badgeSide = bracketMatch ? 1 : 2;
        decorations.push(
          Decoration.widget(badgePos, createBadgeWidget(reqId, statusId, reqComments), {
            side: badgeSide,
            key: `rcb-${nodePos}-${bState}-${reqComments.length}-${statusId}`,
            stopEvent: () => true,
          }),
        );
        return;
      }
    }

    // ── Section badge ─────────────────────────────────────────────────────────
    const sectionNum = extractSectionNumber(text);
    if (sectionNum) {
      const targetId = sectionReviewId(sectionNum);
      const sectionComments = (comments[targetId] as ReviewComment[]) ?? [];
      const bState = badgeState(sectionComments);
      decorations.push(
        Decoration.widget(
          nodePos + 1 + text.length,
          createBadgeWidget(targetId, "unknown", sectionComments),
          {
            side: 1,
            key: `scb-${nodePos}-${bState}-${sectionComments.length}`,
            stopEvent: () => true,
          },
        ),
      );
    }
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

export const reviewCommentBadgePlugin = new Plugin<DecorationSet>({
  key: reviewCommentBadgeKey,

  state: {
    init(_, state) {
      return buildDecorations(state);
    },
    apply(tr, old, _, newState) {
      const meta = tr.getMeta(reviewCommentBadgeKey) as
        | { refresh?: boolean }
        | undefined;
      if (tr.docChanged || meta?.refresh) return buildDecorations(newState);
      return old.map(tr.mapping, tr.doc);
    },
  },

  props: {
    decorations(state) {
      return reviewCommentBadgeKey.getState(state);
    },
  },

  view(editorView) {
    const refresh = () => {
      if (!editorView.isDestroyed) {
        editorView.dispatch(
          editorView.state.tr.setMeta(reviewCommentBadgeKey, { refresh: true }),
        );
      }
    };

    // Rebuild when comment counts change (add/edit/delete/load/reset).
    let prevComments = useReviewCommentsStore.getState().comments;
    const unsubscribeReview = useReviewCommentsStore.subscribe((s) => {
      if (s.comments !== prevComments) {
        prevComments = s.comments;
        refresh();
      }
    });

    // Rebuild when requirement pattern changes. The store replaces the whole
    // pattern object on every set/clear call, so reference inequality is a
    // reliable (and mode-agnostic) "did it change" check.
    let prevPattern = useConfigStore.getState().requirementPattern;
    const unsubscribeConfig = useConfigStore.subscribe((s) => {
      const next = s.requirementPattern;
      if (next !== prevPattern) {
        prevPattern = next;
        refresh();
      }
    });

    return {
      update() {},
      destroy() {
        unsubscribeReview();
        unsubscribeConfig();
      },
    };
  },
});
