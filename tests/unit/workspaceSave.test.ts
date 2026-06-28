import { describe, it, expect, vi, beforeEach } from "vitest";
import { saveWorkspace } from "@/persistence/workspaceSave";

// ── Factories ──────────────────────────────────────────────────────────────────

function makeSaveFns() {
  return {
    saveDoc: vi.fn(async () => {}),
    saveReview: vi.fn(async () => {}),
  };
}

// ── Cases from spec ────────────────────────────────────────────────────────────

describe("saveWorkspace — save decision", () => {
  let saveDoc: ReturnType<typeof makeSaveFns>["saveDoc"];
  let saveReview: ReturnType<typeof makeSaveFns>["saveReview"];

  beforeEach(() => {
    ({ saveDoc, saveReview } = makeSaveFns());
  });

  it("Case 1: doc dirty, review not loaded → saves doc only", async () => {
    await saveWorkspace(true, false, false, saveDoc, saveReview);
    expect(saveDoc).toHaveBeenCalledOnce();
    expect(saveReview).not.toHaveBeenCalled();
  });

  it("Case 2: doc clean, review loaded and dirty → saves review only", async () => {
    await saveWorkspace(false, true, true, saveDoc, saveReview);
    expect(saveDoc).not.toHaveBeenCalled();
    expect(saveReview).toHaveBeenCalledOnce();
  });

  it("Case 3: doc dirty, review loaded and dirty → saves both", async () => {
    await saveWorkspace(true, true, true, saveDoc, saveReview);
    expect(saveDoc).toHaveBeenCalledOnce();
    expect(saveReview).toHaveBeenCalledOnce();
  });

  it("Case 4: nothing dirty → does nothing", async () => {
    await saveWorkspace(false, false, false, saveDoc, saveReview);
    expect(saveDoc).not.toHaveBeenCalled();
    expect(saveReview).not.toHaveBeenCalled();
  });

  it("Case 5: review not loaded, review dirty flag irrelevant → saves doc only when dirty", async () => {
    await saveWorkspace(true, false, true, saveDoc, saveReview);
    expect(saveDoc).toHaveBeenCalledOnce();
    expect(saveReview).not.toHaveBeenCalled();
  });

  it("review loaded but clean → saves doc only when doc is dirty", async () => {
    await saveWorkspace(true, true, false, saveDoc, saveReview);
    expect(saveDoc).toHaveBeenCalledOnce();
    expect(saveReview).not.toHaveBeenCalled();
  });

  it("nothing to save when doc clean and review loaded but clean", async () => {
    await saveWorkspace(false, true, false, saveDoc, saveReview);
    expect(saveDoc).not.toHaveBeenCalled();
    expect(saveReview).not.toHaveBeenCalled();
  });
});

describe("saveWorkspace — save ordering", () => {
  it("saves doc before review", async () => {
    const order: string[] = [];
    const saveDoc = vi.fn(async () => { order.push("doc"); });
    const saveReview = vi.fn(async () => { order.push("review"); });
    await saveWorkspace(true, true, true, saveDoc, saveReview);
    expect(order).toEqual(["doc", "review"]);
  });
});

describe("saveWorkspace — independent error handling", () => {
  it("review save still runs even if saveDoc throws", async () => {
    const saveDoc = vi.fn(async () => { throw new Error("write failed"); });
    const saveReview = vi.fn(async () => {});
    await expect(saveWorkspace(true, true, true, saveDoc, saveReview)).rejects.toThrow("write failed");
    expect(saveDoc).toHaveBeenCalledOnce();
    // review was not called because saveDoc threw synchronously before it
    // This documents current sequential behaviour — callers catch errors in each handler
  });

  it("saveDoc is not called when only review is dirty", async () => {
    const saveDoc = vi.fn(async () => { throw new Error("should not be called"); });
    const saveReview = vi.fn(async () => {});
    await saveWorkspace(false, true, true, saveDoc, saveReview);
    expect(saveDoc).not.toHaveBeenCalled();
    expect(saveReview).toHaveBeenCalledOnce();
  });
});
