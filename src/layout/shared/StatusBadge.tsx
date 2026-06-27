import type { RequirementStatus } from "@/types/requirementStatus";

// ── Color palette ─────────────────────────────────────────────────────────────

export const BUILTIN_COLORS: Record<string, string> = {
  draft:       "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
  ready:       "bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300",
  "in-review": "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-200",
  approved:    "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300",
};

export const PALETTE = [
  "bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300",
  "bg-pink-100 text-pink-700 dark:bg-pink-900/40 dark:text-pink-300",
  "bg-teal-100 text-teal-700 dark:bg-teal-900/40 dark:text-teal-300",
  "bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300",
];

export const UNKNOWN_COLOR = "bg-[var(--color-border)] text-[var(--color-muted)]";

export function badgeClass(statusId: string, statuses: RequirementStatus[]): string {
  if (statusId === "unknown") return UNKNOWN_COLOR;
  if (statusId in BUILTIN_COLORS) return BUILTIN_COLORS[statusId];
  const idx = statuses.findIndex((s) => s.id === statusId);
  return PALETTE[idx % PALETTE.length] ?? UNKNOWN_COLOR;
}

export function statusLabel(statusId: string | null, statuses: RequirementStatus[]): string {
  if (!statusId) return "—";
  if (statusId === "unknown") return "Unknown";
  return statuses.find((s) => s.id === statusId)?.label ?? statusId;
}

export function StatusBadge({
  status,
  statuses,
}: {
  status: string;
  statuses: RequirementStatus[];
}) {
  const label =
    status === "unknown" ? "Unknown" : (statuses.find((s) => s.id === status)?.label ?? status);
  return (
    <span
      className={`inline-block rounded px-1.5 py-px text-[10px] font-semibold uppercase tracking-wide ${badgeClass(status, statuses)}`}
    >
      {label}
    </span>
  );
}
