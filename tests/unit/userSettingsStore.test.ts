import { describe, it, expect, beforeEach } from "vitest";
import { useUserSettingsStore } from "@/stores/userSettingsStore";

const STORAGE_KEY = "userSettings";

// Reset store and localStorage before each test.
beforeEach(() => {
  localStorage.clear();
  useUserSettingsStore.setState({ userName: "", configured: false });
});

describe("initial state", () => {
  it("starts unconfigured with empty name", () => {
    const { userName, configured } = useUserSettingsStore.getState();
    expect(userName).toBe("");
    expect(configured).toBe(false);
  });
});

describe("load()", () => {
  it("remains unconfigured when localStorage is empty", () => {
    useUserSettingsStore.getState().load();
    expect(useUserSettingsStore.getState().configured).toBe(false);
    expect(useUserSettingsStore.getState().userName).toBe("");
  });

  it("loads a valid name from localStorage and sets configured=true", () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ userName: "Alice" }));
    useUserSettingsStore.getState().load();
    expect(useUserSettingsStore.getState().configured).toBe(true);
    expect(useUserSettingsStore.getState().userName).toBe("Alice");
  });

  it("trims whitespace when loading", () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ userName: "  Bob  " }));
    useUserSettingsStore.getState().load();
    expect(useUserSettingsStore.getState().userName).toBe("Bob");
    expect(useUserSettingsStore.getState().configured).toBe(true);
  });

  it("stays unconfigured when stored name is too short (1 char)", () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ userName: "A" }));
    useUserSettingsStore.getState().load();
    expect(useUserSettingsStore.getState().configured).toBe(false);
  });

  it("stays unconfigured when stored name is empty string", () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ userName: "" }));
    useUserSettingsStore.getState().load();
    expect(useUserSettingsStore.getState().configured).toBe(false);
  });

  it("stays unconfigured when storage contains malformed JSON", () => {
    localStorage.setItem(STORAGE_KEY, "not-json");
    useUserSettingsStore.getState().load();
    expect(useUserSettingsStore.getState().configured).toBe(false);
  });

  it("stays unconfigured when storage key is missing", () => {
    // localStorage has a different key
    localStorage.setItem("other", JSON.stringify({ userName: "Eve" }));
    useUserSettingsStore.getState().load();
    expect(useUserSettingsStore.getState().configured).toBe(false);
  });

  it("stays unconfigured when userName field is missing from object", () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ other: "data" }));
    useUserSettingsStore.getState().load();
    expect(useUserSettingsStore.getState().configured).toBe(false);
  });
});

describe("save()", () => {
  it("saves name, sets configured=true, and persists to localStorage", () => {
    useUserSettingsStore.getState().save("Carol");
    const { userName, configured } = useUserSettingsStore.getState();
    expect(userName).toBe("Carol");
    expect(configured).toBe(true);

    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
    expect(stored.userName).toBe("Carol");
  });

  it("trims whitespace when saving", () => {
    useUserSettingsStore.getState().save("  Dave  ");
    expect(useUserSettingsStore.getState().userName).toBe("Dave");
  });

  it("rejects names shorter than 2 chars", () => {
    useUserSettingsStore.getState().save("X");
    expect(useUserSettingsStore.getState().configured).toBe(false);
    expect(useUserSettingsStore.getState().userName).toBe("");
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it("rejects empty string", () => {
    useUserSettingsStore.getState().save("");
    expect(useUserSettingsStore.getState().configured).toBe(false);
  });

  it("rejects whitespace-only string", () => {
    useUserSettingsStore.getState().save("   ");
    expect(useUserSettingsStore.getState().configured).toBe(false);
  });

  it("accepts exactly 2-char name", () => {
    useUserSettingsStore.getState().save("Jo");
    expect(useUserSettingsStore.getState().configured).toBe(true);
    expect(useUserSettingsStore.getState().userName).toBe("Jo");
  });

  it("can update an already-configured name", () => {
    useUserSettingsStore.getState().save("Alice");
    useUserSettingsStore.getState().save("Alice Smith");
    expect(useUserSettingsStore.getState().userName).toBe("Alice Smith");
    expect(useUserSettingsStore.getState().configured).toBe(true);

    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
    expect(stored.userName).toBe("Alice Smith");
  });
});

describe("load() after save()", () => {
  it("round-trips: save then load restores the same name", () => {
    useUserSettingsStore.getState().save("Frank");
    // Reset in-memory state to simulate app restart.
    useUserSettingsStore.setState({ userName: "", configured: false });
    useUserSettingsStore.getState().load();
    expect(useUserSettingsStore.getState().userName).toBe("Frank");
    expect(useUserSettingsStore.getState().configured).toBe(true);
  });
});
