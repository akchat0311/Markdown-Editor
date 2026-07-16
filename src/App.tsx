import { useEffect, useRef, useCallback, useState } from "react";
import { useEditor } from "@tiptap/react";
import { EditorContext } from "@/editor/EditorContext";
import { EditorMain } from "@/editor/EditorMain";
import { createEditorExtensions } from "@/editor/extensions";
import { parseMarkdownToDoc, serializeDocToMarkdown } from "@/markdown";
import { useTabStore, useUIStore, getActiveTab } from "@/stores";
import { useToastStore } from "@/stores/toastStore";
import { useStatusConfigStore } from "@/stores/statusConfigStore";
import { Header } from "@/layout/Header";
import { TabBar } from "@/layout/TabBar";
import { StatusBar } from "@/layout/StatusBar";
import { Toaster } from "@/layout/Toast";
import { GlobalSearch } from "@/search/GlobalSearch";
import { FindReplaceBar } from "@/layout/FindReplaceBar";
import { useAutosave } from "@/persistence/useAutosave";
import { openMarkdownFile, openDirectoryForWorkspace, openFileFromDirectory, scanDirectoryForMarkdown, writeToFileHandle, saveAsMarkdownFile } from "@/persistence/fileAccess";
import {
  saveWorkspaceDoc,
  loadWorkspaceDoc,
  clearWorkspaceDoc,
  checkHandlePermission,
  requestHandlePermission,
  checkDirHandlePermission,
  requestDirHandlePermission,
  readHandleContent,
} from "@/persistence/workspacePersistence";
import { openReviewFile, writeToReviewHandle, saveReviewFileAs } from "@/persistence/reviewFilePersistence";
import { openTraceabilityFile, writeToTraceabilityHandle, saveTraceabilityFileAs } from "@/persistence/traceabilityFilePersistence";
import { saveBundle } from "@/persistence/bundleSave";
import { COMPANION_REGISTRY } from "@/persistence/companionArtifact";
import type { CompanionArtifact } from "@/persistence/companionArtifact";
import { deriveReviewFileName, findReviewFile, deriveTraceabilityFileName, findTraceabilityFile } from "@/persistence/documentBundleService";
import { useReviewCommentsStore } from "@/stores/reviewCommentsStore";
import { useTraceabilityStore } from "@/stores/traceabilityStore";
import { useTraceabilityPanelStore } from "@/stores/traceabilityPanelStore";
import { TraceabilityDrawer } from "@/layout/TraceabilityDrawer";
import {
  stashTraceabilityState,
  restoreTraceabilityState,
  dropTraceabilityState,
  anyStashedTraceabilityDirty,
} from "@/services/traceabilityTabState";
import { useCommentDrawerStore } from "@/stores/commentDrawerStore";
import { useUserSettingsStore } from "@/stores/userSettingsStore";
import { CommentDrawer } from "@/layout/CommentDrawer";
import { UserNameForm } from "@/layout/UserNameForm";
import type { RequirementRecord } from "@/editor/utils/requirementOps";
import { addRecentFile, removeRecentFile } from "@/persistence/recentFiles";
import type { RecentFile } from "@/persistence/recentFiles";
import { ResizeHandle } from "@/layout/ResizeHandle";
import { OutlinePanel } from "@/layout/OutlinePanel";
import { Dashboard } from "@/layout/Dashboard";
import { WorkspacePanel } from "@/layout/WorkspacePanel";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { useConfigStore } from "@/stores/configStore";
import { deriveOutline, flattenOutline } from "@/editor/utils/deriveOutline";
import { collectReviewExportRows, generateReviewCsv, downloadReviewCsv } from "@/services/reviewExportService";
import { useDocumentValidation } from "@/editor/utils/useDocumentValidation";
import { useValidationStore } from "@/stores/validationStore";

// Module-level stable extensions prevent Tiptap compareOptions from
// calling setOptions() synchronously during React's render phase.
const EDITOR_EXTENSIONS = createEditorExtensions();

interface CloseConfirm {
  tabId: string;
  tabTitle: string;
}

export default function App() {
  // Load requirement status config and user settings once at startup.
  const loadStatusConfig = useStatusConfigStore((s) => s.load);
  useEffect(() => { loadStatusConfig(); }, [loadStatusConfig]);

  const loadUserSettings = useUserSettingsStore((s) => s.load);
  useEffect(() => { loadUserSettings(); }, [loadUserSettings]);

  const saveUserName = useUserSettingsStore((s) => s.save);
  const currentUserName = useUserSettingsStore((s) => s.userName);
  const [userNameModalOpen, setUserNameModalOpen] = useState(false);

  const handleChangeUserName = useCallback(() => {
    setUserNameModalOpen(true);
  }, []);

  const theme = useUIStore((s) => s.theme);
  const sidebarOpen = useUIStore((s) => s.sidebarOpen);
  const sidebarWidth = useUIStore((s) => s.sidebarWidth);
  const adjustSidebar = useUIStore((s) => s.adjustSidebar);
  const rightPanelWidth = useUIStore((s) => s.rightPanelWidth);
  const adjustRightPanel = useUIStore((s) => s.adjustRightPanel);
  const sourceMode = useUIStore((s) => s.sourceMode);
  const toggleSourceMode = useUIStore((s) => s.toggleSourceMode);
  const toggleSplitView = useUIStore((s) => s.toggleSplitView);

  const tabState = useTabStore();
  const activeTab = getActiveTab(tabState);
  const updateActiveTab = useTabStore((s) => s.updateActiveTab);
  const updateActiveTabRef = useRef(updateActiveTab);
  updateActiveTabRef.current = updateActiveTab;

  const sourceModeRef = useRef(sourceMode);
  sourceModeRef.current = sourceMode;

  const isLoadingContentRef = useRef(false);
  // Tracks the previous sourceMode value so the exit effect can distinguish
  // "just exited" from "was already false on mount / entering source mode".
  const prevSourceModeRef = useRef(sourceMode);

  const [closeConfirm, setCloseConfirm] = useState<CloseConfirm | null>(null);
  const [restorePending, setRestorePending] = useState<{
    handle: FileSystemFileHandle;
    fileName: string;
  } | null>(null);
  const [findOpen, setFindOpen] = useState(false);
  const [findShowReplace, setFindShowReplace] = useState(false);
  const [activeWorkspace, setActiveWorkspace] = useState<"editor" | "dashboard">("editor");

  const initialDoc = parseMarkdownToDoc(activeTab?.markdown ?? "");

  const editor = useEditor({
    extensions: EDITOR_EXTENSIONS,
    content: initialDoc,
    onUpdate: ({ editor }) => {
      if (sourceModeRef.current) return;
      if (isLoadingContentRef.current) return;
      // Capture the tab ID synchronously — by the time the microtask runs the
      // user may have already switched tabs, which would flip activeTabId.
      // Using updateActiveTab() in the microtask would write Tab A's content
      // into Tab B's store entry, causing silent data corruption on save.
      const state = useTabStore.getState();
      const tabId = state.activeTabId;
      if (state.tabs.find((t) => t.id === tabId)?.isReadOnly) return;
      const json = editor.getJSON();
      queueMicrotask(() => {
        useTabStore.getState().updateTab(tabId, {
          markdown: serializeDocToMarkdown(json),
          isDirty: true,
        });
      });
    },
    editorProps: { attributes: { spellcheck: "true" } },
  });

  // Switch editor content when active tab changes.
  // setContent is deferred via setTimeout so it runs after React has fully
  // committed the tab-store update. Calling it synchronously inside useEffect
  // causes TipTap's ReactRenderer to invoke flushSync while React is still
  // flushing effects, which React 19 rejects with a lifecycle warning.
  const prevTabIdRef = useRef(activeTab?.id);
  useEffect(() => {
    if (!editor || !activeTab) return;
    if (prevTabIdRef.current === activeTab.id) return;

    const departingTabId = prevTabIdRef.current;
    prevTabIdRef.current = activeTab.id;

    // Synchronously flush the departing tab's current editor content to the
    // store before isLoadingContentRef blocks further onUpdate processing.
    // This closes the window between the last onUpdate microtask and the
    // setContent call below, ensuring we never lose the final edit of the
    // departing tab even if the microtask fix somehow doesn't cover a case.
    //
    // Guard: skip the flush when isLoadingContentRef is already true — that
    // means a previous tab switch started but its setContent was cancelled
    // (A→B→C rapid switch). The editor still holds the content from two
    // switches ago, so flushing here would corrupt the departing tab's store
    // entry with another tab's content.
    if (departingTabId && !sourceModeRef.current && !isLoadingContentRef.current) {
      const store = useTabStore.getState();
      const departing = store.tabs.find((t) => t.id === departingTabId);
      if (departing && !departing.isReadOnly) {
        store.updateTab(departingTabId, {
          markdown: serializeDocToMarkdown(editor.getJSON()),
          isDirty: true,
        });
      }
    }

    isLoadingContentRef.current = true;
    const id = setTimeout(() => {
      // Dispatch directly instead of editor.commands.setContent so we can set
      // addToHistory:false. Without it the content-swap transaction enters
      // ProseMirror's undo stack, meaning Ctrl-Z in Tab B can revert the
      // editor to Tab A's content — which would then be saved to Tab B's file.
      // preventUpdate:true suppresses the onUpdate emission; isLoadingContentRef
      // is kept as a secondary guard for other code paths.
      const json = parseMarkdownToDoc(activeTab.markdown);
      const newDoc = editor.schema.nodeFromJSON(json);
      const tr = editor.state.tr
        .replaceWith(0, editor.state.doc.content.size, newDoc.content)
        .setMeta("addToHistory", false)
        .setMeta("preventUpdate", true);
      editor.view.dispatch(tr);
      setTimeout(() => { isLoadingContentRef.current = false; }, 0);
    }, 0);
    return () => clearTimeout(id);
  }, [editor, activeTab]);

  // On source-mode exit: bring TipTap up to date with the store before the
  // WYSIWYG view reappears. SourcePane now writes to the store on every keystroke,
  // so tab.markdown is always authoritative. TipTap itself may be up to one
  // debounce interval (250 ms) behind; this closes that window.
  useEffect(() => {
    const wasActive = prevSourceModeRef.current;
    prevSourceModeRef.current = sourceMode;
    // Only act on true → false transition. Also guards against initial render
    // (wasActive=false) where no sync is needed.
    if (!editor || !wasActive || sourceMode) return;
    const tab = getActiveTab(useTabStore.getState());
    if (!tab || tab.isReadOnly) return;
    isLoadingContentRef.current = true;
    const json = parseMarkdownToDoc(tab.markdown);
    const newDoc = editor.schema.nodeFromJSON(json);
    const tr = editor.state.tr
      .replaceWith(0, editor.state.doc.content.size, newDoc.content)
      .setMeta("addToHistory", false)
      .setMeta("preventUpdate", true);
    editor.view.dispatch(tr);
    setTimeout(() => { isLoadingContentRef.current = false; }, 0);
  }, [editor, sourceMode]);

  // Load the welcome template into the initial read-only tab.
  // Only fires once (editor dep); bails out if the user has already switched away.
  useEffect(() => {
    if (!editor) return;
    const welcomeTabId = useTabStore.getState().activeTabId;
    const welcomeTab = useTabStore.getState().tabs.find((t) => t.id === welcomeTabId);
    if (!welcomeTab?.isReadOnly) return;

    fetch("/templates/welcome.md")
      .then((r) => {
        if (!r.ok) throw new Error("not found");
        return r.text();
      })
      .then((markdown) => {
        // User may have switched away while the fetch was in flight — don't stomp their content.
        if (useTabStore.getState().activeTabId !== welcomeTabId) return;
        useTabStore.getState().updateTab(welcomeTabId, { markdown });
        isLoadingContentRef.current = true;
        setTimeout(() => {
          editor.commands.setContent(parseMarkdownToDoc(markdown));
          setTimeout(() => { isLoadingContentRef.current = false; }, 0);
        }, 0);
      })
      .catch(() => {
        // File missing in dev or prod — leave the blank placeholder; not a crash.
      });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor]);

  const { flush } = useAutosave();

  // ── Workspace restore ────────────────────────────────────────────────────────
  // On startup, check whether a file handle was persisted from the previous
  // session. If permission is still granted (rare after a reload — Chrome
  // revokes FSAA permissions between page loads), auto-restore. Otherwise show
  // a non-blocking banner so the user can restore with a single click.

  // attemptBundleLoad is defined later in the component (it depends on reviewStore
  // and handleLoadReview). We hold it in a ref so handleRestoreDocument — which is
  // defined before those dependencies — can call it without creating a circular
  // initialization order or a TDZ error in the useCallback dep array.
  type AttemptBundleLoad = (
    markdownName: string,
    mdHandle: FileSystemFileHandle | null | undefined,
    dirHandle?: FileSystemDirectoryHandle,
  ) => Promise<void>;
  const attemptBundleLoadRef = useRef<AttemptBundleLoad | null>(null);

  // Guard against React 18 Strict Mode double-firing: the ref persists across
  // the simulated unmount/remount cycle, so the restore logic runs exactly once.
  const workspaceRestoreRan = useRef(false);

  useEffect(() => {
    if (workspaceRestoreRan.current) return;
    workspaceRestoreRan.current = true;

    loadWorkspaceDoc()
      .then(async (ws) => {
        if (!ws) return;

        const perm = await checkHandlePermission(ws.fileHandle);

        if (perm === "granted") {
          // Same browser session — permission still active; restore silently.
          try {
            const content = await readHandleContent(ws.fileHandle);
            const tabId = useTabStore.getState().newTab(
              content,
              ws.fileName.replace(/\.md$/i, ""),
              ws.fileName,
            );
            useTabStore.getState().setActiveTab(tabId);
            useTabStore.getState().updateActiveTab({
              fileHandle: ws.fileHandle,
              ...(ws.reviewHandle ? { reviewHandle: ws.reviewHandle } : {}),
              ...(ws.traceabilityHandle ? { traceabilityHandle: ws.traceabilityHandle } : {}),
            });

            // Restore directory handle if it was saved and still has permission.
            let restoredDirHandle: FileSystemDirectoryHandle | undefined;
            if (ws.dirHandle) {
              const dirPerm = await checkDirHandlePermission(ws.dirHandle);
              if (dirPerm === "granted") {
                restoredDirHandle = ws.dirHandle;
                const mdFiles = await scanDirectoryForMarkdown(ws.dirHandle).catch(() => []);
                useWorkspaceStore.getState().setWorkspace(ws.dirHandle, mdFiles);
              }
            }

            // Editor content is set by the tab-switch effect when it fires.
            // Pass dirHandle so findReviewFile can access the sibling review file.
            setTimeout(() => void attemptBundleLoadRef.current?.(ws.fileName, ws.fileHandle, restoredDirHandle), 0);
          } catch {
            await clearWorkspaceDoc();
          }
        } else if (perm === "prompt") {
          // Browser requires a user gesture before re-granting access.
          // Show a restore banner instead of a silent background read.
          setRestorePending({ handle: ws.fileHandle, fileName: ws.fileName });
        } else {
          // "denied" or API unavailable — file or permission gone; clear silently.
          await clearWorkspaceDoc();
        }
      })
      .catch(() => {
        // IndexedDB unavailable or handle corrupt — ignore.
      });
  // Intentionally empty deps: this must run exactly once on mount.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleRestoreDocument = useCallback(async () => {
    if (!restorePending) return;
    const { handle, fileName } = restorePending;
    setRestorePending(null); // dismiss banner immediately

    const granted = await requestHandlePermission(handle);
    if (!granted) {
      // User denied or browser blocked the prompt — clear stored handle.
      await clearWorkspaceDoc();
      useToastStore.getState().show(
        "File access was not granted. Use File → Open to reopen the file.",
        "info",
      );
      return;
    }

    // Re-request directory permission in the same user gesture if a handle was saved.
    let restoredDirHandle: FileSystemDirectoryHandle | undefined;
    const ws = await loadWorkspaceDoc();
    if (ws?.dirHandle) {
      const dirGranted = await requestDirHandlePermission(ws.dirHandle);
      if (dirGranted) {
        restoredDirHandle = ws.dirHandle;
        const mdFiles = await scanDirectoryForMarkdown(ws.dirHandle).catch(() => []);
        useWorkspaceStore.getState().setWorkspace(ws.dirHandle, mdFiles);
      }
    }

    try {
      const content = await readHandleContent(handle);

      // Don't re-open if the file is already in a tab (shouldn't happen here,
      // but guard against it).
      const existing = useTabStore.getState().tabs.find((t) => t.fileName === fileName);
      if (existing) {
        useTabStore.getState().setActiveTab(existing.id);
        return;
      }

      const tabId = useTabStore.getState().newTab(
        content,
        fileName.replace(/\.md$/i, ""),
        fileName,
      );
      useTabStore.getState().setActiveTab(tabId);
      // Also restore the review handle if it was previously persisted.
      useTabStore.getState().updateActiveTab({
        fileHandle: handle,
        ...(ws?.reviewHandle ? { reviewHandle: ws.reviewHandle } : {}),
        ...(ws?.traceabilityHandle ? { traceabilityHandle: ws.traceabilityHandle } : {}),
      });

      if (editor) {
        isLoadingContentRef.current = true;
        setTimeout(() => {
          editor.commands.setContent(parseMarkdownToDoc(content));
          setTimeout(() => { isLoadingContentRef.current = false; }, 0);
        }, 0);
      }

      await addRecentFile({ name: fileName, lastOpened: Date.now(), handle });
      await saveWorkspaceDoc({ fileHandle: handle, fileName, dirHandle: restoredDirHandle, reviewHandle: ws?.reviewHandle, traceabilityHandle: ws?.traceabilityHandle });
      setTimeout(() => void attemptBundleLoadRef.current?.(fileName, handle, restoredDirHandle), 0);
    } catch (e) {
      const err = e as Error;
      console.error("[Workspace restore] failed:", err.name, err.message);
      await clearWorkspaceDoc();
      useToastStore.getState().show(
        "Could not restore the previous file. Use File → Open to reopen it.",
        "error",
      );
    }
  }, [restorePending, editor]);

  const reviewStore = useReviewCommentsStore();

  // ── Browser unload protection ────────────────────────────────────────────────
  // Warn before refresh / tab-close / navigation when unsaved changes exist.
  // A ref holds the latest combined dirty state so the handler registered once
  // at mount never captures a stale closure and never needs re-registration.
  const isMarkdownDirty = useTabStore(
    (s) => s.tabs.some((t) => t.isDirty && !t.isReadOnly),
  );
  const isReviewDirty = useReviewCommentsStore((s) => s.isDirty);
  const isTraceabilityDirty = useTraceabilityStore((s) => s.isDirty);
  const hasUnsavedChangesRef = useRef(false);
  // anyStashedTraceabilityDirty covers unsaved edits stashed on BACKGROUND
  // tabs; every stash happens alongside a store change, so this line always
  // re-evaluates on the render that follows a stash.
  hasUnsavedChangesRef.current =
    isMarkdownDirty || isReviewDirty || isTraceabilityDirty || anyStashedTraceabilityDirty();

  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (!hasUnsavedChangesRef.current) return;
      e.preventDefault();
      // Older browsers (Chrome <119, Safari) require returnValue to be set.
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, []);

  // ── Inline comment drawer (opened from requirement heading badges) ────────────

  const inlineDrawerReqId = useCommentDrawerStore((s) => s.reqId);
  const inlineDrawerStatus = useCommentDrawerStore((s) => s.status);
  const closeInlineDrawer = useCommentDrawerStore((s) => s.close);

  const inlineDrawerRecord: RequirementRecord | null = inlineDrawerReqId
    ? { id: inlineDrawerReqId, status: inlineDrawerStatus, section: "", pmPos: 0, title: "" }
    : null;

  // ── Traceability panel (right workspace, opened from 🧪 badges) ──────────────
  // One contextual panel at a time: the badge click handler closes the comment
  // drawer before opening this panel; this effect covers the reverse direction
  // (opening a review comment drawer displaces the traceability panel).
  const tracePanelReqId = useTraceabilityPanelStore((s) => s.reqId);
  const closeTracePanel = useTraceabilityPanelStore((s) => s.close);
  useEffect(() => {
    if (inlineDrawerReqId) closeTracePanel();
  }, [inlineDrawerReqId, closeTracePanel]);

  // ── Traceability per-tab state swap ─────────────────────────────────────────
  // The traceability store mirrors the ACTIVE tab's sidecar. On tab switch:
  // stash the departing tab's state (preserving unsaved edits for when it
  // reactivates), then restore the arriving tab's snapshot — or, first
  // activation this session, read its stored sidecar handle.
  const traceActiveTabId = useTabStore((s) => s.activeTabId);
  const prevTraceTabIdRef = useRef(traceActiveTabId);
  useEffect(() => {
    const prevTabId = prevTraceTabIdRef.current;
    if (prevTabId === traceActiveTabId) return;
    prevTraceTabIdRef.current = traceActiveTabId;

    // Stash the departing tab — unless it was just closed (close handlers
    // drop its snapshot; re-stashing would resurrect an entry for a dead tab).
    if (useTabStore.getState().tabs.some((t) => t.id === prevTabId)) {
      stashTraceabilityState(prevTabId);
    } else {
      dropTraceabilityState(prevTabId);
    }
    closeTracePanel(); // panel reqId belongs to the departing document

    if (restoreTraceabilityState(traceActiveTabId)) return;
    useTraceabilityStore.getState().reset();

    // First activation this session: try the tab's stored sidecar handle.
    // (Fresh document opens are handled by attemptBundleLoad instead; this
    // covers switching back to a tab whose sidecar was loaded from a handle.)
    const handle = useTabStore.getState().tabs.find((t) => t.id === traceActiveTabId)?.traceabilityHandle;
    if (!handle) return;
    void (async () => {
      try {
        if ((await checkHandlePermission(handle)) !== "granted") return;
        const text = await readHandleContent(handle);
        // Apply only if this tab is still active and nothing loaded meanwhile.
        const store = useTraceabilityStore.getState();
        if (useTabStore.getState().activeTabId !== traceActiveTabId) return;
        if (store.loaded || store.isDirty) return;
        store.load(JSON.parse(text));
      } catch (e) {
        console.error("[traceability tab switch]", e);
        useTraceabilityStore.getState().setLoadError();
      }
    })();
  }, [traceActiveTabId, closeTracePanel]);

  // ── Document validation ───────────────────────────────────────────────────────

  const requirementPatternForValidation = useConfigStore((s) => s.requirementPattern);
  const setValidationIssues = useValidationStore((s) => s.setIssues);
  const validationIssues = useDocumentValidation(editor, requirementPatternForValidation);
  const prevIssueCountRef = useRef(0);

  useEffect(() => {
    setValidationIssues(validationIssues);
    const orderViolations = validationIssues.filter((i) => i.type === "requirement-order");
    // Toast only when violations appear for the first time (silence when fixed).
    if (orderViolations.length > 0 && prevIssueCountRef.current === 0) {
      useToastStore.getState().show(
        `${orderViolations.length} requirement ordering issue${orderViolations.length !== 1 ? "s" : ""} detected.`,
        "info",
      );
    }
    prevIssueCountRef.current = orderViolations.length;
  }, [validationIssues, setValidationIssues]);

  // ── Quality checks navigation ────────────────────────────────────────────────


  // ── Review comments ──────────────────────────────────────────────────────────

  const handleLoadReview = useCallback(async (startIn?: FileSystemFileHandle) => {
    try {
      const result = await openReviewFile({ startIn });
      if (!result) return;
      reviewStore.load(result.data);
      // Store the handle so subsequent saves can write directly without a picker.
      // writeToReviewHandle will request readwrite permission on first save if
      // this handle was opened read-only via showOpenFilePicker.
      if (result.handle) {
        useTabStore.getState().updateActiveTab({ reviewHandle: result.handle });
      }
      useToastStore.getState().show("Review comments loaded.", "success");
    } catch (e) {
      console.error("[handleLoadReview]", e);
      useToastStore.getState().show("Could not load review file.", "error");
    }
  }, [reviewStore]);

  // Always opens the picker — used for first-time save and explicit "Save As".
  const handleSaveReviewAs = useCallback(async () => {
    const tab = getActiveTab(useTabStore.getState());
    if (!tab) return;
    const suggestedName = tab.fileName
      ? deriveReviewFileName(tab.fileName)
      : "document.review.json";
    try {
      const handle = await saveReviewFileAs(reviewStore.comments, suggestedName);
      if (!handle) return; // user cancelled
      reviewStore.markSaved();
      useTabStore.getState().updateActiveTab({ reviewHandle: handle });
      // Persist so the handle survives a page reload alongside the markdown handle.
      if (tab.fileHandle && tab.fileName) {
        const ws = await loadWorkspaceDoc();
        await saveWorkspaceDoc({
          fileHandle: tab.fileHandle,
          fileName: tab.fileName,
          dirHandle: ws?.dirHandle,
          reviewHandle: handle,
          traceabilityHandle: ws?.traceabilityHandle,
        });
      }
      useToastStore.getState().show("Review comments saved.", "success");
    } catch (e) {
      console.error("[handleSaveReviewAs]", e);
      useToastStore.getState().show("Failed to save review comments.", "error");
    }
  }, [reviewStore]);

  // Writes to the existing review handle when available; opens picker on first save.
  const handleSaveReview = useCallback(async () => {
    const tab = getActiveTab(useTabStore.getState());
    if (!tab) return;

    if (tab.reviewHandle) {
      try {
        await writeToReviewHandle(tab.reviewHandle, reviewStore.comments);
        reviewStore.markSaved();
        useToastStore.getState().show("Review comments saved.", "success");
      } catch (e) {
        if ((e as DOMException)?.name === "NotFoundError") {
          // The file behind this handle was deleted, moved, or renamed
          // outside the app since we captured it. Treat it like "no handle"
          // and let the user re-pick a destination in one gesture (the
          // existing Save As picker, pre-filled with the derived name)
          // instead of leaving this store dirty forever behind a generic
          // error toast with no discoverable recovery path.
          console.warn("[handleSaveReview] review handle is stale, re-prompting", e);
          useTabStore.getState().updateActiveTab({ reviewHandle: undefined });
          await handleSaveReviewAs();
          return;
        }
        console.error("[handleSaveReview]", e);
        useToastStore.getState().show("Failed to save review comments.", "error");
      }
      return;
    }

    // No handle yet — first save for this document; delegate to Save As.
    await handleSaveReviewAs();
  }, [reviewStore, handleSaveReviewAs]);

  // ── Traceability sidecar ─────────────────────────────────────────────────────
  // Mirrors the review trio above. All store access goes through getState() —
  // no subscription needed inside one-shot handlers.

  const handleLoadTraceability = useCallback(async () => {
    const tab = getActiveTab(useTabStore.getState());
    try {
      const result = await openTraceabilityFile(
        tab?.fileHandle ? { startIn: tab.fileHandle } : undefined,
      );
      if (!result) return;
      useTraceabilityStore.getState().load(result.data);
      if (result.handle) {
        useTabStore.getState().updateActiveTab({ traceabilityHandle: result.handle });
      }
      useToastStore.getState().show("Traceability file loaded.", "success");
    } catch (e) {
      console.error("[handleLoadTraceability]", e);
      useToastStore.getState().show("Could not load traceability file.", "error");
    }
  }, []);

  // Always opens the picker — used for first-time save and explicit "Save As".
  const handleSaveTraceabilityAs = useCallback(async () => {
    const tab = getActiveTab(useTabStore.getState());
    if (!tab) return;
    const suggestedName = tab.fileName
      ? deriveTraceabilityFileName(tab.fileName)
      : "document.test-traceability.json";
    try {
      const store = useTraceabilityStore.getState();
      const handle = await saveTraceabilityFileAs(store.getFileData(), suggestedName);
      if (!handle) return; // user cancelled
      store.markSaved();
      useTabStore.getState().updateActiveTab({ traceabilityHandle: handle });
      // Persist so the handle survives a page reload alongside the markdown handle.
      if (tab.fileHandle && tab.fileName) {
        const ws = await loadWorkspaceDoc();
        await saveWorkspaceDoc({
          fileHandle: tab.fileHandle,
          fileName: tab.fileName,
          dirHandle: ws?.dirHandle,
          reviewHandle: ws?.reviewHandle,
          traceabilityHandle: handle,
        });
      }
      useToastStore.getState().show("Traceability saved.", "success");
    } catch (e) {
      console.error("[handleSaveTraceabilityAs]", e);
      useToastStore.getState().show("Failed to save traceability file.", "error");
    }
  }, []);

  // Writes to the existing handle when available; opens picker on first save.
  const handleSaveTraceability = useCallback(async () => {
    const tab = getActiveTab(useTabStore.getState());
    if (!tab) return;
    const store = useTraceabilityStore.getState();

    // loadError means the sidecar on disk couldn't be read — never write over
    // it silently. Fall through to Save As so overwriting is an explicit,
    // user-confirmed choice in the picker.
    if (tab.traceabilityHandle && !store.loadError) {
      try {
        await writeToTraceabilityHandle(tab.traceabilityHandle, store.getFileData());
        store.markSaved();
        useToastStore.getState().show("Traceability saved.", "success");
      } catch (e) {
        if ((e as DOMException)?.name === "NotFoundError") {
          // Same stale-handle recovery as handleSaveReview: the file was
          // deleted/moved/renamed outside the app since we captured this
          // handle. Re-prompt once via the existing Save As picker rather
          // than leaving the store dirty behind a generic error toast.
          console.warn("[handleSaveTraceability] traceability handle is stale, re-prompting", e);
          useTabStore.getState().updateActiveTab({ traceabilityHandle: undefined });
          await handleSaveTraceabilityAs();
          return;
        }
        console.error("[handleSaveTraceability]", e);
        useToastStore.getState().show("Failed to save traceability file.", "error");
      }
      return;
    }

    await handleSaveTraceabilityAs();
  }, [handleSaveTraceabilityAs]);

  // ── Bundle auto-discovery ────────────────────────────────────────────────────
  // After any markdown file open, attempt to locate its companion review file.
  // With the FSAA showOpenFilePicker model we only receive a FileSystemFileHandle
  // (not the parent directory), so silent auto-discovery is not possible — the
  // browser sandbox prevents accessing sibling files from a file handle alone.
  // findReviewFile() handles the case where a dirHandle IS available (future).
  // For now, we surface a non-blocking toast with a one-click CTA that opens
  // the review picker pre-navigated to the same directory via startIn.

  const attemptBundleLoad = useCallback(
    async (
      markdownName: string,
      mdHandle: FileSystemFileHandle | null | undefined,
      dirHandle?: FileSystemDirectoryHandle,
    ) => {
      // A new document is being opened — clear any traceability state left
      // over from the previous document BEFORE discovery, so a document with
      // no sidecar never inherits (and later saves) another document's links.
      // The contextual panel closes too: its reqId belongs to the old document.
      useTraceabilityStore.getState().reset();
      useTraceabilityPanelStore.getState().close();

      const reviewName = deriveReviewFileName(markdownName);
      const { reviewData, reviewFound } = await findReviewFile(dirHandle, reviewName);

      if (reviewFound && reviewData) {
        reviewStore.load(reviewData);
        useToastStore.getState().show(`Review file loaded: ${reviewName}`, "success");
      } else if (dirHandle) {
        // We had directory access but no companion review file was found there.
        useToastStore.getState().show(
          `No review file found in this folder`,
          "info",
          mdHandle ? { label: "Load review", onClick: () => handleLoadReview(mdHandle) } : undefined,
        );
      } else if (mdHandle) {
        // No directory context (opened via single-file picker or recent files).
        // We couldn't search for siblings — don't claim the file is absent.
        useToastStore.getState().show(
          "Review file not auto-detected — use Open Folder to load both files together",
          "info",
          { label: "Load review", onClick: () => handleLoadReview(mdHandle) },
        );
      }

      // ── Traceability sidecar ────────────────────────────────────────────────
      // A missing sidecar is the normal case and stays silent — the (future)
      // Traceability tab surfaces its own load CTA. Only found/unreadable
      // outcomes are worth a toast.
      const traceabilityName = deriveTraceabilityFileName(markdownName);
      const trace = await findTraceabilityFile(dirHandle, traceabilityName);
      if (trace.traceabilityFound) {
        useTraceabilityStore.getState().load(trace.traceabilityData);
        if (trace.traceabilityHandle) {
          useTabStore.getState().updateActiveTab({ traceabilityHandle: trace.traceabilityHandle });
        }
        useToastStore.getState().show(`Traceability file loaded: ${traceabilityName}`, "success");
      } else if (trace.traceabilityError) {
        // The sidecar exists but couldn't be read/parsed. loadError blocks
        // saves so the unreadable file is never overwritten by an empty store.
        useTraceabilityStore.getState().setLoadError();
        useToastStore.getState().show(
          `Couldn't read ${traceabilityName} — fix or remove the file, then reopen the document.`,
          "error",
        );
      } else {
        // No directory discovery. If a traceability handle was restored from
        // a previous session, read from it directly — a populated handle next
        // to an empty store would otherwise risk being overwritten on save.
        const restoredHandle = getActiveTab(useTabStore.getState())?.traceabilityHandle;
        if (restoredHandle && (await checkHandlePermission(restoredHandle)) === "granted") {
          try {
            useTraceabilityStore.getState().load(JSON.parse(await readHandleContent(restoredHandle)));
            useToastStore.getState().show(`Traceability file loaded: ${restoredHandle.name}`, "success");
          } catch (e) {
            console.error("[attemptBundleLoad] traceability restore", e);
            useTraceabilityStore.getState().setLoadError();
            useToastStore.getState().show(
              `Couldn't read ${restoredHandle.name} — fix or remove the file, then reopen the document.`,
              "error",
            );
          }
        }
      }
    },
    [reviewStore, handleLoadReview],
  );
  // Keep the ref current so handleRestoreDocument and the mount effect always
  // call the latest version without `attemptBundleLoad` entering their dep arrays.
  attemptBundleLoadRef.current = attemptBundleLoad;

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
      await saveWorkspaceDoc({ fileHandle: result.handle, fileName: result.name });
    }

    if (editor) {
      isLoadingContentRef.current = true;
      setTimeout(() => {
        editor.commands.setContent(parseMarkdownToDoc(result.content));
        setTimeout(() => { isLoadingContentRef.current = false; }, 0);
      }, 0);
    }

    await addRecentFile({
      name: result.name,
      lastOpened: Date.now(),
      handle: result.handle ?? undefined,
    });

    setTimeout(() => void attemptBundleLoad(result.name, result.handle ?? null), 0);
  }, [editor, attemptBundleLoad]);

  const workspace = useWorkspaceStore();

  // Scans the chosen directory and lets the user pick which document to open.
  // The directory handle is stored in workspaceStore so subsequent bundle
  // operations (findReviewFile) continue to have sibling-file access.
  const handleOpenFolder = useCallback(async () => {
    if (!("showDirectoryPicker" in window)) {
      useToastStore.getState().show(
        "Folder opening is not supported in this browser. Use File → Open File instead.",
        "info",
      );
      return;
    }

    let ws;
    try {
      ws = await openDirectoryForWorkspace();
    } catch {
      useToastStore.getState().show("Could not open the folder.", "error");
      return;
    }

    if (!ws) return; // user cancelled

    if (ws.markdownFiles.length === 0) {
      useToastStore.getState().show("No markdown files found in the selected folder.", "info");
      return;
    }

    workspace.setWorkspace(ws.dirHandle, ws.markdownFiles);
  }, [workspace]);

  // Called when the user clicks a file in the WorkspacePanel sidebar.
  const handleOpenFromWorkspace = useCallback(async (fileName: string) => {
    const { dirHandle } = workspace;
    if (!dirHandle) return;

    let result;
    try {
      result = await openFileFromDirectory(dirHandle, fileName);
    } catch {
      useToastStore.getState().show(`Could not open ${fileName}.`, "error");
      return;
    }

    const { name, content, handle } = result;

    const existing = useTabStore.getState().tabs.find((t) => t.fileName === name);
    if (existing) {
      useTabStore.getState().setActiveTab(existing.id);
      return;
    }

    const tabId = useTabStore.getState().newTab(content, name.replace(/\.md$/i, ""), name);
    useTabStore.getState().setActiveTab(tabId);
    if (handle) useTabStore.getState().updateActiveTab({ fileHandle: handle });

    if (editor) {
      isLoadingContentRef.current = true;
      setTimeout(() => {
        editor.commands.setContent(parseMarkdownToDoc(content));
        setTimeout(() => { isLoadingContentRef.current = false; }, 0);
      }, 0);
    }

    if (handle) {
      await saveWorkspaceDoc({ fileHandle: handle, fileName: name, dirHandle });
      await addRecentFile({ name, lastOpened: Date.now(), handle });
    }

    // dirHandle gives findReviewFile the sibling-file access it needs
    setTimeout(() => void attemptBundleLoad(name, handle ?? null, dirHandle), 0);
  }, [editor, attemptBundleLoad, workspace]);

  // handleSaveAs must be defined before handleSave because handleSave
  // delegates to it when no file handle exists (first save on a new file).
  const handleSaveAs = useCallback(async () => {
    const tab = getActiveTab(useTabStore.getState());
    if (!tab) return;
    if (tab.isReadOnly) {
      useToastStore.getState().show("Sample document — use File → New to create your own.", "info");
      return;
    }

    try {
      const handle = await saveAsMarkdownFile(
        tab.markdown,
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
        await saveWorkspaceDoc({ fileHandle: handle, fileName: handle.name });
      }
      // null = user cancelled picker → leave dirty, no error message
    } catch (e) {
      const err = e as Error;
      console.error("[Save As] failed:", err.name, err.message);
      useToastStore.getState().show("Failed to save file.", "error");
    }

    await flush();
  }, [flush]);

  const handleSave = useCallback(async () => {
    const tab = getActiveTab(useTabStore.getState());
    if (!tab) return;
    if (tab.isReadOnly) {
      useToastStore.getState().show("Sample document — use File → New to create your own.", "info");
      return;
    }

    // No handle yet → this is the first save on a new/untitled file. Delegate
    // to Save As so the user can choose a location. After that, the handle is
    // stored and subsequent ⌘S calls write directly without a picker.
    if (!tab.fileHandle) {
      return handleSaveAs();
    }

    // Capture at call time — the user may keep typing during the async write.
    const { markdown, fileHandle, fileName, title } = tab;

    try {
      await writeToFileHandle(fileHandle, markdown);
      useTabStore.getState().updateActiveTab({ isDirty: false, lastSavedAt: Date.now() });
      await addRecentFile({
        name: fileName ?? `${title}.md`,
        lastOpened: Date.now(),
        handle: fileHandle,
      });
      await saveWorkspaceDoc({ fileHandle, fileName: fileName ?? `${title}.md` });
    } catch (e) {
      // Never fall back to a picker here — surface the error instead so the
      // user knows the write failed and ⌘S doesn't silently become Save As.
      const err = e as Error;
      console.error("[Save] writeToFileHandle failed:", err.name, err.message);
      useToastStore.getState().show(
        `Save failed: ${err.message || "could not write to file."}`,
        "error",
      );
    }

    await flush();
  }, [handleSaveAs, flush]);

  // Companion registry for the bundle save pipeline (Ctrl+S). Built FROM
  // COMPANION_REGISTRY (companionArtifact.ts) — the single canonical list of
  // "what companions exist" also used by useAnyCompanionDirty for the top
  // bundle-dirty status — rather than a second, independently-maintained
  // id/isLoaded/isDirty list that could drift out of sync with it. This
  // function only attaches each id's save handler; a future companion needs
  // one COMPANION_REGISTRY entry plus one line here, nothing else.
  const bundleCompanions = useCallback((): CompanionArtifact[] => {
    const saveHandlers: Record<string, () => Promise<void>> = {
      review: handleSaveReview,
      traceability: handleSaveTraceability,
    };
    return COMPANION_REGISTRY
      .map((c) => ({ id: c.id, isLoaded: c.isLoaded, isDirty: c.isDirty, save: saveHandlers[c.id] }))
      .filter((c): c is CompanionArtifact => Boolean(c.save));
  }, [handleSaveReview, handleSaveTraceability]);

  const handleSaveWorkspace = useCallback(async () => {
    const tab = getActiveTab(useTabStore.getState());
    if (!tab) return;
    await saveBundle(handleSave, tab.isDirty, bundleCompanions());
  }, [handleSave, bundleCompanions]);

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
          setTimeout(() => {
            editor.commands.setContent(parseMarkdownToDoc(content));
            setTimeout(() => { isLoadingContentRef.current = false; }, 0);
          }, 0);
        }

        await addRecentFile({ ...recent, lastOpened: Date.now() });
        await saveWorkspaceDoc({ fileHandle: recent.handle, fileName: recent.name });
        setTimeout(() => void attemptBundleLoad(recent.name, recent.handle), 0);
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

  const handleExportReviewsCsv = useCallback(() => {
    if (!editor) return;
    const tab = getActiveTab(useTabStore.getState());
    const documentName = tab?.fileName ?? (tab ? `${tab.title}.md` : "document.md");
    const { requirementPattern } = useConfigStore.getState();
    const { statuses } = useStatusConfigStore.getState();
    const { comments } = useReviewCommentsStore.getState();

    const flat = flattenOutline(deriveOutline(editor));
    const docContent = editor.state.doc.content.toJSON();

    const rows = collectReviewExportRows(
      flat,
      docContent,
      documentName,
      requirementPattern,
      statuses,
      comments,
    );

    if (rows.length === 0) {
      useToastStore.getState().show("No review comments to export.", "info");
      return;
    }

    const csv = generateReviewCsv(rows);
    downloadReviewCsv(csv, documentName);
  }, [editor]);

  // ── Close tab with dirty guard ───────────────────────────────────────────────

  const handleRequestClose = useCallback((tabId: string) => {
    const tab = useTabStore.getState().tabs.find((t) => t.id === tabId);
    if (!tab) return;
    if (tab.isDirty && !tab.isReadOnly) {
      setCloseConfirm({ tabId, tabTitle: tab.title });
    } else {
      if (tab.fileHandle) {
        // User explicitly closed a disk-linked tab — don't restore it next load.
        void clearWorkspaceDoc();
        setRestorePending(null);
      }
      // The traceability store mirrors the active document's sidecar — clear
      // it when that document closes so its data can't attach to another tab.
      dropTraceabilityState(tabId);
      if (tabId === useTabStore.getState().activeTabId) {
        useTraceabilityStore.getState().reset();
        useTraceabilityPanelStore.getState().close();
      }
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
          if (tab.fileHandle) {
            // Known file — write directly; never open a picker mid-close.
            await writeToFileHandle(tab.fileHandle, tab.markdown);
            useTabStore.getState().updateTab(closeConfirm.tabId, {
              isDirty: false,
              lastSavedAt: Date.now(),
            });
          } else {
            // New file — let the user choose where to save it.
            const handle = await saveAsMarkdownFile(
              tab.markdown,
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
          }
        } catch (e) {
          const err = e as Error;
          console.error("[Save on close] failed:", err.name, err.message);
          useToastStore.getState().show("Save failed. Closing anyway.", "error");
        }
      }
    }
    const closingTab = useTabStore.getState().tabs.find((t) => t.id === closeConfirm.tabId);
    if (closingTab?.fileHandle) {
      // User chose to close (save or discard) a disk-linked tab — don't restore it next load.
      void clearWorkspaceDoc();
      setRestorePending(null);
    }
    // See handleRequestClose: closing the active document clears its traceability state.
    dropTraceabilityState(closeConfirm.tabId);
    if (closeConfirm.tabId === useTabStore.getState().activeTabId) {
      useTraceabilityStore.getState().reset();
      useTraceabilityPanelStore.getState().close();
    }
    useTabStore.getState().closeTab(closeConfirm.tabId);
    setCloseConfirm(null);
  }, [closeConfirm]);

  // ── Keyboard shortcuts ───────────────────────────────────────────────────────

  const handlersRef = useRef({
    handleNewFile,
    handleOpen,
    handleOpenFolder,
    handleSave,
    handleSaveAs,
    handleSaveWorkspace,
    toggleSourceMode,
    toggleSplitView,
    handleRequestClose,
  });
  useEffect(() => {
    handlersRef.current = {
      handleNewFile,
      handleOpen,
      handleOpenFolder,
      handleSave,
      handleSaveAs,
      handleSaveWorkspace,
      toggleSourceMode,
      toggleSplitView,
      handleRequestClose,
    };
  });

  // Keep stable refs for find state setters
  const setFindOpenRef = useRef(setFindOpen);
  setFindOpenRef.current = setFindOpen;
  const setFindShowReplaceRef = useRef(setFindShowReplace);
  setFindShowReplaceRef.current = setFindShowReplace;

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;

      if (e.key === "/") {
        e.preventDefault();
        handlersRef.current.toggleSourceMode();
        return;
      }
      if (e.key === "\\") {
        e.preventDefault();
        handlersRef.current.toggleSplitView();
        return;
      }
      if (e.key === "n") {
        e.preventDefault();
        handlersRef.current.handleNewFile();
        return;
      }
      if (e.key === "o") {
        e.preventDefault();
        if (e.shiftKey) {
          handlersRef.current.handleOpenFolder();
        } else {
          handlersRef.current.handleOpen();
        }
        return;
      }
      if (e.key.toLowerCase() === "s") {
        e.preventDefault();
        if (e.shiftKey) {
          handlersRef.current.handleSaveAs();
        } else {
          handlersRef.current.handleSaveWorkspace();
        }
        return;
      }
      if (e.key === "w") {
        e.preventDefault();
        const { activeTabId } = useTabStore.getState();
        handlersRef.current.handleRequestClose(activeTabId);
        return;
      }
      if (e.key === "f") {
        e.preventDefault();
        setFindShowReplaceRef.current(false);
        setFindOpenRef.current(true);
        return;
      }
      if (e.key === "h") {
        e.preventDefault();
        setFindShowReplaceRef.current(true);
        setFindOpenRef.current(true);
        return;
      }
      if (e.key.toLowerCase() === "d" && e.shiftKey) {
        e.preventDefault();
        setActiveWorkspace((w) => w === "editor" ? "dashboard" : "editor");
        return;
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  // ── Dashboard navigation ─────────────────────────────────────────────────────

  const handleDashboardNavigate = useCallback(
    (pmPos: number) => {
      setActiveWorkspace("editor");
      if (!editor) return;
      setTimeout(() => {
        editor.chain().focus().setTextSelection(pmPos + 1).scrollIntoView().run();
      }, 50);
    },
    [editor],
  );

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
          onOpenFolder={handleOpenFolder}
          onSave={handleSave}
          onSaveAs={handleSaveAs}
          onCloseTab={() => handleRequestClose(useTabStore.getState().activeTabId)}
          onOpenRecent={handleOpenRecent}
          onChangeUserName={handleChangeUserName}
          onExportMarkdown={handleExportMarkdown}
          onExportReviewsCsv={handleExportReviewsCsv}
          onSearch={() =>
            document.dispatchEvent(
              new KeyboardEvent("keydown", { key: "k", metaKey: true, bubbles: true })
            )
          }
          activeWorkspace={activeWorkspace}
          onSwitchWorkspace={setActiveWorkspace}
        />

        <TabBar onRequestClose={handleRequestClose} />

        {/* Restore banner — shown after reload when the last file needs a
            permission re-grant (Chrome revokes FSAA permissions per session). */}
        {restorePending && (
          <div className="flex shrink-0 items-center gap-2 border-b border-[var(--color-border)] bg-amber-50/60 px-4 py-2 dark:bg-amber-900/10">
            <svg
              width="13" height="13" viewBox="0 0 16 16"
              fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"
              className="shrink-0 text-amber-600 dark:text-amber-400"
              aria-hidden="true"
            >
              <path d="M1 4v5h5" />
              <path d="M3.51 9a7 7 0 1 0 .49-4" />
            </svg>
            <span className="text-xs text-[var(--color-muted)]">Restore previous file?</span>
            <span className="max-w-[220px] truncate text-xs font-medium text-[var(--color-text)]">
              {restorePending.fileName}
            </span>
            <button
              onClick={handleRestoreDocument}
              className="ml-1 rounded bg-amber-600 px-2.5 py-0.5 text-xs font-medium text-white transition-colors hover:bg-amber-700 dark:bg-amber-700 dark:hover:bg-amber-600"
            >
              Restore
            </button>
            <button
              onClick={() => { void clearWorkspaceDoc(); setRestorePending(null); }}
              className="text-xs text-[var(--color-muted)] transition-colors hover:text-[var(--color-text)]"
            >
              Dismiss
            </button>
          </div>
        )}

        <div className="flex min-h-0 flex-1">
          {activeWorkspace === "editor" ? (
            <>
              {sidebarOpen && (
                <>
                  <div className="flex shrink-0 flex-col overflow-hidden" style={{ width: sidebarWidth }}>
                    {workspace.dirHandle && (
                      <WorkspacePanel
                        onOpenFile={handleOpenFromWorkspace}
                        onOpenFolder={handleOpenFolder}
                      />
                    )}
                    <OutlinePanel width={sidebarWidth} noWidthStyle />
                  </div>
                  <ResizeHandle onDelta={adjustSidebar} />
                </>
              )}
              <div className="relative flex flex-1 min-w-0">
                <EditorMain />
                <FindReplaceBar
                  open={findOpen}
                  showReplace={findShowReplace}
                  onClose={() => setFindOpen(false)}
                />
              </div>
              {inlineDrawerRecord && (
                <>
                  <ResizeHandle onDelta={(d) => adjustRightPanel(-d)} />
                  {/* h-full fills height via align-self:stretch in the flex row */}
                  <div className="shrink-0 overflow-hidden" style={{ width: rightPanelWidth }}>
                    <CommentDrawer record={inlineDrawerRecord} onClose={closeInlineDrawer} />
                  </div>
                </>
              )}
              {!inlineDrawerRecord && tracePanelReqId && (
                <>
                  <ResizeHandle onDelta={(d) => adjustRightPanel(-d)} />
                  <div className="shrink-0 overflow-hidden" style={{ width: rightPanelWidth }}>
                    <TraceabilityDrawer reqId={tracePanelReqId} onClose={closeTracePanel} />
                  </div>
                </>
              )}
            </>
          ) : (
            <Dashboard
              onNavigateToEditor={handleDashboardNavigate}
              onLoadReview={handleLoadReview}
              onSaveReview={handleSaveReview}
              onSaveReviewAs={handleSaveReviewAs}
              onLoadTraceability={handleLoadTraceability}
              onSaveTraceability={handleSaveTraceability}
              onSaveTraceabilityAs={handleSaveTraceabilityAs}
            />
          )}
        </div>

        <StatusBar
          onSaveReview={handleSaveReview}
          onSaveReviewAs={handleSaveReviewAs}
          onSaveTraceability={handleSaveTraceability}
          onSaveTraceabilityAs={handleSaveTraceabilityAs}
        />
      </div>

      {/* User name modal — opened via File → User Name… */}
      {userNameModalOpen && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 backdrop-blur-sm"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setUserNameModalOpen(false);
          }}
        >
          <div className="w-80 rounded-xl border border-[var(--color-border)] bg-[var(--color-paper)] p-5 shadow-2xl">
            <p className="mb-4 text-sm font-semibold text-[var(--color-text)]">User Name</p>
            <UserNameForm
              initialName={currentUserName}
              onSave={(name) => {
                saveUserName(name);
                setUserNameModalOpen(false);
              }}
              onCancel={() => setUserNameModalOpen(false)}
            />
          </div>
        </div>
      )}

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
