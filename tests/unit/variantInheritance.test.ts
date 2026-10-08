import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { Editor } from "@tiptap/core";
import { createCoreExtensions } from "@/editor/extensions/core";
import { parseMarkdownToDoc, serializeDocToMarkdown } from "@/markdown";
import { collectDocumentVariants } from "@/editor/utils/requirementOps";
import { filterSlashCommandItems } from "@/editor/slashCommandItems";
import { useConfigStore } from "@/stores/configStore";
import type { PMNode } from "@/markdown/types";

/**
 * Variant inheritance (user request, 2026-09-02): a new requirement takes
 * the document's variant by default when exactly ONE distinct variant is in
 * use; with several in use nothing is guessed (the chip menu offers them).
 */
describe("variant inheritance", () => {
  let editor: Editor;

  beforeEach(() => {
    useConfigStore.getState().setRequirementRegexPattern("(TRANS_[A-Za-z0-9]+_\\d{3})", "");
  });
  afterEach(() => {
    editor?.destroy();
    useConfigStore.getState().clearRequirementPattern();
  });

  function open(md: string): void {
    editor = new Editor({
      element: document.createElement("div"),
      extensions: createCoreExtensions(),
      content: parseMarkdownToDoc(md),
    });
  }

  function runNewRequirement(): void {
    const item = filterSlashCommandItems("requirement").find((i) => i.id === "requirement");
    expect(item).toBeTruthy();
    // Simulate "/" typed on the empty trailing paragraph.
    const end = editor.state.doc.content.size - 1;
    editor.commands.setTextSelection(end);
    editor.commands.insertContent("/");
    const from = editor.state.selection.from - 1;
    item!.command(editor, { from, to: from + 1 });
  }

  describe("collectDocumentVariants", () => {
    it("returns distinct variants in document order", () => {
      open(
        "### TRANS_feat_001 [*Draft*] [V2]\n\n### TRANS_feat_002 [*Draft*] [V1]\n\n### TRANS_feat_003 [*Draft*] [V2]\n",
      );
      expect(collectDocumentVariants(editor.state.doc)).toEqual(["V2", "V1"]);
    });

    it("ignores non-requirement headings and variant-less requirements", () => {
      open("## Section [Note]\n\n### TRANS_feat_001 [*Draft*]\n");
      expect(collectDocumentVariants(editor.state.doc)).toEqual([]);
    });

    it("returns [] when no pattern is configured", () => {
      open("### TRANS_feat_001 [*Draft*] [V2]\n");
      useConfigStore.getState().clearRequirementPattern();
      expect(collectDocumentVariants(editor.state.doc)).toEqual([]);
    });
  });

  describe("slash-inserted requirement", () => {
    it("inherits the document's single variant", () => {
      open("### TRANS_feat_001 [*Draft*] [V2]\n\nBody.\n\n");
      runNewRequirement();
      const md = serializeDocToMarkdown(editor.getJSON() as PMNode);
      expect(md).toContain("### TRANS_feat_002 [*Draft*] [V2]");
    });

    it("does NOT guess when several variants are in use", () => {
      open(
        "### TRANS_feat_001 [*Draft*] [V1]\n\n### TRANS_feat_002 [*Draft*] [V2]\n\nBody.\n\n",
      );
      runNewRequirement();
      const md = serializeDocToMarkdown(editor.getJSON() as PMNode);
      expect(md).toContain("### TRANS_feat_003 [*Draft*]\n");
      expect(md).not.toContain("TRANS_feat_003 [*Draft*] [V");
    });

    it("no variant in the doc → none inserted (unchanged behavior)", () => {
      open("### TRANS_feat_001 [*Draft*]\n\nBody.\n\n");
      runNewRequirement();
      const md = serializeDocToMarkdown(editor.getJSON() as PMNode);
      expect(md).toContain("### TRANS_feat_002 [*Draft*]\n");
    });
  });
});
