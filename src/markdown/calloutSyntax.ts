export const CALLOUT_TYPES = ["info", "warning", "success", "danger"] as const;
export type CalloutType = (typeof CALLOUT_TYPES)[number];

export const DEFAULT_CALLOUT_TYPE: CalloutType = "info";

const MARKER_PATTERN = /^\[!(\w+)\]$/i;

const TYPE_ALIASES: Record<string, CalloutType> = {
  info: "info",
  note: "info",
  warning: "warning",
  caution: "warning",
  success: "success",
  tip: "success",
  danger: "danger",
  error: "danger",
};

/** Parses a `[!TYPE]` callout marker line. Returns null when it isn't one. */
export function parseCalloutMarker(line: string): CalloutType | null {
  const match = MARKER_PATTERN.exec(line.trim());
  if (!match) return null;
  return TYPE_ALIASES[match[1].toLowerCase()] ?? DEFAULT_CALLOUT_TYPE;
}

export function formatCalloutMarker(type: CalloutType): string {
  return `[!${type.toUpperCase()}]`;
}
