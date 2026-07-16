import { create } from "zustand";

/**
 * Controls the contextual Traceability panel in the editor's right workspace
 * (the same slot the review CommentDrawer occupies — one panel at a time;
 * App.tsx enforces the mutual exclusion).
 */
interface TraceabilityPanelState {
  reqId: string | null;
  open: (reqId: string) => void;
  close: () => void;
}

export const useTraceabilityPanelStore = create<TraceabilityPanelState>((set) => ({
  reqId: null,
  open: (reqId) => set({ reqId }),
  close: () => set({ reqId: null }),
}));
