# Markdown Editor

A Typora-style WYSIWYG Markdown editor. Markdown is the canonical format — every edit round-trips to deterministic, diff-friendly Markdown.

## Quick Start

```bash
npm install
npm run dev        # dev server at http://localhost:5173
npm run build      # production build
npm run preview    # preview production build
```

## Testing

```bash
npm test                 # vitest unit suite (shared with the VS Code extension's engine)
npm run test:watch
npm run typecheck
npm run lint
```

## Features

| Feature | Status |
| - | - |
| WYSIWYG editor (Tiptap v3 / ProseMirror) | ✅ |
| Markdown round-trip (deterministic) | ✅ |
| Fidelity: only edited blocks are rewritten; untouched lines stay byte-identical | ✅ |
| Enter = one newline (toggle Line / Paragraph mode in the status bar) | ✅ |
| Requirement headings: `[Status] [Variant]` brackets, variant vocabulary, quality rule | ✅ |
| Ordered-list markers renumbered in the file when a list is edited | ✅ |
| Document tabs (multi-document) | ✅ |
| Source mode (⌘/ — synced textarea) | ✅ |
| Slash command menu (`/`) | ✅ |
| Floating bubble toolbar | ✅ |
| Callout blocks (`[!INFO]` / `[!WARNING]` …) | ✅ |
| Outline sidebar (live, click-to-jump) | ✅ |
| Global search (⌘K) | ✅ |
| Autosave to IndexedDB | ✅ |
| Open / Save via File System Access API | ✅ |
| Markdown export | ✅ |
| Light / dark theme (persisted) | ✅ |
| Status bar (word count, reading time) | ✅ |
| Typora live-preview syntax decorations | 🔜 M2 |
| Mermaid diagram blocks | 🔜 M3 |
| Focus mode (⌘⇧F) | 🔜 M4 |
| File tree sidebar | 🔜 M4 |
| DOCX / PDF export | 🔜 stub ready |

## Architecture

### Data flow

```
User types → Tiptap/ProseMirror (always mounted)
                  │ onUpdate (queueMicrotask)
                  ▼
           tabStore.updateActiveTab({ markdown, isDirty })
                  │
          ┌───────┴──────────┐
          ▼                  ▼
    useAutosave           Outline sidebar
  (IndexedDB 2s         derives from live
   debounce)            editor via useEditorState
```

### Source mode

Source mode is NOT a second editor. Tiptap stays mounted and hidden (`display:none`). A `<SourcePane>` textarea appears, initialized from the tab's markdown. Edits are debounced 250 ms → `markdownToEditorDoc(text)` → `editor.commands.setContent()`. All live-editor parse/serialize goes through `src/markdown/editorDoc.ts` (soft breaks, empty-paragraph stripping, per-block source preservation — see CLAUDE.md). Tiptap is the single source of truth at all times.

`onUpdate` is a no-op while `sourceModeRef.current` is true, preventing feedback loops. Toggle with ⌘/ or the `<>` button in the status bar.

### Tab switching

All tabs share one Tiptap instance. Switching tabs loads `markdownToEditorDoc(tab.markdown)` into the editor guarded by `isLoadingContentRef` to suppress the resulting `onUpdate` store write (which would incorrectly mark the tab dirty).

### Markdown canonical format

Tables use `| - | - |` (`tablePipeAlign:false`). Underline serializes as `<u>…</u>`. Callout markers are `\[!INFO]` (escaped). `toMarkdown` from `mdast-util-to-markdown` handles all other escaping.

### Extension points

- **New block types**: add a Tiptap extension in `src/editor/extensions/`, register in `createEditorExtensions()`, add a slash-command item in `slashCommandItems.ts`, handle in `parser.ts` and `serializer.ts`.
- **Export formats**: implement stubs in `src/persistence/exportStubs.ts`, enable buttons in `Header.tsx`.

### Known limitations

- `FileSystemFileHandle` is not persisted across page reloads; re-opening the same file requires re-selecting it.
- The autosave restores only the document that was open when the page last closed (by tab ID). Other tabs are not restored across reloads.
- The global search does not highlight results inline in the editor viewport.
