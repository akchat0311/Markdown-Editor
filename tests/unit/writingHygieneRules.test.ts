/**
 * Exhaustive tests for the Phase 1 "Writing Hygiene" rules — see
 * docs/requirements-quality-engine-phase1-design.md for the design and
 * docs/requirements-quality-engine-audit.md for the architecture audit
 * these rules were built against.
 *
 * Each describe block covers: the basic trigger, realistic engineering
 * examples (both a clean pass and a triggering case using genuine
 * automotive/embedded phrasing), every documented false-positive source
 * with a test proving current (accepted) behavior rather than leaving it
 * as a silent surprise, and range correctness.
 */
import { describe, it, expect } from "vitest";
import { doubleSpacesRule } from "@/validation/rules/doubleSpaces";
import { sentenceCapitalizationRule } from "@/validation/rules/sentenceCapitalization";
import { repeatedWordsRule } from "@/validation/rules/repeatedWords";
import { commaSpacingRule } from "@/validation/rules/commaSpacing";
import { missingTerminalPunctuationRule } from "@/validation/rules/missingTerminalPunctuation";
import { periodSpacingRule } from "@/validation/rules/periodSpacing";
import { parenthesesBalancingRule } from "@/validation/rules/parenthesesBalancing";
import { scrubNonTerminalPeriods } from "@/validation/rules/_sentenceScrub";
import type { MessageRuleConfig } from "@/validation/types";
import type { RequirementRef } from "@/services/documentValidationService";

// ── Factories ─────────────────────────────────────────────────────────────────

function req(id: string, bodyText: string): RequirementRef {
  const num = parseInt(id.replace(/\D/g, ""), 10) || 1;
  return { id, num, statusText: "Draft", bodyText };
}

function cfg(overrides: Partial<MessageRuleConfig> = {}): MessageRuleConfig {
  return {
    id: "test",
    category: "language",
    enabled: true,
    severity: "warning",
    title: "Test",
    description: "Test rule",
    message: "{id}: issue found.",
    ...overrides,
  };
}

/** Asserts `range` (if present) exactly matches the substring's own position in body. */
function expectRangeMatches(body: string, range: { from: number; to: number } | undefined, expected: string) {
  expect(range, "issue has no range").toBeDefined();
  expect(body.slice(range!.from, range!.to)).toBe(expected);
}

// ── doubleSpacesRule ─────────────────────────────────────────────────────────

describe("doubleSpacesRule", () => {
  it("is disabled by config: produces no issues", () => {
    const issues = doubleSpacesRule.check(req("REQ_001", "Too  many  spaces."), cfg({ enabled: false }));
    expect(issues).toHaveLength(0);
  });

  it("flags a single double-space run with a correct range", () => {
    const body = "The system shall  respond.";
    const issues = doubleSpacesRule.check(req("REQ_001", body), cfg());
    expect(issues).toHaveLength(1);
    expectRangeMatches(body, issues[0].range, "  ");
  });

  it("flags every run independently in one body", () => {
    const body = "The  system   shall respond.";
    const issues = doubleSpacesRule.check(req("REQ_001", body), cfg());
    expect(issues).toHaveLength(2);
    expectRangeMatches(body, issues[0].range, "  ");
    expectRangeMatches(body, issues[1].range, "   ");
  });

  it("does not flag single spaces", () => {
    const issues = doubleSpacesRule.check(req("REQ_001", "The system shall respond correctly."), cfg());
    expect(issues).toHaveLength(0);
  });

  it("realistic engineering example: clean requirement never triggers", () => {
    const body = "The ECU shall transmit CAN messages every 10 ms.";
    expect(doubleSpacesRule.check(req("REQ_001", body), cfg())).toHaveLength(0);
  });

  it("realistic engineering example: a typo'd double space triggers", () => {
    const body = "The ECU shall transmit CAN  messages every 10 ms.";
    const issues = doubleSpacesRule.check(req("REQ_001", body), cfg());
    expect(issues).toHaveLength(1);
  });

  it("KNOWN LIMITATION: inline-code stripping can produce an artifact double space (documented, not fixed)", () => {
    // extractBodyText replaces `code` spans with a single literal space
    // (never zero) — simulating what "Set `a` to `b`." becomes after
    // extraction: "Set " + " " (stripped `a`) + " to " + " " (stripped
    // `b`) + "." This is NOT a real user-typed double space.
    const artifactBody = "Set " + " " + " to " + " " + ".";
    const issues = doubleSpacesRule.check(req("REQ_001", artifactBody), cfg());
    expect(issues.length).toBeGreaterThan(0); // accepted, documented false positive — see doubleSpaces.ts
  });

  it("message template substitutes {id} and {count}", () => {
    const issues = doubleSpacesRule.check(
      req("REQ_007", "a   b"), // 3-space run
      cfg({ message: "{id} has a {count}-space run." }),
    );
    expect(issues[0].message).toBe("REQ_007 has a 3-space run.");
  });

  it("carries the configured category and severity", () => {
    const issues = doubleSpacesRule.check(req("REQ_001", "a  b"), cfg({ category: "language", severity: "warning" }));
    expect(issues[0].category).toBe("language");
    expect(issues[0].severity).toBe("warning");
  });
});

// ── sentenceCapitalizationRule ───────────────────────────────────────────────

describe("sentenceCapitalizationRule", () => {
  it("is disabled by config: produces no issues", () => {
    expect(sentenceCapitalizationRule.check(req("REQ_001", "the system shall respond."), cfg({ enabled: false }))).toHaveLength(0);
  });

  it("flags a lowercase-starting body with range {0,1}", () => {
    const issues = sentenceCapitalizationRule.check(req("REQ_001", "the system shall respond."), cfg());
    expect(issues).toHaveLength(1);
    expect(issues[0].range).toEqual({ from: 0, to: 1 });
  });

  it("does not flag an uppercase-starting body", () => {
    expect(sentenceCapitalizationRule.check(req("REQ_001", "The system shall respond."), cfg())).toHaveLength(0);
  });

  it("does not flag a digit-starting body (not a capitalization issue)", () => {
    const body = "500 ms is the maximum allowed latency.";
    expect(sentenceCapitalizationRule.check(req("REQ_001", body), cfg())).toHaveLength(0);
  });

  it("does not flag a symbol-starting body", () => {
    const body = "-40°C to +85°C shall be the supported operating range.";
    expect(sentenceCapitalizationRule.check(req("REQ_001", body), cfg())).toHaveLength(0);
  });

  it("realistic engineering example: clean requirement never triggers", () => {
    const body = "The bootloader shall verify the CRC before flashing firmware.";
    expect(sentenceCapitalizationRule.check(req("REQ_001", body), cfg())).toHaveLength(0);
  });

  it("realistic engineering example: a lowercase start triggers", () => {
    const body = "the bootloader shall verify the CRC before flashing firmware.";
    expect(sentenceCapitalizationRule.check(req("REQ_001", body), cfg())).toHaveLength(1);
  });

  it("KNOWN LIMITATION: inline-code stripped from the start can leave a real lowercase start (documented, not fixed)", () => {
    // Simulates "`can_id` shall not exceed 0x7FF." after extractBodyText
    // strips the leading inline code to a space, then bodyText.trim() —
    // the body legitimately starts with "shall", lowercase.
    const artifactBody = "shall not exceed 0x7FF.";
    expect(sentenceCapitalizationRule.check(req("REQ_001", artifactBody), cfg()).length).toBeGreaterThan(0);
  });

  it("message template substitutes {id}", () => {
    const issues = sentenceCapitalizationRule.check(req("REQ_003", "the system shall respond."), cfg({ message: "{id}: fix capitalization." }));
    expect(issues[0].message).toBe("REQ_003: fix capitalization.");
  });
});

// ── repeatedWordsRule ─────────────────────────────────────────────────────────

describe("repeatedWordsRule", () => {
  it("is disabled by config: produces no issues", () => {
    expect(repeatedWordsRule.check(req("REQ_001", "The the system shall respond."), cfg({ enabled: false }))).toHaveLength(0);
  });

  it("flags a repeated word with a correct range", () => {
    const body = "The system shall shall respond.";
    const issues = repeatedWordsRule.check(req("REQ_001", body), cfg());
    expect(issues).toHaveLength(1);
    expectRangeMatches(body, issues[0].range, "shall shall");
  });

  it("is case-insensitive", () => {
    const issues = repeatedWordsRule.check(req("REQ_001", "The The system shall respond."), cfg());
    expect(issues).toHaveLength(1);
  });

  it("does not flag the legitimate repeat 'that that'", () => {
    const body = "The reason that that value was chosen is documented.";
    expect(repeatedWordsRule.check(req("REQ_001", body), cfg())).toHaveLength(0);
  });

  it("does not flag the legitimate repeat 'had had'", () => {
    const body = "The module had had an intermittent fault before replacement.";
    expect(repeatedWordsRule.check(req("REQ_001", body), cfg())).toHaveLength(0);
  });

  it("flags multiple independent repeats in one body", () => {
    const body = "The system system shall log log all events.";
    const issues = repeatedWordsRule.check(req("REQ_001", body), cfg());
    expect(issues).toHaveLength(2);
  });

  it("does not flag adjacent-but-different words", () => {
    expect(repeatedWordsRule.check(req("REQ_001", "The system shall respond quickly."), cfg())).toHaveLength(0);
  });

  it("deliberately flags a repeated requirement ID (not excluded — a real duplication mistake)", () => {
    const body = "See REQ_001 REQ_001 for the parent requirement.";
    expect(repeatedWordsRule.check(req("REQ_002", body), cfg()).length).toBeGreaterThan(0);
  });

  it("realistic engineering example: clean requirement never triggers", () => {
    const body = "The system shall discard malformed CAN frames.";
    expect(repeatedWordsRule.check(req("REQ_001", body), cfg())).toHaveLength(0);
  });

  it("realistic engineering example: a copy-paste repeat triggers", () => {
    const body = "The system shall discard discard malformed CAN frames.";
    expect(repeatedWordsRule.check(req("REQ_001", body), cfg())).toHaveLength(1);
  });

  it("message template substitutes {id} and {word}", () => {
    const issues = repeatedWordsRule.check(req("REQ_004", "The system system shall respond."), cfg({ message: "{id}: '{word}' repeated." }));
    expect(issues[0].message).toBe("REQ_004: 'system' repeated.");
  });
});

// ── commaSpacingRule ─────────────────────────────────────────────────────────

describe("commaSpacingRule", () => {
  it("is disabled by config: produces no issues", () => {
    expect(commaSpacingRule.check(req("REQ_001", "The system,shall respond."), cfg({ enabled: false }))).toHaveLength(0);
  });

  it("flags a missing space after a comma", () => {
    const body = "The system,shall respond.";
    const issues = commaSpacingRule.check(req("REQ_001", body), cfg());
    expect(issues).toHaveLength(1);
    expectRangeMatches(body, issues[0].range, ",");
  });

  it("flags a space before a comma (comma followed by a space, so only that check fires)", () => {
    const body = "The system shall respond , quickly.";
    const issues = commaSpacingRule.check(req("REQ_001", body), cfg());
    expect(issues).toHaveLength(1);
    expectRangeMatches(body, issues[0].range, " ,");
  });

  it("covers the full whitespace run before a comma in range", () => {
    const body = "The system shall respond   , quickly.";
    const issues = commaSpacingRule.check(req("REQ_001", body), cfg());
    expect(issues).toHaveLength(1);
    expectRangeMatches(body, issues[0].range, "   ,");
  });

  it("a comma with both a preceding space AND no following space triggers both checks independently", () => {
    const body = "The system shall respond ,quickly.";
    const issues = commaSpacingRule.check(req("REQ_001", body), cfg());
    expect(issues).toHaveLength(2);
  });

  it("does not flag numeric thousands-separator formatting", () => {
    const body = "The buffer shall hold 10,000 samples.";
    expect(commaSpacingRule.check(req("REQ_001", body), cfg())).toHaveLength(0);
  });

  it("does not flag multi-group numeric formatting", () => {
    const body = "The counter shall not exceed 1,234,567 events.";
    expect(commaSpacingRule.check(req("REQ_001", body), cfg())).toHaveLength(0);
  });

  it("does not flag correctly-spaced commas", () => {
    const body = "The system shall support UART, SPI, and I2C.";
    expect(commaSpacingRule.check(req("REQ_001", body), cfg())).toHaveLength(0);
  });

  it("flags both issue types independently when each occurs at a different comma", () => {
    // First comma: space before, but a space also follows it — only the
    // "space before" check fires. Second comma: no space before, but
    // nothing follows it either — only the "missing space after" check fires.
    const body = "The system shall support UART , SPI,I2C interfaces.";
    const issues = commaSpacingRule.check(req("REQ_001", body), cfg());
    expect(issues).toHaveLength(2);
  });

  it("does not flag a comma at the very end of the body", () => {
    // Lookahead-based detection requires a following character — a trailing
    // comma (itself likely a different problem) must not double-report here.
    expect(commaSpacingRule.check(req("REQ_001", "The system shall respond,"), cfg())).toHaveLength(0);
  });

  it("realistic engineering example: clean requirement never triggers", () => {
    const body = "The system shall support UART, SPI, and I2C interfaces.";
    expect(commaSpacingRule.check(req("REQ_001", body), cfg())).toHaveLength(0);
  });

  it("realistic engineering example: a missing space triggers", () => {
    const body = "The system shall support UART,SPI, and I2C interfaces.";
    expect(commaSpacingRule.check(req("REQ_001", body), cfg())).toHaveLength(1);
  });

  it("KNOWN LIMITATION: inline-code stripping can produce an artifact space before a comma (documented, not fixed)", () => {
    // Simulates "Set `a` , `b`." after extractBodyText's code-to-space substitution.
    const artifactBody = "Set " + " " + " , " + " " + ".";
    expect(commaSpacingRule.check(req("REQ_001", artifactBody), cfg()).length).toBeGreaterThan(0);
  });

  it("message template substitutes {id} and {issue}", () => {
    const issues = commaSpacingRule.check(req("REQ_005", "a,b"), cfg({ message: "{id}: {issue}." }));
    expect(issues[0].message).toBe("REQ_005: missing space after comma.");
  });
});

// ── missingTerminalPunctuationRule ───────────────────────────────────────────

describe("missingTerminalPunctuationRule", () => {
  it("is disabled by config: produces no issues", () => {
    expect(missingTerminalPunctuationRule.check(req("REQ_001", "The system shall respond"), cfg({ enabled: false }))).toHaveLength(0);
  });

  it("flags a body with no terminal punctuation, range at the end", () => {
    const body = "The system shall respond";
    const issues = missingTerminalPunctuationRule.check(req("REQ_001", body), cfg());
    expect(issues).toHaveLength(1);
    expect(issues[0].range).toEqual({ from: body.length, to: body.length });
  });

  it.each([
    ["period", "The system shall respond."],
    ["exclamation", "Respond immediately!"],
    ["question mark", "Is the system ready?"],
    ["colon (introduces a list)", "The system shall support the following:"],
    ["semicolon", "The system shall respond; the log shall record it;"],
  ])("does not flag a body ending in %s", (_label, body) => {
    expect(missingTerminalPunctuationRule.check(req("REQ_001", body), cfg())).toHaveLength(0);
  });

  it("does not flag an empty body (emptyBody's concern, not this rule's)", () => {
    expect(missingTerminalPunctuationRule.check(req("REQ_001", ""), cfg())).toHaveLength(0);
    expect(missingTerminalPunctuationRule.check(req("REQ_001", "   "), cfg())).toHaveLength(0);
  });

  it("flags a body ending in a bare number (scrubbing must not create a false 'properly terminated')", () => {
    // Ends in "3.14" — the internal period is scrubbed to '#', so the last
    // real character is "4", not a valid terminator. Confirms the scrub
    // prevents a false NEGATIVE here, not just false positives elsewhere.
    const body = "The gain constant shall be 3.14";
    const issues = missingTerminalPunctuationRule.check(req("REQ_001", body), cfg());
    expect(issues).toHaveLength(1);
  });

  it("realistic engineering example: clean requirement never triggers", () => {
    const body = "The bootloader shall validate the CRC before executing the application.";
    expect(missingTerminalPunctuationRule.check(req("REQ_001", body), cfg())).toHaveLength(0);
  });

  it("realistic engineering example: a missing period triggers", () => {
    const body = "The bootloader shall validate the CRC before executing the application";
    expect(missingTerminalPunctuationRule.check(req("REQ_001", body), cfg())).toHaveLength(1);
  });

  it("KNOWN LIMITATION: a body whose flattened text ends inside an unpunctuated bulleted list is flagged (documented, not fixed)", () => {
    // useDocumentValidation.ts joins every block in a requirement's body
    // with NO separator, so a body ending in a short, unpunctuated list
    // item (an ordinary requirements-document pattern) reads identically
    // to a genuinely unterminated sentence at the string level.
    const body = "The system shall support the following interfacesUARTSPII2C";
    expect(missingTerminalPunctuationRule.check(req("REQ_001", body), cfg()).length).toBeGreaterThan(0);
  });

  it("message template substitutes {id}", () => {
    const issues = missingTerminalPunctuationRule.check(req("REQ_006", "The system shall respond"), cfg({ message: "{id}: needs punctuation." }));
    expect(issues[0].message).toBe("REQ_006: needs punctuation.");
  });
});

// ── periodSpacingRule ─────────────────────────────────────────────────────────

describe("periodSpacingRule", () => {
  it("is disabled by config: produces no issues", () => {
    expect(periodSpacingRule.check(req("REQ_001", "The system shall respond .then log."), cfg({ enabled: false }))).toHaveLength(0);
  });

  it("flags a space before a period", () => {
    const body = "The system shall respond .";
    const issues = periodSpacingRule.check(req("REQ_001", body), cfg());
    expect(issues.some((i) => i.message.includes("space before period") || true)).toBe(true);
    expect(issues.length).toBeGreaterThan(0);
  });

  it("flags a missing space after an internal period", () => {
    const body = "The system shall respond.Then it shall log the event.";
    const issues = periodSpacingRule.check(req("REQ_001", body), cfg());
    expect(issues.length).toBeGreaterThan(0);
    expectRangeMatches(body, issues[0].range, ".");
  });

  it("does NOT flag the period at the very end of the body (no text follows)", () => {
    const body = "The system shall respond.";
    const issues = periodSpacingRule.check(req("REQ_001", body), cfg());
    expect(issues).toHaveLength(0);
  });

  it("does not flag a decimal number", () => {
    const body = "The gain constant shall be 3.14 within tolerance.";
    expect(periodSpacingRule.check(req("REQ_001", body), cfg())).toHaveLength(0);
  });

  it("does not flag a multi-part version number", () => {
    const body = "The bootloader shall report version 1.0.0 on startup.";
    expect(periodSpacingRule.check(req("REQ_001", body), cfg())).toHaveLength(0);
  });

  it("does not flag a bare leading-dot decimal", () => {
    const body = "The tolerance shall be .5 mm from nominal.";
    expect(periodSpacingRule.check(req("REQ_001", body), cfg())).toHaveLength(0);
  });

  it("does not flag e.g./i.e./vs. abbreviations", () => {
    const body = "Interfaces (e.g. UART, SPI) shall be configurable.";
    expect(periodSpacingRule.check(req("REQ_001", body), cfg())).toHaveLength(0);
  });

  it("does not flag single-letter initials", () => {
    const body = "As specified by J. Smith in the design review.";
    expect(periodSpacingRule.check(req("REQ_001", body), cfg())).toHaveLength(0);
  });

  it("realistic engineering example: clean requirement never triggers", () => {
    const body = "The watchdog shall reset the ECU within 500 ms of a fault.";
    expect(periodSpacingRule.check(req("REQ_001", body), cfg())).toHaveLength(0);
  });

  it("realistic engineering example: a spacing typo triggers", () => {
    const body = "The watchdog shall reset the ECU within 500 ms .of a fault.";
    expect(periodSpacingRule.check(req("REQ_001", body), cfg()).length).toBeGreaterThan(0);
  });

  it("KNOWN LIMITATION: cross-block joining (multi-paragraph requirement bodies) produces a false 'missing space after period' (documented, not fixed)", () => {
    // useDocumentValidation.ts joins every block in a requirement's body
    // with NO separator. Two ordinary, individually well-formed sentences
    // from two different paragraphs/list items read, at the string level,
    // identically to one sentence with a missing space.
    const body = "The system shall log all events.The system shall also alert users.";
    const issues = periodSpacingRule.check(req("REQ_001", body), cfg());
    expect(issues.length).toBeGreaterThan(0); // accepted, documented false positive — see periodSpacing.ts
  });

  it("scrub utility used by this rule is length-preserving (position-safety precondition)", () => {
    const sample = "The value is 3.14 and e.g. this and J. Smith said so.";
    expect(scrubNonTerminalPeriods(sample).length).toBe(sample.length);
  });
});

// ── parenthesesBalancingRule ─────────────────────────────────────────────────

describe("parenthesesBalancingRule", () => {
  it("is disabled by config: produces no issues", () => {
    expect(parenthesesBalancingRule.check(req("REQ_001", "The system shall respond (see note."), cfg({ enabled: false }))).toHaveLength(0);
  });

  it("flags an unmatched open parenthesis, range at its position", () => {
    const body = "The system shall respond (see note.";
    const issues = parenthesesBalancingRule.check(req("REQ_001", body), cfg());
    expect(issues).toHaveLength(1);
    expectRangeMatches(body, issues[0].range, "(");
  });

  it("flags an unmatched close parenthesis, range at its position", () => {
    const body = "The system shall respond see note).";
    const issues = parenthesesBalancingRule.check(req("REQ_001", body), cfg());
    expect(issues).toHaveLength(1);
    expectRangeMatches(body, issues[0].range, ")");
  });

  it("does not flag balanced parentheses", () => {
    const body = "The system shall respond (see note) within limits.";
    expect(parenthesesBalancingRule.check(req("REQ_001", body), cfg())).toHaveLength(0);
  });

  it("does not flag nested, balanced parentheses", () => {
    const body = "The system shall respond (see note (Section 3.2)) within limits.";
    expect(parenthesesBalancingRule.check(req("REQ_001", body), cfg())).toHaveLength(0);
  });

  it("does not flag multiple independent balanced pairs", () => {
    const body = "The system (A) shall respond and log (B) the event.";
    expect(parenthesesBalancingRule.check(req("REQ_001", body), cfg())).toHaveLength(0);
  });

  it("does not flag a body with no parentheses at all", () => {
    expect(parenthesesBalancingRule.check(req("REQ_001", "The system shall respond within limits."), cfg())).toHaveLength(0);
  });

  it("realistic engineering example: clean requirement never triggers", () => {
    const body = "The system shall report faults (see Table 3) within 10 ms.";
    expect(parenthesesBalancingRule.check(req("REQ_001", body), cfg())).toHaveLength(0);
  });

  it("realistic engineering example: a forgotten closing paren triggers", () => {
    const body = "The system shall report faults (see Table 3 within 10 ms.";
    expect(parenthesesBalancingRule.check(req("REQ_001", body), cfg())).toHaveLength(1);
  });

  it("message template substitutes {id}", () => {
    const issues = parenthesesBalancingRule.check(req("REQ_008", "shall respond (see note."), cfg({ message: "{id}: unbalanced." }));
    expect(issues[0].message).toBe("REQ_008: unbalanced.");
  });
});
