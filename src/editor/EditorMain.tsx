import { useContext } from "react";
import { EditorContent } from "@tiptap/react";
import { EditorContext } from "./EditorContext";
import { EditorToolbar } from "./Toolbar";
import { SourcePane } from "./SourcePane";
import { useTabStore, useUIStore } from "@/stores";

export function EditorMain() {
  const editor = useContext(EditorContext);
  const sourceMode = useUIStore((s) => s.sourceMode);
  const activeTabId = useTabStore((s) => s.activeTabId);

  return (
    <div className="relative flex flex-1 flex-col overflow-hidden bg-[var(--color-page-bg)]">
      {/* WYSIWYG layer — always mounted, hidden in source mode */}
      <div className={`flex flex-1 flex-col overflow-y-auto ${sourceMode ? "hidden" : ""}`}>
        {editor && <EditorToolbar editor={editor} />}
        <div className="w-full py-8">
          <div className="doc-page">
            <EditorContent editor={editor} />
          </div>
        </div>
      </div>

      {/* Source mode pane — tab-aware: passes activeTabId for timer cancellation and store reads */}
      {editor && <SourcePane editor={editor} active={sourceMode} activeTabId={activeTabId} />}
    </div>
  );
}
