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
 * whose slugified text matches `slug`.  Checks one level inside blockquotes
 * and callouts to match the rest of the codebase's traversal pattern.
 * Returns null when no matching heading exists.
 */
export function findHeadingBySlug(doc: PMNode, slug: string): number | null {
  let found: number | null = null;

  doc.forEach((node, offset) => {
    if (found !== null) return;
    if (node.type.name === "heading" && slugify(node.textContent) === slug) {
      found = offset;
      return;
    }
    if (node.type.name === "blockquote" || node.type.name === "callout") {
      node.forEach((child, childOffset) => {
        if (found !== null) return;
        if (child.type.name === "heading" && slugify(child.textContent) === slug) {
          found = offset + 1 + childOffset;
        }
      });
    }
  });

  return found;
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
          handleClick(view: EditorView, _pos: number, event: MouseEvent) {
            if (event.button !== 0) return false;
            if (!event.metaKey && !event.ctrlKey) return false;

            const anchor = resolveAnchor(event.target, view.dom);
            if (!anchor) return false;

            const href = anchor.getAttribute("href");
            if (!href) return false;

            event.preventDefault();
            event.stopPropagation();

            if (href.startsWith("#")) {
              const pos = findHeadingBySlug(view.state.doc, href.slice(1));
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
