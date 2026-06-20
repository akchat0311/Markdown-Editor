import type { JSONContent } from "@tiptap/core";

/** A PM JSON node with attrs/content typed loosely enough to pattern-match on `type`. */
export type PMNode = JSONContent;

export interface PMMark {
  type: string;
  attrs?: Record<string, unknown>;
}
