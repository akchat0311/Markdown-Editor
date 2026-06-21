import { Extension } from "@tiptap/core";

// Adds verticalAlign (top / middle / bottom) to tableCell and tableHeader.
// setCellAttribute("verticalAlign", "top") works because TableKit's setCellAttribute
// command accepts any registered attribute name.
// Note: verticalAlign is not part of GFM so it is not persisted to Markdown.
export const TableAlignment = Extension.create({
  name: "tableAlignment",
  addGlobalAttributes() {
    return [
      {
        types: ["tableCell", "tableHeader"],
        attributes: {
          verticalAlign: {
            default: null,
            parseHTML: (element) => element.style.verticalAlign || null,
            renderHTML: (attributes) => {
              if (!attributes.verticalAlign) return {};
              return { style: `vertical-align: ${attributes.verticalAlign}` };
            },
          },
        },
      },
    ];
  },
});
