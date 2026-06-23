import { Extension } from "@tiptap/core";
import { Plugin, PluginKey, TextSelection } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import type { Node as PMNode } from "@tiptap/pm/model";

const linkNavKey = new PluginKey("linkNavigation");

/**
 * Converts heading text to a URL-safe anchor slug using the GitHub Flavored
 * Markdown algorithm: lowercase, strip non-word/space/hyphen chars, collapse
 * whitespace runs into single hyphens.
 */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-");
}

/**
 * Walks a PM document and returns the absolute position of the first heading
 * matching `slug` in two-priority order (single pass):
 *
 *   1. Exact GFM slug: slugify(heading.textContent) === slug
 *      → handles regular headings like #brake-monitoring
 *
 *   2. Bracket-stripped slug: slugify(heading text without trailing [Status]) === slug
 *      → handles requirement headings like #req_015 → "REQ_015 [Draft]"
 *
 * Exact matches take priority over stripped matches in document order.
 * Checks one level inside blockquotes and callouts.
 * Returns null when no matching heading exists.
 */
export function findHeadingBySlug(doc: PMNode, slug: string): number | null {
  let exact: number | null = null;
  let stripped: number | null = null;

  function check(node: PMNode, pos: number): void {
    if (node.type.name !== "heading") return;
    if (exact === null && slugify(node.textContent) === slug) {
      exact = pos;
      return; // exact match; skip stripped check for this node
    }
    if (stripped === null) {
      const bare = node.textContent.replace(/\s*\[[^\]]*\]\s*$/, "").trim();
      if (slugify(bare) === slug) stripped = pos;
    }
  }

  doc.forEach((node, offset) => {
    check(node, offset);
    if (node.type.name === "blockquote" || node.type.name === "callout") {
      node.forEach((child, childOffset) => check(child, offset + 1 + childOffset));
    }
  });

  return exact ?? stripped;
}

function resolveAnchor(
  target: EventTarget | null,
  root: Element,
): HTMLAnchorElement | null {
  if (!target) return null;
  const el = target as Element;
  const anchor =
    el instanceof HTMLAnchorElement ? el : el.closest<HTMLAnchorElement>("a");
  if (!anchor || !root.contains(anchor)) return null;
  return anchor;
}

function buildTooltip(anchor: HTMLAnchorElement): HTMLDivElement {
  const href = anchor.getAttribute("href") ?? "";
  const isMac = /Mac|iPhone|iPad/.test(navigator.platform);
  const modifier = isMac ? "Cmd" : "Ctrl";
  const action = href.startsWith("#") ? "navigate" : "open";

  const div = document.createElement("div");
  div.className = "link-nav-tooltip";
  div.textContent = `${modifier}+Click to ${action}\n${href}`;
  return div;
}

export const LinkNavigation = Extension.create({
  name: "linkNavigation",

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: linkNavKey,

        props: {
          handleDOMEvents: {
            // Intercept before PM's mousedown handler creates a LeftMouseDown
            // tracker.  Returning true skips PM's handler entirely → no cursor
            // placement on mouseup for modifier+link clicks.
            mousedown(view: EditorView, rawEvent: Event) {
              const e = rawEvent as MouseEvent;
              console.log("[LinkNav] mousedown", {
                button: e.button,
                metaKey: e.metaKey,
                ctrlKey: e.ctrlKey,
                target: (e.target as Element)?.tagName,
              });
              if (e.button !== 0 || (!e.metaKey && !e.ctrlKey)) return false;
              const anchor = resolveAnchor(e.target, view.dom);
              console.log("[LinkNav] mousedown anchor:", anchor?.getAttribute("href"));
              if (!anchor?.getAttribute("href")) return false;
              // Skip PM's LeftMouseDown creation → no cursor placement on mouseup
              return true;
            },

            // Perform navigation on click (fires after mousedown+mouseup, after
            // returning true from mousedown above, PM has no LeftMouseDown so
            // it does not place a cursor on mouseup).
            // Using click (not mousedown) so window.open is treated as a
            // direct user gesture and is not blocked by popup blockers.
            click(view: EditorView, rawEvent: Event) {
              const e = rawEvent as MouseEvent;
              console.log("[LinkNav] click", {
                button: e.button,
                metaKey: e.metaKey,
                ctrlKey: e.ctrlKey,
                target: (e.target as Element)?.tagName,
              });
              if (e.button !== 0 || (!e.metaKey && !e.ctrlKey)) return false;

              const anchor = resolveAnchor(e.target, view.dom);
              const href = anchor?.getAttribute("href") ?? null;
              console.log("[LinkNav] click href:", href);
              if (!anchor || !href) return false;

              e.preventDefault();

              if (href.startsWith("#")) {
                const slug = href.slice(1);
                const pos = findHeadingBySlug(view.state.doc, slug);
                console.log("[LinkNav] internal nav slug=", slug, "pos=", pos);
                if (pos !== null) {
                  const resolved = view.state.doc.resolve(pos + 1);
                  const sel = TextSelection.near(resolved);
                  view.dispatch(view.state.tr.setSelection(sel).scrollIntoView());
                  view.focus();
                }
              } else {
                window.open(href, "_blank", "noopener,noreferrer");
              }

              return true;
            },
          },

          // Diagnostic: log every handleClick invocation to verify whether PM
          // calls it at all (it fires from mouseup inside LeftMouseDown.up()).
          // This should NOT fire for modifier+link clicks because handleDOMEvents
          // .mousedown consumed the event and PM never created a LeftMouseDown.
          handleClick(_view: EditorView, _pos: number, event: MouseEvent) {
            if (event.metaKey || event.ctrlKey) {
              console.log("[LinkNav] handleClick (PM mouseup path) — should not fire for modifier+link clicks", {
                metaKey: event.metaKey,
                ctrlKey: event.ctrlKey,
                target: (event.target as Element)?.tagName,
              });
            }
            return false;
          },
        },

        view(editorView: EditorView) {
          let tooltip: HTMLDivElement | null = null;

          const removeTooltip = () => {
            tooltip?.remove();
            tooltip = null;
          };

          const onMouseOver = (e: MouseEvent) => {
            const anchor = resolveAnchor(e.target, editorView.dom);
            if (!anchor) { removeTooltip(); return; }
            if (tooltip) return;
            tooltip = buildTooltip(anchor);
            document.body.appendChild(tooltip);
            const rect = anchor.getBoundingClientRect();
            tooltip.style.left = `${Math.max(0, rect.left)}px`;
            tooltip.style.top = `${rect.bottom + 4}px`;
          };

          const onMouseOut = (e: MouseEvent) => {
            const related = e.relatedTarget as Node | null;
            if (related && tooltip?.contains(related)) return;
            removeTooltip();
          };

          editorView.dom.addEventListener("mouseover", onMouseOver);
          editorView.dom.addEventListener("mouseout", onMouseOut);

          return {
            destroy() {
              editorView.dom.removeEventListener("mouseover", onMouseOver);
              editorView.dom.removeEventListener("mouseout", onMouseOut);
              removeTooltip();
            },
          };
        },
      }),
    ];
  },
});
