import { describe, it, expect, afterEach } from "vitest";
import { Editor } from "@tiptap/core";
import { createCoreExtensions } from "@/editor/extensions/core";
import { parseMarkdownToDoc, serializeDocToMarkdown } from "@/markdown";
import {
  rewriteHeadingStatus,
  insertHeadingStatus,
  rewriteHeadingVariant,
  insertHeadingVariant,
  removeHeadingVariant,
} from "@/editor/utils/requirementHeadingOps";
import type { PMNode } from "@/markdown/types";

/**
 * Token-level heading ops for the [Variant] bracket (design D10–D13).
 * The critical invariant: a status change on a variant-carrying heading
 * NEVER touches the variant, and vice versa — the classified bracket is
 * targeted, not "the last bracket".
 */
describe("variant heading ops", () => {
  let editor: Editor;
  afterEach(() => editor?.destroy());

  function open(md: string): void {
    editor = new Editor({
      element: document.createElement("div"),
      extensions: createCoreExtensions(),
      content: parseMarkdownToDoc(md),
    });
  }

  function heading(): { pos: number; node: PMNode } {
    let pos = -1;
    let node: unknown = null;
    editor.state.doc.descendants((n, p) => {
      if (n.type.name === "heading") { pos = p; node = n; }
    });
    return { pos, node: node as PMNode };
  }

  function md(): string {
    return serializeDocToMarkdown(editor.getJSON() as PMNode);
  }

  it("status rewrite on a variant-carrying heading preserves the variant byte-exact", () => {
    open("### TRANS_feat_001 [*Draft*] [V2]\n");
    const { pos, node } = heading();
    const tr = editor.state.tr;
    expect(rewriteHeadingStatus(tr, pos, node as never, "Approved")).toBe(true);
    editor.view.dispatch(tr);
    expect(md()).toBe("### TRANS_feat_001 [*Approved*] [V2]\n");
  });

  it("variant rewrite preserves the status byte-exact and stays plain", () => {
    open("### TRANS_feat_001 [*Draft*] [V2]\n");
    const { pos, node } = heading();
    const tr = editor.state.tr;
    expect(rewriteHeadingVariant(tr, pos, node as never, "V3")).toBe(true);
    editor.view.dispatch(tr);
    expect(md()).toBe("### TRANS_feat_001 [*Draft*] [V3]\n");
  });

  it("insertHeadingVariant appends after the status (canonical order)", () => {
    open("### TRANS_feat_001 [*Draft*]\n");
    const { pos, node } = heading();
    const tr = editor.state.tr;
    insertHeadingVariant(tr, pos, node as never, "V1");
    editor.view.dispatch(tr);
    expect(md()).toBe("### TRANS_feat_001 [*Draft*] [V1]\n");
  });

  it("removeHeadingVariant deletes the bracket and its leading space", () => {
    open("### TRANS_feat_001 [*Draft*] [V2]\n");
    const { pos, node } = heading();
    const tr = editor.state.tr;
    expect(removeHeadingVariant(tr, pos, node as never)).toBe(true);
    editor.view.dispatch(tr);
    expect(md()).toBe("### TRANS_feat_001 [*Draft*]\n");
  });

  it("removeHeadingVariant is a no-op without a variant", () => {
    open("### TRANS_feat_001 [*Draft*]\n");
    const { pos, node } = heading();
    expect(removeHeadingVariant(editor.state.tr, pos, node as never)).toBe(false);
  });

  it("rewriteHeadingStatus returns false with no brackets (insert path)", () => {
    open("### TRANS_feat_001 Title\n");
    const { pos, node } = heading();
    const tr = editor.state.tr;
    expect(rewriteHeadingStatus(tr, pos, node as never, "Draft")).toBe(false);
    insertHeadingStatus(tr, pos, node as never, "Draft");
    editor.view.dispatch(tr);
    expect(md()).toBe("### TRANS_feat_001 Title [*Draft*]\n");
  });

  it("a variant-carrying heading round-trips byte-exact untouched", () => {
    const src = "### TRANS_feat_001 Login flow [*Draft*] [V2]\n";
    expect(serializeDocToMarkdown(parseMarkdownToDoc(src))).toBe(src);
  });
});
