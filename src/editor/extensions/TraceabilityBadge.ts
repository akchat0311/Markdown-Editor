import { Extension } from "@tiptap/core";
import { traceabilityBadgePlugin } from "@/editor/plugins/traceabilityBadgePlugin";

export const TraceabilityBadge = Extension.create({
  name: "traceabilityBadge",

  addProseMirrorPlugins() {
    return [traceabilityBadgePlugin];
  },
});
