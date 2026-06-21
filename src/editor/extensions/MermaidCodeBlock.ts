import CodeBlock from "@tiptap/extension-code-block";
import { ReactNodeViewRenderer } from "@tiptap/react";
import { MermaidView } from "../components/MermaidView";

/**
 * Extends StarterKit's CodeBlock with a React NodeView.
 *
 * For regular code blocks the NodeView renders an identical <pre><code> structure.
 * For `language="mermaid"` blocks it renders a Mermaid diagram in preview mode
 * and the source editor when the cursor is inside the block (Typora-style).
 *
 * No parser or serializer changes are needed: mermaid blocks are stored on disk
 * as standard fenced code blocks with `mermaid` as the language identifier.
 */
export const MermaidCodeBlock = CodeBlock.extend({
  addNodeView() {
    return ReactNodeViewRenderer(MermaidView);
  },
});
