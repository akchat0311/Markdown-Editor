import type { Editor } from "@tiptap/react";
import { useEditorState } from "@tiptap/react";
import { useEffect, useRef } from "react";

interface ContextMenuProps {
  editor: Editor;
  x: number;
  y: number;
  onClose: () => void;
}

interface MenuItemProps {
  label: string;
  shortcut?: string;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
}

function MenuItem({ label, shortcut, active, disabled, onClick }: MenuItemProps) {
  return (
    <button
      type="button"
      disabled={disabled}
      onMouseDown={(e) => {
        e.preventDefault();
        if (!disabled) onClick();
      }}
      className={[
        "flex w-full items-center justify-between gap-4 rounded px-2.5 py-1.5 text-sm text-left transition-colors",
        disabled
          ? "cursor-not-allowed opacity-40 text-[var(--color-text)]"
          : active
            ? "bg-blue-50 text-blue-700 dark:bg-blue-900/40 dark:text-blue-200"
            : "text-[var(--color-text)] hover:bg-black/5 dark:hover:bg-white/8",
      ].join(" ")}
    >
      <span>{label}</span>
      {shortcut && (
        <span className="text-xs text-[var(--color-muted)]">{shortcut}</span>
      )}
    </button>
  );
}

function MenuDivider() {
  return <div className="my-1 h-px bg-[var(--color-border)]" />;
}

function SectionLabel({ children }: { children: string }) {
  return (
    <div className="px-2.5 pb-0.5 pt-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--color-muted)]">
      {children}
    </div>
  );
}

export function ContextMenu({ editor, x, y, onClose }: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);

  const state = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      bold: e.isActive("bold"),
      italic: e.isActive("italic"),
      underline: e.isActive("underline"),
      strike: e.isActive("strike"),
      code: e.isActive("code"),
      highlight: e.isActive("highlight"),
      superscript: e.isActive("superscript"),
      subscript: e.isActive("subscript"),
      inTable: e.isActive("table"),
      // Column alignment (reads from whichever cell type is active)
      cellAlign: e.getAttributes("tableCell").align ?? e.getAttributes("tableHeader").align ?? null,
      canAddRowBefore: e.can().addRowBefore(),
      canAddRowAfter: e.can().addRowAfter(),
      canAddColBefore: e.can().addColumnBefore(),
      canAddColAfter: e.can().addColumnAfter(),
      canDeleteRow: e.can().deleteRow(),
      canDeleteCol: e.can().deleteColumn(),
      canDeleteTable: e.can().deleteTable(),
    }),
  });

  // Clamp position so the menu doesn't overflow the viewport
  const menuWidth = 200;
  const menuHeight = state.inTable ? 560 : 290;
  const left = Math.min(x, window.innerWidth - menuWidth - 8);
  const top = Math.min(y, window.innerHeight - menuHeight - 8);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    const onPointer = (e: PointerEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer);
    };
  }, [onClose]);

  const run = (cmd: () => void) => {
    cmd();
    onClose();
  };

  const setLink = () => {
    const prev = editor.getAttributes("link").href as string | undefined;
    const url = window.prompt("URL", prev ?? "https://");
    if (url === null) return;
    if (url === "") {
      editor.chain().focus().extendMarkRange("link").unsetLink().run();
    } else {
      editor.chain().focus().extendMarkRange("link").setLink({ href: url }).run();
    }
    onClose();
  };

  return (
    <div
      ref={menuRef}
      style={{ position: "fixed", left, top, zIndex: 9999, minWidth: menuWidth }}
      className="rounded-lg border border-[var(--color-border)] bg-[var(--color-paper)] p-1 shadow-xl"
    >
      <MenuItem
        label="Bold"
        shortcut="⌘B"
        active={state.bold}
        onClick={() => run(() => editor.chain().focus().toggleBold().run())}
      />
      <MenuItem
        label="Italic"
        shortcut="⌘I"
        active={state.italic}
        onClick={() => run(() => editor.chain().focus().toggleItalic().run())}
      />
      <MenuItem
        label="Underline"
        shortcut="⌘U"
        active={state.underline}
        onClick={() => run(() => editor.chain().focus().toggleUnderline().run())}
      />
      <MenuItem
        label="Strikethrough"
        shortcut="⌘⇧X"
        active={state.strike}
        onClick={() => run(() => editor.chain().focus().toggleStrike().run())}
      />
      <MenuItem
        label="Inline Code"
        shortcut="⌘E"
        active={state.code}
        onClick={() => run(() => editor.chain().focus().toggleCode().run())}
      />
      <MenuItem
        label="Link"
        shortcut="⌘K"
        active={editor.isActive("link")}
        onClick={setLink}
      />
      <MenuDivider />
      <MenuItem
        label="Highlight"
        shortcut="⌘⇧H"
        active={state.highlight}
        onClick={() => run(() => editor.chain().focus().toggleMark("highlight").run())}
      />
      <MenuItem
        label="Superscript"
        active={state.superscript}
        onClick={() => run(() => editor.chain().focus().toggleMark("superscript").run())}
      />
      <MenuItem
        label="Subscript"
        active={state.subscript}
        onClick={() => run(() => editor.chain().focus().toggleMark("subscript").run())}
      />

      {/* ── Table operations (only when cursor is inside a table) ── */}
      {state.inTable && (
        <>
          <MenuDivider />
          <SectionLabel>Column Alignment</SectionLabel>
          <MenuItem
            label="Align Left"
            active={state.cellAlign === "left"}
            onClick={() => run(() => editor.chain().focus().setColumnAlign(state.cellAlign === "left" ? null : "left").run())}
          />
          <MenuItem
            label="Align Center"
            active={state.cellAlign === "center"}
            onClick={() => run(() => editor.chain().focus().setColumnAlign(state.cellAlign === "center" ? null : "center").run())}
          />
          <MenuItem
            label="Align Right"
            active={state.cellAlign === "right"}
            onClick={() => run(() => editor.chain().focus().setColumnAlign(state.cellAlign === "right" ? null : "right").run())}
          />
          <MenuDivider />
          <SectionLabel>Rows</SectionLabel>
          <MenuItem
            label="Add Row Above"
            disabled={!state.canAddRowBefore}
            onClick={() => run(() => editor.chain().focus().addRowBefore().run())}
          />
          <MenuItem
            label="Add Row Below"
            shortcut="⌃↵"
            disabled={!state.canAddRowAfter}
            onClick={() => run(() => editor.chain().focus().addRowAfter().run())}
          />
          <MenuItem
            label="Delete Row"
            disabled={!state.canDeleteRow}
            onClick={() => run(() => editor.chain().focus().deleteRow().run())}
          />
          <MenuDivider />
          <SectionLabel>Columns</SectionLabel>
          <MenuItem
            label="Add Column Left"
            disabled={!state.canAddColBefore}
            onClick={() => run(() => editor.chain().focus().addColumnBefore().run())}
          />
          <MenuItem
            label="Add Column Right"
            disabled={!state.canAddColAfter}
            onClick={() => run(() => editor.chain().focus().addColumnAfter().run())}
          />
          <MenuItem
            label="Delete Column"
            disabled={!state.canDeleteCol}
            onClick={() => run(() => editor.chain().focus().deleteColumn().run())}
          />
          <MenuDivider />
          <MenuItem
            label="Delete Table"
            disabled={!state.canDeleteTable}
            onClick={() => run(() => editor.chain().focus().deleteTable().run())}
          />
        </>
      )}
    </div>
  );
}
