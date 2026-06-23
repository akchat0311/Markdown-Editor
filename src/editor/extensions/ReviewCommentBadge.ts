import { Extension } from "@tiptap/core";
import { reviewCommentBadgePlugin } from "@/editor/plugins/reviewCommentBadgePlugin";

export const ReviewCommentBadge = Extension.create({
  name: "reviewCommentBadge",

  addProseMirrorPlugins() {
    return [reviewCommentBadgePlugin];
  },
});
