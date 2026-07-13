import { create } from "zustand";
import { persist } from "zustand/middleware";

/**
 * Two ways to define how requirement IDs are detected:
 *
 *  - "simple": user gives one example ID (e.g. "REQ_001"); prefix + digit
 *    width are derived automatically. This is the original/default mode.
 *  - "regex":  user supplies a full regular expression with a capture group
 *    for the ID (named `id`, or the first group when unnamed). Use this for
 *    ID shapes the simple mode can't express (no numeric suffix, multiple
 *    numeric segments, alphanumeric IDs, etc).
 *
 * Mutation features that need to *generate* new IDs (Insert Requirement,
 * Renumber, Reassign Duplicate, the "/requirement" slash command) only work
 * in "simple" mode, since a regex describes matching, not generation — see
 * CompiledPattern.supportsNumbering in requirementOps.ts.
 */
export type RequirementPattern =
  | { mode: "simple"; example: string }
  | { mode: "regex"; source: string; flags: string };

/** Pre-1.0 persisted shape, before the `mode` discriminant existed. */
interface LegacyRequirementPattern {
  example: string;
}

interface ConfigState {
  requirementPattern: RequirementPattern | null;
  /** Simple mode: derives prefix + digit width from one example ID. */
  setRequirementPattern(example: string): void;
  /** Regex mode: caller is responsible for validating first (see
   *  validateRequirementRegex in requirementOps.ts) — an invalid regex is
   *  still stored as typed (so the UI can keep echoing it back to the user)
   *  but compileRequirementPattern() will treat it as unusable everywhere. */
  setRequirementRegexPattern(source: string, flags?: string): void;
  clearRequirementPattern(): void;
}

export type { ConfigState };

const CONFIG_STORE_VERSION = 1;

export const useConfigStore = create<ConfigState>()(
  persist(
    (set) => ({
      requirementPattern: null,
      setRequirementPattern: (example) =>
        set({ requirementPattern: { mode: "simple", example: example.trim() } }),
      setRequirementRegexPattern: (source, flags = "") =>
        set({
          requirementPattern: { mode: "regex", source: source.trim(), flags: flags.trim() },
        }),
      clearRequirementPattern: () => set({ requirementPattern: null }),
    }),
    {
      name: "md-editor-config",
      version: CONFIG_STORE_VERSION,
      partialize: (s) => ({ requirementPattern: s.requirementPattern }),
      // Pre-version-1 persisted state stored requirementPattern as a bare
      // { example } object with no `mode` field. Tag it as "simple" so
      // documents/browsers that configured a pattern before regex mode
      // shipped keep working without the user re-entering anything.
      migrate: (persistedState) => {
        const state = persistedState as { requirementPattern?: unknown } | undefined;
        const pattern = state?.requirementPattern;
        if (pattern && typeof pattern === "object" && !("mode" in pattern)) {
          return {
            ...state,
            requirementPattern: {
              mode: "simple" as const,
              example: (pattern as LegacyRequirementPattern).example,
            },
          };
        }
        return state as ConfigState;
      },
    }
  )
);
