import { describe, it, expect, vi, afterEach } from "vitest";
import {
  deriveTraceabilityFileName,
  deriveReviewFileName,
  findTraceabilityFile,
  findReviewFile,
} from "@/persistence/documentBundleService";
import {
  serializeTraceability,
  writeToTraceabilityHandle,
  saveTraceabilityFileAs,
  openTraceabilityFile,
} from "@/persistence/traceabilityFilePersistence";
import type { TraceabilityFile } from "@/types/traceability";

const FILE: TraceabilityFile = {
  version: 1,
  testCases: [{ id: "TC-001", title: "Login" }],
  links: [{ tc: "TC-001", req: "REQ_001" }],
};

// ── Test doubles ──────────────────────────────────────────────────────────────

function makeFileHandle(text: string, name = "spec.test-traceability.json") {
  const written: string[] = [];
  const handle = {
    name,
    kind: "file" as const,
    getFile: async () => ({ text: async () => text }),
    queryPermission: async () => "granted" as const,
    createWritable: async () => ({
      write: async (chunk: string) => { written.push(chunk); },
      close: async () => {},
      abort: async () => {},
    }),
  };
  return { handle: handle as unknown as FileSystemFileHandle, written };
}

/** Directory handle whose getFileHandle resolves per `files`, else throws `error`. */
function makeDirHandle(files: Record<string, string>, error?: () => Error) {
  return {
    kind: "directory",
    getFileHandle: async (fileName: string) => {
      if (fileName in files) return makeFileHandle(files[fileName], fileName).handle;
      if (error) throw error();
      throw new DOMException("not found", "NotFoundError");
    },
  } as unknown as FileSystemDirectoryHandle;
}

function stubWindowFn(name: "showOpenFilePicker" | "showSaveFilePicker", impl: (opts: unknown) => unknown) {
  const w = window as unknown as Record<string, unknown>;
  w[name] = vi.fn(impl);
  return () => { delete w[name]; };
}

let cleanupStubs: Array<() => void> = [];
afterEach(() => {
  cleanupStubs.forEach((fn) => fn());
  cleanupStubs = [];
  vi.restoreAllMocks();
});

// ── Naming ────────────────────────────────────────────────────────────────────

describe("deriveTraceabilityFileName", () => {
  it("derives the sidecar name from the markdown stem", () => {
    expect(deriveTraceabilityFileName("requirements.md")).toBe("requirements.test-traceability.json");
    expect(deriveTraceabilityFileName("Spec.MD")).toBe("Spec.test-traceability.json");
  });

  it("keeps dots in the stem and never collides with the review sidecar", () => {
    expect(deriveTraceabilityFileName("v1.2-spec.md")).toBe("v1.2-spec.test-traceability.json");
    expect(deriveTraceabilityFileName("spec.md")).not.toBe(deriveReviewFileName("spec.md"));
  });
});

// ── Serialization ─────────────────────────────────────────────────────────────

describe("serializeTraceability", () => {
  it("writes version 1 first, pretty-printed, with only schema fields", () => {
    const json = serializeTraceability(FILE);
    expect(json.startsWith('{\n  "version": 1')).toBe(true);
    expect(JSON.parse(json)).toEqual(FILE);
  });

  it("stamps version 1 even when the input snapshot omits it", () => {
    const json = serializeTraceability({ testCases: [], links: [] });
    expect(JSON.parse(json)).toEqual({ version: 1, testCases: [], links: [] });
  });
});

// ── Discovery: findTraceabilityFile ───────────────────────────────────────────

describe("findTraceabilityFile", () => {
  it("returns not-found without a directory handle", async () => {
    const result = await findTraceabilityFile(null, "spec.test-traceability.json");
    expect(result).toEqual({
      traceabilityData: null,
      traceabilityFound: false,
      traceabilityHandle: null,
      traceabilityError: false,
    });
  });

  it("finds, parses, and returns the sibling file plus its handle", async () => {
    const dir = makeDirHandle({ "spec.test-traceability.json": JSON.stringify(FILE) });
    const result = await findTraceabilityFile(dir, "spec.test-traceability.json");
    expect(result.traceabilityFound).toBe(true);
    expect(result.traceabilityData).toEqual(FILE);
    expect(result.traceabilityHandle).not.toBeNull();
    expect(result.traceabilityError).toBe(false);
  });

  it("reports a clean not-found when the file is absent (NotFoundError)", async () => {
    const dir = makeDirHandle({});
    const result = await findTraceabilityFile(dir, "spec.test-traceability.json");
    expect(result.traceabilityFound).toBe(false);
    expect(result.traceabilityError).toBe(false);
  });

  it("flags a read error when the file exists but is not valid JSON", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const dir = makeDirHandle({ "spec.test-traceability.json": "{ not json" });
    const result = await findTraceabilityFile(dir, "spec.test-traceability.json");
    expect(result.traceabilityFound).toBe(false);
    expect(result.traceabilityError).toBe(true);
    expect(result.traceabilityHandle).toBeNull();
  });

  it("flags a read error on unexpected failures (e.g. permission revoked)", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const dir = makeDirHandle({}, () => new DOMException("denied", "NotAllowedError"));
    const result = await findTraceabilityFile(dir, "spec.test-traceability.json");
    expect(result.traceabilityFound).toBe(false);
    expect(result.traceabilityError).toBe(true);
  });
});

// ── Discovery: findReviewFile behaviour preserved by the refactor ─────────────

describe("findReviewFile (post-refactor regression)", () => {
  it("still finds and migrates a review file", async () => {
    const dir = makeDirHandle({
      "spec.review.json": JSON.stringify({
        REQ_001: [{ id: "c_1", author: "A", text: "t", createdAt: "2026-01-01" }],
      }),
    });
    const result = await findReviewFile(dir, "spec.review.json");
    expect(result.reviewFound).toBe(true);
    expect(result.reviewData?.REQ_001).toHaveLength(1);
  });

  it("still reports parse failures as not-found (never throws)", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const dir = makeDirHandle({ "spec.review.json": "{ broken" });
    const result = await findReviewFile(dir, "spec.review.json");
    expect(result).toEqual({ reviewData: null, reviewFound: false });
  });

  it("still reports a clean not-found for absent files and missing dirHandle", async () => {
    expect(await findReviewFile(undefined, "spec.review.json")).toEqual({
      reviewData: null,
      reviewFound: false,
    });
    expect(await findReviewFile(makeDirHandle({}), "spec.review.json")).toEqual({
      reviewData: null,
      reviewFound: false,
    });
  });
});

// ── Save: writeToTraceabilityHandle ───────────────────────────────────────────

describe("writeToTraceabilityHandle", () => {
  it("writes the serialized schema through the handle", async () => {
    const { handle, written } = makeFileHandle("");
    await writeToTraceabilityHandle(handle, FILE);
    expect(written).toHaveLength(1);
    expect(JSON.parse(written[0])).toEqual(FILE);
  });

  it("propagates write failures so the caller keeps the store dirty", async () => {
    const handle = {
      queryPermission: async () => "granted",
      createWritable: async () => ({
        write: async () => { throw new Error("disk full"); },
        close: async () => {},
        abort: async () => {},
      }),
    } as unknown as FileSystemFileHandle;
    await expect(writeToTraceabilityHandle(handle, FILE)).rejects.toThrow("disk full");
  });

  it("throws NotAllowedError when write permission is denied", async () => {
    const handle = {
      queryPermission: async () => "denied",
      createWritable: async () => { throw new Error("unreachable"); },
    } as unknown as FileSystemFileHandle;
    await expect(writeToTraceabilityHandle(handle, FILE)).rejects.toMatchObject({
      name: "NotAllowedError",
    });
  });
});

// ── Save As: saveTraceabilityFileAs ───────────────────────────────────────────

describe("saveTraceabilityFileAs", () => {
  it("writes via the save picker and returns the handle", async () => {
    const { handle, written } = makeFileHandle("");
    let pickerOpts: { suggestedName?: string } | undefined;
    cleanupStubs.push(
      stubWindowFn("showSaveFilePicker", async (opts) => {
        pickerOpts = opts as { suggestedName?: string };
        return handle;
      }),
    );

    const returned = await saveTraceabilityFileAs(FILE, "spec.test-traceability.json");
    expect(returned).toBe(handle);
    expect(pickerOpts?.suggestedName).toBe("spec.test-traceability.json");
    expect(JSON.parse(written[0])).toEqual(FILE);
  });

  it("defaults the suggested name to document.test-traceability.json", async () => {
    let pickerOpts: { suggestedName?: string } | undefined;
    const { handle } = makeFileHandle("");
    cleanupStubs.push(
      stubWindowFn("showSaveFilePicker", async (opts) => {
        pickerOpts = opts as { suggestedName?: string };
        return handle;
      }),
    );
    await saveTraceabilityFileAs(FILE);
    expect(pickerOpts?.suggestedName).toBe("document.test-traceability.json");
  });

  it("returns null when the user cancels the picker", async () => {
    cleanupStubs.push(
      stubWindowFn("showSaveFilePicker", async () => {
        throw new DOMException("user cancelled", "AbortError");
      }),
    );
    expect(await saveTraceabilityFileAs(FILE)).toBeNull();
  });

  it("throws on write failure after the picker succeeds", async () => {
    const handle = {
      createWritable: async () => ({
        write: async () => { throw new Error("disk full"); },
        close: async () => {},
        abort: async () => {},
      }),
    } as unknown as FileSystemFileHandle;
    cleanupStubs.push(stubWindowFn("showSaveFilePicker", async () => handle));
    await expect(saveTraceabilityFileAs(FILE)).rejects.toThrow("disk full");
  });
});

// ── Open: openTraceabilityFile ────────────────────────────────────────────────

describe("openTraceabilityFile", () => {
  it("returns raw parsed JSON plus the handle (migration is the store's job)", async () => {
    const raw = { version: 1, testCases: [{ id: " TC-1 ", title: "pad" }], links: "junk" };
    const { handle } = makeFileHandle(JSON.stringify(raw));
    cleanupStubs.push(stubWindowFn("showOpenFilePicker", async () => [handle]));

    const result = await openTraceabilityFile();
    expect(result?.handle).toBe(handle);
    // Untouched raw data — no trimming, no repair.
    expect(result?.data).toEqual(raw);
  });

  it("returns null when the user cancels", async () => {
    cleanupStubs.push(
      stubWindowFn("showOpenFilePicker", async () => {
        throw new DOMException("user cancelled", "AbortError");
      }),
    );
    expect(await openTraceabilityFile()).toBeNull();
  });

  it("retries without startIn when the startIn variant fails", async () => {
    const { handle } = makeFileHandle(JSON.stringify(FILE));
    const calls: unknown[] = [];
    cleanupStubs.push(
      stubWindowFn("showOpenFilePicker", async (opts) => {
        calls.push(opts);
        if ((opts as { startIn?: unknown }).startIn) {
          throw new TypeError("startIn not supported");
        }
        return [handle];
      }),
    );

    const startIn = {} as FileSystemFileHandle;
    const result = await openTraceabilityFile({ startIn });
    expect(result?.handle).toBe(handle);
    expect(calls).toHaveLength(2);
  });
});
