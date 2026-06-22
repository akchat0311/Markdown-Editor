import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { EditorState } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import type { Node as PMNode } from "@tiptap/pm/model";
import { useConfigStore } from "@/stores/configStore";
import { useStatusConfigStore } from "@/stores/statusConfigStore";
import { getRequirementStatuses, resolveRequirementStatus } from "@/services/requirementStatusService";
import { derivePattern, buildDetectionRegex } from "@/editor/utils/requirementOps";
import type { RequirementStatus } from "@/types/requirementStatus";

export const requirementStatusKey = new PluginKey<DecorationSet>("requirementStatus");

// ── Badge color helpers ───────────────────────────────────────────────────────

const BUILTIN_COLORS: Record<string, { bg: string; text: string }> = {
  draft:    { bg: "#fef3c7", text: "#b45309" },
  review:   { bg: "#dbeafe", text: "#1d4ed8" },
  approved: { bg: "#dcfce7", text: "#15803d" },
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

// ── Widget factory ────────────────────────────────────────────────────────────

interface StatusRange {
  bracketFrom: number;
  bracketTo: number | null; // null = missing status (widget inserts text)
  statusId: string;
  nodePos: number;
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

    const applyStatus = (s: RequirementStatus) => {
      // Re-derive bracket positions from the current doc at click time.
      // The closure's bracketFrom/bracketTo may be stale if any document
      // change occurred between widget creation and the click.
      const currentNode = view.state.doc.nodeAt(range.nodePos);
      if (!currentNode || currentNode.type.name !== "heading") return;

      const text = currentNode.textContent;
      const bracketMatch = text.match(/(\[[^\]]+\])\s*$/);
      const newBracket = "[" + s.label + "]";
      const { tr } = view.state;

      if (!bracketMatch) {
        tr.insertText(" " + newBracket, range.nodePos + 1 + text.length);
      } else {
        const charOffset = text.lastIndexOf(bracketMatch[1]);
        const freshFrom = range.nodePos + 1 + charOffset;
        const freshTo = freshFrom + bracketMatch[1].length;
        tr.replaceWith(freshFrom, freshTo, view.state.schema.text(newBracket));
      }

      view.dispatch(tr);
      closeMenu();
      view.focus();
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

// ── Decoration builder ────────────────────────────────────────────────────────

function findStatusRange(
  headingNode: PMNode,
  nodePos: number,
  regex: RegExp,
  statuses: RequirementStatus[],
): StatusRange | null {
  const text = headingNode.textContent;
  if (!regex.test(text)) return null;

  // Find the last `[...]` bracket group at end of heading text.
  const bracketMatch = text.match(/(\[[^\]]+\])\s*$/);

  if (!bracketMatch) {
    // Requirement heading with no status bracket — "missing status" case.
    const insertPos = nodePos + 1 + text.length;
    return { bracketFrom: insertPos, bracketTo: null, statusId: "unknown", nodePos };
  }

  const charOffset = text.lastIndexOf(bracketMatch[1]);
  const bracketFrom = nodePos + 1 + charOffset;
  const bracketTo = bracketFrom + bracketMatch[1].length;

  const rawText = bracketMatch[1].slice(1, -1); // strip [ and ]
  const statusId = resolveRequirementStatus(rawText, statuses);

  return { bracketFrom, bracketTo, statusId, nodePos };
}

function buildDecorations(state: EditorState): DecorationSet {
  const { requirementPattern } = useConfigStore.getState();
  if (!requirementPattern) return DecorationSet.empty;

  const derived = derivePattern(requirementPattern.example);
  if (!derived) return DecorationSet.empty;

  const statuses = getRequirementStatuses();
  if (statuses.length === 0) return DecorationSet.empty;

  const regex = buildDetectionRegex(derived.prefix);
  const { from: selFrom, to: selTo } = state.selection;
  const decorations: Decoration[] = [];

  // Process a heading node at the given absolute PM position.
  function processHeading(node: import("@tiptap/pm/model").Node, nodePos: number) {
    const range = findStatusRange(node, nodePos, regex, statuses);
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
      update() {},
      destroy() {
        unsubscribe();
        unsubscribeConfig();
      },
    };
  },
});
