export type CommentStatus = "open" | "responded" | "closed";

export interface ReviewComment {
  id: string;
  author: string;
  text: string;
  createdAt: string;

  // Set when the author/engineer addresses the concern
  response?: string;
  respondedBy?: string;
  respondedAt?: string;

  // Set when the reviewer verifies the resolution
  status: CommentStatus;
  closedBy?: string;
  closedAt?: string;
}

export interface ReviewFile {
  _version?: number;
  [requirementId: string]: ReviewComment[] | number | undefined;
}
