import { create } from "zustand";

const STORAGE_KEY = "userSettings";

interface UserSettingsState {
  userName: string;
  configured: boolean;
  load: () => void;
  save: (name: string) => void;
}

export const useUserSettingsStore = create<UserSettingsState>((set) => ({
  userName: "",
  configured: false,

  load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const data = JSON.parse(raw) as { userName?: string };
        const name = data.userName?.trim() ?? "";
        if (name.length >= 2) {
          set({ userName: name, configured: true });
          return;
        }
      }
    } catch {
      // Corrupted storage — start unconfigured.
    }
  },

  save(name: string) {
    const trimmed = name.trim();
    if (trimmed.length < 2) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ userName: trimmed }));
    } catch {
      // Storage unavailable — still update in-memory state.
    }
    set({ userName: trimmed, configured: true });
  },
}));
