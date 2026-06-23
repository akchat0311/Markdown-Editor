/** File System Access API helpers with download/upload fallback. */

interface FilePickerOpts {
  types?: Array<{ description?: string; accept: Record<string, string[]> }>;
  excludeAcceptAllOption?: boolean;
  suggestedName?: string;
}

// Extended handle type that includes the WICG permission API.
// These methods are part of the spec but absent from base TS DOM lib types.
type FsaHandle = FileSystemFileHandle & {
  queryPermission(descriptor: { mode: "read" | "readwrite" }): Promise<"granted" | "denied" | "prompt">;
  requestPermission(descriptor: { mode: "read" | "readwrite" }): Promise<"granted" | "denied" | "prompt">;
};

const MARKDOWN_OPTS: FilePickerOpts = {
  types: [{ description: "Markdown", accept: { "text/markdown": [".md"] } }],
  excludeAcceptAllOption: false,
};

export interface OpenedFile {
  name: string;
  content: string;
  handle: FileSystemFileHandle | null;
}

export interface WorkspaceDirectory {
  dirHandle: FileSystemDirectoryHandle;
  dirName: string;
  markdownFiles: string[];
}

/** Opens a file picker and reads the chosen .md file. */
export async function openMarkdownFile(): Promise<OpenedFile | null> {
  // File System Access API — preserves the handle for later saves
  if ("showOpenFilePicker" in window) {
    try {
      const [handle] = await (window as Window & typeof globalThis & {
        showOpenFilePicker: (opts: FilePickerOpts) => Promise<FileSystemFileHandle[]>;
      }).showOpenFilePicker(MARKDOWN_OPTS);
      const file = await handle.getFile();
      return { name: file.name, content: await file.text(), handle };
    } catch (e) {
      if ((e as DOMException).name === "AbortError") return null;
      throw e;
    }
  }

  // Fallback: hidden <input type="file"> — no handle available
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".md,text/markdown";
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) { resolve(null); return; }
      resolve({ name: file.name, content: await file.text(), handle: null });
    };
    input.oncancel = () => resolve(null);
    input.click();
  });
}

/**
 * Opens a directory picker and scans the root for .md files.
 *
 * Returns the directory handle and file list only — does NOT open any
 * document. The caller is responsible for presenting the file list to the
 * user and calling openFileFromDirectory once a choice is made.
 *
 * Returns null if the user cancelled or if showDirectoryPicker is unavailable.
 */
export async function openDirectoryForWorkspace(): Promise<WorkspaceDirectory | null> {
  if (!("showDirectoryPicker" in window)) return null;

  let dirHandle: FileSystemDirectoryHandle;
  try {
    dirHandle = await (window as Window & {
      showDirectoryPicker: (opts?: unknown) => Promise<FileSystemDirectoryHandle>;
    }).showDirectoryPicker({ mode: "read" });
  } catch (e) {
    if ((e as DOMException).name === "AbortError") return null;
    throw e;
  }

  const markdownFiles: string[] = [];
  for await (const [name, entry] of dirHandle.entries()) {
    if (entry.kind === "file" && name.toLowerCase().endsWith(".md")) {
      markdownFiles.push(name);
    }
  }
  markdownFiles.sort((a, b) => a.localeCompare(b));

  return { dirHandle, dirName: dirHandle.name, markdownFiles };
}

/**
 * Scans an existing directory handle for .md files without opening a picker.
 * Used when restoring a persisted dirHandle across sessions.
 */
export async function scanDirectoryForMarkdown(
  dirHandle: FileSystemDirectoryHandle,
): Promise<string[]> {
  const files: string[] = [];
  for await (const [name, entry] of dirHandle.entries()) {
    if (entry.kind === "file" && name.toLowerCase().endsWith(".md")) {
      files.push(name);
    }
  }
  files.sort((a, b) => a.localeCompare(b));
  return files;
}

/**
 * Reads a specific markdown file from an already-open directory handle.
 * Used when the user clicks a file in the WorkspacePanel sidebar.
 */
export async function openFileFromDirectory(
  dirHandle: FileSystemDirectoryHandle,
  fileName: string,
): Promise<OpenedFile> {
  const fileHandle = await dirHandle.getFileHandle(fileName);
  const file = await fileHandle.getFile();
  return { name: file.name, content: await file.text(), handle: fileHandle };
}

/** Triggers a download of the markdown content as a .md file. */
export function downloadMarkdown(content: string, fileName = "document.md"): void {
  const blob = new Blob([content], { type: "text/markdown" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * Writes `content` to an existing FSAA file handle.
 *
 * Explicitly queries and — if needed — requests `readwrite` permission before
 * calling createWritable(). This is required for handles obtained via
 * showOpenFilePicker(), which only carry `read` access by default; calling
 * createWritable() on them without this step throws NotAllowedError.
 *
 * Throws on any failure. Callers must NOT fall back to a picker on error —
 * surface the error to the user so ⌘S never silently becomes Save As.
 */
export async function writeToFileHandle(
  handle: FileSystemFileHandle,
  content: string,
): Promise<void> {
  // queryPermission / requestPermission are in the WICG FSAA spec but may be
  // absent in older Electron builds or non-FSAA polyfills — guard at runtime.
  if ("queryPermission" in handle) {
    const h = handle as FsaHandle;
    const perm = await h.queryPermission({ mode: "readwrite" });
    if (perm === "prompt") {
      const result = await h.requestPermission({ mode: "readwrite" });
      if (result !== "granted") {
        throw new DOMException(
          "Write permission was not granted by the user.",
          "NotAllowedError",
        );
      }
    } else if (perm === "denied") {
      throw new DOMException(
        "Write permission has been denied for this file.",
        "NotAllowedError",
      );
    }
    // perm === "granted" → fall through to write
  }

  const writable = await handle.createWritable();
  try {
    await writable.write(content);
    await writable.close();
  } catch (e) {
    // Best-effort abort to release the file lock before re-throwing.
    try { await writable.abort(); } catch { /* ignore — already in error path */ }
    throw e;
  }
}

/**
 * Shows the Save File picker, writes the chosen file, and returns the handle.
 * Returns null if the user cancelled the picker. Throws on write failure.
 *
 * Use ONLY for explicit Save As (⌘⇧S / File → Save As).
 * To write to an already-known handle use writeToFileHandle() directly.
 */
export async function saveAsMarkdownFile(
  content: string,
  defaultName = "document.md",
): Promise<FileSystemFileHandle | null> {
  if ("showSaveFilePicker" in window) {
    let handle: FileSystemFileHandle;
    try {
      handle = await (window as Window & typeof globalThis & {
        showSaveFilePicker: (opts: FilePickerOpts) => Promise<FileSystemFileHandle>;
      }).showSaveFilePicker({ ...MARKDOWN_OPTS, suggestedName: defaultName });
    } catch (e) {
      if ((e as DOMException).name === "AbortError") return null;
      throw e;
    }
    // Handles from showSaveFilePicker carry implicit readwrite permission;
    // writeToFileHandle will confirm via queryPermission then write.
    await writeToFileHandle(handle, content);
    return handle;
  }

  // Fallback for browsers without FSAA (Firefox, older Safari).
  downloadMarkdown(content, defaultName);
  return null;
}
