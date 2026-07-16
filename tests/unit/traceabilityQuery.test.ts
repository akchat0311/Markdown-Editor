import { describe, it, expect, beforeEach } from "vitest";
import {
  buildLinksByReq,
  getLinkedTestCases,
  getRequirementTraceability,
} from "@/services/traceabilityQuery";
import { useTraceabilityStore } from "@/stores/traceabilityStore";
import type { TestCase, TraceLink } from "@/types/traceability";

const TCS: TestCase[] = [
  { id: "TC_001", title: "Verify Engine Start" },
  { id: "TC_002", title: "Verify Restart" },
  { id: "TC_005", title: "Verify Shutdown" },
];

const LINKS: TraceLink[] = [
  { tc: "TC_001", req: "REQ_001" },
  { tc: "TC_002", req: "REQ_001" },
  { tc: "TC_005", req: "REQ_003" },
];

describe("buildLinksByReq", () => {
  it("maps requirement IDs to linked test cases in links-array order", () => {
    const byReq = buildLinksByReq(TCS, LINKS);
    expect(byReq.get("REQ_001")?.map((t) => t.id)).toEqual(["TC_001", "TC_002"]);
    expect(byReq.get("REQ_003")?.map((t) => t.id)).toEqual(["TC_005"]);
    expect(byReq.get("REQ_002")).toBeUndefined();
  });

  it("skips links whose test case is unknown", () => {
    const byReq = buildLinksByReq(TCS, [{ tc: "TC_999", req: "REQ_001" }]);
    expect(byReq.size).toBe(0);
  });

  it("includes broken links (unknown req) under their stored requirement ID", () => {
    const byReq = buildLinksByReq(TCS, [{ tc: "TC_001", req: "REQ_GONE" }]);
    expect(byReq.get("REQ_GONE")?.map((t) => t.id)).toEqual(["TC_001"]);
  });
});

describe("getLinkedTestCases", () => {
  it("projects a single requirement", () => {
    expect(getLinkedTestCases(TCS, LINKS, "REQ_001").map((t) => t.id)).toEqual([
      "TC_001",
      "TC_002",
    ]);
  });

  it("returns [] for an unlinked requirement", () => {
    expect(getLinkedTestCases(TCS, LINKS, "REQ_002")).toEqual([]);
  });

  it("agrees with the bulk projection for every requirement", () => {
    const byReq = buildLinksByReq(TCS, LINKS);
    for (const req of ["REQ_001", "REQ_002", "REQ_003"]) {
      expect(getLinkedTestCases(TCS, LINKS, req)).toEqual(byReq.get(req) ?? []);
    }
  });
});

describe("getRequirementTraceability (store-bound)", () => {
  beforeEach(() => {
    useTraceabilityStore.setState({
      testCases: [],
      links: [],
      isDirty: false,
      loaded: false,
      loadError: false,
    });
  });

  it("reads the live store snapshot", () => {
    useTraceabilityStore.getState().load({ version: 1, testCases: TCS, links: LINKS });
    expect(getRequirementTraceability("REQ_001").map((t) => t.id)).toEqual([
      "TC_001",
      "TC_002",
    ]);
    expect(getRequirementTraceability("REQ_002")).toEqual([]);
  });

  it("reflects store mutations immediately", () => {
    useTraceabilityStore.getState().load({ version: 1, testCases: TCS, links: [] });
    expect(getRequirementTraceability("REQ_001")).toEqual([]);
    useTraceabilityStore.getState().addLink("TC_001", "REQ_001");
    expect(getRequirementTraceability("REQ_001").map((t) => t.id)).toEqual(["TC_001"]);
  });
});
