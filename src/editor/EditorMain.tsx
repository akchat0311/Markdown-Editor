import { useCallback, useContext, useState } from "react";
import { EditorContent } from "@tiptap/react";
import { EditorContext } from "./EditorContext";
import { EditorToolbar } from "./Toolbar";
import { SourcePane } from "./SourcePane";
import { ContextMenu } from "./components/ContextMenu";
import { useUIStore } from "@/stores";

interface ContextMenuState {
  x: number;
  y: number;
}

export function EditorMain() {
  const editor = useContext(EditorContext);
  const sourceMode = useUIStore((s) => s.sourceMode);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);

  const handleContextMenu = useCallback(
    (e: React.MouseEvent) => {
      if (!editor) return;
      e.preventDefault();
      setContextMenu({ x: e.clientX, y: e.clientY });
    },
    [editor]
  );

  const closeContextMenu = useCallback(() => setContextMenu(null), []);

  return (
    <div className="relative flex flex-1 flex-col overflow-hidden bg-[var(--color-page-bg)]">
      {/* WYSIWYG layer — always mounted, hidden in source mode */}
      <div className={`flex flex-1 flex-col overflow-y-auto ${sourceMode ? "hidden" : ""}`}>
        {editor && <EditorToolbar editor={editor} />}
        <div
          className="mx-auto w-full max-w-[860px] py-10 px-8"
          onContextMenu={handleContextMenu}
        >
          <div className="doc-page">
            <EditorContent editor={editor} />
          </div>
        </div>
      </div>

      {/* Source mode pane — synchronized textarea, Tiptap stays mounted above */}
      {editor && <SourcePane editor={editor} active={sourceMode} />}

      {/* Right-click context menu */}
      {editor && contextMenu && (
        <ContextMenu
          editor={editor}
          x={contextMenu.x}
          y={contextMenu.y}
          onClose={closeContextMenu}
        />
      )}
    </div>
  );
}
