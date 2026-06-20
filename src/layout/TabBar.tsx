import { useTabStore } from "@/stores";

interface TabBarProps {
  onRequestClose?: (tabId: string) => void;
}

export function TabBar({ onRequestClose }: TabBarProps = {}) {
  const tabs = useTabStore((s) => s.tabs);
  const activeTabId = useTabStore((s) => s.activeTabId);
  const setActiveTab = useTabStore((s) => s.setActiveTab);
  const closeTab = useTabStore((s) => s.closeTab);
  const newUntitledTab = useTabStore((s) => s.newUntitledTab);

  const handleClose = (tabId: string) => {
    if (onRequestClose) {
      onRequestClose(tabId);
    } else {
      closeTab(tabId);
    }
  };

  return (
    <div className="flex h-9 shrink-0 items-end overflow-x-auto border-b border-[var(--color-border)] bg-[var(--color-page-bg)] px-2 gap-0.5">
      {tabs.map((tab) => {
        const active = tab.id === activeTabId;
        return (
          <div
            key={tab.id}
            className={[
              "group relative flex h-8 min-w-0 max-w-[180px] shrink-0 cursor-pointer items-center gap-1.5 rounded-t border-x border-t px-3 text-xs select-none transition-colors",
              active
                ? "border-[var(--color-border)] bg-[var(--color-paper)] text-[var(--color-text)] font-medium"
                : "border-transparent bg-transparent text-[var(--color-muted)] hover:bg-[var(--color-border)] hover:text-[var(--color-text)]",
            ].join(" ")}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.isDirty && (
              <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-400" />
            )}
            <span className="truncate">{tab.title || "Untitled"}</span>
            {tabs.length > 1 && (
              <button
                className="ml-auto flex h-4 w-4 shrink-0 items-center justify-center rounded text-[var(--color-muted)] opacity-0 group-hover:opacity-100 hover:bg-[var(--color-border)] hover:text-[var(--color-text)]"
                onClick={(e) => { e.stopPropagation(); handleClose(tab.id); }}
                aria-label="Close tab"
              >
                <svg width="8" height="8" viewBox="0 0 8 8" fill="currentColor">
                  <path d="M1 1l6 6M7 1L1 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
              </button>
            )}
          </div>
        );
      })}
      <button
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded text-[var(--color-muted)] hover:bg-[var(--color-border)] hover:text-[var(--color-text)] transition-colors"
        onClick={() => newUntitledTab()}
        aria-label="New tab"
        title="New tab (⌘N)"
      >
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
          <path d="M6 1v10M1 6h10" />
        </svg>
      </button>
    </div>
  );
}
