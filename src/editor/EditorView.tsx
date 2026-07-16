import { useMemo, useRef } from "react";
import { EditorContent, useEditor, type JSONContent } from "@tiptap/react";
import { createEditorExtensions } from "./extensions";
import { EditorToolbar } from "./Toolbar";

export interface EditorViewProps {
  /** Used once to seed the editor on mount. Tiptap owns document state from
   *  then on — updates must flow out via onChange, not back in through this
   *  prop (re-feeding live state into `content` causes redundant setOptions
   *  calls on every keystroke and fights the editor's own state). */
  initialContent: JSONContent;
  onChange: (doc: JSONContent) => void;
  editable?: boolean;
}

export function EditorView({ initialContent, onChange, editable = true }: EditorViewProps) {
  // Stable extensions array — prevents Tiptap's compareOptions from seeing a
  // new reference on every render and calling setOptions() synchronously
  // (which would invoke onUpdate during React's render phase → setState warning).
  const extensions = useMemo(() => createEditorExtensions(), []);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const editor = useEditor({
    extensions,
    content: initialContent,
    editable,
    onUpdate: ({ editor }) => {
      const doc = editor.getJSON();
      // queueMicrotask breaks any residual synchronous call path during render
      queueMicrotask(() => onChangeRef.current(doc));
    },
    editorProps: {
      attributes: { spellcheck: "true" },
    },
  });

  if (!editor) return null;

  return (
    <div className="w-full py-8">
      <EditorToolbar editor={editor} />
      <div className="doc-page">
        <EditorContent editor={editor} />
      </div>
    </div>
  );
}
