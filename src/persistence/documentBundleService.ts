/**
 * Document bundle service — centralises the relationship between a markdown
 * file and its companion review JSON.
 *
 * Bundle layout:
 *   requirements.md           — content, structure, requirement IDs (source of truth)
 *   requirements.review.json  — comments, responses, closure state (source of truth)
 *
 * All filename-derivation logic lives here so callers never scatter
 * `.replace(".md", ".review.json")` across the codebase.
 *
 * File discovery requires a FileSystemDirectoryHandle. When the markdown was
 * opened via showOpenFilePicker the browser's FSAA sandbox does not expose
 * sibling files, so findReviewFile returns `reviewFound: false` and the caller
 * is expected to surface a non-blocking prompt for manual loading.
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

// ── Discovery ─────────────────────────────────────────────────────────────────

export interface BundleResult {
  reviewData: ReviewFile | null;
  reviewFound: boolean;
}

/**
 * Attempts to find and parse the companion review file within a directory.
 *
 * Requires a FileSystemDirectoryHandle (obtained via showDirectoryPicker) —
 * the only standards-compliant way to access sibling files in the browser
 * FSAA model without an additional user-facing picker dialog.
 *
 * When dirHandle is absent (the common case when markdown was opened via
 * showOpenFilePicker), returns `{ reviewFound: false }` immediately. The
 * calling code should then surface a non-blocking CTA so the user can load
 * the review file with a single click.
 */
export async function findReviewFile(
  dirHandle: FileSystemDirectoryHandle | null | undefined,
  reviewFileName: string,
): Promise<BundleResult> {
  if (!dirHandle) {
    return { reviewData: null, reviewFound: false };
  }
  try {
    // FileSystemDirectoryHandle.getFileHandle is part of the FSAA spec but
    // not yet reflected in all TS DOM type versions — cast defensively.
    const handle = await (dirHandle as FileSystemDirectoryHandle & {
      getFileHandle(name: string, opts?: { create?: boolean }): Promise<FileSystemFileHandle>;
    }).getFileHandle(reviewFileName, { create: false });

    const file = await handle.getFile();
    const text = await file.text();
    return { reviewData: migrateReviewFile(JSON.parse(text)), reviewFound: true };
  } catch (e) {
    // NotFoundError is expected — the review file simply isn't in the folder.
    // Any other error (parse failure, permission revoked, schema mismatch) is
    // unexpected; log it so it doesn't silently masquerade as "not found".
    if ((e as DOMException | Error)?.name !== "NotFoundError") {
      console.error("[findReviewFile]", (e as Error)?.name, e);
    }
    return { reviewData: null, reviewFound: false };
  }
}
