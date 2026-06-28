import { NodeViewContent, NodeViewWrapper, type ReactNodeViewProps } from "@tiptap/react";
import { CALLOUT_TYPES, type CalloutType } from "@/markdown/calloutSyntax";

const CALLOUT_STYLES: Record<CalloutType, { border: string; bg: string; icon: string }> = {
  info: { border: "border-blue-400", bg: "bg-blue-50 dark:bg-blue-950/40", icon: "ℹ" },
  warning: { border: "border-amber-400", bg: "bg-amber-50 dark:bg-amber-950/40", icon: "⚠" },
  success: { border: "border-emerald-400", bg: "bg-emerald-50 dark:bg-emerald-950/40", icon: "✓" },
  danger: { border: "border-red-400", bg: "bg-red-50 dark:bg-red-950/40", icon: "✕" },
};

export function CalloutView({ node, updateAttributes, selected }: ReactNodeViewProps) {
  const type = (node.attrs.type as CalloutType) || "info";
  const style = CALLOUT_STYLES[type];

  return (
    <NodeViewWrapper
      className={`callout-block my-3 flex gap-3 rounded-md border-l-4 p-3 ${style.border} ${style.bg} ${
        selected ? "ring-2 ring-blue-400" : ""
      }`}
      data-callout-type={type}
    >
      <select
        contentEditable={false}
        value={type}
        onChange={(e) => updateAttributes({ type: e.target.value, marker: null })}
        className="h-fit shrink-0 rounded border border-[var(--color-border)] bg-transparent px-1 py-0.5 text-xs"
        aria-label="Callout type"
      >
        {CALLOUT_TYPES.map((t) => (
          <option key={t} value={t}>
            {style.icon} {t}
          </option>
        ))}
      </select>
      <NodeViewContent className="callout-content min-w-0 flex-1 [&>*:first-child]:mt-0" />
    </NodeViewWrapper>
  );
}
