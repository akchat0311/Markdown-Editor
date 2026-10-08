import BulletList from "@tiptap/extension-bullet-list";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import type { Node as PMNode } from "@tiptap/pm/model";
import ListItem from "@tiptap/extension-list-item";
import OrderedList from "@tiptap/extension-ordered-list";
import TaskItem from "@tiptap/extension-task-item";
import TaskList from "@tiptap/extension-task-list";

/**
 * Drop-in replacements for the StarterKit list extensions and the standalone
 * TaskList / TaskItem extensions.
 *
 * The only change is the addition of a `spread` attribute on every list and
 * list-item node type. `spread` maps directly to the MDAST `ListItem.spread`
 * / `List.spread` fields that control whether blank lines are emitted:
 *
 *   List.spread     true  → blank line between items    (loose list)
 *   ListItem.spread true  → blank line between blocks   (multi-block item)
 *
 * Without this attribute ProseMirror strips the value when it normalizes the
 * document against the schema, causing the serializer to hard-code
 * `spread: false` and collapse every loose list into a tight list on save.
 *
 * All other parent functionality (commands, keymaps, parseHTML, renderHTML,
 * input rules) is inherited unchanged via TipTap's extend() mechanism.
 */

export const SpreadBulletList = BulletList.extend({
  addAttributes() {
    return { ...this.parent?.(), spread: { default: false } };
  },
});

export const SpreadOrderedList = OrderedList.extend({
  addAttributes() {
    return { ...this.parent?.(), spread: { default: false } };
  },

  addProseMirrorPlugins() {
    return [...(this.parent?.() ?? []), orderedListRenumberPlugin()];
  },
});

/**
 * Renumbers the item `value` attrs of any ordered list the user EDITS.
 *
 * `value` preserves the source's exact marker numbers for round-trip
 * fidelity — including deliberately exotic schemes ("2. 4. 6.", all-ones).
 * That fidelity only makes sense for lists the user has not touched: once a
 * list is edited (item inserted, deleted, split, text changed), stale
 * values leave the FILE showing wrong numbers while the editor renders
 * sequentially (user report, 2026-09-01: inserting an item left
 * "1. 2. 2. 4. 5."). This plugin renormalizes the values of every ordered
 * list intersecting an edit, style-aware:
 * - all stored values equal (the diff-friendly "1. 1. 1." convention) →
 *   keep that constant on every item;
 * - anything else → sequential from the first item's value (preserving a
 *   non-1 start such as "3. 4. 5.").
 * Untouched lists never enter the changed ranges, so their exotic numbering
 * survives byte-exact (see markdown-roundtrip preservation tests).
 */
function orderedListRenumberPlugin(): Plugin {
  return new Plugin({
    key: new PluginKey("orderedListRenumber"),
    appendTransaction(transactions, _oldState, newState) {
      if (!transactions.some((t) => t.docChanged)) return null;
      // Undo/redo must restore exactly what history recorded — the original
      // renumber (if any) is itself part of that record.
      if (transactions.some((t) => t.getMeta("history$"))) return null;

      // Ranges touched by these transactions, mapped into the new doc.
      const ranges: Array<[number, number]> = [];
      for (let t = 0; t < transactions.length; t++) {
        const tr = transactions[t];
        tr.steps.forEach((step, i) => {
          step.getMap().forEach((_os, _oe, ns, ne) => {
            let from = ns;
            let to = ne;
            // Map through the remaining steps of this tr…
            for (let j = i + 1; j < tr.steps.length; j++) {
              const m = tr.steps[j].getMap();
              from = m.map(from, -1);
              to = m.map(to, 1);
            }
            // …and through all subsequent transactions.
            for (let k = t + 1; k < transactions.length; k++) {
              from = transactions[k].mapping.map(from, -1);
              to = transactions[k].mapping.map(to, 1);
            }
            ranges.push([from, to]);
          });
        });
      }
      if (ranges.length === 0) return null;

      const tr = newState.tr;
      let changed = false;

      newState.doc.descendants((node: PMNode, pos: number) => {
        if (node.type.name !== "orderedList") return true;
        const end = pos + node.nodeSize;
        if (!ranges.some(([f, t2]) => f < end && t2 > pos)) return true;

        const stored: number[] = [];
        node.forEach((li) => {
          if (typeof li.attrs.value === "number") stored.push(li.attrs.value);
        });
        const allOnes = stored.length >= 2 && stored.every((v) => v === stored[0]);
        const first = node.child(0);
        // The list's own `start` attr outranks the first item's stored value:
        // the parser sets `start` from the source for authored non-1 starts,
        // while an edit that SPLITS a list copies the original node's attrs —
        // so a split-off tail carrying values [3,4,5] with start=1 renumbers
        // to [1,2,3] instead of being mistaken for an authored 3-start (user
        // report, 2026-09-01: deleting a mid-list item left "1." + "3) 4) 5)").
        const start =
          typeof node.attrs.start === "number"
            ? (node.attrs.start as number)
            : typeof first.attrs.value === "number"
              ? (first.attrs.value as number)
              : 1;

        let childPos = pos + 1;
        node.forEach((li, _offset, index) => {
          const target = allOnes ? start : start + index;
          if (li.attrs.value !== target) {
            tr.setNodeMarkup(childPos, undefined, { ...li.attrs, value: target });
            changed = true;
          }
          childPos += li.nodeSize;
        });
        return true;
      });

      return changed ? tr : null;
    },
  });
}

export const SpreadListItem = ListItem.extend({
  addAttributes() {
    // `value` stores the original ordered-list marker number (e.g. 1 for "1.", 4 for "4.").
    // Null means the item was created via the editor and uses sequential fallback numbering.
    //
    // Writers of `value`: the markdown parser (parser.ts,
    // attachOrderedListItemValues/listNodeToPM) for source fidelity, and the
    // orderedListRenumberPlugin below, which renormalizes EDITED lists. It sets it on the PM
    // JSON tree when loading a .md file. It must NEVER be trusted from parsed DOM:
    // TipTap's default attribute config would otherwise read it from any `<li value>`
    // fed through the `li` parse rule (paste, drag-drop) and — because attributes
    // default to `keepOnSplit: true` — clone a pasted value onto every subsequent
    // item created by pressing Enter, corrupting both the display and the saved
    // markdown (serializer.ts trusts `node.value` unconditionally). Clipboard-sourced
    // `<li value>`/`<ol start>` is presentation metadata from the source document,
    // not persistent state for this one — closing off `parseHTML` and disabling
    // `keepOnSplit` makes pasted/typed numbering derive purely from list position,
    // per HTML's native <ol>/<li> counting.
    return {
      ...this.parent?.(),
      spread: { default: false },
      value: { default: null, keepOnSplit: false, parseHTML: () => null },
    };
  },
});

export const SpreadTaskList = TaskList.extend({
  addAttributes() {
    return { ...this.parent?.(), spread: { default: false } };
  },
});

export const SpreadTaskItem = TaskItem.extend({
  addAttributes() {
    return { ...this.parent?.(), spread: { default: false } };
  },
});
