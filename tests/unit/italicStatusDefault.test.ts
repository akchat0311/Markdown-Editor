import { describe, it, expect } from "vitest";
import type { JSONContent } from "@tiptap/core";
import { duplicateSection, duplicateMultipleSections } from "@/editor/utils/outlineOps";
import { insertRequirementAfter } from "@/editor/utils/requirementOps";
import { parseMarkdownToDoc, serializeDocToMarkdown } from "@/markdown";
import type { OutlineNode } from "@/types/outline";

/**
 * Requirement statuses are written ITALIC by default — "[*Draft*]" with
 * asterisks in the markdown (user requirement, 2026-10-07). Every code path
 * that creates or resets a status bracket must produce the three-node form
 * "[" + italic label + "]", and must still recognise a status that is
 * already italic (three text nodes, not one).
 */

function text(node: JSONContent): string {
  return (node.content ?? []).map((n) => n.text ?? "").join("");
}
function marksOf(node: JSONContent): Array<[string, string | undefined]> {
  return (node.content ?? []).map((n) => [n.text ?? "", n.marks?.[0]?.type]);
}
function md(content: JSONContent[]): string {
  return serializeDocToMarkdown({ type: "doc", content });
}
const ITALIC_DRAFT: Array<[string, string | undefined]> = [["[", undefined], ["Draft", "italic"], ["]", undefined]];

describe("status brackets are italic by default", () => {
  it("insertRequirementAfter writes [*Draft*]", () => {
    const content = parseMarkdownToDoc("## REQ_001 First [*Approved*]\n\nbody\n").content!;
    const result = insertRequirementAfter(content, 0, 2, "REQ_002");
    expect(text(result[2])).toBe("REQ_002 [Draft]");
    expect(marksOf(result[2]).slice(1)).toEqual(ITALIC_DRAFT);
    expect(md(result)).toBe("## REQ_001 First [*Approved*]\n\nbody\n\n## REQ_002 [*Draft*]\n");
  });

  it("duplicateSection resets an italic status to italic Draft and keeps the variant", () => {
    const content = parseMarkdownToDoc("## REQ_001 Login [*Approved*] [V2]\n\nbody\n").content!;
    const result = duplicateSection(content, 0, 2);
    expect(text(result[2])).toBe("REQ_001 Login [Draft] [V2]");
    expect(marksOf(result[2])).toEqual([
      ["REQ_001 Login ", undefined],
      ...ITALIC_DRAFT,
      [" [V2]", undefined],
    ]);
    expect(md(result.slice(2, 3))).toBe("## REQ_001 Login [*Draft*] [V2]\n");
  });

  it("duplicateSection upgrades a legacy plain [Approved] to italic [*Draft*]", () => {
    const content = parseMarkdownToDoc("## REQ_001 Login [Approved]\n").content!;
    const result = duplicateSection(content, 0, 2);
    expect(md(result.slice(1))).toBe("## REQ_001 Login [*Draft*]\n");
  });

  it("duplicateMultipleSections puts 'Copy' BEFORE an italic status, not after it", () => {
    const content = parseMarkdownToDoc("## REQ_001 Login [*Draft*]\n\nbody\n\n## Notes\n").content!;
    const node: OutlineNode = { key: "k", type: "heading", label: "REQ_001 Login [Draft]", level: 2, index: 0, pmPos: 0, children: [] };
    const result = duplicateMultipleSections(content, [{ node, from: 0, to: 2 }]);
    expect(text(result[2])).toBe("REQ_001 Login Copy [Draft]");
    expect(md(result.slice(2, 3))).toBe("## REQ_001 Login Copy [*Draft*]\n");
  });

  it("duplicateMultipleSections appends ' Copy' to a heading without a status", () => {
    const content = parseMarkdownToDoc("## Notes\n\nbody\n").content!;
    const node: OutlineNode = { key: "k", type: "heading", label: "Notes", level: 2, index: 0, pmPos: 0, children: [] };
    const result = duplicateMultipleSections(content, [{ node, from: 0, to: 2 }]);
    expect(text(result[2])).toBe("Notes Copy");
  });
});
