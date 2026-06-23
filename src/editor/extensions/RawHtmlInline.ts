import { Node } from "@tiptap/core";

/**
 * Opaque inline atom that preserves raw HTML tags verbatim through the editor.
 *
 * Every MDAST inline `html` node that is not handled by a dedicated extension
 * (<br> → hardBreak, <u>…</u> → underline mark) lands here. Examples:
 * <sub>, </sub>, <sup>, </sup>, <kbd>, </kbd>, <span class="…">, </span>,
 * inline <!-- comments -->, and any other unknown inline HTML fragment.
 *
 * The full HTML string is stored in the `html` attribute. The serializer emits
 * it back as a MDAST `html` inline node so mdast-util-to-markdown outputs it
 * verbatim — no escaping, no normalization.
 *
 * Why atom: true?
 * ProseMirror merges adjacent text nodes that share the same mark set. Without
 * atom: true the node would be a text node and would be merged with its
 * neighbours, causing the distinct HTML tag boundary to vanish. With atom: true
 * the node is an indivisible inline unit that text nodes cannot merge across.
 *
 * Editing model: the cursor passes over the atom in a single keypress (same
 * as an emoji). The node is not independently selectable (selectable: false).
 * Users cannot manually apply marks (bold, italic, …) to the atom itself.
 *
 * Inherited marks: the parser passes its current mark context (e.g. "inside
 * a link") to rawHtmlInline atoms via the `marks` field. The serializer uses
 * those inherited marks to group consecutive nodes sharing the same outer mark
 * into a single MDAST wrapper, preserving correct accessibility semantics:
 * [H<sub>2</sub>O](url) produces one <a> element, not three.
 */
export const RawHtmlInline = Node.create({
  name: "rawHtmlInline",
  group: "inline",
  inline: true,
  atom: true,
  selectable: false,
  draggable: false,

  addAttributes() {
    return {
      html: { default: "" },
    };
  },

  // Used by TipTap when deserializing its own HTML representation (clipboard,
  // editor ↔ HTML round-trips). The sentinel attribute avoids false positives
  // against arbitrary <span> elements from pasted content.
  parseHTML() {
    return [
      {
        tag: "span[data-raw-html-inline]",
        getAttrs: (el) => ({ html: (el as HTMLElement).textContent ?? "" }),
      },
    ];
  },

  // Renders the raw HTML source as visible text inside a neutral <span>.
  // The text content (not innerHTML) is used, so angle brackets appear
  // literally — no XSS risk from the stored html string.
  renderHTML({ node }) {
    return [
      "span",
      { "data-raw-html-inline": "true", class: "raw-html-inline" },
      node.attrs.html as string,
    ];
  },
});
