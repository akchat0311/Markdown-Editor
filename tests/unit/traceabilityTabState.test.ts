/**
 * Per-tab traceability state cache (Phase 5 cross-document behaviour).
 *
 * Guarantees under test: switching tabs swaps sidecar state without losing
 * unsaved edits; closed tabs drop their snapshots; background dirty state
 * still guards beforeunload.
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  stashTraceabilityState,
  restoreTraceabilityState,
  dropTraceabilityState,
  anyStashedTraceabilityDirty,
  clearTraceabilityTabState,
} from "@/services/traceabilityTabState";
import { useTraceabilityStore } from "@/stores/traceabilityStore";

function resetStore() {
  useTraceabilityStore.setState({
    testCases: [],
    links: [],
    isDirty: false,
    loaded: false,
    loadError: false,
  });
}

describe("traceability tab state cache", () => {
  beforeEach(() => {
    resetStore();
    clearTraceabilityTabState();
  });

  it("round-trips the full store state through stash/restore", () => {
    useTraceabilityStore.getState().load({
      version: 1,
      testCases: [{ id: "TC_001", title: "T" }],
      links: [{ tc: "TC_001", req: "REQ_001" }],
    });
    useTraceabilityStore.getState().addTestCase("TC_002", "Unsaved edit"); // dirty

    stashTraceabilityState("tab_a");
    resetStore(); // simulate the arriving tab having nothing

    expect(restoreTraceabilityState("tab_a")).toBe(true);
    const s = useTraceabilityStore.getState();
    expect(s.testCases.map((t) => t.id)).toEqual(["TC_001", "TC_002"]);
    expect(s.links).toEqual([{ tc: "TC_001", req: "REQ_001" }]);
    expect(s.isDirty).toBe(true); // unsaved edits survive the round trip
    expect(s.loaded).toBe(true);
  });

  it("restore returns false for an unknown tab and leaves the store alone", () => {
    useTraceabilityStore.getState().addTestCase("TC_001", "T");
    expect(restoreTraceabilityState("never_seen")).toBe(false);
    expect(useTraceabilityStore.getState().testCases).toHaveLength(1);
  });

  it("simulated A→B→A switch keeps each tab's state isolated", () => {
    // Tab A has one link; user switches to tab B (empty), edits there, then back.
    useTraceabilityStore.getState().load({
      version: 1,
      testCases: [{ id: "TC_A", title: "A's case" }],
      links: [{ tc: "TC_A", req: "REQ_001" }],
    });
    stashTraceabilityState("tab_a");
    resetStore();

    useTraceabilityStore.getState().addTestCase("TC_B", "B's case");
    stashTraceabilityState("tab_b");

    expect(restoreTraceabilityState("tab_a")).toBe(true);
    expect(useTraceabilityStore.getState().testCases.map((t) => t.id)).toEqual(["TC_A"]);

    expect(restoreTraceabilityState("tab_b")).toBe(true);
    expect(useTraceabilityStore.getState().testCases.map((t) => t.id)).toEqual(["TC_B"]);
  });

  it("dropTraceabilityState removes the snapshot (closed tab)", () => {
    useTraceabilityStore.getState().addTestCase("TC_001", "T");
    stashTraceabilityState("tab_a");
    dropTraceabilityState("tab_a");
    resetStore();
    expect(restoreTraceabilityState("tab_a")).toBe(false);
  });

  it("anyStashedTraceabilityDirty reflects background unsaved edits", () => {
    expect(anyStashedTraceabilityDirty()).toBe(false);

    useTraceabilityStore.getState().addTestCase("TC_001", "T"); // dirty
    stashTraceabilityState("tab_a");
    expect(anyStashedTraceabilityDirty()).toBe(true);

    dropTraceabilityState("tab_a");
    expect(anyStashedTraceabilityDirty()).toBe(false);
  });

  it("stash overwrites a previous snapshot for the same tab", () => {
    useTraceabilityStore.getState().addTestCase("TC_001", "T");
    stashTraceabilityState("tab_a");
    useTraceabilityStore.getState().addTestCase("TC_002", "T2");
    stashTraceabilityState("tab_a");
    resetStore();
    restoreTraceabilityState("tab_a");
    expect(useTraceabilityStore.getState().testCases).toHaveLength(2);
  });
});
