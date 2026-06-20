import { useState, useEffect, useRef } from "react";
import { useUIStore, useTabStore, getActiveTab } from "@/stores";
import { getRecentFiles } from "@/persistence/recentFiles";
import type { RecentFile } from "@/persistence/recentFiles";

// ── Icons ────────────────────────────────────────────────────────────────────

function IconSidebar() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
      <rect x="1" y="1" width="5" height="14" rx="1" opacity="0.4" />
      <rect x="8" y="1" width="7" height="14" rx="1" />
    </svg>
  );
}

function IconMoon() {
  return (
    <svg width="15" height="15" viewBox="0 0 15 15" fill="currentColor">
      <path d="M2.89 1.9A6.5 6.5 0 1 0 13.1 12.1a5 5 0 0 1-10.2-10.2Z" />
    </svg>
  );
}

function IconSun() {
  return (
    <svg width="15" height="15" viewBox="0 0 15 15" fill="currentColor">
      <circle cx="7.5" cy="7.5" r="2.5" />
      <line stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" x1="7.5" y1="1" x2="7.5" y2="3" />
      <line stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" x1="7.5" y1="12" x2="7.5" y2="14" />
      <line stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" x1="1" y1="7.5" x2="3" y2="7.5" />
      <line stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" x1="12" y1="7.5" x2="14" y2="7.5" />
      <line stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" x1="3.05" y1="3.05" x2="4.46" y2="4.46" />
      <line stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" x1="10.54" y1="10.54" x2="11.95" y2="11.95" />
      <line stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" x1="10.54" y1="4.46" x2="11.95" y2="3.05" />
      <line stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" x1="3.05" y1="11.95" x2="4.46" y2="10.54" />
    </svg>
  );
}

// ── File menu ────────────────────────────────────────────────────────────────

interface FileMenuProps {
  onNewFile: () => void;
  onOpen: () => void;
  onSave: () => void;
  onSaveAs: () => void;
  onCloseTab: () => void;
  onOpenRecent: (r: RecentFile) => void;
}

function Separator() {
  return <div className="my-1 h-px bg-[var(--color-border)]" />;
}

function FileMenu({ onNewFile, onOpen, onSave, onSaveAs, onCloseTab, onOpenRecent }: FileMenuProps) {
  const [open, setOpen] = useState(false);
  const [recentFiles, setRecentFiles] = useState<RecentFile[]>([]);
  const menuRef = useRef<HTMLDivElement>(null);
  const tabCount = useTabStore((s) => s.tabs.length);

  useEffect(() => {
    if (!open) return;
    getRecentFiles().then(setRecentFiles).catch(() => {});
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const item = (
    label: string,
    shortcut: string,
    onClick: () => void,
    disabled = false,
  ) => (
    <button
      key={label}
      disabled={disabled}
      onMouseDown={(e) => {
        e.preventDefault();
        if (!disabled) { onClick(); setOpen(false); }
      }}
      className={[
        "flex w-full items-center justify-between gap-4 px-3 py-1.5 text-left text-xs",
        disabled
          ? "cursor-not-allowed text-[var(--color-muted)] opacity-50"
          : "text-[var(--color-text)] hover:bg-[var(--color-border)]",
      ].join(" ")}
    >
      <span>{label}</span>
      <kbd className="font-mono text-[10px] text-[var(--color-muted)]">{shortcut}</kbd>
    </button>
  );

  return (
    <div ref={menuRef} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className={[
          "flex h-7 items-center gap-1 rounded px-2 text-xs font-medium transition-colors",
          open
            ? "bg-[var(--color-border)] text-[var(--color-text)]"
            : "text-[var(--color-muted)] hover:bg-[var(--color-border)] hover:text-[var(--color-text)]",
        ].join(" ")}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        File
        <svg width="9" height="9" viewBox="0 0 9 9" fill="currentColor">
          <path d="M1 3l3.5 3L8 3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" fill="none" />
        </svg>
      </button>

      {open && (
        <div
          role="menu"
          className="absolute left-0 top-full z-50 mt-1 w-56 rounded-lg border border-[var(--color-border)] bg-[var(--color-paper)] py-1 shadow-xl"
        >
          {item("New File", "⌘N", onNewFile)}
          {item("Open File…", "⌘O", onOpen)}
          <Separator />
          {item("Save", "⌘S", onSave)}
          {item("Save As…", "⇧⌘S", onSaveAs)}
          {recentFiles.length > 0 && (
            <>
              <Separator />
              <p className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--color-muted)]">
                Recent
              </p>
              {recentFiles.map((rf) => (
                <button
                  key={rf.name}
                  onMouseDown={(e) => { e.preventDefault(); onOpenRecent(rf); setOpen(false); }}
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-[var(--color-text)] hover:bg-[var(--color-border)]"
                >
                  <svg width="11" height="11" viewBox="0 0 15 15" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <path d="M2 3h4l1.5 1.5H13v8H2V3Z" />
                  </svg>
                  <span className="truncate">{rf.name}</span>
                </button>
              ))}
            </>
          )}
          <Separator />
          {item("Close Tab", "⌘W", onCloseTab, tabCount <= 1)}
        </div>
      )}
    </div>
  );
}

// ── Header ───────────────────────────────────────────────────────────────────

export interface HeaderProps {
  onNewFile: () => void;
  onOpen: () => void;
  onSave: () => void;
  onSaveAs: () => void;
  onCloseTab: () => void;
  onOpenRecent: (r: RecentFile) => void;
  onExportMarkdown?: () => void;
  onSearch?: () => void;
}

export function Header({
  onNewFile,
  onOpen,
  onSave,
  onSaveAs,
  onCloseTab,
  onOpenRecent,
  onExportMarkdown,
  onSearch,
}: HeaderProps) {
  const [exportOpen, setExportOpen] = useState(false);
  const { theme, toggleTheme, sidebarOpen, toggleSidebar } = useUIStore();
  const exportRef = useRef<HTMLDivElement>(null);

  const tabState = useTabStore();
  const activeTab = getActiveTab(tabState);
  const setTabTitle = useTabStore((s) => s.setTabTitle);

  // Close export dropdown on outside click
  useEffect(() => {
    if (!exportOpen) return;
    const handler = (e: MouseEvent) => {
      if (!exportRef.current?.contains(e.target as Node)) setExportOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [exportOpen]);

  const btnCls =
    "flex h-7 w-7 items-center justify-center rounded text-[var(--color-muted)] " +
    "hover:bg-[var(--color-border)] hover:text-[var(--color-text)] transition-colors";

  return (
    <header className="flex h-11 shrink-0 items-center gap-1 border-b border-[var(--color-border)] px-2">
      {/* Sidebar toggle */}
      <button
        onClick={toggleSidebar}
        className={`${btnCls} ${sidebarOpen ? "text-[var(--color-text)]" : ""}`}
        title={sidebarOpen ? "Hide sidebar" : "Show sidebar"}
      >
        <IconSidebar />
      </button>

      <div className="mx-1 h-5 w-px bg-[var(--color-border)]" />

      {/* File menu */}
      <FileMenu
        onNewFile={onNewFile}
        onOpen={onOpen}
        onSave={onSave}
        onSaveAs={onSaveAs}
        onCloseTab={onCloseTab}
        onOpenRecent={onOpenRecent}
      />

      <div className="mx-1 h-5 w-px bg-[var(--color-border)]" />

      {/* Document title input */}
      <input
        value={activeTab?.title ?? ""}
        onChange={(e) => setTabTitle(e.target.value)}
        className="min-w-0 flex-1 bg-transparent text-sm font-medium text-[var(--color-text)] outline-none placeholder:text-[var(--color-muted)]"
        placeholder="Untitled"
        spellCheck={false}
      />

      {activeTab?.isDirty && (
        <span className="flex shrink-0 items-center gap-1 text-xs text-[var(--color-muted)]">
          <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
          Unsaved
        </span>
      )}

      {/* Search button */}
      <button
        className="flex h-7 shrink-0 items-center gap-2 rounded border border-[var(--color-border)] px-2 text-xs text-[var(--color-muted)] hover:border-[var(--color-accent)] hover:text-[var(--color-text)] transition-colors"
        onClick={onSearch}
        title="Search (⌘K)"
      >
        <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
          <circle cx="7" cy="7" r="5" />
          <path d="m10.5 10.5 3 3" />
        </svg>
        <span>Search</span>
        <kbd className="rounded bg-[var(--color-border)] px-1 font-mono text-[10px]">⌘K</kbd>
      </button>

      <div className="mx-1 h-5 w-px bg-[var(--color-border)]" />

      {/* Export dropdown */}
      <div ref={exportRef} className="relative">
        <button
          className={btnCls}
          title="Export"
          onClick={() => setExportOpen((o) => !o)}
          aria-label="Export"
        >
          <svg width="15" height="15" viewBox="0 0 15 15" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M7.5 1v9M4 7l3.5 3L11 7M2 11v2h11v-2" />
          </svg>
        </button>
        {exportOpen && (
          <div className="absolute right-0 top-full z-50 mt-1 w-48 rounded-lg border border-[var(--color-border)] bg-[var(--color-paper)] py-1 shadow-lg">
            <button
              className="w-full px-3 py-1.5 text-left text-xs hover:bg-[var(--color-border)]"
              onClick={() => { onExportMarkdown?.(); setExportOpen(false); }}
            >
              Export Markdown (.md)
            </button>
            <button
              disabled
              title="Coming soon"
              className="w-full cursor-not-allowed px-3 py-1.5 text-left text-xs text-[var(--color-muted)] opacity-50"
            >
              Export DOCX — soon
            </button>
            <button
              disabled
              title="Coming soon"
              className="w-full cursor-not-allowed px-3 py-1.5 text-left text-xs text-[var(--color-muted)] opacity-50"
            >
              Export PDF — soon
            </button>
          </div>
        )}
      </div>

      {/* Theme toggle */}
      <button onClick={toggleTheme} className={btnCls} title="Toggle theme">
        {theme === "light" ? <IconMoon /> : <IconSun />}
      </button>
    </header>
  );
}
