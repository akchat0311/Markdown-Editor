import { create } from "zustand";
import type { TestCase, TraceLink, TraceabilityFile } from "@/types/traceability";

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

  return { data: { version: 1, testCases, links }, repaired };
}

// ── Store ─────────────────────────────────────────────────────────────────────

interface TraceabilityState {
  testCases: TestCase[];
  links: TraceLink[];
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
   * Applies a complete oldId→newId requirement rename mapping to every link
   * in ONE atomic state update.
   *
   * - Chain-safe: each link's req is looked up once against its ORIGINAL
   *   value, so overlapping mappings (REQ_003→REQ_001 while REQ_001→REQ_002)
   *   never cascade through intermediate states.
   * - Union semantics: a rename onto an ID that already has links merges the
   *   two sets and dedupes — a rename can never lose a link.
   *
   * This is the ONLY correct way to migrate requirement renames; never call
   * per-ID mutations in a loop (see services/requirementIdMigration).
   */
  remapRequirementIds(mapping: ReadonlyMap<string, string>): void;

  /** Snapshot in on-disk schema form, for the persistence layer. */
  getFileData(): TraceabilityFile;
}

export const useTraceabilityStore = create<TraceabilityState>((set, get) => ({
  testCases: [],
  links: [],
  isDirty: false,
  loaded: false,
  loadError: false,

  load(raw) {
    const { data, repaired } = migrateTraceabilityFile(raw);
    set({
      testCases: data.testCases,
      links: data.links,
      isDirty: repaired,
      loaded: true,
      loadError: false,
    });
  },

  reset() {
    set({ testCases: [], links: [], isDirty: false, loaded: false, loadError: false });
  },

  markSaved() {
    set({ isDirty: false });
  },

  setLoadError() {
    set({ testCases: [], links: [], isDirty: false, loaded: false, loadError: true });
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
    if (!get().testCases.some((t) => t.id === id)) return;
    set((s) => ({
      testCases: s.testCases.filter((t) => t.id !== id),
      links: s.links.filter((l) => l.tc !== id),
      isDirty: true,
    }));
  },

  addLink(tc, req) {
    const s = get();
    const trimmedReq = req.trim();
    if (!trimmedReq || !s.testCases.some((t) => t.id === tc)) return false;
    if (s.links.some((l) => l.tc === tc && l.req === trimmedReq)) return true; // set semantics
    set((cur) => ({ links: [...cur.links, { tc, req: trimmedReq }], isDirty: true }));
    return true;
  },

  removeLink(tc, req) {
    if (!get().links.some((l) => l.tc === tc && l.req === req)) return;
    set((s) => ({
      links: s.links.filter((l) => !(l.tc === tc && l.req === req)),
      isDirty: true,
    }));
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
    set((cur) => ({ links: [...cur.links, ...toAdd], isDirty: true }));
  },

  removeLinks(pairs) {
    if (pairs.length === 0) return;
    const keys = new Set(pairs.map((p) => JSON.stringify([p.tc, p.req])));
    const s = get();
    const next = s.links.filter((l) => !keys.has(JSON.stringify([l.tc, l.req])));
    if (next.length === s.links.length) return;
    set({ links: next, isDirty: true });
  },

  remapRequirementIds(mapping) {
    if (mapping.size === 0) return;
    const s = get();
    let changed = false;
    const seen = new Set<string>();
    const next: TraceLink[] = [];
    for (const link of s.links) {
      const mapped = mapping.get(link.req);
      const req = mapped ?? link.req;
      if (mapped !== undefined && mapped !== link.req) changed = true;
      const key = JSON.stringify([link.tc, req]);
      if (seen.has(key)) {
        // Union-dedupe: the rename merged this pair into an existing one.
        changed = true;
        continue;
      }
      seen.add(key);
      next.push(req === link.req ? link : { ...link, req });
    }
    if (!changed) return;
    set({ links: next, isDirty: true });
  },

  getFileData() {
    const { testCases, links } = get();
    return { version: 1, testCases, links };
  },
}));
