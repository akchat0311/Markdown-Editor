import { create } from "zustand";

interface WorkspaceState {
  dirHandle: FileSystemDirectoryHandle | null;
  dirName: string;
  markdownFiles: string[];
  setWorkspace(dirHandle: FileSystemDirectoryHandle, files: string[]): void;
  clearWorkspace(): void;
}

export const useWorkspaceStore = create<WorkspaceState>()((set) => ({
  dirHandle: null,
  dirName: "",
  markdownFiles: [],

  setWorkspace(dirHandle, files) {
    set({ dirHandle, dirName: dirHandle.name, markdownFiles: files });
  },

  clearWorkspace() {
    set({ dirHandle: null, dirName: "", markdownFiles: [] });
  },
}));
