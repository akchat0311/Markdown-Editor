import { useState } from "react";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { useTabStore, getActiveTab } from "@/stores";

interface WorkspacePanelProps {
  onOpenFile: (fileName: string) => void;
  onOpenFolder: () => void;
}

export function WorkspacePanel({ onOpenFile, onOpenFolder }: WorkspacePanelProps) {
  const [collapsed, setCollapsed] = useState(false);
  const { dirName, markdownFiles } = useWorkspaceStore();
  const activeFileName = useTabStore((s) => getActiveTab(s)?.fileName);

  return (
    <div className="flex shrink-0 flex-col border-b border-[var(--color-border)]">
      {/* Section header */}
      <div className="flex h-9 shrink-0 items-center gap-1 px-3">
        <button
          onClick={() => setCollapsed((c) => !c)}
          className="flex min-w-0 flex-1 items-center gap-1 text-left"
          title={collapsed ? "Expand workspace" : "Collapse workspace"}
        >
          <svg
            width="8"
            height="8"
            viewBox="0 0 8 8"
            fill="currentColor"
            className="shrink-0 text-[var(--color-muted)] transition-transform duration-100"
            style={{ transform: collapsed ? "rotate(0deg)" : "rotate(90deg)" }}
          >
            <path d="M2 1l4 3-4 3V1z" />
          </svg>
          <span
            className="min-w-0 truncate text-[10px] font-semibold uppercase tracking-widest text-[var(--color-muted)]"
            title={dirName}
          >
            {dirName}
          </span>
        </button>

        {/* Open / change folder */}
        <button
          onClick={onOpenFolder}
          title="Open a different folder (⌘⇧O)"
          className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-[var(--color-muted)] transition-colors hover:bg-[var(--color-border)] hover:text-[var(--color-text)]"
        >
          <svg
            width="12"
            height="12"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M2 3h4l1.5 1.5H14v8H2V3Z" />
          </svg>
        </button>
      </div>

      {/* File list */}
      {!collapsed && (
        <div className="max-h-48 overflow-y-auto pb-1">
          {markdownFiles.length === 0 && (
            <p className="px-4 py-3 text-center text-[10px] text-[var(--color-muted)]">
              No markdown files found.
            </p>
          )}
          {markdownFiles.map((name) => {
            const isActive = name === activeFileName;
            return (
              <button
                key={name}
                onClick={() => onOpenFile(name)}
                title={name}
                className={[
                  "flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs transition-colors",
                  isActive
                    ? "bg-[var(--color-accent)]/10 font-medium text-[var(--color-accent)]"
                    : "text-[var(--color-text)] hover:bg-[var(--color-border)]",
                ].join(" ")}
              >
                {/* File icon */}
                <svg
                  width="12"
                  height="12"
                  viewBox="0 0 13 13"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.4"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="shrink-0 opacity-50"
                >
                  <path d="M2 1h6l3 3v8H2V1z" />
                  <path d="M8 1v3h3" />
                </svg>
                <span className="min-w-0 truncate">{name}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
