import { Plugin, PluginKey, TextSelection } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { EditorState } from "@tiptap/pm/state";
import type { Node as PMNode } from "@tiptap/pm/model";
import type { EditorView } from "@tiptap/pm/view";
import { ensureKatex, katexRenderToString } from "@/editor/utils/katexLoader";

export const inlineMathKey = new PluginKey<DecorationSet>("inlineMath");

// ── Math range discovery ──────────────────────────────────────────────────────

interface MathRange {
  from: number;
  to: number;
  src: string;
}

function findMathRanges(doc: PMNode): MathRange[] {
  const ranges: MathRange[] = [];
  doc.descendants((node, pos) => {
    if (!node.isText) return true;
    if (!node.marks.some((m) => m.type.name === "inlineMath")) return true;
    // Merge with previous range if contiguous (adjacent text nodes with the same mark)
    const prev = ranges[ranges.length - 1];
    if (prev && prev.to === pos) {
      prev.to = pos + node.nodeSize;
      prev.src += node.text ?? "";
    } else {
      ranges.push({ from: pos, to: pos + node.nodeSize, src: node.text ?? "" });
    }
    return false;
  });
  return ranges;
}

// ── Widget DOM factory (called lazily at render time — view is available) ─────

function makeWidget(src: string): Element {
  const span = document.createElement("span");
  span.className = "math-inline-widget";
  span.setAttribute("contenteditable", "false");
  span.setAttribute("aria-label", `Math: ${src}`);

  const rendered = katexRenderToString(src, false);
  if (rendered === src) {
    // katex not loaded yet — show styled placeholder
    span.textContent = src;
    span.className += " math-inline-loading";
  } else {
    span.innerHTML = rendered;
  }

  return span;
}

function makeWidgetFactory(src: string, from: number) {
  return (view: EditorView): Element => {
    const el = makeWidget(src);

    // Clicking the widget moves the cursor inside the math range → edit mode
    el.addEventListener("mousedown", (e) => {
      e.preventDefault();
      // setTimeout lets PM finish processing this mouse event before we dispatch
      setTimeout(() => {
        view.focus();
        view.dispatch(
          view.state.tr.setSelection(
            TextSelection.create(view.state.doc, from + 1)
          )
        );
      }, 0);
    });

    return el;
  };
}

// ── Decoration builder ────────────────────────────────────────────────────────

function buildDecorations(state: EditorState): DecorationSet {
  if (!state.schema.marks.inlineMath) return DecorationSet.empty;

  const { from: curFrom, to: curTo } = state.selection;
  const ranges = findMathRanges(state.doc);
  if (ranges.length === 0) return DecorationSet.empty;

  const decorations: Decoration[] = [];

  for (const range of ranges) {
    const cursorInside = curFrom >= range.from && curTo <= range.to;

    if (cursorInside) {
      // Edit mode: show source with a subtle highlight
      decorations.push(
        Decoration.inline(range.from, range.to, { class: "math-source-editing" })
      );
    } else {
      // Preview mode: hide source, show rendered widget
      decorations.push(
        Decoration.inline(range.from, range.to, { class: "math-source-hidden" })
      );
      decorations.push(
        Decoration.widget(
          range.from,
          makeWidgetFactory(range.src, range.from),
          { side: -1, key: `mw-${range.from}`, marks: [], stopEvent: () => false }
        )
      );
    }
  }

  return DecorationSet.create(state.doc, decorations);
}

// ── Plugin ────────────────────────────────────────────────────────────────────

export const inlineMathPlugin = new Plugin<DecorationSet>({
  key: inlineMathKey,

  state: {
    init(_, state) {
      return buildDecorations(state);
    },

    apply(tr, old, _, newState) {
      const meta = tr.getMeta(inlineMathKey) as { reload?: boolean } | undefined;
      if (tr.docChanged || tr.selectionSet || meta?.reload) {
        return buildDecorations(newState);
      }
      return old.map(tr.mapping, tr.doc);
    },
  },

  props: {
    decorations(state) {
      return inlineMathKey.getState(state);
    },
  },

  view(editorView: EditorView) {
    // Kick off KaTeX lazy-load; once ready, force a decoration rebuild so
    // placeholder widgets are replaced with rendered equations.
    let destroyed = false;
    ensureKatex().then(() => {
      if (destroyed) return;
      editorView.dispatch(
        editorView.state.tr.setMeta(inlineMathKey, { reload: true })
      );
    });

    return { update() {}, destroy() { destroyed = true; } };
  },
});
