import { create } from "zustand";
import type { TestCase, TraceLink, TraceabilityFile, CoverageStatus } from "@/types/traceability";

function isCoverageStatus(v: unknown): v is CoverageStatus {
  return v === "NONE" || v === "PARTIAL" || v === "FULL";
}

/**
 * Coverage above NONE is only meaningful once at least one test case is
 * linked — it's an assessment of evidence, not a standalone claim. Called
 * after every link removal so a requirement that loses its last link
 * reverts to the implicit NONE default instead of keeping a stale
 * PARTIAL/FULL with nothing behind it.
 */
function clearOrphanedCoverage(
  nextLinks: TraceLink[],
  coverage: Record<string, CoverageStatus>,
  affectedReqIds: Iterable<string>,
): Record<string, CoverageStatus> {
  const stillLinked = new Set(nextLinks.map((l) => l.req));
  let changed = false;
  const next = { ...coverage };
  for (const req of affectedReqIds) {
    if (stillLinked.has(req)) continue;
    if (next[req] !== undefined) {
      delete next[req];
      changed = true;
    }
  }
  return changed ? next : coverage;
}

/**
 * A requirement's first linked test case is the start of evidence — leaving
 * coverage at "No" once a test case exists reads as untouched/forgotten, so
 * it's promoted to "Partial" automatically. This is the ONE exception to
 * "coverage is never inferred": it only sets the weakest positive state, and
 * only the moment a requirement's link count goes from zero to nonzero. It
 * never touches a requirement that already had a link (that's an existing,
 * deliberate choice) or overwrites an explicit non-NONE status.
 */
function autoPromoteCoverage(
  prevLinks: TraceLink[],
  nextLinks: TraceLink[],
  coverage: Record<string, CoverageStatus>,
  affectedReqIds: Iterable<string>,
): Record<string, CoverageStatus> {
  const hadLinkBefore = new Set(prevLinks.map((l) => l.req));
  const hasLinkAfter = new Set(nextLinks.map((l) => l.req));
  let changed = false;
  const next = { ...coverage };
  for (const req of affectedReqIds) {
    if (hadLinkBefore.has(req) || !hasLinkAfter.has(req)) continue;
    if ((next[req] ?? "NONE") !== "NONE") continue;
    next[req] = "PARTIAL";
    changed = true;
  }
  return changed ? next : coverage;
}

// ── Loader / migration ────────────────────────────────────────────────────────

export interface MigratedTraceability {
  data: TraceabilityFile;
  /**
   * True when anything was dropped, deduplicated, or coerced during load.
   * The store marks itself dirty in that case so the next save normalizes
   * the file on disk.
   */
  repaired: boolean;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Tolerant loader for the sidecar JSON. Never throws.
 *
 * Repair rules:
 * - missing `version` is treated as 1; a newer version is read best-effort
 *   (only known fields are used)
 * - test cases with a non-string/empty id are dropped; values are trimmed
 * - title is OPTIONAL: empty is valid; a missing/non-string title is
 *   normalized to "" (marked repaired so the next save writes the field)
 * - duplicate test case IDs (exact string): first occurrence wins
 * - links whose `tc` does not reference a surviving test case are dropped —
 *   the referenced entity lives in the same file, so a miss is corruption
 * - duplicate (tc, req) pairs are deduplicated
 * - links whose `req` matches no current requirement are KEPT — that is an
 *   expected lifecycle state ("broken" link), not corruption
 * - `coverage` entries are keyed by requirement ID, which lives in the
 *   document, not this sidecar — existence is never validated here, only
 *   shape (non-empty string key, one of NONE/PARTIAL/FULL). An entry for a
 *   requirement absent from the document is kept, same rationale as broken
 *   links: it heals automatically if the requirement reappears.
 */
export function migrateTraceabilityFile(raw: unknown): MigratedTraceability {
  const obj = isRecord(raw) ? raw : {};
  let repaired = !isRecord(raw);

  const testCases: TestCase[] = [];
  const seenIds = new Set<string>();
  const rawCases = Array.isArray(obj.testCases) ? obj.testCases : [];
  if (!Array.isArray(obj.testCases) && obj.testCases !== undefined) repaired = true;
  for (const entry of rawCases) {
    if (!isRecord(entry) || typeof entry.id !== "string") {
      repaired = true;
      continue;
    }
    const id = entry.id.trim();
    const title = typeof entry.title === "string" ? entry.title.trim() : "";
    if (typeof entry.title !== "string") repaired = true; // missing/non-string → normalized to ""
    if (!id || seenIds.has(id)) {
      repaired = true;
      continue;
    }
    if (id !== entry.id || (typeof entry.title === "string" && title !== entry.title)) repaired = true;
    seenIds.add(id);
    testCases.push({ id, title });
  }

  const links: TraceLink[] = [];
  const seenPairs = new Set<string>();
  const rawLinks = Array.isArray(obj.links) ? obj.links : [];
  if (!Array.isArray(obj.links) && obj.links !== undefined) repaired = true;
  for (const entry of rawLinks) {
    if (!isRecord(entry) || typeof entry.tc !== "string" || typeof entry.req !== "string") {
      repaired = true;
      continue;
    }
    const tc = entry.tc.trim();
    const req = entry.req.trim();
    // JSON-encode the pair so IDs containing spaces can't collide across fields.
    const pairKey = JSON.stringify([tc, req]);
    if (!tc || !req || !seenIds.has(tc) || seenPairs.has(pairKey)) {
      repaired = true;
      continue;
    }
    if (tc !== entry.tc || req !== entry.req) repaired = true;
    seenPairs.add(pairKey);
    links.push({ tc, req });
  }

  const coverage: Record<string, CoverageStatus> = {};
  const rawCoverage = isRecord(obj.coverage) ? obj.coverage : {};
  if (!isRecord(obj.coverage) && obj.coverage !== undefined) repaired = true;
  for (const [rawReq, value] of Object.entries(rawCoverage)) {
    const reqId = rawReq.trim();
    if (!reqId || !isCoverageStatus(value)) {
      repaired = true;
      continue;
    }
    if (reqId !== rawReq || coverage[reqId] !== undefined) repaired = true;
    coverage[reqId] = value;
  }

  return { data: { version: 1, testCases, links, coverage }, repaired };
}

// ── Store ─────────────────────────────────────────────────────────────────────

interface TraceabilityState {
  testCases: TestCase[];
  links: TraceLink[];
  /** Requirement ID → coverage status. Missing entries are treated as "NONE". */
  coverage: Record<string, CoverageStatus>;
  isDirty: boolean;
  loaded: boolean;
  /**
   * Set when the sidecar existed but could not be read/parsed. Save-to-handle
   * must be disabled while this is set so an unreadable file is never
   * overwritten with an empty store. Cleared by a successful load or reset.
   */
  loadError: boolean;

  /** Loads raw parsed JSON, migrating/repairing it. Repairs mark the store dirty. */
  load(raw: unknown): void;
  reset(): void;
  markSaved(): void;
  setLoadError(): void;

  /** Returns false (and changes nothing) when the ID is empty or already
   *  taken. Title is optional — empty is stored as "". */
  addTestCase(id: string, title: string): boolean;
  /** ID renames cascade to links[].tc atomically. */
  updateTestCase(oldId: string, patch: { id?: string; title?: string }): "updated" | "duplicate" | "not-found" | "invalid";
  /** Deletes the test case and all of its links. */
  deleteTestCase(id: string): void;

  /**
   * Sets the engineer-selected coverage status for a requirement. This is the
   * ONLY way coverage changes — it is never inferred from linked test cases.
   * PARTIAL/FULL require at least one linked test case (a no-op otherwise);
   * NONE is always allowed. A requirement that loses its last link
   * automatically reverts to NONE — see removeLink / removeLinks / deleteTestCase.
   */
  setCoverage(reqId: string, status: CoverageStatus): void;

  /** Set semantics: no-op if the pair exists. Returns false when `tc` is unknown or `req` is empty. */
  addLink(tc: string, req: string): boolean;
  removeLink(tc: string, req: string): void;

  /**
   * Links several test cases to one requirement in a single state update.
   * Unknown test case IDs and already-linked pairs are skipped silently;
   * the store stays clean when nothing actually changes.
   */
  addLinks(tcIds: string[], req: string): void;
  /** Removes several (tc, req) pairs in a single state update. Missing pairs are ignored. */
  removeLinks(pairs: TraceLink[]): void;

  /**
   * Applies a complete set of requirement-ID renames to every link and
   * coverage entry in ONE atomic state update. Takes a rename LIST, not a
   * Map — a single old ID can legitimately appear more than once (a
   * requirement duplicated via copy/paste shares one ID across several
   * physical headings until renumbering assigns each its own new ID), and a
   * Map key can only hold one value, which would silently drop all but the
   * first occurrence.
   *
   * Renames are grouped by oldId first, then handled per group:
   * - ONE destination: a genuine rename — existing links/coverage MOVE onto
   *   the new ID. Chain-safe (each link's req is looked up once against its
   *   ORIGINAL value, so overlapping mappings like REQ_003→REQ_001 while
   *   REQ_001→REQ_002 never cascade through intermediate states) and
   *   union-safe (merges with any links already at the destination, never
   *   losing one). Coverage never overwrites a destination's own explicit
   *   status.
   * - MULTIPLE destinations (a duplicated ID splitting apart): there is no
   *   way to tell which pre-existing link "belonged" to which physical
   *   occurrence, so the source's ENTIRE link set (and explicit coverage
   *   status, if any) is COPIED onto every destination — never split, never
   *   silently dropped — and the old, now-nonexistent ID is cleared. A
   *   destination that gains its first-ever link this way is still subject
   *   to the standard first-link coverage promotion.
   *
   * This is the ONLY correct way to migrate requirement renames; never call
   * per-ID mutations in a loop (see services/requirementIdMigration).
   */
  remapRequirementIds(renames: readonly { oldId: string; newId: string }[]): void;

  /**
   * Duplicates one requirement's links onto another WITHOUT touching the
   * source — used when a duplicated heading diverges to a fresh ID (the
   * original, untouched heading must keep everything it had; this is a
   * copy, not a rename). Coverage: an explicit non-NONE status on the
   * source is copied too (only if the destination has none yet); either
   * way, the destination is still subject to the standard first-link
   * promotion (NONE → PARTIAL) if it had no links before this call.
   */
  copyRequirementLinks(fromReq: string, toReq: string): void;

  /** Snapshot in on-disk schema form, for the persistence layer. */
  getFileData(): TraceabilityFile;
}

export const useTraceabilityStore = create<TraceabilityState>((set, get) => ({
  testCases: [],
  links: [],
  coverage: {},
  isDirty: false,
  loaded: false,
  loadError: false,

  load(raw) {
    const { data, repaired } = migrateTraceabilityFile(raw);
    set({
      testCases: data.testCases,
      links: data.links,
      coverage: data.coverage,
      isDirty: repaired,
      loaded: true,
      loadError: false,
    });
  },

  reset() {
    set({ testCases: [], links: [], coverage: {}, isDirty: false, loaded: false, loadError: false });
  },

  markSaved() {
    set({ isDirty: false });
  },

  setLoadError() {
    set({ testCases: [], links: [], coverage: {}, isDirty: false, loaded: false, loadError: true });
  },

  addTestCase(id, title) {
    const trimmedId = id.trim();
    const trimmedTitle = title.trim(); // optional — "" is valid
    if (!trimmedId) return false;
    if (get().testCases.some((t) => t.id === trimmedId)) return false;
    set((s) => ({
      testCases: [...s.testCases, { id: trimmedId, title: trimmedTitle }],
      isDirty: true,
      loaded: true,
    }));
    return true;
  },

  updateTestCase(oldId, patch) {
    const s = get();
    const existing = s.testCases.find((t) => t.id === oldId);
    if (!existing) return "not-found";

    const newId = patch.id !== undefined ? patch.id.trim() : existing.id;
    const newTitle = patch.title !== undefined ? patch.title.trim() : existing.title;
    if (!newId) return "invalid"; // title is optional — clearing it is a valid edit
    if (newId !== oldId && s.testCases.some((t) => t.id === newId)) return "duplicate";
    if (newId === existing.id && newTitle === existing.title) return "updated";

    set((cur) => ({
      testCases: cur.testCases.map((t) => (t.id === oldId ? { id: newId, title: newTitle } : t)),
      // Rename cascades to links in the same update — no dangling window.
      links: newId === oldId ? cur.links : cur.links.map((l) => (l.tc === oldId ? { ...l, tc: newId } : l)),
      isDirty: true,
    }));
    return "updated";
  },

  deleteTestCase(id) {
    const s = get();
    if (!s.testCases.some((t) => t.id === id)) return;
    const affectedReqs = s.links.filter((l) => l.tc === id).map((l) => l.req);
    const nextLinks = s.links.filter((l) => l.tc !== id);
    const nextCoverage = clearOrphanedCoverage(nextLinks, s.coverage, affectedReqs);
    set({
      testCases: s.testCases.filter((t) => t.id !== id),
      links: nextLinks,
      coverage: nextCoverage,
      isDirty: true,
    });
  },

  setCoverage(reqId, status) {
    const trimmedReq = reqId.trim();
    if (!trimmedReq) return;
    const s = get();
    // Partial/Full require evidence — at least one linked test case.
    if (status !== "NONE" && !s.links.some((l) => l.req === trimmedReq)) return;
    if ((s.coverage[trimmedReq] ?? "NONE") === status) return;
    set((cur) => ({
      coverage: { ...cur.coverage, [trimmedReq]: status },
      isDirty: true,
    }));
  },

  addLink(tc, req) {
    const s = get();
    const trimmedReq = req.trim();
    if (!trimmedReq || !s.testCases.some((t) => t.id === tc)) return false;
    if (s.links.some((l) => l.tc === tc && l.req === trimmedReq)) return true; // set semantics
    const nextLinks = [...s.links, { tc, req: trimmedReq }];
    const nextCoverage = autoPromoteCoverage(s.links, nextLinks, s.coverage, [trimmedReq]);
    set({ links: nextLinks, coverage: nextCoverage, isDirty: true });
    return true;
  },

  removeLink(tc, req) {
    const s = get();
    if (!s.links.some((l) => l.tc === tc && l.req === req)) return;
    const nextLinks = s.links.filter((l) => !(l.tc === tc && l.req === req));
    const nextCoverage = clearOrphanedCoverage(nextLinks, s.coverage, [req]);
    set({ links: nextLinks, coverage: nextCoverage, isDirty: true });
  },

  addLinks(tcIds, req) {
    const trimmedReq = req.trim();
    if (!trimmedReq) return;
    const s = get();
    const known = new Set(s.testCases.map((t) => t.id));
    const present = new Set(s.links.map((l) => JSON.stringify([l.tc, l.req])));
    const toAdd: TraceLink[] = [];
    for (const tc of tcIds) {
      const key = JSON.stringify([tc, trimmedReq]);
      if (!known.has(tc) || present.has(key)) continue;
      present.add(key);
      toAdd.push({ tc, req: trimmedReq });
    }
    if (toAdd.length === 0) return;
    const nextLinks = [...s.links, ...toAdd];
    const nextCoverage = autoPromoteCoverage(s.links, nextLinks, s.coverage, [trimmedReq]);
    set({ links: nextLinks, coverage: nextCoverage, isDirty: true });
  },

  removeLinks(pairs) {
    if (pairs.length === 0) return;
    const keys = new Set(pairs.map((p) => JSON.stringify([p.tc, p.req])));
    const s = get();
    const next = s.links.filter((l) => !keys.has(JSON.stringify([l.tc, l.req])));
    if (next.length === s.links.length) return;
    const affectedReqs = pairs.map((p) => p.req);
    const nextCoverage = clearOrphanedCoverage(next, s.coverage, affectedReqs);
    set({ links: next, coverage: nextCoverage, isDirty: true });
  },

  remapRequirementIds(renames) {
    if (renames.length === 0) return;
    const s = get();

    // Group by oldId: a duplicated requirement produces MULTIPLE distinct
    // destinations for the same oldId, which is exactly what a Map key
    // could never represent. Self-pairs (newId === oldId) are KEPT in the
    // group at this stage — when one duplicate occurrence keeps its number
    // while another diverges (e.g. REQ_001→REQ_001 and REQ_001→REQ_002 in
    // the same batch), the self-pair is the only signal that REQ_001 was
    // shared by two occurrences at all; dropping it here would collapse the
    // group to a single destination and wrongly MOVE everything to REQ_002.
    const byOld = new Map<string, string[]>();
    for (const { oldId, newId } of renames) {
      let dests = byOld.get(oldId);
      if (!dests) {
        dests = [];
        byOld.set(oldId, dests);
      }
      if (!dests.includes(newId)) dests.push(newId);
    }
    // NOW drop true no-ops: a group whose only destination is the source
    // itself changes nothing.
    for (const [oldReq, dests] of byOld) {
      if (dests.length === 1 && dests[0] === oldReq) byOld.delete(oldReq);
    }
    if (byOld.size === 0) return;

    const simple = new Map<string, string>(); // 1 destination → move
    const fanOut = new Map<string, string[]>(); // >1 destination → copy to each
    for (const [oldReq, dests] of byOld) {
      if (dests.length === 1) simple.set(oldReq, dests[0]);
      else fanOut.set(oldReq, dests);
    }

    let changed = false;
    const seen = new Set<string>();
    const next: TraceLink[] = [];

    // ── Single-destination: existing chain-safe MOVE, reading link.req
    // against the ORIGINAL s.links so overlapping mappings never cascade. ──
    for (const link of s.links) {
      if (fanOut.has(link.req)) continue; // handled entirely below
      const mapped = simple.get(link.req);
      const req = mapped ?? link.req;
      if (mapped !== undefined) changed = true;
      const key = JSON.stringify([link.tc, req]);
      if (seen.has(key)) {
        // Union-dedupe: the rename merged this pair into an existing one.
        changed = true;
        continue;
      }
      seen.add(key);
      next.push(req === link.req ? link : { ...link, req });
    }

    // ── Fan-out: copy the source's entire link set onto every destination
    // (never split — there's no way to tell which link "belonged" to which
    // physical occurrence) — the old, now-nonexistent ID is simply dropped
    // by never being re-pushed to `next` above. ──
    for (const [oldReq, dests] of fanOut) {
      const sourceLinks = s.links.filter((l) => l.req === oldReq);
      if (sourceLinks.length > 0) changed = true;
      for (const newReq of dests) {
        for (const l of sourceLinks) {
          const key = JSON.stringify([l.tc, newReq]);
          if (seen.has(key)) continue;
          seen.add(key);
          next.push({ tc: l.tc, req: newReq });
        }
      }
    }

    // Coverage: single-destination moves (never overwriting an existing
    // explicit status at the destination); fan-out copies an explicit
    // status onto every destination that doesn't already have one.
    let nextCoverage = { ...s.coverage };
    for (const [oldReq, newReq] of simple) {
      const value = s.coverage[oldReq];
      if (value === undefined) continue;
      delete nextCoverage[oldReq];
      changed = true;
      if (nextCoverage[newReq] === undefined) nextCoverage[newReq] = value;
    }
    for (const [oldReq, dests] of fanOut) {
      const value = s.coverage[oldReq];
      if (value !== undefined) {
        delete nextCoverage[oldReq];
        changed = true;
      }
      if (value !== undefined && value !== "NONE") {
        for (const newReq of dests) {
          if (nextCoverage[newReq] === undefined) nextCoverage[newReq] = value;
        }
      }
    }
    // A destination that just received its first-ever link via fan-out, and
    // still has no explicit status, gets the standard first-link promotion.
    const fanOutDests = [...fanOut.values()].flat();
    if (fanOutDests.length > 0) {
      nextCoverage = autoPromoteCoverage(s.links, next, nextCoverage, fanOutDests);
    }

    if (!changed) return;
    set({ links: next, coverage: nextCoverage, isDirty: true });
  },

  copyRequirementLinks(fromReq, toReq) {
    if (fromReq === toReq) return;
    const s = get();
    const toCopy = s.links.filter((l) => l.req === fromReq);
    const present = new Set(s.links.map((l) => JSON.stringify([l.tc, l.req])));
    const additions: TraceLink[] = [];
    for (const l of toCopy) {
      const key = JSON.stringify([l.tc, toReq]);
      if (present.has(key)) continue;
      present.add(key);
      additions.push({ tc: l.tc, req: toReq });
    }
    const nextLinks = additions.length > 0 ? [...s.links, ...additions] : s.links;

    let nextCoverage = s.coverage;
    const fromStatus = s.coverage[fromReq];
    if (fromStatus !== undefined && fromStatus !== "NONE" && s.coverage[toReq] === undefined) {
      nextCoverage = { ...s.coverage, [toReq]: fromStatus };
    }
    // Whether or not an explicit status was just copied, still apply the
    // standard first-link promotion for a destination that had no links.
    nextCoverage = autoPromoteCoverage(s.links, nextLinks, nextCoverage, [toReq]);

    if (nextLinks === s.links && nextCoverage === s.coverage) return;
    set({ links: nextLinks, coverage: nextCoverage, isDirty: true });
  },

  getFileData() {
    const { testCases, links, coverage } = get();
    return { version: 1, testCases, links, coverage };
  },
}));
