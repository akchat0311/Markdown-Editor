import { create } from "zustand";
import { persist } from "zustand/middleware";

/**
 * Editing-behavior switches.
 *
 * enterMode:
 * - "line" — Enter inserts a single soft line break (one `\n` in the file);
 *   pressing Enter again on the now-empty line converts it to a paragraph
 *   break (blank line). Matches the mental model "Enter = new line".
 * - "paragraph" — classic markdown/Typora behavior: Enter always starts a
 *   new paragraph (blank line in the file); Shift+Enter for a line break.
 *
 * Mirrors the VS Code extension's store (there the value is pushed from the
 * `mdreq.newlineBehavior` setting); in the browser app it is a persisted
 * user preference toggled from the status bar.
 */
export type EnterMode = "line" | "paragraph";

interface EditorBehaviorState {
  enterMode: EnterMode;
  setEnterMode(mode: EnterMode): void;
  toggleEnterMode(): void;
}

export const useEditorBehaviorStore = create<EditorBehaviorState>()(
  persist(
    (set) => ({
      enterMode: "line",
      setEnterMode: (enterMode) => set({ enterMode }),
      toggleEnterMode: () =>
        set((s) => ({ enterMode: s.enterMode === "line" ? "paragraph" : "line" })),
    }),
    { name: "editorBehavior" },
  ),
);
