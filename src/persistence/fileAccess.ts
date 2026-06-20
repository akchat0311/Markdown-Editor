/** File System Access API helpers with download/upload fallback. */

interface FilePickerOpts {
  types?: Array<{ description?: string; accept: Record<string, string[]> }>;
  excludeAcceptAllOption?: boolean;
  suggestedName?: string;
}

const MARKDOWN_OPTS: FilePickerOpts = {
  types: [{ description: "Markdown", accept: { "text/markdown": [".md"] } }],
  excludeAcceptAllOption: false,
};

export interface OpenedFile {
  name: string;
  content: string;
  handle: FileSystemFileHandle | null;
}

/** Opens a file picker and reads the chosen .md file. */
export async function openMarkdownFile(): Promise<OpenedFile | null> {
  // File System Access API — preserves the handle for later saves
  if ("showOpenFilePicker" in window) {
    try {
      const [handle] = await (window as Window & typeof globalThis & { showOpenFilePicker: (opts: FilePickerOpts) => Promise<FileSystemFileHandle[]> }).showOpenFilePicker(MARKDOWN_OPTS);
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

/** Attempts to save via File System Access API, falls back to download. */
export async function saveMarkdownFile(
  content: string,
  existingHandle?: FileSystemFileHandle | null,
  defaultName = "document.md"
): Promise<FileSystemFileHandle | null> {
  // Try to write to existing handle first
  if (existingHandle) {
    try {
      const writable = await existingHandle.createWritable();
      await writable.write(content);
      await writable.close();
      return existingHandle;
    } catch {
      // Permission might have been revoked — fall through to picker
    }
  }

  // Show save picker
  if ("showSaveFilePicker" in window) {
    try {
      const handle = await (window as Window & typeof globalThis & { showSaveFilePicker: (opts: FilePickerOpts) => Promise<FileSystemFileHandle> }).showSaveFilePicker({
        ...MARKDOWN_OPTS,
        suggestedName: defaultName,
      });
      const writable = await handle.createWritable();
      await writable.write(content);
      await writable.close();
      return handle;
    } catch (e) {
      if ((e as DOMException).name === "AbortError") return null;
      throw e;
    }
  }

  // Final fallback: plain download
  downloadMarkdown(content, defaultName);
  return null;
}
