/**
 * Document bundle service — centralises the relationship between a markdown
 * file and its companion sidecar JSON files.
 *
 * Bundle layout:
 *   requirements.md                       — content, structure, requirement IDs (source of truth)
 *   requirements.review.json              — comments, responses, closure state (source of truth)
 *   requirements.test-traceability.json   — test cases + requirement links (source of truth)
 *
 * All filename-derivation logic lives here so callers never scatter
 * `.replace(".md", ".review.json")` across the codebase.
 *
 * File discovery requires a FileSystemDirectoryHandle. When the markdown was
 * opened via showOpenFilePicker the browser's FSAA sandbox does not expose
 * sibling files, so discovery reports "not found" and the caller is expected
 * to surface a non-blocking prompt for manual loading.
 */

import type { ReviewFile } from "@/types/reviewComment";
import { migrateReviewFile } from "@/stores/reviewCommentsStore";

// ── Naming ────────────────────────────────────────────────────────────────────

/**
 * Derives the companion review filename for a given markdown filename.
 *   requirements.md  →  requirements.review.json
 *   spec.md          →  spec.review.json
 */
export function deriveReviewFileName(markdownName: string): string {
  return markdownName.replace(/\.md$/i, ".review.json");
}

/**
 * Derives the companion traceability filename for a given markdown filename.
 *   requirements.md  →  requirements.test-traceability.json
 */
export function deriveTraceabilityFileName(markdownName: string): string {
  return markdownName.replace(/\.md$/i, ".test-traceability.json");
}

// ── Discovery ─────────────────────────────────────────────────────────────────

interface CompanionResult {
  /** Raw parsed JSON when found — callers migrate/validate it themselves. */
  data: unknown;
  found: boolean;
  /** The sibling file's handle when found — enables direct saves later. */
  handle: FileSystemFileHandle | null;
  /**
   * True when the file appears to exist but could not be read or parsed
   * (as opposed to simply being absent). Callers that write back to the
   * file must treat this as "do not overwrite".
   */
  readError: boolean;
}

/**
 * Attempts to find and parse a companion JSON file within a directory.
 *
 * Requires a FileSystemDirectoryHandle (obtained via showDirectoryPicker) —
 * the only standards-compliant way to access sibling files in the browser
 * FSAA model without an additional user-facing picker dialog.
 *
 * When dirHandle is absent (the common case when markdown was opened via
 * showOpenFilePicker), reports not-found immediately. The calling code should
 * then surface a non-blocking CTA so the user can load the file manually.
 */
async function findCompanionFile(
  dirHandle: FileSystemDirectoryHandle | null | undefined,
  fileName: string,
): Promise<CompanionResult> {
  if (!dirHandle) {
    return { data: null, found: false, handle: null, readError: false };
  }
  let handle: FileSystemFileHandle;
  let text: string;
  try {
    // FileSystemDirectoryHandle.getFileHandle is part of the FSAA spec but
    // not yet reflected in all TS DOM type versions — cast defensively.
    handle = await (dirHandle as FileSystemDirectoryHandle & {
      getFileHandle(name: string, opts?: { create?: boolean }): Promise<FileSystemFileHandle>;
    }).getFileHandle(fileName, { create: false });

    const file = await handle.getFile();
    text = await file.text();
  } catch (e) {
    // NotFoundError is expected — the file simply isn't in the folder.
    // Any other error (permission revoked, read failure) is unexpected;
    // log it so it doesn't silently masquerade as "not found".
    if ((e as DOMException | Error)?.name !== "NotFoundError") {
      console.error("[findCompanionFile]", fileName, (e as Error)?.name, e);
      return { data: null, found: false, handle: null, readError: true };
    }
    return { data: null, found: false, handle: null, readError: false };
  }
  try {
    return { data: JSON.parse(text), found: true, handle, readError: false };
  } catch (e) {
    console.error("[findCompanionFile]", fileName, (e as Error)?.name, e);
    return { data: null, found: false, handle: null, readError: true };
  }
}

export interface BundleResult {
  reviewData: ReviewFile | null;
  reviewFound: boolean;
}

/**
 * Attempts to find and parse the companion review file within a directory.
 * See findCompanionFile for discovery semantics.
 */
export async function findReviewFile(
  dirHandle: FileSystemDirectoryHandle | null | undefined,
  reviewFileName: string,
): Promise<BundleResult> {
  const result = await findCompanionFile(dirHandle, reviewFileName);
  if (!result.found) {
    return { reviewData: null, reviewFound: false };
  }
  try {
    return { reviewData: migrateReviewFile(result.data), reviewFound: true };
  } catch (e) {
    // Pre-refactor behaviour: a migration failure is logged and reported as
    // not-found rather than thrown.
    console.error("[findReviewFile]", (e as Error)?.name, e);
    return { reviewData: null, reviewFound: false };
  }
}

export interface TraceabilityBundleResult {
  /** Raw parsed JSON — pass to traceabilityStore.load(), which migrates/repairs. */
  traceabilityData: unknown;
  traceabilityFound: boolean;
  /** Handle of the discovered sidecar, for direct saves without a picker. */
  traceabilityHandle: FileSystemFileHandle | null;
  /**
   * True when the sidecar exists but could not be read/parsed. Callers must
   * surface this and block saves to it (never overwrite what couldn't be read).
   */
  traceabilityError: boolean;
}

/**
 * Attempts to find and parse the companion test-traceability file within a
 * directory. See findCompanionFile for discovery semantics.
 */
export async function findTraceabilityFile(
  dirHandle: FileSystemDirectoryHandle | null | undefined,
  traceabilityFileName: string,
): Promise<TraceabilityBundleResult> {
  const result = await findCompanionFile(dirHandle, traceabilityFileName);
  return {
    traceabilityData: result.data,
    traceabilityFound: result.found,
    traceabilityHandle: result.handle,
    traceabilityError: result.readError,
  };
}
