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
    return { ...this.parent?.(), spread: { default: false }, value: { default: null } };
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
