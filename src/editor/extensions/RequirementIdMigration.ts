import { Extension } from "@tiptap/core";
import { requirementIdMigrationPlugin } from "@/editor/plugins/requirementIdMigrationPlugin";

export const RequirementIdMigration = Extension.create({
  name: "requirementIdMigration",

  addProseMirrorPlugins() {
    return [requirementIdMigrationPlugin];
  },
});
