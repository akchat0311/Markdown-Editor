import { create } from "zustand";

interface CommentDrawerState {
  reqId: string | null;
  status: string;
  open: (reqId: string, status: string) => void;
  close: () => void;
}

export const useCommentDrawerStore = create<CommentDrawerState>((set) => ({
  reqId: null,
  status: "unknown",
  open: (reqId, status) => set({ reqId, status }),
  close: () => set({ reqId: null, status: "unknown" }),
}));
