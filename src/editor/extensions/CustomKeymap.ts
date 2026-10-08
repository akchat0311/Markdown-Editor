import { Extension } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";
import { canJoin } from "@tiptap/pm/transform";
import { useEditorBehaviorStore } from "@/stores/editorBehaviorStore";
import { SuggestionPluginKey } from "@tiptap/suggestion";

/** List item node types whose Backspace-at-start behaviour is overridden. */
const LIST_ITEM_TYPES = new Set(["listItem", "taskItem"]);

export const CustomKeymap = Extension.create({
  name: "customKeymap",
  addKeyboardShortcuts() {
    return {
      "Mod-Shift-9": () => this.editor.commands.toggleTaskList(),

      // Backspace at the START of a list item that is not the first item of
      // its list joins the item into the previous one. TipTap's ListKeymap
      // instead LIFTS the item out of the list, which splits the list in two
      // around a paragraph: clearing items 2-3 of "1. 2. 3. 4. 5." and
      // backspacing the empty item left "1." + a new list "1. 2." (user
      // report, 2026-10-07). The first item keeps the lift — that is how a
      // list is left at the top. Delete (forward) already joins.
      Backspace: () => {
        // Same first step as every Backspace handler: right after an input
        // rule fired (e.g. "1. " just became a list), Backspace undoes it.
        if (this.editor.commands.undoInputRule()) return true;
        return this.editor.commands.command(({ state, tr, dispatch }) => {
          const { $from, empty } = state.selection;
          if (!empty || $from.parentOffset !== 0) return false;
          const itemDepth = $from.depth - 1;
          if (itemDepth < 1) return false;
          const item = $from.node(itemDepth);
          if (!LIST_ITEM_TYPES.has(item.type.name)) return false;
          // Caret must sit in the item's FIRST block (not in a later
          // paragraph of a multi-block item — that is an in-item join).
          if ($from.index(itemDepth) !== 0) return false;
          const itemIndex = $from.index(itemDepth - 1);
          if (itemIndex === 0) return false; // first item: default lift
          const list = $from.node(itemDepth - 1);
          const prevItem = list.child(itemIndex - 1);
          const itemStart = $from.before(itemDepth);

          const isEmptyItem = item.childCount === 1 && item.firstChild!.content.size === 0;
          if (isEmptyItem) {
            // Drop the empty item; the caret lands at the end of the previous
            // item's content (its last paragraph, or its nested list's).
            if (dispatch) {
              tr.delete(itemStart, itemStart + item.nodeSize);
              tr.setSelection(TextSelection.near(tr.doc.resolve(itemStart - 1), -1));
              tr.scrollIntoView();
            }
            return true;
          }
          if (!canJoin(state.doc, itemStart)) return false;
          // Merge the item's first block into the previous item's last block
          // when both are textblocks ("two" + "three" → "twothree"); when the
          // previous item ends with a nested list, the block simply becomes
          // a trailing block of the previous item — either way the list
          // stays one list.
          const prevLast = prevItem.lastChild;
          const first = item.firstChild;
          const deep =
            !!prevLast && !!first && prevLast.isTextblock && first.isTextblock &&
            prevLast.type.compatibleContent(first.type);
          if (dispatch) {
            tr.join(itemStart, deep ? 2 : 1);
            tr.scrollIntoView();
          }
          return true;
        });
      },

      // Block Enter inside table cells: ProseMirror's default Enter handler
      // (splitBlock) creates a second paragraph inside the cell, which the
      // GFM serializer concatenates without a separator — silent data loss.
      // Shift-Enter (hardBreak) remains the correct path for line breaks in cells.
      //
      // Enter inside a HEADING never splits it: it finishes the heading and
      // opens a paragraph below. Splitting was a trap for requirement
      // headings — the caret sits before the " [Draft]" status after a
      // slash-insert, and Enter dragged the status down into the user's
      // body text (user report, 2026-09-01).
      "Enter": () => {
        if (this.editor.isActive("table")) return true;

        // The slash-command menu is open: Enter selects the highlighted item.
        if (SuggestionPluginKey.getState(this.editor.state)?.active) return false;

        // Headings never split (any mode): Enter finishes the heading and
        // opens a paragraph below (see 2026-09-01 report — splitting dragged
        // the " [Draft]" status into the body text).
        const headingHandled = this.editor.commands.command(({ state, tr, dispatch }) => {
          const { $from, empty } = state.selection;
          if (!empty || $from.parent.type.name !== "heading") return false;
          const paragraph = state.schema.nodes.paragraph.createAndFill();
          if (!paragraph) return false;
          if (dispatch) {
            const after = $from.after();
            tr.insert(after, paragraph);
            tr.setSelection(TextSelection.create(tr.doc, after + 1)).scrollIntoView();
          }
          return true;
        });
        if (headingHandled) return true;

        // "line" mode (default): in a TOP-LEVEL paragraph, Enter inserts a
        // soft line break — a single \n in the file, no blank line. Enter on
        // the resulting empty line upgrades it to a real paragraph break.
        // Lists, blockquotes, callouts, code keep their native Enter.
        if (useEditorBehaviorStore.getState().enterMode !== "line") return false;
        return this.editor.commands.command(({ state, tr, dispatch }) => {
          const { $from, empty } = state.selection;
          if (!empty || $from.parent.type.name !== "paragraph") return false;
          if ($from.depth !== 1) return false; // only top-level paragraphs
          const parent = $from.parent;
          if (parent.content.size === 0) return false; // empty para → default

          const before = $from.nodeBefore;
          const atLineStartAfterBreak = before?.type.name === "softBreak";
          const atParentEnd = $from.parentOffset === parent.content.size;
          if (atLineStartAfterBreak && atParentEnd) {
            // Second Enter on the empty line: replace the trailing soft
            // break with a real paragraph split.
            if (dispatch) {
              tr.delete($from.pos - 1, $from.pos);
              tr.split(tr.mapping.map($from.pos));
              tr.scrollIntoView();
            }
            return true;
          }
          const softBreak = state.schema.nodes.softBreak;
          if (!softBreak) return false;
          if (dispatch) {
            // Enter at the START of a line means "push this line down" — the
            // caret stays on the new empty line ABOVE (before the inserted
            // break), matching what the user sees and intends.
            const atLineStart =
              $from.parentOffset === 0 || $from.nodeBefore?.type.name === "softBreak";
            const pos = $from.pos;
            tr.replaceSelectionWith(softBreak.create());
            if (atLineStart) {
              tr.setSelection(TextSelection.create(tr.doc, pos));
            }
            tr.scrollIntoView();
          }
          return true;
        });
      },

      // Mod-Enter inserts a row below while inside a table.
      // Outside tables, Mod-Enter falls through to prosemirror-commands' exitCode
      // which only runs inside code blocks — no conflict.
      "Mod-Enter": () => {
        if (!this.editor.isActive("table")) return false;
        return this.editor.commands.addRowAfter();
      },
    };
  },
});
