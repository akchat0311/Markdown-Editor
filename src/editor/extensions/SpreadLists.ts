import BulletList from "@tiptap/extension-bullet-list";
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
});

export const SpreadListItem = ListItem.extend({
  addAttributes() {
    // `value` stores the original ordered-list marker number (e.g. 1 for "1.", 4 for "4.").
    // Null means the item was created via the editor and uses sequential fallback numbering.
    //
    // The only legitimate writer of `value` is the markdown parser (parser.ts,
    // attachOrderedListItemValues/listNodeToPM), which sets it directly on the PM
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
