import { describe, it, expect } from "vitest";
import { extractOutline } from "@/editor/utils/extractOutline";
import type { JSONContent } from "@tiptap/core";

function heading(level: number, text: string): JSONContent {
  return {
    type: "heading",
    attrs: { level },
    content: [{ type: "text", text }],
  };
}

function table(): JSONContent {
  return {
    type: "table",
    content: [
      { type: "tableRow", content: [{ type: "tableHeader", content: [{ type: "paragraph", content: [] }] }] },
    ],
  };
}

describe("extractOutline", () => {
  it("produces a flat list for top-level h1 headings", () => {
    const doc: JSONContent = {
      type: "doc",
      content: [heading(1, "Intro"), heading(1, "Features")],
    };
    const outline = extractOutline(doc);
    expect(outline).toHaveLength(2);
    expect(outline[0].label).toBe("Intro");
    expect(outline[1].label).toBe("Features");
    expect(outline[0].type).toBe("heading");
  });

  it("nests h2 under h1", () => {
    const doc: JSONContent = {
      type: "doc",
      content: [heading(1, "H1"), heading(2, "H2a"), heading(2, "H2b")],
    };
    const outline = extractOutline(doc);
    expect(outline).toHaveLength(1);
    expect(outline[0].children).toHaveLength(2);
    expect(outline[0].children[0].label).toBe("H2a");
  });

  it("nests h3 under h2 under h1", () => {
    const doc: JSONContent = {
      type: "doc",
      content: [heading(1, "H1"), heading(2, "H2"), heading(3, "H3")],
    };
    const outline = extractOutline(doc);
    expect(outline[0].children[0].children[0].label).toBe("H3");
  });

  it("attaches tables as leaves under nearest heading", () => {
    const doc: JSONContent = {
      type: "doc",
      content: [heading(1, "Data"), table()],
    };
    const outline = extractOutline(doc);
    expect(outline[0].children).toHaveLength(1);
    expect(outline[0].children[0].type).toBe("table");
    expect(outline[0].children[0].label).toBe("Table");
  });

  it("places table at root if no heading precedes it", () => {
    const doc: JSONContent = { type: "doc", content: [table()] };
    const outline = extractOutline(doc);
    expect(outline[0].type).toBe("table");
  });

  it("returns empty for empty doc", () => {
    expect(extractOutline({ type: "doc", content: [] })).toHaveLength(0);
  });

  it("sibling h2s after an h1 are all nested under that h1", () => {
    const doc: JSONContent = {
      type: "doc",
      content: [
        heading(1, "Parent"),
        heading(2, "Child A"),
        heading(2, "Child B"),
        heading(1, "Another Parent"),
      ],
    };
    const outline = extractOutline(doc);
    expect(outline).toHaveLength(2);
    expect(outline[0].children).toHaveLength(2);
    expect(outline[1].children).toHaveLength(0);
  });

  it("assigns pmPos as the node index", () => {
    const doc: JSONContent = {
      type: "doc",
      content: [heading(1, "A"), heading(2, "B")],
    };
    const outline = extractOutline(doc);
    expect(outline[0].pmPos).toBe(0);
    expect(outline[0].children[0].pmPos).toBe(1);
  });
});
