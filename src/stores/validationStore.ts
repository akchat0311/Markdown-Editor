import { create } from "zustand";
import type { ValidationIssue } from "@/types/validation";

interface ValidationState {
  issues: ValidationIssue[];
  setIssues: (issues: ValidationIssue[]) => void;
}

/**
 * Holds the current document-quality validation issues.
 *
 * Updated by App.tsx whenever useDocumentValidation produces a new result.
 * Any component can subscribe to read the current issues without prop-drilling.
 */
export const useValidationStore = create<ValidationState>()((set) => ({
  issues: [],
  setIssues: (issues) => set({ issues }),
}));
