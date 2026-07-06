import { BubbleMenu } from "@tiptap/react/menus";
import type { Editor } from "@tiptap/react";
import { useEditorState } from "@tiptap/react";

interface ToolbarButtonProps {
  label: string;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}

function ToolbarButton({ label, active, disabled, onClick, children }: ToolbarButtonProps) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onMouseDown={(e) => {
        e.preventDefault();
        if (!disabled) onClick();
      }}
      className={[
        "flex h-7 min-w-7 items-center justify-center rounded px-1.5 text-sm font-medium transition-colors",
        disabled
          ? "cursor-not-allowed opacity-30"
          : active
            ? "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-200"
            : "text-[var(--color-text)] hover:bg-black/5 dark:hover:bg-white/10",
      ].join(" ")}
    >
      {children}
    </button>
  );
}

function Divider() {
  return <span className="mx-0.5 h-4 w-px shrink-0 bg-[var(--color-border)]" />;
}

// ── Alignment icons ───────────────────────────────────────────────────────────

function IconAlignLeft() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
      <line x1="1" y1="3" x2="13" y2="3" />
      <line x1="1" y1="6" x2="9" y2="6" />
      <line x1="1" y1="9" x2="11" y2="9" />
      <line x1="1" y1="12" x2="7" y2="12" />
    </svg>
  );
}

function IconAlignCenter() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
      <line x1="1" y1="3" x2="13" y2="3" />
      <line x1="3" y1="6" x2="11" y2="6" />
      <line x1="2" y1="9" x2="12" y2="9" />
      <line x1="4" y1="12" x2="10" y2="12" />
    </svg>
  );
}

function IconAlignRight() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
      <line x1="1" y1="3" x2="13" y2="3" />
      <line x1="5" y1="6" x2="13" y2="6" />
      <line x1="3" y1="9" x2="13" y2="9" />
      <line x1="7" y1="12" x2="13" y2="12" />
    </svg>
  );
}

// ── Table action icons ────────────────────────────────────────────────────────

function IconRowAbove() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
      <rect x="1" y="5" width="12" height="8" rx="1" />
      <line x1="5" y1="9" x2="9" y2="9" />
      <line x1="7" y1="1" x2="7" y2="4" />
      <polyline points="5,2.5 7,1 9,2.5" />
    </svg>
  );
}

function IconRowBelow() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
      <rect x="1" y="1" width="12" height="8" rx="1" />
      <line x1="5" y1="5" x2="9" y2="5" />
      <line x1="7" y1="10" x2="7" y2="13" />
      <polyline points="5,11.5 7,13 9,11.5" />
    </svg>
  );
}

function IconColLeft() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
      <rect x="5" y="1" width="8" height="12" rx="1" />
      <line x1="9" y1="5" x2="9" y2="9" />
      <line x1="1" y1="7" x2="4" y2="7" />
      <polyline points="2.5,5 1,7 2.5,9" />
    </svg>
  );
}

function IconColRight() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
      <rect x="1" y="1" width="8" height="12" rx="1" />
      <line x1="5" y1="5" x2="5" y2="9" />
      <line x1="10" y1="7" x2="13" y2="7" />
      <polyline points="11.5,5 13,7 11.5,9" />
    </svg>
  );
}

function IconDeleteRow() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
      <rect x="1" y="4" width="12" height="6" rx="1" />
      <line x1="4" y1="7" x2="10" y2="7" />
    </svg>
  );
}

function IconDeleteCol() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
      <rect x="4" y="1" width="6" height="12" rx="1" />
      <line x1="7" y1="4" x2="7" y2="10" />
    </svg>
  );
}

function IconDeleteTable() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
      <rect x="1" y="1" width="12" height="12" rx="1" />
      <line x1="4" y1="4" x2="10" y2="10" />
      <line x1="10" y1="4" x2="4" y2="10" />
    </svg>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

export function EditorToolbar({ editor }: { editor: Editor }) {
  const state = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      // Text formatting
      bold: e.isActive("bold"),
      italic: e.isActive("italic"),
      underline: e.isActive("underline"),
      strike: e.isActive("strike"),
      code: e.isActive("code"),
      link: e.isActive("link"),
      highlight: e.isActive("highlight"),
      superscript: e.isActive("superscript"),
      subscript: e.isActive("subscript"),
      // Inline math
      inlineMath: e.isActive("inlineMath"),
      // Table context
      inTable: e.isActive("table"),
      canAddRowBefore: e.can().addRowBefore(),
      canAddRowAfter: e.can().addRowAfter(),
      canAddColBefore: e.can().addColumnBefore(),
      canAddColAfter: e.can().addColumnAfter(),
      canDeleteRow: e.can().deleteRow(),
      canDeleteCol: e.can().deleteColumn(),
      canDeleteTable: e.can().deleteTable(),
      // Column alignment (reads from whichever cell type is active)
      cellAlign: e.getAttributes("tableCell").align ?? e.getAttributes("tableHeader").align ?? null,
    }),
  });

  const setLink = () => {
    const previousUrl = editor.getAttributes("link").href as string | undefined;
    const url = window.prompt("URL", previousUrl ?? "https://");
    if (url === null) return;
    if (url === "") {
      editor.chain().focus().extendMarkRange("link").unsetLink().run();
      return;
    }
    editor.chain().focus().extendMarkRange("link").setLink({ href: url }).run();
  };

  return (
    <BubbleMenu
      editor={editor}
      className="flex items-center gap-0.5 rounded-md border border-[var(--color-border)] bg-[var(--color-paper)] p-1 shadow-lg"
      options={{ placement: "top", offset: 8 }}
      shouldShow={({ editor: e, from, to }) =>
        from !== to || e.isActive("table") || e.isActive("inlineMath")
      }
    >
      {/* ── Text formatting ── */}
      <ToolbarButton
        label="Bold (Ctrl+B)"
        active={state.bold}
        onClick={() => editor.chain().focus().toggleBold().run()}
      >
        B
      </ToolbarButton>
      <ToolbarButton
        label="Italic (Ctrl+I)"
        active={state.italic}
        onClick={() => editor.chain().focus().toggleItalic().run()}
      >
        <span className="italic">I</span>
      </ToolbarButton>
      <ToolbarButton
        label="Underline (Ctrl+U)"
        active={state.underline}
        onClick={() => editor.chain().focus().toggleUnderline().run()}
      >
        <span className="underline">U</span>
      </ToolbarButton>
      <ToolbarButton
        label="Strikethrough (Ctrl+Shift+X)"
        active={state.strike}
        onClick={() => editor.chain().focus().toggleStrike().run()}
      >
        <span className="line-through">S</span>
      </ToolbarButton>
      <ToolbarButton
        label="Inline code (Ctrl+E)"
        active={state.code}
        onClick={() => editor.chain().focus().toggleCode().run()}
      >
        {"</>"}
      </ToolbarButton>
      <ToolbarButton label="Link (Ctrl+K)" active={state.link} onClick={setLink}>
        🔗
      </ToolbarButton>

      <Divider />

      <ToolbarButton
        label="Highlight (Ctrl+Shift+H)"
        active={state.highlight}
        onClick={() => editor.chain().focus().toggleMark("highlight").run()}
      >
        <span className="rounded px-0.5" style={{ background: "rgba(253,224,71,0.6)" }}>H</span>
      </ToolbarButton>
      <ToolbarButton
        label="Superscript"
        active={state.superscript}
        onClick={() => editor.chain().focus().toggleMark("superscript").run()}
      >
        x<sup style={{ fontSize: "0.65em" }}>²</sup>
      </ToolbarButton>
      <ToolbarButton
        label="Subscript"
        active={state.subscript}
        onClick={() => editor.chain().focus().toggleMark("subscript").run()}
      >
        x<sub style={{ fontSize: "0.65em" }}>₂</sub>
      </ToolbarButton>

      {/* ── Remove math (visible only when cursor is inside an inline math range) ── */}
      {state.inlineMath && (
        <>
          <Divider />
          <ToolbarButton
            label="Remove math"
            onClick={() =>
              editor.chain().focus().extendMarkRange("inlineMath").unsetMark("inlineMath").run()
            }
          >
            <span className="font-mono line-through" style={{ fontSize: "0.75em" }}>$</span>
          </ToolbarButton>
        </>
      )}

      {/* ── Table controls (visible only when cursor is in a table) ── */}
      {state.inTable && (
        <>
          <Divider />

          {/* Column alignment — applies to the entire column (GFM is column-level) */}
          <ToolbarButton
            label="Align Left"
            active={state.cellAlign === "left"}
            onClick={() => editor.chain().focus().setColumnAlign(state.cellAlign === "left" ? null : "left").run()}
          >
            <IconAlignLeft />
          </ToolbarButton>
          <ToolbarButton
            label="Align Center"
            active={state.cellAlign === "center"}
            onClick={() => editor.chain().focus().setColumnAlign(state.cellAlign === "center" ? null : "center").run()}
          >
            <IconAlignCenter />
          </ToolbarButton>
          <ToolbarButton
            label="Align Right"
            active={state.cellAlign === "right"}
            onClick={() => editor.chain().focus().setColumnAlign(state.cellAlign === "right" ? null : "right").run()}
          >
            <IconAlignRight />
          </ToolbarButton>

          <Divider />

          <ToolbarButton
            label="Row Above"
            disabled={!state.canAddRowBefore}
            onClick={() => editor.chain().focus().addRowBefore().run()}
          >
            <IconRowAbove />
          </ToolbarButton>
          <ToolbarButton
            label="Row Below"
            disabled={!state.canAddRowAfter}
            onClick={() => editor.chain().focus().addRowAfter().run()}
          >
            <IconRowBelow />
          </ToolbarButton>
          <ToolbarButton
            label="Column Left"
            disabled={!state.canAddColBefore}
            onClick={() => editor.chain().focus().addColumnBefore().run()}
          >
            <IconColLeft />
          </ToolbarButton>
          <ToolbarButton
            label="Column Right"
            disabled={!state.canAddColAfter}
            onClick={() => editor.chain().focus().addColumnAfter().run()}
          >
            <IconColRight />
          </ToolbarButton>

          <Divider />

          <ToolbarButton
            label="Delete Row"
            disabled={!state.canDeleteRow}
            onClick={() => editor.chain().focus().deleteRow().run()}
          >
            <IconDeleteRow />
          </ToolbarButton>
          <ToolbarButton
            label="Delete Column"
            disabled={!state.canDeleteCol}
            onClick={() => editor.chain().focus().deleteColumn().run()}
          >
            <IconDeleteCol />
          </ToolbarButton>
          <ToolbarButton
            label="Delete Table"
            disabled={!state.canDeleteTable}
            onClick={() => editor.chain().focus().deleteTable().run()}
          >
            <IconDeleteTable />
          </ToolbarButton>
        </>
      )}
    </BubbleMenu>
  );
}
