import { create } from "zustand";
import type { ReviewFile, ReviewComment, CommentStatus } from "@/types/reviewComment";

function makeId(): string {
  return `c_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

export function migrateComment(raw: Record<string, unknown>): ReviewComment {
  return {
    id: String(raw.id),
    author: String(raw.author),
    text: String(raw.text),
    createdAt: String(raw.createdAt),
    status: (raw.status as CommentStatus | undefined) ?? "open",
    response: raw.response as string | undefined,
    respondedBy: raw.respondedBy as string | undefined,
    respondedAt: raw.respondedAt as string | undefined,
    closedBy: raw.closedBy as string | undefined,
    closedAt: raw.closedAt as string | undefined,
  };
}

export function migrateReviewFile(raw: unknown): ReviewFile {
  const obj = raw as Record<string, unknown>;
  const result: ReviewFile = { _version: 1 };
  for (const [key, val] of Object.entries(obj)) {
    if (key.startsWith("_")) continue;
    if (Array.isArray(val)) {
      result[key] = val.map((c) => migrateComment(c as Record<string, unknown>));
    }
  }
  return result;
}

interface ReviewCommentsState {
  comments: ReviewFile;
  isDirty: boolean;
  loaded: boolean;

  load(data: ReviewFile): void;
  reset(): void;
  markSaved(): void;

  addComment(reqId: string, author: string, text: string): ReviewComment;
  updateComment(reqId: string, commentId: string, patch: { author?: string; text?: string }): void;
  deleteComment(reqId: string, commentId: string): void;
  getComments(reqId: string): ReviewComment[];

  respondToComment(reqId: string, commentId: string, response: string, respondedBy: string): void;
  closeComment(reqId: string, commentId: string, closedBy: string): void;
  reopenComment(reqId: string, commentId: string): void;

  /**
   * Batch-migrates comment threads for a full requirement renumbering pass.
   * Takes a rename LIST, not per-pair calls — a single old ID can legitimately
   * appear more than once (a requirement duplicated via copy/paste shares one
   * ID across several physical headings until renumbering assigns each its
   * own new ID). Calling a single-pair move in a loop for that case silently
   * empties the source after the first call, so every occurrence after the
   * first ends up with no comments at all.
   *
   * Grouped by oldId, then handled per group:
   * - ONE destination: the thread moves onto the new ID, merging with (never
   *   overwriting) anything already there.
   * - MULTIPLE destinations (a duplicated ID splitting apart): the thread
   *   can't be split by occurrence, so it is COPIED onto every destination.
   *
   * Reads only the ORIGINAL snapshot, so overlapping renames (REQ_003→REQ_001
   * while REQ_001→REQ_002) never cascade through intermediate results.
   */
  renumberComments(renames: readonly { oldId: string; newId: string }[]): void;

  /**
   * Duplicates one requirement's comment thread onto another WITHOUT
   * touching the source — used when a duplicated heading is resolved by
   * reassigning ONE occurrence to a fresh ID (the remaining occurrence(s)
   * still bearing the original ID must keep everything they had; this is a
   * copy, not a rename). Merges with, never overwrites, anything already at
   * the destination. Mirrors traceabilityStore.copyRequirementLinks.
   */
  copyRequirementComments(fromReq: string, toReq: string): void;

  /**
   * Safely migrates review comments when a review target ID is renamed.
   *
   * - "migrated": comments moved from oldId to newId (safe rename)
   * - "conflict": newId already has comments; migration blocked to prevent data loss
   * - "noop": oldId had no comments; nothing to migrate
   */
  migrateReviewTarget(oldId: string, newId: string): "migrated" | "conflict" | "noop";
}

export const useReviewCommentsStore = create<ReviewCommentsState>((set, get) => ({
  comments: {},
  isDirty: false,
  loaded: false,

  load(data) {
    set({ comments: migrateReviewFile(data), isDirty: false, loaded: true });
  },

  reset() {
    set({ comments: {}, isDirty: false, loaded: false });
  },

  markSaved() {
    set({ isDirty: false });
  },

  addComment(reqId, author, text) {
    const comment: ReviewComment = {
      id: makeId(),
      author: author.trim(),
      text: text.trim(),
      createdAt: new Date().toISOString(),
      status: "open",
    };
    set((s) => ({
      comments: { ...s.comments, [reqId]: [...(s.comments[reqId] as ReviewComment[] ?? []), comment] },
      isDirty: true,
      loaded: true,
    }));
    return comment;
  },

  updateComment(reqId, commentId, patch) {
    set((s) => ({
      comments: {
        ...s.comments,
        [reqId]: ((s.comments[reqId] as ReviewComment[]) ?? []).map((c) =>
          c.id === commentId ? { ...c, ...patch } : c
        ),
      },
      isDirty: true,
    }));
  },

  deleteComment(reqId, commentId) {
    set((s) => ({
      comments: {
        ...s.comments,
        [reqId]: ((s.comments[reqId] as ReviewComment[]) ?? []).filter((c) => c.id !== commentId),
      },
      isDirty: true,
    }));
  },

  getComments(reqId) {
    return (get().comments[reqId] as ReviewComment[]) ?? [];
  },

  respondToComment(reqId, commentId, response, respondedBy) {
    set((s) => ({
      comments: {
        ...s.comments,
        [reqId]: ((s.comments[reqId] as ReviewComment[]) ?? []).map((c) =>
          c.id === commentId
            ? {
                ...c,
                status: "responded" as CommentStatus,
                response: response.trim(),
                respondedBy: respondedBy.trim(),
                respondedAt: new Date().toISOString(),
              }
            : c
        ),
      },
      isDirty: true,
    }));
  },

  closeComment(reqId, commentId, closedBy) {
    set((s) => ({
      comments: {
        ...s.comments,
        [reqId]: ((s.comments[reqId] as ReviewComment[]) ?? []).map((c) =>
          c.id === commentId
            ? {
                ...c,
                status: "closed" as CommentStatus,
                closedBy: closedBy.trim(),
                closedAt: new Date().toISOString(),
              }
            : c
        ),
      },
      isDirty: true,
    }));
  },

  reopenComment(reqId, commentId) {
    set((s) => ({
      comments: {
        ...s.comments,
        [reqId]: ((s.comments[reqId] as ReviewComment[]) ?? []).map((c) =>
          c.id === commentId
            ? {
                ...c,
                status: "open" as CommentStatus,
                closedBy: undefined,
                closedAt: undefined,
              }
            : c
        ),
      },
      isDirty: true,
    }));
  },

  renumberComments(renames) {
    if (renames.length === 0) return;
    const s = get();

    // Self-pairs are KEPT at this stage — when one duplicate occurrence
    // keeps its number while another diverges (REQ_001→REQ_001 and
    // REQ_001→REQ_002 in the same batch), the self-pair is the only signal
    // that REQ_001 was shared by two occurrences; dropping it here would
    // collapse the group to a single destination and wrongly MOVE the
    // thread away from the occurrence that never changed.
    const byOld = new Map<string, string[]>();
    for (const { oldId, newId } of renames) {
      let dests = byOld.get(oldId);
      if (!dests) {
        dests = [];
        byOld.set(oldId, dests);
      }
      if (!dests.includes(newId)) dests.push(newId);
    }
    // NOW drop true no-ops: a group whose only destination is the source itself.
    for (const [oldId, dests] of byOld) {
      if (dests.length === 1 && dests[0] === oldId) byOld.delete(oldId);
    }
    if (byOld.size === 0) return;

    let changed = false;
    const next: ReviewFile = {};
    // Everything not being renamed away carries over untouched — including
    // `_version` and any other non-array metadata key.
    for (const [key, val] of Object.entries(s.comments)) {
      if (!Array.isArray(val) || !byOld.has(key)) next[key] = val;
    }

    for (const [oldId, dests] of byOld) {
      const sourceComments = s.comments[oldId] as ReviewComment[] | undefined;
      if (!sourceComments || sourceComments.length === 0) continue;
      changed = true;
      for (const newId of dests) {
        const existing = (next[newId] as ReviewComment[] | undefined) ?? [];
        next[newId] = [...existing, ...sourceComments];
      }
    }

    if (!changed) return;
    set({ comments: next, isDirty: true });
  },

  copyRequirementComments(fromReq, toReq) {
    if (fromReq === toReq) return;
    const s = get();
    const sourceComments = s.comments[fromReq] as ReviewComment[] | undefined;
    if (!sourceComments || sourceComments.length === 0) return;
    const existing = (s.comments[toReq] as ReviewComment[] | undefined) ?? [];
    set({
      comments: { ...s.comments, [toReq]: [...existing, ...sourceComments] },
      isDirty: true,
    });
  },

  migrateReviewTarget(oldId, newId) {
    const s = get();
    const oldComments = s.comments[oldId] as ReviewComment[] | undefined;
    if (!oldComments || oldComments.length === 0) return "noop";

    const newComments = s.comments[newId] as ReviewComment[] | undefined;
    if (newComments && newComments.length > 0) return "conflict";

    set((current) => {
      const { [oldId]: moved, ...rest } = current.comments;
      return { comments: { ...rest, [newId]: moved }, isDirty: true };
    });
    return "migrated";
  },
}));
