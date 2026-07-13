import { describe, it, expect, beforeEach } from "vitest";
import { useConfigStore } from "@/stores/configStore";

const STORAGE_KEY = "md-editor-config";

describe("configStore", () => {
  beforeEach(() => {
    localStorage.clear();
    useConfigStore.setState({ requirementPattern: null });
  });

  describe("simple mode", () => {
    it("setRequirementPattern stores a simple-mode pattern", () => {
      useConfigStore.getState().setRequirementPattern("REQ_001");
      expect(useConfigStore.getState().requirementPattern).toEqual({
        mode: "simple",
        example: "REQ_001",
      });
    });

    it("trims whitespace from the example", () => {
      useConfigStore.getState().setRequirementPattern("  REQ_001  ");
      expect(useConfigStore.getState().requirementPattern).toEqual({
        mode: "simple",
        example: "REQ_001",
      });
    });
  });

  describe("regex mode", () => {
    it("setRequirementRegexPattern stores a regex-mode pattern", () => {
      useConfigStore.getState().setRequirementRegexPattern("^REQ-(\\d+)", "i");
      expect(useConfigStore.getState().requirementPattern).toEqual({
        mode: "regex",
        source: "^REQ-(\\d+)",
        flags: "i",
      });
    });

    it("defaults flags to an empty string when omitted", () => {
      useConfigStore.getState().setRequirementRegexPattern("^REQ-(\\d+)");
      expect(useConfigStore.getState().requirementPattern).toEqual({
        mode: "regex",
        source: "^REQ-(\\d+)",
        flags: "",
      });
    });

    it("trims whitespace from source and flags", () => {
      useConfigStore.getState().setRequirementRegexPattern("  ^REQ-(\\d+)  ", "  i  ");
      expect(useConfigStore.getState().requirementPattern).toEqual({
        mode: "regex",
        source: "^REQ-(\\d+)",
        flags: "i",
      });
    });

    it("stores the pattern as typed even when it is invalid regex — validation is the caller's job", () => {
      // configStore itself does not validate; validateRequirementRegex()/
      // compileRequirementPattern() are what guarantee an invalid pattern is
      // never *used*. This lets the settings UI keep echoing back exactly
      // what the user typed while it's still invalid/incomplete.
      useConfigStore.getState().setRequirementRegexPattern("^REQ-(\\d+");
      expect(useConfigStore.getState().requirementPattern).toEqual({
        mode: "regex",
        source: "^REQ-(\\d+",
        flags: "",
      });
    });
  });

  it("clearRequirementPattern resets to null regardless of prior mode", () => {
    useConfigStore.getState().setRequirementRegexPattern("^REQ-(\\d+)");
    useConfigStore.getState().clearRequirementPattern();
    expect(useConfigStore.getState().requirementPattern).toBeNull();
  });

  it("switching from regex mode to simple mode replaces the whole pattern object (no leftover fields)", () => {
    useConfigStore.getState().setRequirementRegexPattern("^REQ-(\\d+)", "i");
    useConfigStore.getState().setRequirementPattern("REQ_001");
    const pattern = useConfigStore.getState().requirementPattern;
    expect(pattern).toEqual({ mode: "simple", example: "REQ_001" });
    expect(pattern).not.toHaveProperty("source");
    expect(pattern).not.toHaveProperty("flags");
  });

  describe("persistence", () => {
    it("persists the pattern to localStorage on every change", () => {
      useConfigStore.getState().setRequirementPattern("REQ_001");
      const raw = localStorage.getItem(STORAGE_KEY);
      expect(raw).not.toBeNull();
      const parsed = JSON.parse(raw!);
      expect(parsed.state.requirementPattern).toEqual({ mode: "simple", example: "REQ_001" });
    });

    it("persists regex-mode patterns", () => {
      useConfigStore.getState().setRequirementRegexPattern("^REQ-(\\d+)", "i");
      const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
      expect(parsed.state.requirementPattern).toEqual({ mode: "regex", source: "^REQ-(\\d+)", flags: "i" });
    });
  });

  describe("legacy migration", () => {
    it("migrates a pre-mode legacy { example } shape into simple mode on rehydrate", async () => {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ state: { requirementPattern: { example: "LEGACY_001" } }, version: 0 })
      );
      await useConfigStore.persist.rehydrate();
      expect(useConfigStore.getState().requirementPattern).toEqual({
        mode: "simple",
        example: "LEGACY_001",
      });
    });

    it("leaves an already-migrated (mode-tagged) simple pattern untouched on rehydrate", async () => {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ state: { requirementPattern: { mode: "simple", example: "REQ_001" } }, version: 1 })
      );
      await useConfigStore.persist.rehydrate();
      expect(useConfigStore.getState().requirementPattern).toEqual({ mode: "simple", example: "REQ_001" });
    });

    it("leaves an already-migrated regex pattern untouched on rehydrate", async () => {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          state: { requirementPattern: { mode: "regex", source: "^REQ-(\\d+)", flags: "" } },
          version: 1,
        })
      );
      await useConfigStore.persist.rehydrate();
      expect(useConfigStore.getState().requirementPattern).toEqual({
        mode: "regex",
        source: "^REQ-(\\d+)",
        flags: "",
      });
    });

    it("handles a null persisted pattern without crashing", async () => {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ state: { requirementPattern: null }, version: 0 }));
      await useConfigStore.persist.rehydrate();
      expect(useConfigStore.getState().requirementPattern).toBeNull();
    });

    it("handles no persisted state at all (fresh browser) without crashing", async () => {
      localStorage.removeItem(STORAGE_KEY);
      await useConfigStore.persist.rehydrate();
      expect(useConfigStore.getState().requirementPattern).toBeNull();
    });
  });
});
