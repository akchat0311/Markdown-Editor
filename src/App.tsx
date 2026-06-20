import { useEffect, useRef, useCallback, useState } from "react";
import { useEditor } from "@tiptap/react";
import { EditorContext } from "@/editor/EditorContext";
import { EditorMain } from "@/editor/EditorMain";
import { createEditorExtensions } from "@/editor/extensions";
import { parseMarkdownToDoc, serializeDocToMarkdown } from "@/markdown";
import { useTabStore, useUIStore, getActiveTab } from "@/stores";
import { useToastStore } from "@/stores/toastStore";
import { Header } from "@/layout/Header";
import { TabBar } from "@/layout/TabBar";
import { StatusBar } from "@/layout/StatusBar";
import { Toaster } from "@/layout/Toast";
import { GlobalSearch } from "@/search/GlobalSearch";
import { useAutosave } from "@/persistence/useAutosave";
import { openMarkdownFile, saveMarkdownFile } from "@/persistence/fileAccess";
import { addRecentFile, removeRecentFile } from "@/persistence/recentFiles";
import type { RecentFile } from "@/persistence/recentFiles";
import { ResizeHandle } from "@/layout/ResizeHandle";
import { OutlinePanel } from "@/layout/OutlinePanel";
import { INITIAL_MARKDOWN } from "@/stores/tabStore";

// Module-level stable extensions prevent Tiptap compareOptions from
// calling setOptions() synchronously during React's render phase.
const EDITOR_EXTENSIONS = createEditorExtensions();

interface CloseConfirm {
  tabId: string;
  tabTitle: string;
}

export default function App() {
  const theme = useUIStore((s) => s.theme);
  const sidebarOpen = useUIStore((s) => s.sidebarOpen);
  const sidebarWidth = useUIStore((s) => s.sidebarWidth);
  const adjustSidebar = useUIStore((s) => s.adjustSidebar);
  const sourceMode = useUIStore((s) => s.sourceMode);
  const toggleSourceMode = useUIStore((s) => s.toggleSourceMode);

  const tabState = useTabStore();
  const activeTab = getActiveTab(tabState);
  const updateActiveTab = useTabStore((s) => s.updateActiveTab);
  const updateActiveTabRef = useRef(updateActiveTab);
  updateActiveTabRef.current = updateActiveTab;

  const sourceModeRef = useRef(sourceMode);
  sourceModeRef.current = sourceMode;

  const isLoadingContentRef = useRef(false);

  const [closeConfirm, setCloseConfirm] = useState<CloseConfirm | null>(null);

  const initialDoc = parseMarkdownToDoc(activeTab?.markdown ?? INITIAL_MARKDOWN);

  const editor = useEditor({
    extensions: EDITOR_EXTENSIONS,
    content: initialDoc,
    onUpdate: ({ editor }) => {
      if (sourceModeRef.current) return;
      if (isLoadingContentRef.current) return;
      const json = editor.getJSON();
      queueMicrotask(() => {
        updateActiveTabRef.current({
          markdown: serializeDocToMarkdown(json),
          isDirty: true,
        });
      });
    },
    editorProps: { attributes: { spellcheck: "true" } },
  });

  // Switch editor content when active tab changes
  const prevTabIdRef = useRef(activeTab?.id);
  useEffect(() => {
    if (!editor || !activeTab) return;
    if (prevTabIdRef.current === activeTab.id) return;
    prevTabIdRef.current = activeTab.id;
    isLoadingContentRef.current = true;
    editor.commands.setContent(parseMarkdownToDoc(activeTab.markdown));
    setTimeout(() => { isLoadingContentRef.current = false; }, 0);
  }, [editor, activeTab]);

  const { flush } = useAutosave();

  // ── File operations ──────────────────────────────────────────────────────────

  const handleNewFile = useCallback(() => {
    useTabStore.getState().newUntitledTab();
    // Tab switch effect loads content; focus editor after it settles
    setTimeout(() => editor?.commands.focus("end"), 50);
  }, [editor]);

  const handleOpen = useCallback(async () => {
    let result;
    try {
      result = await openMarkdownFile();
    } catch {
      useToastStore.getState().show("Could not open file.", "error");
      return;
    }
    if (!result) return;

    // Switch to existing tab if already open (matched by filename)
    const existing = useTabStore.getState().tabs.find((t) => t.fileName === result.name);
    if (existing) {
      useTabStore.getState().setActiveTab(existing.id);
      return;
    }

    const tabId = useTabStore.getState().newTab(
      result.content,
      result.name.replace(/\.md$/i, ""),
      result.name,
    );
    useTabStore.getState().setActiveTab(tabId);
    if (result.handle) {
      useTabStore.getState().updateActiveTab({ fileHandle: result.handle });
    }

    if (editor) {
      isLoadingContentRef.current = true;
      editor.commands.setContent(parseMarkdownToDoc(result.content));
      setTimeout(() => { isLoadingContentRef.current = false; }, 0);
    }

    await addRecentFile({
      name: result.name,
      lastOpened: Date.now(),
      handle: result.handle ?? undefined,
    });
  }, [editor]);

  const handleSave = useCallback(async () => {
    const state = useTabStore.getState();
    const tab = getActiveTab(state);
    if (!tab) return;

    try {
      const handle = await saveMarkdownFile(
        tab.markdown,
        tab.fileHandle ?? null,
        tab.fileName ?? `${tab.title}.md`,
      );

      if (handle) {
        useTabStore.getState().updateActiveTab({
          fileHandle: handle,
          fileName: handle.name,
          title: handle.name.replace(/\.md$/i, ""),
          isDirty: false,
          lastSavedAt: Date.now(),
        });
        await addRecentFile({ name: handle.name, lastOpened: Date.now(), handle });
      } else if (!("showSaveFilePicker" in window)) {
        // Download fallback — treat as saved
        useTabStore.getState().markTabSaved();
      }
      // If null + picker exists → user aborted; leave dirty
    } catch {
      useToastStore.getState().show("Failed to save file.", "error");
    }

    await flush();
  }, [flush]);

  const handleSaveAs = useCallback(async () => {
    const state = useTabStore.getState();
    const tab = getActiveTab(state);
    if (!tab) return;

    try {
      // Pass null to force Save As picker regardless of existing handle
      const handle = await saveMarkdownFile(
        tab.markdown,
        null,
        tab.fileName ?? `${tab.title}.md`,
      );

      if (handle) {
        useTabStore.getState().updateActiveTab({
          fileHandle: handle,
          fileName: handle.name,
          title: handle.name.replace(/\.md$/i, ""),
          isDirty: false,
          lastSavedAt: Date.now(),
        });
        await addRecentFile({ name: handle.name, lastOpened: Date.now(), handle });
      }
    } catch {
      useToastStore.getState().show("Failed to save file.", "error");
    }

    await flush();
  }, [flush]);

  const handleOpenRecent = useCallback(async (recent: RecentFile) => {
    // Switch to existing open tab if already loaded
    const existing = useTabStore.getState().tabs.find((t) => t.fileName === recent.name);
    if (existing) {
      useTabStore.getState().setActiveTab(existing.id);
      return;
    }

    if (recent.handle) {
      try {
        const file = await recent.handle.getFile();
        const content = await file.text();
        const tabId = useTabStore.getState().newTab(
          content,
          recent.name.replace(/\.md$/i, ""),
          recent.name,
        );
        useTabStore.getState().setActiveTab(tabId);
        useTabStore.getState().updateActiveTab({ fileHandle: recent.handle });

        if (editor) {
          isLoadingContentRef.current = true;
          editor.commands.setContent(parseMarkdownToDoc(content));
          setTimeout(() => { isLoadingContentRef.current = false; }, 0);
        }

        await addRecentFile({ ...recent, lastOpened: Date.now() });
        return;
      } catch {
        // Handle expired or file moved
      }
    }

    useToastStore.getState().show(
      `Could not reopen "${recent.name}". Try File → Open.`,
      "error",
    );
    await removeRecentFile(recent.name);
  }, [editor]);

  const handleExportMarkdown = useCallback(async () => {
    const tab = getActiveTab(useTabStore.getState());
    if (!tab) return;
    const { downloadMarkdown } = await import("@/persistence/fileAccess");
    downloadMarkdown(tab.markdown, `${tab.title}.md`);
  }, []);

  // ── Close tab with dirty guard ───────────────────────────────────────────────

  const handleRequestClose = useCallback((tabId: string) => {
    const tab = useTabStore.getState().tabs.find((t) => t.id === tabId);
    if (!tab) return;
    if (tab.isDirty) {
      setCloseConfirm({ tabId, tabTitle: tab.title });
    } else {
      useTabStore.getState().closeTab(tabId);
    }
  }, []);

  const handleConfirmClose = useCallback(async (action: "save" | "discard" | "cancel") => {
    if (!closeConfirm) return;
    if (action === "cancel") {
      setCloseConfirm(null);
      return;
    }
    if (action === "save") {
      const tab = useTabStore.getState().tabs.find((t) => t.id === closeConfirm.tabId);
      if (tab) {
        try {
          const handle = await saveMarkdownFile(
            tab.markdown,
            tab.fileHandle ?? null,
            tab.fileName ?? `${tab.title}.md`,
          );
          if (handle) {
            useTabStore.getState().updateTab(closeConfirm.tabId, {
              fileHandle: handle,
              fileName: handle.name,
              title: handle.name.replace(/\.md$/i, ""),
              isDirty: false,
              lastSavedAt: Date.now(),
            });
          }
        } catch {
          useToastStore.getState().show("Save failed. Closing anyway.", "error");
        }
      }
    }
    useTabStore.getState().closeTab(closeConfirm.tabId);
    setCloseConfirm(null);
  }, [closeConfirm]);

  // ── Keyboard shortcuts ───────────────────────────────────────────────────────

  const handlersRef = useRef({
    handleNewFile,
    handleOpen,
    handleSave,
    handleSaveAs,
    toggleSourceMode,
    handleRequestClose,
  });
  useEffect(() => {
    handlersRef.current = {
      handleNewFile,
      handleOpen,
      handleSave,
      handleSaveAs,
      toggleSourceMode,
      handleRequestClose,
    };
  });

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;

      if (e.key === "/") {
        e.preventDefault();
        handlersRef.current.toggleSourceMode();
        return;
      }
      if (e.key === "n") {
        e.preventDefault();
        handlersRef.current.handleNewFile();
        return;
      }
      if (e.key === "o") {
        e.preventDefault();
        handlersRef.current.handleOpen();
        return;
      }
      if (e.key.toLowerCase() === "s") {
        e.preventDefault();
        if (e.shiftKey) {
          handlersRef.current.handleSaveAs();
        } else {
          handlersRef.current.handleSave();
        }
        return;
      }
      if (e.key === "w") {
        e.preventDefault();
        const { activeTabId } = useTabStore.getState();
        handlersRef.current.handleRequestClose(activeTabId);
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  // Apply theme class to <html>
  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
  }, [theme]);

  return (
    <EditorContext.Provider value={editor}>
      <GlobalSearch />
      <Toaster />

      <div className="flex h-screen flex-col overflow-hidden bg-[var(--color-page-bg)] text-[var(--color-text)]">
        <Header
          onNewFile={handleNewFile}
          onOpen={handleOpen}
          onSave={handleSave}
          onSaveAs={handleSaveAs}
          onCloseTab={() => handleRequestClose(useTabStore.getState().activeTabId)}
          onOpenRecent={handleOpenRecent}
          onExportMarkdown={handleExportMarkdown}
          onSearch={() =>
            document.dispatchEvent(
              new KeyboardEvent("keydown", { key: "k", metaKey: true, bubbles: true })
            )
          }
        />

        <TabBar onRequestClose={handleRequestClose} />

        <div className="flex min-h-0 flex-1">
          {sidebarOpen && (
            <>
              <OutlinePanel width={sidebarWidth} />
              <ResizeHandle onDelta={adjustSidebar} />
            </>
          )}
          <EditorMain />
        </div>

        <StatusBar />
      </div>

      {/* Unsaved changes dialog */}
      {closeConfirm && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
          onMouseDown={(e) => e.target === e.currentTarget && handleConfirmClose("cancel")}
        >
          <div className="w-80 rounded-xl border border-[var(--color-border)] bg-[var(--color-paper)] p-6 shadow-2xl">
            <p className="mb-1 text-sm font-semibold text-[var(--color-text)]">Unsaved changes</p>
            <p className="mb-5 text-sm text-[var(--color-muted)]">
              Save changes to &ldquo;{closeConfirm.tabTitle}&rdquo; before closing?
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => handleConfirmClose("cancel")}
                className="rounded px-3 py-1.5 text-sm text-[var(--color-muted)] hover:bg-[var(--color-border)] transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => handleConfirmClose("discard")}
                className="rounded px-3 py-1.5 text-sm text-[var(--color-muted)] hover:bg-[var(--color-border)] transition-colors"
              >
                Discard
              </button>
              <button
                onClick={() => handleConfirmClose("save")}
                className="rounded bg-[var(--color-accent)] px-3 py-1.5 text-sm font-medium text-white hover:opacity-90 transition-opacity"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </EditorContext.Provider>
  );
}
