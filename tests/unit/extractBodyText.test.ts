import { describe, it, expect } from "vitest";
import type { JSONContent } from "@tiptap/core";
import { extractBodyText } from "@/editor/utils/extractBodyText";

// ── helpers ───────────────────────────────────────────────────────────────────

function textNode(text: string): JSONContent {
  return { type: "text", text };
}

function codeNode(text: string): JSONContent {
  return { type: "text", text, marks: [{ type: "code" }] };
}

function paragraph(...children: JSONContent[]): JSONContent {
  return { type: "paragraph", content: children };
}

function codeBlock(text: string): JSONContent {
  return { type: "codeBlock", content: [{ type: "text", text }] };
}

// ── extractBodyText ───────────────────────────────────────────────────────────

describe("extractBodyText", () => {
  it("returns plain text unchanged", () => {
    expect(extractBodyText(textNode("The system shall respond."))).toBe("The system shall respond.");
  });

  it("recurses into paragraph children", () => {
    const node = paragraph(textNode("The "), textNode("system"), textNode(" shall."));
    expect(extractBodyText(node)).toBe("The system shall.");
  });

  // ── inline code exclusion ──────────────────────────────────────────────────

  it("excludes inline-code ECU from prose text", () => {
    const node = paragraph(
      textNode("The system uses "),
      codeNode("ECU"),
      textNode(" timeout."),
    );
    expect(extractBodyText(node)).not.toMatch(/\bECU\b/);
  });

  it("excludes inline-code CAN from prose text", () => {
    const node = paragraph(
      textNode("The "),
      codeNode("CAN"),
      textNode(" frame size is 8 bytes."),
    );
    expect(extractBodyText(node)).not.toMatch(/\bCAN\b/);
  });

  it("excludes inline-code ENABLED from prose text", () => {
    const node = paragraph(
      textNode("The state shall be "),
      codeNode("ENABLED"),
      textNode("."),
    );
    expect(extractBodyText(node)).not.toMatch(/\bENABLED\b/);
  });

  it("keeps plain-text ECU in prose for validation", () => {
    const node = paragraph(textNode("The ECU shall respond."));
    expect(extractBodyText(node)).toMatch(/\bECU\b/);
  });

  // ── lexical boundary preservation when excluding inline code ──────────────

  it("separates adjacent uppercase tokens around inline code (ECU`VALUE`CAN)", () => {
    const node = paragraph(
      textNode("ECU"),
      codeNode("VALUE"),
      textNode("CAN"),
    );
    const result = extractBodyText(node);
    expect(result).not.toContain("ECUCAN");
    expect(result).toMatch(/ECU\s+CAN/);
  });

  it("separates adjacent uppercase tokens around inline code (ALL`foo`ANY)", () => {
    const node = paragraph(
      textNode("ALL"),
      codeNode("foo"),
      textNode("ANY"),
    );
    const result = extractBodyText(node);
    expect(result).not.toContain("ALLANY");
    expect(result).toMatch(/ALL\s+ANY/);
  });

  it("separates adjacent lowercase tokens around inline code (word`CODE`word)", () => {
    const node = paragraph(
      textNode("word"),
      codeNode("CODE"),
      textNode("word"),
    );
    const result = extractBodyText(node);
    expect(result).not.toContain("wordword");
    expect(result).toMatch(/word\s+word/);
  });

  it("preserves surrounding spaces when inline code has adjacent spaces (ECU `VALUE` CAN)", () => {
    const node = paragraph(
      textNode("ECU "),
      codeNode("VALUE"),
      textNode(" CAN"),
    );
    const result = extractBodyText(node);
    expect(result).toMatch(/ECU\s+CAN/);
  });

  // ── code block exclusion ───────────────────────────────────────────────────

  it("excludes codeBlock content entirely", () => {
    const block = codeBlock("ECU_STATE = ACTIVE; HVAC_MODE = ON;");
    const result = extractBodyText(block);
    expect(result).not.toContain("ECU_STATE");
    expect(result).not.toContain("ACTIVE");
    expect(result).not.toContain("HVAC_MODE");
  });

  it("codeBlock between prose paragraphs does not concatenate surrounding text", () => {
    const nodes = [
      paragraph(textNode("The system shall respond.")),
      codeBlock("ECU_STATE = ACTIVE;\nHVAC_MODE = ON;"),
      paragraph(textNode("All outputs shall be stable.")),
    ];
    const result = nodes.map(extractBodyText).join("").trim();
    // Code block content absent
    expect(result).not.toContain("ECU_STATE");
    expect(result).not.toContain("ACTIVE");
    expect(result).not.toContain("HVAC_MODE");
    // Prose content present
    expect(result).toContain("shall respond");
    expect(result).toContain("All outputs");
  });

  it("returns ' ' for a codeBlock so that surrounding prose is not concatenated", () => {
    // If codeBlock returned "" the surrounding blocks would be joined with ""
    // in the caller's .join("") and potentially merge words across the gap.
    const result = extractBodyText(codeBlock("ECU_STATE = ACTIVE;"));
    expect(result).toBe(" ");
  });

  it("returns ' ' for an inline-code text node to preserve lexical boundaries", () => {
    const result = extractBodyText(codeNode("VALUE"));
    expect(result).toBe(" ");
  });

  // ── other node types ───────────────────────────────────────────────────────

  it("returns empty string for nodes with no text and no content", () => {
    expect(extractBodyText({ type: "hardBreak" })).toBe("");
    expect(extractBodyText({ type: "image", attrs: { src: "x.png" } })).toBe("");
  });

  it("handles deeply nested content", () => {
    const node: JSONContent = {
      type: "blockquote",
      content: [
        {
          type: "paragraph",
          content: [textNode("The ECU shall respond.")],
        },
      ],
    };
    expect(extractBodyText(node)).toContain("ECU");
  });
});
