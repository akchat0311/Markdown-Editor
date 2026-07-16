/**
 * Shared requirement→test-case projection.
 *
 * Single source for "which test cases are linked to this requirement" —
 * consumed by the editor badge decorations, the badge tooltip, the right
 * workspace panel, the dashboard table, and (later) CSV export. Keep all
 * projection logic here; consumers must not re-derive it from raw links.
 */

import { useMemo } from "react";
import { useTraceabilityStore } from "@/stores/traceabilityStore";
import type { TestCase, TraceLink } from "@/types/traceability";

/**
 * Bulk projection: requirement ID → linked test cases, in links-array order.
 * Links whose tc has no matching test case are skipped defensively (the store
 * loader already drops them; this guards transient states).
 */
export function buildLinksByReq(
  testCases: TestCase[],
  links: TraceLink[],
): Map<string, TestCase[]> {
  const tcById = new Map(testCases.map((t) => [t.id, t]));
  const byReq = new Map<string, TestCase[]>();
  for (const link of links) {
    const tc = tcById.get(link.tc);
    if (!tc) continue;
    const list = byReq.get(link.req) ?? [];
    list.push(tc);
    byReq.set(link.req, list);
  }
  return byReq;
}

/** Single-requirement projection over explicit state (pure). */
export function getLinkedTestCases(
  testCases: TestCase[],
  links: TraceLink[],
  reqId: string,
): TestCase[] {
  const tcById = new Map(testCases.map((t) => [t.id, t]));
  const result: TestCase[] = [];
  for (const link of links) {
    if (link.req !== reqId) continue;
    const tc = tcById.get(link.tc);
    if (tc) result.push(tc);
  }
  return result;
}

export interface BrokenLink {
  /** The stored requirement ID that no longer matches any heading in the document. */
  req: string;
  testCase: TestCase;
}

/**
 * Links whose requirement is absent from the current index — the preserved
 * "broken" state. Derived live on every use, never stored, so links heal
 * automatically when the requirement reappears (undo, paste-back).
 * Links whose tc is unknown are skipped (same defensive rule as buildLinksByReq).
 */
export function findBrokenLinks(
  requirementIds: string[],
  testCases: TestCase[],
  links: TraceLink[],
): BrokenLink[] {
  const known = new Set(requirementIds);
  const tcById = new Map(testCases.map((t) => [t.id, t]));
  const broken: BrokenLink[] = [];
  for (const link of links) {
    if (known.has(link.req)) continue;
    const testCase = tcById.get(link.tc);
    if (testCase) broken.push({ req: link.req, testCase });
  }
  return broken;
}

/**
 * Store-bound snapshot for non-React consumers (ProseMirror widgets, export).
 * NOT reactive — pair with a store subscription (see traceabilityBadgePlugin)
 * or use the hook below inside React components.
 */
export function getRequirementTraceability(reqId: string): TestCase[] {
  const { testCases, links } = useTraceabilityStore.getState();
  return getLinkedTestCases(testCases, links, reqId);
}

/** Reactive variant for React components — recomputes when the store changes. */
export function useRequirementTraceability(reqId: string): TestCase[] {
  const testCases = useTraceabilityStore((s) => s.testCases);
  const links = useTraceabilityStore((s) => s.links);
  return useMemo(() => getLinkedTestCases(testCases, links, reqId), [testCases, links, reqId]);
}
