import { create } from "zustand";
import type { RequirementStatus } from "@/types/requirementStatus";
import { loadRequirementStatuses } from "@/services/requirementStatusService";

interface StatusConfigState {
  statuses: RequirementStatus[];
  loaded: boolean;
  load: () => Promise<void>;
}

export const useStatusConfigStore = create<StatusConfigState>((set, get) => ({
  statuses: [],
  loaded: false,
  load: async () => {
    if (get().loaded) return;
    const statuses = await loadRequirementStatuses();
    set({ statuses, loaded: true });
  },
}));
