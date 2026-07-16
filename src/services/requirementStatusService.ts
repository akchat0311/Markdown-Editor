import type { RequirementStatus, RequirementStatusConfig } from "@/types/requirementStatus";

const CONFIG_URL = "/config/requirement-statuses.json";

const FALLBACK_STATUSES: RequirementStatus[] = [
  { id: "draft",     label: "Draft",            order: 1, aliases: ["Draft", "draft", "DRAFT"] },
  { id: "ready",     label: "Ready for review",  order: 2, aliases: ["Ready for review", "Ready For Review", "READY FOR REVIEW", "ready for review", "Ready"] },
  { id: "in-review", label: "In Review",         order: 3, aliases: ["In Review", "in review", "IN REVIEW", "Review", "review", "REVIEW"] },
  { id: "approved",  label: "Approved",           order: 4, aliases: ["Approved", "approved", "APPROVED"] },
];

let cached: RequirementStatus[] | null = null;
let loadPromise: Promise<RequirementStatus[]> | null = null;

/**
 * Fetches and validates requirement-statuses.json once, then caches the result.
 * Falls back to built-in statuses if the file is missing or malformed.
 */
export async function loadRequirementStatuses(): Promise<RequirementStatus[]> {
  if (cached) return cached;
  if (loadPromise) return loadPromise;

  loadPromise = fetch(CONFIG_URL)
    .then((r) => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json() as Promise<RequirementStatusConfig>;
    })
    .then((config) => {
      if (!Array.isArray(config?.statuses) || config.statuses.length === 0) {
        throw new Error("statuses array missing or empty");
      }
      const statuses = config.statuses
        .filter(
          (s) =>
            typeof s.id === "string" &&
            typeof s.label === "string" &&
            typeof s.order === "number" &&
            Array.isArray(s.aliases)
        )
        .sort((a, b) => a.order - b.order);
      if (statuses.length === 0) throw new Error("no valid status entries");
      cached = statuses;
      return statuses;
    })
    .catch((err) => {
      console.warn("[RequirementStatusService] Failed to load config, using fallback.", err);
      cached = FALLBACK_STATUSES;
      return FALLBACK_STATUSES;
    });

  return loadPromise;
}

/**
 * Synchronous access after loadRequirementStatuses() has resolved.
 * Returns the fallback set if called before load completes.
 */
export function getRequirementStatuses(): RequirementStatus[] {
  return cached ?? FALLBACK_STATUSES;
}

/**
 * Normalizes status text for case/whitespace-insensitive comparison: trim,
 * collapse consecutive whitespace to a single space, then lowercase
 * (locale-aware). This is the single shared helper for comparing a parsed
 * status string against configured statuses — it must never be used for
 * display or persistence, which always use the canonical configured
 * label/alias exactly as configured (see resolveRequirementStatus below,
 * which returns status.id — the caller maps that back to status.label for
 * display, so the configured capitalization is never lost or rewritten).
 */
export function normalizeStatusText(text: string): string {
  return text.trim().replace(/\s+/g, " ").toLocaleLowerCase();
}

/**
 * Resolves a raw status text extracted from a heading (e.g. "Draft", "APPROVED",
 * "ready  for   review") against the configured aliases.
 *
 * Matching is case-insensitive and whitespace-insensitive (via
 * normalizeStatusText) — "Ready For Review", "READY FOR REVIEW", and
 * "ready   for review" all resolve to the same configured status. Storage
 * and display are unaffected: this function only returns the canonical
 * `status.id`, or `"unknown"` if no alias matches.
 */
export function resolveRequirementStatus(
  rawText: string,
  statuses: RequirementStatus[]
): string {
  const normalized = normalizeStatusText(rawText);
  for (const status of statuses) {
    if (status.aliases.some((alias) => normalizeStatusText(alias) === normalized)) {
      return status.id;
    }
  }
  return "unknown";
}
