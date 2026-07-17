import { describe, it, expect, vi } from "vitest";
import { saveBundle } from "@/persistence/bundleSave";
import type { CompanionArtifact } from "@/persistence/companionArtifact";

// ── Factories ──────────────────────────────────────────────────────────────────

function makeCompanion(
  id: string,
  opts: Partial<{ loaded: boolean; dirty: boolean; save: () => Promise<void> }> = {},
): CompanionArtifact {
  let dirty = opts.dirty ?? true;
  const loaded = opts.loaded ?? true;
  const save = opts.save ?? vi.fn(async () => { dirty = false; });
  return {
    id,
    isLoaded: () => loaded,
    isDirty: () => dirty,
    save: vi.fn(async () => save()),
  };
}

// ── Document save decision ───────────────────────────────────────────────────

describe("saveBundle — document save decision", () => {
  it("saves the doc when dirty", async () => {
    const saveDoc = vi.fn(async () => {});
    const result = await saveBundle(saveDoc, true, []);
    expect(saveDoc).toHaveBeenCalledOnce();
    expect(result.doc).toBe("saved");
  });

  it("skips the doc when clean", async () => {
    const saveDoc = vi.fn(async () => {});
    const result = await saveBundle(saveDoc, false, []);
    expect(saveDoc).not.toHaveBeenCalled();
    expect(result.doc).toBe("skipped");
  });

  it("reports failed when saveDoc throws, without throwing itself", async () => {
    const saveDoc = vi.fn(async () => { throw new Error("disk full"); });
    const result = await saveBundle(saveDoc, true, []);
    expect(result.doc).toBe("failed");
  });
});

// ── Companion save decisions ─────────────────────────────────────────────────

describe("saveBundle — companion save decisions", () => {
  it("skips a companion that isn't loaded", async () => {
    const c = makeCompanion("review", { loaded: false });
    const result = await saveBundle(vi.fn(async () => {}), false, [c]);
    expect(c.save).not.toHaveBeenCalled();
    expect(result.companions).toEqual([{ id: "review", status: "skipped" }]);
  });

  it("skips a companion that is loaded but clean", async () => {
    const c = makeCompanion("review", { loaded: true, dirty: false });
    const result = await saveBundle(vi.fn(async () => {}), false, [c]);
    expect(c.save).not.toHaveBeenCalled();
    expect(result.companions).toEqual([{ id: "review", status: "skipped" }]);
  });

  it("saves a loaded, dirty companion", async () => {
    const c = makeCompanion("review");
    const result = await saveBundle(vi.fn(async () => {}), false, [c]);
    expect(c.save).toHaveBeenCalledOnce();
    expect(result.companions).toEqual([{ id: "review", status: "saved" }]);
  });

  it("reports 'unsaved' when save() resolves without clearing dirty (cancelled picker)", async () => {
    const c = makeCompanion("review", { save: async () => {} }); // dirty stays true
    const result = await saveBundle(vi.fn(async () => {}), false, [c]);
    expect(result.companions).toEqual([{ id: "review", status: "unsaved" }]);
  });

  it("reports 'failed' (not throwing) when a companion's save() throws", async () => {
    const c = makeCompanion("review", { save: async () => { throw new Error("permission denied"); } });
    const result = await saveBundle(vi.fn(async () => {}), false, [c]);
    expect(result.companions).toEqual([{ id: "review", status: "failed", error: "permission denied" }]);
  });
});

// ── Failure isolation — the behavior this replaces saveWorkspace() for ──────

describe("saveBundle — failure isolation", () => {
  it("still attempts every companion even when the document save fails", async () => {
    const saveDoc = vi.fn(async () => { throw new Error("write failed"); });
    const review = makeCompanion("review");
    const traceability = makeCompanion("traceability");
    const result = await saveBundle(saveDoc, true, [review, traceability]);

    expect(result.doc).toBe("failed");
    expect(review.save).toHaveBeenCalledOnce();
    expect(traceability.save).toHaveBeenCalledOnce();
    expect(result.companions).toEqual([
      { id: "review", status: "saved" },
      { id: "traceability", status: "saved" },
    ]);
  });

  it("one companion failing does not block the next companion", async () => {
    const failing = makeCompanion("review", { save: async () => { throw new Error("stale handle"); } });
    const healthy = makeCompanion("traceability");
    const result = await saveBundle(vi.fn(async () => {}), false, [failing, healthy]);

    expect(healthy.save).toHaveBeenCalledOnce();
    expect(result.companions).toEqual([
      { id: "review", status: "failed", error: "stale handle" },
      { id: "traceability", status: "saved" },
    ]);
  });

  it("saves doc and every dirty companion in one call, in order", async () => {
    const order: string[] = [];
    const saveDoc = vi.fn(async () => { order.push("doc"); });
    const review = makeCompanion("review", { save: async () => { order.push("review"); } });
    const traceability = makeCompanion("traceability", { save: async () => { order.push("traceability"); } });
    await saveBundle(saveDoc, true, [review, traceability]);
    expect(order).toEqual(["doc", "review", "traceability"]);
  });
});

describe("saveBundle — nothing dirty", () => {
  it("does nothing and reports skipped/skipped when nothing is dirty", async () => {
    const saveDoc = vi.fn(async () => {});
    const c = makeCompanion("review", { dirty: false });
    const result = await saveBundle(saveDoc, false, [c]);
    expect(saveDoc).not.toHaveBeenCalled();
    expect(c.save).not.toHaveBeenCalled();
    expect(result).toEqual({ doc: "skipped", companions: [{ id: "review", status: "skipped" }] });
  });
});
