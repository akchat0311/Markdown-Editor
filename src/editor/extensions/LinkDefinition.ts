import { Node } from "@tiptap/core";

/**
 * Opaque block node that preserves a markdown link definition verbatim.
 *
 * A link definition (`[label]: url "title"`) is a block-level anchor that
 * provides the URL for one or more reference-style links (`[text][label]`).
 * remark-parse produces a MDAST `definition` node for each; without a
 * corresponding PM node type, those definitions were silently dropped and
 * all associated reference links became empty text.
 *
 * The label, url, and title are stored as attrs. The serializer reconstructs
 * a MDAST `{type:"definition"}` node so mdast-util-to-markdown handles URL
 * quoting and title quoting correctly.
 *
 * Editing model: atom block. The cursor can be placed before or after but not
 * inside. The raw definition text is displayed so the user can see what is
 * preserved; it is not editable in-place.
 */
export const LinkDefinition = Node.create({
  name: "linkDefinition",
  group: "block",
  atom: true,
  selectable: true,
  draggable: false,

  addAttributes() {
    return {
      label: { default: "" },
      url: { default: "" },
      title: { default: null },
    };
  },

  parseHTML() {
    return [
      {
        tag: "div[data-link-definition]",
        getAttrs: (el) => ({
          label: (el as HTMLElement).getAttribute("data-label") ?? "",
          url: (el as HTMLElement).getAttribute("data-url") ?? "",
          // empty string attribute → null (no title)
          title: (el as HTMLElement).getAttribute("data-title") || null,
        }),
      },
    ];
  },

  renderHTML({ node }) {
    const label = String(node.attrs.label ?? "");
    const url = String(node.attrs.url ?? "");
    const title = node.attrs.title ? String(node.attrs.title) : null;
    const raw = title ? `[${label}]: ${url} "${title}"` : `[${label}]: ${url}`;
    return [
      "div",
      {
        "data-link-definition": "true",
        "data-label": label,
        "data-url": url,
        "data-title": title ?? "",
        class: "link-definition",
      },
      raw,
    ];
  },
});
