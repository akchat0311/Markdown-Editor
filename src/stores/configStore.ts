import { create } from "zustand";
import { persist } from "zustand/middleware";

export interface RequirementPattern {
  example: string;
}

interface ConfigState {
  requirementPattern: RequirementPattern | null;
  setRequirementPattern(example: string): void;
  clearRequirementPattern(): void;
}

export type { ConfigState };

export const useConfigStore = create<ConfigState>()(
  persist(
    (set) => ({
      requirementPattern: null,
      setRequirementPattern: (example) =>
        set({ requirementPattern: { example: example.trim() } }),
      clearRequirementPattern: () => set({ requirementPattern: null }),
    }),
    {
      name: "md-editor-config",
      partialize: (s) => ({ requirementPattern: s.requirementPattern }),
    }
  )
);
