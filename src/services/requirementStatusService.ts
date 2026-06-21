import type { RequirementStatus, RequirementStatusConfig } from "@/types/requirementStatus";

const CONFIG_URL = "/config/requirement-statuses.json";

const FALLBACK_STATUSES: RequirementStatus[] = [
  { id: "draft",    label: "Draft",    order: 1, aliases: ["Draft", "draft", "DRAFT"] },
  { id: "review",   label: "Review",   order: 2, aliases: ["Review", "review", "REVIEW"] },
  { id: "approved", label: "Approved", order: 3, aliases: ["Approved", "approved", "APPROVED"] },
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
 * Resolves a raw status text extracted from a heading (e.g. "Draft", "APPROVED")
 * against the configured aliases.
 *
 * Returns the canonical `status.id`, or `"unknown"` if no alias matches.
 */
export function resolveRequirementStatus(
  rawText: string,
  statuses: RequirementStatus[]
): string {
  const trimmed = rawText.trim();
  for (const status of statuses) {
    if (status.aliases.includes(trimmed)) return status.id;
  }
  return "unknown";
}
