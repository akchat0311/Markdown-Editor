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

export interface CalloutParseResult {
  /** Canonical internal type used for rendering. */
  type: CalloutType;
  /** Original marker word exactly as written, e.g. "NOTE", "note", "CAUTION". */
  marker: string;
}

/**
 * Like parseCalloutMarker but also returns the original marker word so the
 * serializer can emit `[!NOTE]` / `[!note]` / `[!CAUTION]` verbatim instead
 * of always normalizing to the canonical uppercase form.
 */
export function parseCalloutFull(line: string): CalloutParseResult | null {
  const match = MARKER_PATTERN.exec(line.trim());
  if (!match) return null;
  const marker = match[1]; // original spelling, e.g. "NOTE", "note"
  const type = TYPE_ALIASES[marker.toLowerCase()] ?? DEFAULT_CALLOUT_TYPE;
  return { type, marker };
}

export function formatCalloutMarker(type: CalloutType): string {
  return `[!${type.toUpperCase()}]`;
}
