import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { EditorState } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import type { Node as PMNode } from "@tiptap/pm/model";
import { useConfigStore } from "@/stores/configStore";
import { useStatusConfigStore } from "@/stores/statusConfigStore";
import { useReviewCommentsStore } from "@/stores/reviewCommentsStore";
import { getRequirementStatuses, resolveRequirementStatus } from "@/services/requirementStatusService";
import { derivePattern, buildDetectionRegex } from "@/editor/utils/requirementOps";
import { rewriteHeadingStatus, insertHeadingStatus } from "@/editor/utils/requirementHeadingOps";
import type { RequirementStatus } from "@/types/requirementStatus";
import type { ReviewComment } from "@/types/reviewComment";

export const requirementStatusKey = new PluginKey<DecorationSet>("requirementStatus");

// ── Badge color helpers ───────────────────────────────────────────────────────

const BUILTIN_COLORS: Record<string, { bg: string; text: string }> = {
  draft:       { bg: "#fef3c7", text: "#b45309" },
  ready:       { bg: "#ede9fe", text: "#6d28d9" },
  "in-review": { bg: "#dbeafe", text: "#1d4ed8" },
  approved:    { bg: "#dcfce7", text: "#15803d" },
};
const PALETTE = [
  { bg: "#f3e8ff", text: "#7c3aed" },
  { bg: "#fce7f3", text: "#be185d" },
  { bg: "#ccfbf1", text: "#0f766e" },
  { bg: "#ffedd5", text: "#c2410c" },
];
const UNKNOWN_COLORS = { bg: "var(--color-border)", text: "var(--color-muted)" };

function badgeColors(statusId: string, statuses: RequirementStatus[]) {
  if (statusId in BUILTIN_COLORS) return BUILTIN_COLORS[statusId];
  const idx = statuses.findIndex((s) => s.id === statusId);
  return idx >= 0 ? PALETTE[idx % PALETTE.length] : UNKNOWN_COLORS;
}

// ── Approval confirmation dialog (DOM-based, no React dependency) ─────────────

function showApprovalConfirm(
  openCount: number,
  onConfirm: () => void,
  onCancel: () => void,
): void {
  const overlay = document.createElement("div");
  Object.assign(overlay.style, {
    position: "fixed", inset: "0", zIndex: "400",
    display: "flex", alignItems: "center", justifyContent: "center",
    background: "rgba(0,0,0,0.45)", backdropFilter: "blur(2px)",
  });

  const dialog = document.createElement("div");
  Object.assign(dialog.style, {
    background: "var(--color-paper)", border: "1px solid var(--color-border)",
    borderRadius: "12px", boxShadow: "0 8px 32px rgba(0,0,0,0.18)",
    maxWidth: "320px", width: "calc(100% - 48px)",
    padding: "24px", display: "flex", flexDirection: "column", gap: "12px",
  });

  const title = document.createElement("p");
  title.textContent = "Approve with open comments?";
  Object.assign(title.style, { fontSize: "14px", fontWeight: "600", color: "var(--color-text)", margin: "0" });

  const body = document.createElement("p");
  body.textContent = `This requirement has ${openCount} open review comment${openCount !== 1 ? "s" : ""}. Approving means these concerns are accepted or resolved out-of-band.`;
  Object.assign(body.style, { fontSize: "13px", color: "var(--color-muted)", margin: "0", lineHeight: "1.5" });

  const btnRow = document.createElement("div");
  Object.assign(btnRow.style, { display: "flex", justifyContent: "flex-end", gap: "8px", marginTop: "4px" });

  const makeBtn = (label: string, primary: boolean) => {
    const btn = document.createElement("button");
    btn.textContent = label;
    btn.type = "button";
    Object.assign(btn.style, {
      border: "none", fontSize: "13px", padding: "6px 14px",
      borderRadius: "6px", cursor: "pointer",
      ...(primary
        ? { background: "var(--color-accent)", color: "white", fontWeight: "500" }
        : { background: "transparent", color: "var(--color-muted)" }),
    });
    if (!primary) {
      btn.addEventListener("mouseenter", () => { btn.style.background = "var(--color-border)"; });
      btn.addEventListener("mouseleave", () => { btn.style.background = "transparent"; });
    }
    return btn;
  };

  const cancelBtn = makeBtn("Cancel", false);
  const approveBtn = makeBtn("Approve Anyway", true);

  const dismiss = (confirmed: boolean) => {
    overlay.remove();
    if (confirmed) onConfirm(); else onCancel();
  };

  cancelBtn.addEventListener("mousedown", (e) => { e.preventDefault(); dismiss(false); });
  approveBtn.addEventListener("mousedown", (e) => { e.preventDefault(); dismiss(true); });
  overlay.addEventListener("mousedown", (e) => { if (e.target === overlay) { e.preventDefault(); dismiss(false); } });

  btnRow.appendChild(cancelBtn);
  btnRow.appendChild(approveBtn);
  dialog.appendChild(title);
  dialog.appendChild(body);
  dialog.appendChild(btnRow);
  overlay.appendChild(dialog);
  document.body.appendChild(overlay);
  approveBtn.focus();
}

// ── Widget factory ────────────────────────────────────────────────────────────

interface StatusRange {
  bracketFrom: number;
  bracketTo: number | null; // null = missing status (widget inserts text)
  statusId: string;
  nodePos: number;
  reqId: string;
}

function createDropdownWidget(
  range: StatusRange,
  statuses: RequirementStatus[],
): (view: EditorView) => HTMLElement {
  return (view: EditorView) => {
    const { bracketTo, statusId } = range;
    const isMissing = bracketTo === null;

    const colors = badgeColors(statusId, statuses);
    const label = isMissing
      ? "Set Status"
      : (statuses.find((s) => s.id === statusId)?.label ?? (statusId === "unknown" ? "Unknown" : statusId));

    // ── Container ──────────────────────────────────────────────────────────────
    const container = document.createElement("span");
    container.className = "req-status-widget";
    container.setAttribute("contenteditable", "false");

    // ── Trigger button ─────────────────────────────────────────────────────────
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `req-status-btn${isMissing ? " req-status-btn--missing" : ""}`;
    btn.style.cssText = `background:${colors.bg};color:${colors.text}`;
    btn.setAttribute("aria-haspopup", "listbox");
    btn.setAttribute("aria-expanded", "false");
    btn.tabIndex = -1; // don't break tab flow inside editor

    const labelSpan = document.createElement("span");
    labelSpan.textContent = label;
    const caret = document.createElement("span");
    caret.className = "req-status-caret";
    caret.textContent = "▾";
    btn.appendChild(labelSpan);
    btn.appendChild(caret);
    container.appendChild(btn);

    // ── Dropdown menu ──────────────────────────────────────────────────────────
    const menu = document.createElement("ul");
    menu.className = "req-status-menu";
    menu.setAttribute("role", "listbox");
    menu.setAttribute("aria-label", "Select status");
    menu.style.display = "none";

    let activeIdx = 0;

    // Re-derive the heading node and dispatch the status change.
    // Called after any confirmation dialog is dismissed.
    const doApply = (s: RequirementStatus) => {
      const currentNode = view.state.doc.nodeAt(range.nodePos);
      if (!currentNode || currentNode.type.name !== "heading") return;
      const { tr } = view.state;
      const hasBracket = /\[[^\]]+\]\s*$/.test(currentNode.textContent);
      if (hasBracket) {
        rewriteHeadingStatus(tr, range.nodePos, currentNode, s.label);
      } else {
        insertHeadingStatus(tr, range.nodePos, currentNode, s.label);
      }
      view.dispatch(tr);
      view.focus();
    };

    const applyStatus = (s: RequirementStatus) => {
      // Soft-block: show confirmation if approving a requirement with open comments.
      if (s.id === "approved" && range.reqId) {
        const stored = useReviewCommentsStore.getState().getComments(range.reqId) as ReviewComment[];
        const openCount = stored.filter((c) => c.status === "open").length;
        if (openCount > 0) {
          closeMenu();
          showApprovalConfirm(openCount, () => doApply(s), () => view.focus());
          return;
        }
      }
      doApply(s);
      closeMenu();
    };

    statuses.forEach((s, idx) => {
      const li = document.createElement("li");
      li.className = "req-status-option";
      li.setAttribute("role", "option");
      li.setAttribute("aria-selected", String(s.id === statusId));
      li.setAttribute("data-idx", String(idx));
      li.textContent = s.label;
      li.addEventListener("mousedown", (e) => {
        e.preventDefault();
        applyStatus(s);
      });
      menu.appendChild(li);
    });
    container.appendChild(menu);

    // ── Menu open/close ────────────────────────────────────────────────────────
    let closePointerHandler: ((e: PointerEvent) => void) | null = null;

    const openMenu = () => {
      menu.style.display = "block";
      btn.setAttribute("aria-expanded", "true");
      activeIdx = Math.max(0, statuses.findIndex((s) => s.id === statusId));
      highlightOption(activeIdx);

      closePointerHandler = (e: PointerEvent) => {
        if (!container.contains(e.target as Node)) closeMenu();
      };
      document.addEventListener("pointerdown", closePointerHandler, { capture: true });
    };

    const closeMenu = () => {
      menu.style.display = "none";
      btn.setAttribute("aria-expanded", "false");
      if (closePointerHandler) {
        document.removeEventListener("pointerdown", closePointerHandler, { capture: true });
        closePointerHandler = null;
      }
    };

    const highlightOption = (idx: number) => {
      const items = menu.querySelectorAll<HTMLElement>(".req-status-option");
      items.forEach((el, i) => el.classList.toggle("req-status-option--active", i === idx));
      items[idx]?.scrollIntoView?.({ block: "nearest" });
    };

    // Use mousedown (not click) so the menu opens before ProseMirror's
    // mousedown handler runs and potentially moves the cursor into the
    // bracket range, which would remove the widget from the DOM and cause
    // the click event to fire on a detached element.
    btn.addEventListener("mousedown", (e) => {
      e.preventDefault();  // prevents PM cursor movement and browser focus change
      e.stopPropagation();
      menu.style.display === "none" ? openMenu() : closeMenu();
    });

    // ── Keyboard navigation ────────────────────────────────────────────────────
    btn.addEventListener("keydown", (e) => {
      const isOpen = menu.style.display !== "none";
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        e.stopPropagation();
        isOpen ? applyStatus(statuses[activeIdx]) : openMenu();
      } else if (e.key === "Escape") {
        e.preventDefault();
        closeMenu();
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        e.stopPropagation();
        if (!isOpen) openMenu();
        activeIdx = Math.min(activeIdx + 1, statuses.length - 1);
        highlightOption(activeIdx);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        e.stopPropagation();
        if (!isOpen) openMenu();
        activeIdx = Math.max(activeIdx - 1, 0);
        highlightOption(activeIdx);
      }
    });

    return container;
  };
}

// ── Auto-insert Draft for new requirements ────────────────────────────────────

/**
 * Called from plugin view.update(). Scans for requirement headings that have no
 * [Status] bracket AND the cursor is not inside them, then inserts "[Draft]"
 * automatically. This covers the direct-typing case: the user types a heading
 * that matches the requirement pattern and moves on without setting a status.
 *
 * Processes headings in reverse document order so earlier insertions do not
 * shift the positions of subsequent ones within the same transaction.
 * Marked addToHistory:false so it does not appear as a separate undo step.
 */
function autoInsertDraftStatus(view: EditorView): void {
  const { requirementPattern } = useConfigStore.getState();
  if (!requirementPattern) return;

  const derived = derivePattern(requirementPattern.example);
  if (!derived) return;

  const statuses = getRequirementStatuses();
  if (statuses.length === 0) return;

  const draftStatus = statuses.find((s) => s.id === "draft") ?? statuses[0];
  const { prefix } = derived;
  const regex = buildDetectionRegex(prefix);
  const { state } = view;
  const { from: selFrom, to: selTo } = state.selection;

  const pending: Array<{ offset: number; node: import("@tiptap/pm/model").Node }> = [];

  const checkHeading = (node: import("@tiptap/pm/model").Node, offset: number) => {
    if (node.type.name !== "heading") return;
    const range = findStatusRange(node, offset, regex, statuses, prefix);
    if (!range || range.bracketTo !== null) return; // already has a bracket
    // Don't auto-insert while cursor is inside this heading.
    const headingFrom = offset + 1;
    const headingTo   = offset + node.nodeSize - 1;
    if (selFrom >= headingFrom && selTo <= headingTo) return;
    pending.push({ offset, node });
  };

  state.doc.forEach((node, offset) => {
    checkHeading(node, offset);
    if (node.type.name === "blockquote" || node.type.name === "callout") {
      node.forEach((child, childOffset) => checkHeading(child, offset + 1 + childOffset));
    }
  });

  if (pending.length === 0) return;

  const tr = state.tr;
  for (let i = pending.length - 1; i >= 0; i--) {
    const { offset, node } = pending[i];
    insertHeadingStatus(tr, offset, node, draftStatus.label);
  }
  tr.setMeta("addToHistory", false);
  view.dispatch(tr);
}

// ── Decoration builder ────────────────────────────────────────────────────────

function findStatusRange(
  headingNode: PMNode,
  nodePos: number,
  regex: RegExp,
  statuses: RequirementStatus[],
  prefix: string,
): StatusRange | null {
  const text = headingNode.textContent;
  if (!regex.test(text)) return null;

  const idMatch = text.match(regex);
  const reqId = idMatch ? prefix + idMatch[1] : "";

  // Find the last `[...]` bracket group at end of heading text.
  const bracketMatch = text.match(/(\[[^\]]+\])\s*$/);

  if (!bracketMatch) {
    // Requirement heading with no status bracket — "missing status" case.
    const insertPos = nodePos + 1 + text.length;
    return { bracketFrom: insertPos, bracketTo: null, statusId: "unknown", nodePos, reqId };
  }

  const charOffset = text.lastIndexOf(bracketMatch[1]);
  const bracketFrom = nodePos + 1 + charOffset;
  const bracketTo = bracketFrom + bracketMatch[1].length;

  const rawText = bracketMatch[1].slice(1, -1); // strip [ and ]
  const statusId = resolveRequirementStatus(rawText, statuses);

  return { bracketFrom, bracketTo, statusId, nodePos, reqId };
}

function buildDecorations(state: EditorState): DecorationSet {
  const { requirementPattern } = useConfigStore.getState();
  if (!requirementPattern) return DecorationSet.empty;

  const derived = derivePattern(requirementPattern.example);
  if (!derived) return DecorationSet.empty;

  const statuses = getRequirementStatuses();
  if (statuses.length === 0) return DecorationSet.empty;

  const { prefix } = derived;
  const regex = buildDetectionRegex(prefix);
  const { from: selFrom, to: selTo } = state.selection;
  const decorations: Decoration[] = [];

  // Process a heading node at the given absolute PM position.
  function processHeading(node: import("@tiptap/pm/model").Node, nodePos: number) {
    const range = findStatusRange(node, nodePos, regex, statuses, prefix);
    if (!range) return;

    const { bracketFrom, bracketTo } = range;

    if (bracketTo !== null) {
      const cursorInside = selFrom >= bracketFrom && selTo <= bracketTo;
      if (cursorInside) {
        decorations.push(
          Decoration.inline(bracketFrom, bracketTo, { class: "req-status-editing" })
        );
      } else {
        decorations.push(
          Decoration.inline(bracketFrom, bracketTo, { class: "req-status-source-hidden" })
        );
        decorations.push(
          Decoration.widget(
            bracketFrom,
            createDropdownWidget(range, statuses),
            { side: -1, key: `rs-${bracketFrom}-${range.statusId}`, stopEvent: () => true }
          )
        );
      }
    } else {
      decorations.push(
        Decoration.widget(
          bracketFrom,
          createDropdownWidget(range, statuses),
          { side: 1, key: `rs-missing-${nodePos}`, stopEvent: () => true }
        )
      );
    }
  }

  // Scan top-level children and one level inside blockquotes / callouts.
  state.doc.forEach((node, offset) => {
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

  return DecorationSet.create(state.doc, decorations);
}

// ── Plugin ────────────────────────────────────────────────────────────────────

export const requirementStatusPlugin = new Plugin<DecorationSet>({
  key: requirementStatusKey,

  state: {
    init(_, state) {
      return buildDecorations(state);
    },
    apply(tr, old, _, newState) {
      const meta = tr.getMeta(requirementStatusKey) as { refresh?: boolean } | undefined;
      if (tr.docChanged || tr.selectionSet || meta?.refresh) {
        return buildDecorations(newState);
      }
      return old.map(tr.mapping, tr.doc);
    },
  },

  props: {
    decorations(state) {
      return requirementStatusKey.getState(state);
    },
  },

  view(editorView: EditorView) {
    const refresh = () => {
      if (!editorView.isDestroyed) {
        editorView.dispatch(
          editorView.state.tr.setMeta(requirementStatusKey, { refresh: true })
        );
      }
    };

    // When status config loads (async), trigger a decoration rebuild.
    let prevLoaded = useStatusConfigStore.getState().loaded;
    const unsubscribe = useStatusConfigStore.subscribe((state) => {
      if (state.loaded && !prevLoaded) { prevLoaded = true; refresh(); }
    });

    // Rebuild when requirementPattern changes.
    let prevPattern = useConfigStore.getState().requirementPattern?.example;
    const unsubscribeConfig = useConfigStore.subscribe((state) => {
      const next = state.requirementPattern?.example;
      if (next !== prevPattern) { prevPattern = next; refresh(); }
    });

    return {
      update(v) {
        autoInsertDraftStatus(v);
      },
      destroy() {
        unsubscribe();
        unsubscribeConfig();
      },
    };
  },
});
