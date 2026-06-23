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

  renumberComments(oldId: string, newId: string): void;
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

  renumberComments(oldId, newId) {
    set((s) => {
      const existing = s.comments[oldId];
      if (!existing) return s;
      const { [oldId]: _removed, ...rest } = s.comments;
      return {
        comments: { ...rest, [newId]: existing },
        isDirty: true,
      };
    });
  },
}));
