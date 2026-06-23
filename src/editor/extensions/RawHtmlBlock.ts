import { Node } from "@tiptap/core";

/**
 * Opaque block node that preserves raw HTML verbatim through the editor.
 *
 * This node is never created by the user; it is produced exclusively by the
 * markdown parser when it encounters a block-level HTML node (remark type
 * "html") that has no richer semantic representation. Examples: <details>,
 * <div>, <!-- comments -->, standalone <img> / <hr>.
 *
 * The full HTML string is stored in the `html` attribute. The serializer emits
 * it back as a MDAST `html` block node so mdast-util-to-markdown outputs it
 * verbatim — no escaping, no normalization.
 *
 * Editing model: atom block. The cursor can be placed before or after the node
 * but not inside it. The node is selectable and can be deleted as a unit.
 * No rich in-place editing is supported (fidelity-first goal).
 */
export const RawHtmlBlock = Node.create({
  name: "rawHtmlBlock",
  group: "block",
  atom: true,
  selectable: true,
  draggable: false,

  addAttributes() {
    return {
      html: { default: "" },
    };
  },

  // parseHTML is used by TipTap when deserializing the editor's own HTML
  // representation (clipboard, ProseMirror JSON → HTML round-trips). It targets
  // the sentinel attribute so regular <pre><code> code blocks are never matched.
  parseHTML() {
    return [
      {
        tag: "pre[data-raw-html-block]",
        getAttrs: (el) => ({ html: (el as HTMLElement).textContent ?? "" }),
      },
    ];
  },

  // renderHTML is the editor's visual DOM representation. The raw HTML source is
  // emitted as a text node inside a <pre> so angle brackets display literally.
  // The data-raw-html-block sentinel distinguishes this from code blocks in
  // parseHTML rules, and the class wires up the muted visual style in CSS.
  renderHTML({ node }) {
    return [
      "pre",
      { "data-raw-html-block": "true", class: "raw-html-block" },
      node.attrs.html as string,
    ];
  },
});
