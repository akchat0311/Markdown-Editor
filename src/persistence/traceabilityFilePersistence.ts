import type { TraceabilityFile } from "@/types/traceability";
import { writeToFileHandle } from "@/persistence/fileAccess";

const JSON_PICKER_OPTS = {
  types: [{ description: "JSON", accept: { "application/json": [".json"] } }],
  excludeAcceptAllOption: true,
};

export function serializeTraceability(data: TraceabilityFile): string {
  return JSON.stringify(
    { version: 1, testCases: data.testCases, links: data.links, coverage: data.coverage },
    null,
    2,
  );
}

// ── Open ─────────────────────────────────────────────────────────────────────

export interface LoadedTraceabilityFile {
  /** Raw parsed JSON — pass to traceabilityStore.load(), which migrates/repairs. */
  data: unknown;
  /** The file handle from showOpenFilePicker, or null for the <input> fallback. */
  handle: FileSystemFileHandle | null;
}

/**
 * Opens a file picker for a traceability JSON file and returns the parsed data
 * plus the file handle so callers can store it for subsequent writes.
 *
 * Pass `startIn` to pre-navigate the picker to the same directory as the
 * markdown file. Chrome is inconsistent about accepting a FileSystemFileHandle
 * for startIn, so we fall back to a plain picker on any non-abort error.
 */
export async function openTraceabilityFile(
  opts?: { startIn?: FileSystemFileHandle },
): Promise<LoadedTraceabilityFile | null> {
  if ("showOpenFilePicker" in window) {
    const pick = window as Window & {
      showOpenFilePicker: (o: unknown) => Promise<FileSystemFileHandle[]>;
    };

    const tryPick = async (extraOpts?: object): Promise<LoadedTraceabilityFile> => {
      const [handle] = await pick.showOpenFilePicker({ ...JSON_PICKER_OPTS, ...extraOpts });
      const file = await handle.getFile();
      return { data: JSON.parse(await file.text()), handle };
    };

    try {
      return await tryPick(opts?.startIn ? { startIn: opts.startIn } : undefined);
    } catch (e) {
      if ((e as DOMException).name === "AbortError") return null;
      if (opts?.startIn) {
        try {
          return await tryPick();
        } catch (retryE) {
          if ((retryE as DOMException).name === "AbortError") return null;
          throw retryE;
        }
      }
      throw e;
    }
  }

  // Fallback: <input type="file"> — no handle available
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json,application/json";
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) { resolve(null); return; }
      try {
        resolve({ data: JSON.parse(await file.text()), handle: null });
      } catch {
        resolve(null);
      }
    };
    input.oncancel = () => resolve(null);
    input.click();
  });
}

// ── Save ──────────────────────────────────────────────────────────────────────

/**
 * Writes traceability data directly to an existing file handle.
 *
 * Uses writeToFileHandle (from fileAccess.ts) which checks/requests readwrite
 * permission before writing. Throws on any failure; caller surfaces the error
 * and must leave the store dirty.
 */
export async function writeToTraceabilityHandle(
  handle: FileSystemFileHandle,
  data: TraceabilityFile,
): Promise<void> {
  await writeToFileHandle(handle, serializeTraceability(data));
}

/**
 * Opens a Save File picker, writes the traceability data, and returns the
 * handle so the caller can store it for subsequent direct writes.
 *
 * Returns null if the user cancels. Throws on write failure.
 * Use ONLY for "Save As" — never as the default save path.
 */
export async function saveTraceabilityFileAs(
  data: TraceabilityFile,
  suggestedName = "document.test-traceability.json",
): Promise<FileSystemFileHandle | null> {
  const json = serializeTraceability(data);

  if ("showSaveFilePicker" in window) {
    let handle: FileSystemFileHandle;
    try {
      handle = await (window as Window & {
        showSaveFilePicker: (o: unknown) => Promise<FileSystemFileHandle>;
      }).showSaveFilePicker({ ...JSON_PICKER_OPTS, suggestedName });
    } catch (e) {
      if ((e as DOMException).name === "AbortError") return null;
      throw e;
    }
    // Handles from showSaveFilePicker carry implicit readwrite permission.
    const writable = await handle.createWritable();
    try {
      await writable.write(json);
      await writable.close();
    } catch (e) {
      try { await writable.abort(); } catch { /* ignore */ }
      throw e;
    }
    return handle;
  }

  // Download fallback — no handle
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = suggestedName;
  a.click();
  URL.revokeObjectURL(url);
  return null;
}
