import Image from "@tiptap/extension-image";
import type { Node as PMNode } from "@tiptap/pm/model";
import { useWorkspaceStore } from "@/stores/workspaceStore";

// ── Path helpers ──────────────────────────────────────────────────────────────

function isRelativePath(src: string): boolean {
  if (!src) return false;
  return (
    !src.startsWith("http://") &&
    !src.startsWith("https://") &&
    !src.startsWith("data:") &&
    !src.startsWith("blob:") &&
    !src.startsWith("//")
  );
}

/**
 * Walks a FileSystemDirectoryHandle tree to resolve a relative path such as
 * "images/foo.png" or "assets/diagrams/bar.png".
 *
 * Leading "./" is stripped. Each directory segment is descended with
 * getDirectoryHandle(); the final segment is opened with getFileHandle().
 */
async function resolveRelativePath(
  root: FileSystemDirectoryHandle,
  relativePath: string,
): Promise<FileSystemFileHandle> {
  const normalized = relativePath.replace(/^\.\//, "");
  const parts = normalized.split("/").filter(Boolean);
  if (parts.length === 0) throw new Error("Empty image path");

  let dir: FileSystemDirectoryHandle = root;
  for (const segment of parts.slice(0, -1)) {
    dir = await dir.getDirectoryHandle(segment);
  }
  return dir.getFileHandle(parts[parts.length - 1]);
}

// ── Error placeholder styling ─────────────────────────────────────────────────

function clearErrorStyle(img: HTMLImageElement): void {
  img.style.outline = "";
  img.style.borderRadius = "";
  img.style.minWidth = "";
  img.style.minHeight = "";
  img.dataset.broken = "";
}

// ── Extension ─────────────────────────────────────────────────────────────────

/**
 * Extends the stock Tiptap Image extension with workspace-aware image
 * resolution. Only addNodeView() is overridden; all schema definitions,
 * parseHTML, renderHTML, and markdown serialization are inherited unchanged.
 *
 * Render-time behaviour:
 *   - Absolute URLs (http/https), data: URIs, and blob: URLs → passed directly
 *     to <img src> with no modification.
 *   - Relative paths → resolved against workspaceStore.dirHandle using the
 *     File System Access API. A blob URL is created for rendering and revoked
 *     when the NodeView is destroyed or the src changes.
 *   - If resolution fails (file missing, no workspace open) → broken-image
 *     placeholder is shown without touching the underlying document.
 */
export const WorkspaceImage = Image.extend({
  addNodeView() {
    return ({ node }) => {
      const img = document.createElement("img");
      img.style.maxWidth = "100%";
      img.style.display = "block";

      let objectUrl: string | null = null;
      let currentSrc = "";

      function revokeObjectUrl(): void {
        if (objectUrl) {
          URL.revokeObjectURL(objectUrl);
          objectUrl = null;
        }
      }

      async function loadSrc(src: string, alt: string, title: string): Promise<void> {
        currentSrc = src;
        clearErrorStyle(img);
        img.alt = alt;
        if (title) {
          img.title = title;
        } else {
          img.removeAttribute("title");
        }

        if (!isRelativePath(src)) {
          revokeObjectUrl();
          img.src = src || "";
          return;
        }

        const { dirHandle } = useWorkspaceStore.getState();
        if (!dirHandle) {
          // No workspace open — let the browser resolve against the page origin.
          // This covers Vite public/ assets, deployed static files, etc.
          revokeObjectUrl();
          img.src = src;
          return;
        }

        try {
          revokeObjectUrl();
          const fileHandle = await resolveRelativePath(dirHandle, src);
          const file = await fileHandle.getFile();
          objectUrl = URL.createObjectURL(file);
          img.src = objectUrl;
        } catch {
          // File not found in workspace — fall back to browser URL resolution.
          // Covers public/ assets and paths outside the workspace directory.
          img.src = src;
        }
      }

      // Initial render
      void loadSrc(
        node.attrs.src ?? "",
        node.attrs.alt ?? "",
        node.attrs.title ?? "",
      );

      return {
        dom: img,

        update(updatedNode: PMNode): boolean {
          if (updatedNode.type.name !== "image") return false;

          const newSrc   = updatedNode.attrs.src   ?? "";
          const newAlt   = updatedNode.attrs.alt   ?? "";
          const newTitle = updatedNode.attrs.title ?? "";

          if (newSrc !== currentSrc) {
            void loadSrc(newSrc, newAlt, newTitle);
          } else {
            // src unchanged — update text attributes only, no reload
            img.alt = newAlt;
            if (newTitle) {
              img.title = newTitle;
            } else {
              img.removeAttribute("title");
            }
          }
          return true;
        },

        destroy(): void {
          revokeObjectUrl();
        },
      };
    };
  },
});
