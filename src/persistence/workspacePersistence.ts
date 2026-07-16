/**
 * Workspace persistence — remembers the last-opened document so the app can
 * offer to restore it after a page reload.
 *
 * FileSystemFileHandle and FileSystemDirectoryHandle are both structured-
 * cloneable and can be stored in IndexedDB. Handles survive a reload but their
 * permission is revoked by the browser per the FSAA security model, so we
 * always check queryPermission before use and prompt the user when needed.
 */

import { getDB, WORKSPACE_STORE } from "./db";

// WICG FSAA permission methods — not in base TS DOM lib.
type FsaHandle = FileSystemFileHandle & {
  queryPermission(d: { mode: "read" | "readwrite" }): Promise<"granted" | "denied" | "prompt">;
  requestPermission(d: { mode: "read" | "readwrite" }): Promise<"granted" | "denied" | "prompt">;
};

type FsaDirHandle = FileSystemDirectoryHandle & {
  queryPermission(d: { mode: "read" | "readwrite" }): Promise<"granted" | "denied" | "prompt">;
  requestPermission(d: { mode: "read" | "readwrite" }): Promise<"granted" | "denied" | "prompt">;
};

export interface WorkspaceDoc {
  /** Always "active" — singleton record. */
  key: "active";
  fileHandle: FileSystemFileHandle;
  fileName: string;
  reviewHandle?: FileSystemFileHandle;
  reviewFileName?: string;
  traceabilityHandle?: FileSystemFileHandle;
  /** Directory handle from showDirectoryPicker — enables sibling file discovery on restore. */
  dirHandle?: FileSystemDirectoryHandle;
  lastOpenedAt: number;
}

// ── CRUD ──────────────────────────────────────────────────────────────────────

export async function saveWorkspaceDoc(
  entry: Pick<WorkspaceDoc, "fileHandle" | "fileName"> & {
    dirHandle?: FileSystemDirectoryHandle;
    reviewHandle?: FileSystemFileHandle;
    traceabilityHandle?: FileSystemFileHandle;
  },
): Promise<void> {
  const db = await getDB();
  const record: WorkspaceDoc = {
    key: "active",
    fileHandle: entry.fileHandle,
    fileName: entry.fileName,
    lastOpenedAt: Date.now(),
  };
  if (entry.dirHandle) record.dirHandle = entry.dirHandle;
  if (entry.reviewHandle) record.reviewHandle = entry.reviewHandle;
  if (entry.traceabilityHandle) record.traceabilityHandle = entry.traceabilityHandle;
  await db.put(WORKSPACE_STORE, record);
}

export async function loadWorkspaceDoc(): Promise<WorkspaceDoc | undefined> {
  const db = await getDB();
  return db.get(WORKSPACE_STORE, "active");
}

export async function clearWorkspaceDoc(): Promise<void> {
  const db = await getDB();
  await db.delete(WORKSPACE_STORE, "active");
}

// ── Handle permission helpers ─────────────────────────────────────────────────

export type HandlePermission = "granted" | "prompt" | "denied";

/**
 * Queries the current read permission state of a stored file handle without
 * triggering a browser prompt. Returns "denied" for any error or if the
 * permission API is unavailable.
 */
export async function checkHandlePermission(
  handle: FileSystemFileHandle,
): Promise<HandlePermission> {
  if (!("queryPermission" in handle)) return "denied";
  try {
    return await (handle as FsaHandle).queryPermission({ mode: "read" });
  } catch {
    return "denied";
  }
}

/**
 * Requests read permission for a stored file handle. Must be called from a
 * user gesture. Returns true if permission was granted.
 */
export async function requestHandlePermission(
  handle: FileSystemFileHandle,
): Promise<boolean> {
  if (!("requestPermission" in handle)) return false;
  try {
    const result = await (handle as FsaHandle).requestPermission({ mode: "read" });
    return result === "granted";
  } catch {
    return false;
  }
}

/**
 * Queries the current read permission state of a stored directory handle.
 * Returns "denied" for any error or if the permission API is unavailable.
 */
export async function checkDirHandlePermission(
  handle: FileSystemDirectoryHandle,
): Promise<HandlePermission> {
  if (!("queryPermission" in handle)) return "denied";
  try {
    return await (handle as FsaDirHandle).queryPermission({ mode: "read" });
  } catch {
    return "denied";
  }
}

/**
 * Requests read permission for a stored directory handle. Must be called from
 * a user gesture. Returns true if permission was granted.
 */
export async function requestDirHandlePermission(
  handle: FileSystemDirectoryHandle,
): Promise<boolean> {
  if (!("requestPermission" in handle)) return false;
  try {
    const result = await (handle as FsaDirHandle).requestPermission({ mode: "read" });
    return result === "granted";
  } catch {
    return false;
  }
}

// ── File content helper ───────────────────────────────────────────────────────

/**
 * Reads the current content of the file behind a handle. Caller must have
 * already verified/granted permission before calling this.
 */
export async function readHandleContent(handle: FileSystemFileHandle): Promise<string> {
  const file = await handle.getFile();
  return file.text();
}
