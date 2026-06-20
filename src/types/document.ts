import type { JSONContent } from "@tiptap/core";

export interface EditorDocumentState {
  /** Markdown source of truth, regenerated after every editor transaction. */
  markdown: string;
  /** ProseMirror document as plain JSON, used for persistence/recovery. */
  json: JSONContent;
  updatedAt: number;
}

export interface PersistedDocument {
  id: string;
  name: string;
  state: EditorDocumentState;
  /** File System Access API handle is not persistable to IndexedDB across
   *  reloads in all browsers, so we track the file name only and re-request
   *  permission on demand. */
  fileName?: string;
}

export type { JSONContent };
