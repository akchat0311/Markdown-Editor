import { createContext } from "react";
import type { Editor } from "@tiptap/core";

/** Provides the active Tiptap Editor instance to all descendant components. */
export const EditorContext = createContext<Editor | null>(null);
