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
  onClick: () => void;
}

function MenuItem({ label, shortcut, active, onClick }: MenuItemProps) {
  return (
    <button
      type="button"
      onMouseDown={(e) => {
        e.preventDefault();
        onClick();
      }}
      className={[
        "flex w-full items-center justify-between gap-4 rounded px-2.5 py-1.5 text-sm text-left transition-colors",
        active
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
      cellAlign: e.getAttributes("tableCell").align ?? e.getAttributes("tableHeader").align ?? null,
      cellVerticalAlign: e.getAttributes("tableCell").verticalAlign ?? e.getAttributes("tableHeader").verticalAlign ?? null,
    }),
  });

  // Clamp position so the menu doesn't overflow the viewport
  const menuWidth = 200;
  const menuHeight = state.inTable ? 500 : 290;
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

      {/* ── Table alignment (only when cursor is inside a table) ── */}
      {state.inTable && (
        <>
          <MenuDivider />
          <div className="px-2.5 pb-0.5 pt-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--color-muted)]">
            Horizontal
          </div>
          <MenuItem
            label="Align Left"
            active={state.cellAlign === "left"}
            onClick={() => run(() => editor.chain().focus().setCellAttribute("align", state.cellAlign === "left" ? null : "left").run())}
          />
          <MenuItem
            label="Align Center"
            active={state.cellAlign === "center"}
            onClick={() => run(() => editor.chain().focus().setCellAttribute("align", state.cellAlign === "center" ? null : "center").run())}
          />
          <MenuItem
            label="Align Right"
            active={state.cellAlign === "right"}
            onClick={() => run(() => editor.chain().focus().setCellAttribute("align", state.cellAlign === "right" ? null : "right").run())}
          />
          <div className="px-2.5 pb-0.5 pt-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--color-muted)]">
            Vertical
          </div>
          <MenuItem
            label="Align Top"
            active={state.cellVerticalAlign === "top"}
            onClick={() => run(() => editor.chain().focus().setCellAttribute("verticalAlign", state.cellVerticalAlign === "top" ? null : "top").run())}
          />
          <MenuItem
            label="Align Middle"
            active={state.cellVerticalAlign === "middle"}
            onClick={() => run(() => editor.chain().focus().setCellAttribute("verticalAlign", state.cellVerticalAlign === "middle" ? null : "middle").run())}
          />
          <MenuItem
            label="Align Bottom"
            active={state.cellVerticalAlign === "bottom"}
            onClick={() => run(() => editor.chain().focus().setCellAttribute("verticalAlign", state.cellVerticalAlign === "bottom" ? null : "bottom").run())}
          />
        </>
      )}
    </div>
  );
}
