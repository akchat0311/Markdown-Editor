import { describe, it, expect, afterEach } from "vitest";
import { Editor } from "@tiptap/core";
import { createCoreExtensions } from "@/editor/extensions/core";
import { parseMarkdownToDoc, serializeDocToMarkdown } from "@/markdown";
import { expandSoftBreaks, collapseSoftBreaks } from "@/markdown/softBreaks";
import { stripEmptyTopLevelParagraphs } from "@/markdown/emptyParagraphs";
import type { PMNode } from "@/markdown/types";

/**
 * Regression (user report, 2026-09-01): lifting a mid-list item out of the
 * list (Shift+Tab / liftListItem; Backspace used to do this too — it now joins
 * into the previous item instead, see listItemBackspaceJoin.test.ts) SPLITS
 * the ordered list.
 * The split-off tail copies the original list node's attrs (start=1) but its
 * items keep their stored source values ([3,4,5]) — and the renumber plugin
 * used to trust the first item's value as the start, so the tail looked
 * "already sequential from 3" and the file showed "1." followed by
 * "3) 4) 5)". The plugin now trusts the list's `start` attr first.
 *
 * (The ")" delimiter on the tail is mdast-util-to-markdown keeping the two
 * adjacent lists from merging on reparse — expected, not part of the bug.)
 */
describe("ordered list split/merge renumbering", () => {
  let editor: Editor;
  afterEach(() => editor?.destroy());

  function serialize(): string {
    return serializeDocToMarkdown(
      stripEmptyTopLevelParagraphs(collapseSoftBreaks(editor.getJSON() as PMNode)),
    );
  }

  function listValues(): (number | null)[][] {
    const lists: (number | null)[][] = [];
    editor.state.doc.descendants((n) => {
      if (n.type.name === "orderedList") {
        const vals: (number | null)[] = [];
        n.forEach((li) => vals.push((li.attrs.value as number | null) ?? null));
        lists.push(vals);
      }
    });
    return lists;
  }

  function open(md: string): void {
    editor = new Editor({
      element: document.createElement("div"),
      extensions: createCoreExtensions(),
      content: expandSoftBreaks(parseMarkdownToDoc(md)),
    });
  }

  function clearItemText(text: string): void {
    let from = -1;
    let to = -1;
    editor.state.doc.descendants((n, p) => {
      if (n.isText && n.text === text) {
        from = p;
        to = p + n.nodeSize;
      }
    });
    editor.commands.setTextSelection({ from, to });
    editor.commands.deleteSelection();
  }

  it("lifting a mid-list item renumbers the split-off tail from 1", () => {
    open("1. alpha\n2. beta\n3. gamma\n4. delta\n5. epsilon\n");
    clearItemText("beta");
    editor.commands.liftListItem("listItem");
    expect(listValues()).toEqual([[1], [1, 2, 3]]);
    expect(serialize()).toBe("1. alpha\n\n1) gamma\n2) delta\n3) epsilon\n");
  });

  it("merging the lists back yields one sequential list", () => {
    open("1. alpha\n2. beta\n3. gamma\n4. delta\n5. epsilon\n");
    clearItemText("beta");
    editor.commands.liftListItem("listItem");
    // Backspace twice from the empty paragraph: rejoin, then remove the
    // stranded empty item.
    editor.commands.joinBackward();
    editor.commands.joinBackward();
    expect(listValues()).toEqual([[1, 2, 3, 4]]);
  });

  it("an authored non-1 start is kept by BOTH halves of a split", () => {
    open("3. first\n4. second\n5. third\n");
    clearItemText("second");
    editor.commands.liftListItem("listItem");
    // A split copies the list node's attrs to the tail, so an authored
    // non-1 start carries to both halves — each renumbers from 3.
    expect(listValues()).toEqual([[3], [3]]);
    expect(serialize()).toBe("3. first\n\n3) third\n");
  });
});
