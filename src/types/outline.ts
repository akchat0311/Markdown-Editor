export type OutlineNodeType = "heading" | "table" | "image";

export interface OutlineNode {
  key: string;
  type: OutlineNodeType;
  level?: number;
  label: string;
  pmPos: number;
  /** 0-based index in the document's top-level content array. Used for structural ops.
   *  For headings inside containers (blockquote/callout) this is the container's index. */
  index: number;
  children: OutlineNode[];
  /** True when this heading is nested inside a blockquote or callout.
   *  Structural ops (rename, delete, move, renumber) are not applicable. */
  readonly?: true;
}
