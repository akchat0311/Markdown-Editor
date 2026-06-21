import { Extension } from "@tiptap/core";
import { requirementStatusPlugin } from "@/editor/plugins/requirementStatusPlugin";

export const RequirementStatus = Extension.create({
  name: "requirementStatus",

  addProseMirrorPlugins() {
    return [requirementStatusPlugin];
  },
});
