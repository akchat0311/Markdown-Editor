export type OutlineNodeType = "heading" | "table" | "image";

export interface OutlineNode {
  key: string;
  type: OutlineNodeType;
  level?: number;
  label: string;
  pmPos: number;
  /** 0-based index in the document's top-level content array. Used for structural ops. */
  index: number;
  children: OutlineNode[];
}
