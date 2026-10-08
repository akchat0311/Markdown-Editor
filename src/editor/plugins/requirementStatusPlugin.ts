import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { EditorState } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import type { Node as PMNode } from "@tiptap/pm/model";
import { useConfigStore } from "@/stores/configStore";
import { useStatusConfigStore } from "@/stores/statusConfigStore";
import { useReviewCommentsStore } from "@/stores/reviewCommentsStore";
import { getRequirementStatuses } from "@/services/requirementStatusService";
import { compileRequirementPattern, matchRequirementId, collectDocumentVariants } from "@/editor/utils/requirementOps";
import type { CompiledPattern } from "@/editor/utils/requirementOps";
import {
  rewriteHeadingStatus,
  insertHeadingStatus,
  rewriteHeadingVariant,
  insertHeadingVariant,
  removeHeadingVariant,
} from "@/editor/utils/requirementHeadingOps";
import { parseHeadingFields, variantDisplayText } from "@/editor/utils/headingFields";
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
  /** Absolute positions of the [Variant] bracket, when present (D10). */
  variantFrom: number | null;
  variantTo: number | null;
  /** Display text of the variant (emphasis stripped), when present. */
  variantText: string | null;
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
      // rewriteHeadingStatus targets the CLASSIFIED status bracket (a
      // trailing variant is never overwritten) and reports false when the
      // heading has no status bracket at all.
      if (!rewriteHeadingStatus(tr, range.nodePos, currentNode, s.label)) {
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

// ── Variant chip widget (D10–D13) ─────────────────────────────────────────────

/**
 * Chip for the optional [Variant] bracket. Two modes:
 *  - existing variant → chip shows the variant text; click edits it
 *  - no variant (but a status is present) → a ghost "+ Variant" chip,
 *    revealed on heading hover, that adds one
 * Editing: with mdreq.variantVocabulary configured a dropdown (plus Remove)
 * opens; otherwise an inline free-text input. Empty input removes the
 * variant. All writes are token-level heading ops — nothing else in the
 * heading is touched.
 */
function createVariantWidget(range: StatusRange): (view: EditorView) => HTMLElement {
  return (view: EditorView) => {
    const hasVariant = range.variantText !== null;

    const container = document.createElement("span");
    container.className = "req-variant-widget";
    container.setAttribute("contenteditable", "false");

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `req-variant-btn${hasVariant ? "" : " req-variant-btn--add"}`;
    btn.textContent = hasVariant ? range.variantText! : "+ Variant";
    btn.title = hasVariant ? "Edit variant" : "Add variant";
    btn.tabIndex = -1;
    container.appendChild(btn);

    const commit = (raw: string) => {
      const text = raw.trim().replace(/[[\]]/g, "");
      const node = view.state.doc.nodeAt(range.nodePos);
      if (!node || node.type.name !== "heading") return;
      const { tr } = view.state;
      let changed = false;
      if (!text) {
        changed = hasVariant && removeHeadingVariant(tr, range.nodePos, node);
      } else if (hasVariant) {
        changed = text !== range.variantText && rewriteHeadingVariant(tr, range.nodePos, node, text);
      } else {
        insertHeadingVariant(tr, range.nodePos, node, text);
        changed = true;
      }
      if (changed) view.dispatch(tr);
      view.focus();
    };

    const startInput = () => {
      const input = document.createElement("input");
      input.type = "text";
      input.className = "req-variant-input";
      input.value = hasVariant ? range.variantText! : "";
      input.placeholder = "Variant";
      btn.replaceWith(input);
      input.focus();
      input.select();
      let done = false;
      const finish = (apply: boolean) => {
        if (done) return;
        done = true;
        if (apply) commit(input.value);
        else {
          input.replaceWith(btn);
          view.focus();
        }
      };
      input.addEventListener("keydown", (e) => {
        e.stopPropagation();
        if (e.key === "Enter") { e.preventDefault(); finish(true); }
        else if (e.key === "Escape") { e.preventDefault(); finish(false); }
      });
      input.addEventListener("blur", () => finish(false));
    };

    const startMenu = (options: string[]) => {
      const menu = document.createElement("ul");
      menu.className = "req-status-menu";
      menu.setAttribute("role", "listbox");
      menu.setAttribute("aria-label", "Select variant");
      // value: a variant to apply · "" removes · null opens the free-text
      // input for a brand-new variant name.
      const entries: Array<{ label: string; value: string | null }> = options.map((v) => ({ label: v, value: v }));
      entries.push({ label: "＋ New variant…", value: null });
      if (hasVariant) entries.push({ label: "✕ Remove variant", value: "" });
      for (const entry of entries) {
        const li = document.createElement("li");
        li.className = "req-status-option";
        li.setAttribute("role", "option");
        li.setAttribute("aria-selected", String(entry.value !== null && entry.value === range.variantText));
        li.textContent = entry.label;
        li.addEventListener("mousedown", (e) => {
          e.preventDefault();
          closeMenu();
          if (entry.value === null) startInput();
          else commit(entry.value);
        });
        menu.appendChild(li);
      }
      let closePointerHandler: ((e: PointerEvent) => void) | null = null;
      const closeMenu = () => {
        menu.remove();
        if (closePointerHandler) {
          document.removeEventListener("pointerdown", closePointerHandler, { capture: true });
          closePointerHandler = null;
        }
      };
      container.appendChild(menu);
      closePointerHandler = (e: PointerEvent) => {
        if (!container.contains(e.target as Node)) closeMenu();
      };
      document.addEventListener("pointerdown", closePointerHandler, { capture: true });
    };

    btn.addEventListener("mousedown", (e) => {
      e.preventDefault();
      e.stopPropagation();
      // Menu options: variants already used in this document (document
      // order) plus any configured vocabulary values not yet in use (user
      // request, 2026-09-02). With no options at all, go straight to the
      // free-text input.
      const docVariants = collectDocumentVariants(view.state.doc);
      const vocabulary = useConfigStore.getState().variantVocabulary;
      const options = [...docVariants, ...vocabulary.filter((v) => !docVariants.includes(v))];
      if (options.length > 0) startMenu(options);
      else startInput();
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

  const compiled = compileRequirementPattern(requirementPattern);
  if (!compiled) return;

  const statuses = getRequirementStatuses();
  if (statuses.length === 0) return;

  const draftStatus = statuses.find((s) => s.id === "draft") ?? statuses[0];
  const { state } = view;
  const { from: selFrom, to: selTo } = state.selection;

  const pending: Array<{ offset: number; node: import("@tiptap/pm/model").Node }> = [];

  const checkHeading = (node: import("@tiptap/pm/model").Node, offset: number) => {
    if (node.type.name !== "heading") return;
    const range = findStatusRange(node, offset, compiled, statuses);
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

  // Variant inheritance (user request, 2026-09-02): a newly typed
  // requirement heading also receives the document's variant when exactly
  // one distinct variant is in use.
  const docVariants = collectDocumentVariants(state.doc);
  const inheritedVariant = docVariants.length === 1 ? docVariants[0] : undefined;

  const tr = state.tr;
  for (let i = pending.length - 1; i >= 0; i--) {
    const { offset, node } = pending[i];
    insertHeadingStatus(tr, offset, node, draftStatus.label, inheritedVariant);
  }
  tr.setMeta("addToHistory", false);
  view.dispatch(tr);
}

// ── Decoration builder ────────────────────────────────────────────────────────

function findStatusRange(
  headingNode: PMNode,
  nodePos: number,
  compiled: CompiledPattern,
  statuses: RequirementStatus[],
): StatusRange | null {
  const text = headingNode.textContent;
  const matched = matchRequirementId(text, compiled);
  if (!matched) return null;

  const reqId = matched.id;

  // Shared trailing-bracket tokenizer (D11): classifies the [Status] and
  // optional [Variant] groups in one pass.
  const fields = parseHeadingFields(text, statuses);

  if (!fields.status) {
    // Requirement heading with no status bracket — "missing status" case.
    const insertPos = nodePos + 1 + text.length;
    return {
      bracketFrom: insertPos, bracketTo: null, statusId: "unknown", nodePos, reqId,
      variantFrom: null, variantTo: null, variantText: null,
    };
  }

  return {
    bracketFrom: nodePos + 1 + fields.status.charFrom,
    bracketTo: nodePos + 1 + fields.status.charTo,
    statusId: fields.status.statusId,
    nodePos,
    reqId,
    variantFrom: fields.variant ? nodePos + 1 + fields.variant.charFrom : null,
    variantTo: fields.variant ? nodePos + 1 + fields.variant.charTo : null,
    variantText: fields.variant ? variantDisplayText(fields.variant.inner) : null,
  };
}

function buildDecorations(state: EditorState): DecorationSet {
  const { requirementPattern } = useConfigStore.getState();
  if (!requirementPattern) return DecorationSet.empty;

  const compiledOrNull = compileRequirementPattern(requirementPattern);
  if (!compiledOrNull) return DecorationSet.empty;
  const compiled: CompiledPattern = compiledOrNull;

  const statuses = getRequirementStatuses();
  if (statuses.length === 0) return DecorationSet.empty;

  const { from: selFrom, to: selTo } = state.selection;
  const decorations: Decoration[] = [];

  // Process a heading node at the given absolute PM position.
  function processHeading(node: import("@tiptap/pm/model").Node, nodePos: number) {
    const range = findStatusRange(node, nodePos, compiled, statuses);
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

    // ── Variant chip (D10–D13) ────────────────────────────────────────────────
    if (range.variantFrom !== null && range.variantTo !== null) {
      const cursorInVariant = selFrom >= range.variantFrom && selTo <= range.variantTo;
      if (cursorInVariant) {
        decorations.push(
          Decoration.inline(range.variantFrom, range.variantTo, { class: "req-status-editing" })
        );
      } else {
        decorations.push(
          Decoration.inline(range.variantFrom, range.variantTo, { class: "req-status-source-hidden" })
        );
        decorations.push(
          Decoration.widget(
            range.variantFrom,
            createVariantWidget(range),
            { side: -1, key: `rv-${range.variantFrom}-${range.variantText}`, stopEvent: () => true }
          )
        );
      }
    } else if (bracketTo !== null) {
      // Requirement with a status but no variant: ghost "+ Variant" chip,
      // revealed on heading hover (CSS). Placed after the status bracket.
      decorations.push(
        Decoration.widget(
          bracketTo,
          createVariantWidget(range),
          { side: 2, key: `rv-add-${nodePos}`, stopEvent: () => true }
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

    // Rebuild when requirementPattern changes. The store replaces the whole
    // pattern object on every set/clear call, so reference inequality is a
    // reliable (and mode-agnostic) "did it change" check.
    let prevPattern = useConfigStore.getState().requirementPattern;
    const unsubscribeConfig = useConfigStore.subscribe((state) => {
      const next = state.requirementPattern;
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
