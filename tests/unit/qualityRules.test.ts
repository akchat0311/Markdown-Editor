import { describe, it, expect } from "vitest";
import type { JSONContent } from "@tiptap/core";
import { weakModalRule } from "@/validation/rules/weakModal";
import { ambiguousWordsRule } from "@/validation/rules/ambiguousWords";
import { forbiddenTermsRule } from "@/validation/rules/forbiddenTerms";
import { wordCountRule } from "@/validation/rules/wordCount";
import { multipleShallRule } from "@/validation/rules/multipleShall";
import { vagueQuantifiersRule } from "@/validation/rules/vagueQuantifiers";
import { escapeClausesRule } from "@/validation/rules/escapeClauses";
import { multipleSentencesRule } from "@/validation/rules/multipleSentences";
import { undefinedAcronymsRule } from "@/validation/rules/undefinedAcronyms";
import { RULE_REGISTRY, DOC_RULE_REGISTRY } from "@/validation/registry";
import { runAllValidations } from "@/validation/engine";
import qualityRules from "@/config/quality-rules.json";
import type { TermListRuleConfig, WordCountRuleConfig, MultipleShallRuleConfig, MessageRuleConfig, AcronymRuleConfig } from "@/validation/types";
import type { RequirementRef } from "@/services/documentValidationService";

// ── Factories ─────────────────────────────────────────────────────────────────

function req(id: string, bodyText: string, statusText = "Draft"): RequirementRef {
  const num = parseInt(id.replace(/\D/g, ""), 10) || 1;
  return { id, num, statusText, bodyText };
}

const BASE_TERM_CFG: Omit<TermListRuleConfig, "terms" | "message" | "id"> = {
  category: "language",
  enabled: true,
  severity: "warning",
  title: "Test",
  description: "Test rule",
};

function termCfg(terms: string[], message = "{id}: '{term}' found."): TermListRuleConfig {
  return { ...BASE_TERM_CFG, id: "weakModal", terms, message };
}

// ── RULE_REGISTRY ─────────────────────────────────────────────────────────────

describe("RULE_REGISTRY", () => {
  it("contains exactly 8 configurable rules", () => {
    expect(RULE_REGISTRY).toHaveLength(8);
  });

  it("each rule has a unique ID", () => {
    const ids = RULE_REGISTRY.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("registry order is stable", () => {
    expect(RULE_REGISTRY.map((r) => r.id)).toEqual([
      "weakModal",
      "ambiguousWords",
      "forbiddenTerms",
      "wordCount",
      "multipleShall",
      "vagueQuantifiers",
      "escapeClauses",
      "multipleSentences",
    ]);
  });

  it("every registered rule ID exists in quality-rules.json", () => {
    for (const rule of RULE_REGISTRY) {
      expect(qualityRules.rules).toHaveProperty(rule.id);
    }
  });

  it("every rule fires when given a body that triggers it", () => {
    const triggers: Record<string, string> = {
      weakModal: "The system should respond.",
      ambiguousWords: "Response shall be fast.",
      forbiddenTerms: "Performance target is TBD.",
      wordCount: Array.from({ length: 200 }, (_, i) => `word${i}`).join(" "),
      multipleShall: "System shall do X and shall do Y.",
      vagueQuantifiers: "The system shall handle some requests.",
      escapeClauses: "The system shall respond if possible.",
      multipleSentences: "The system shall respond. It shall also log the event.",
    };
    for (const rule of RULE_REGISTRY) {
      const config = (qualityRules.rules as Record<string, unknown>)[rule.id];
      const issues = rule.check(req("REQ_001", triggers[rule.id]), config);
      expect(issues.length, `rule "${rule.id}" produced no issues`).toBeGreaterThan(0);
    }
  });

  it("disabled rules produce no issues regardless of body text", () => {
    for (const rule of RULE_REGISTRY) {
      const baseConfig = (qualityRules.rules as Record<string, unknown>)[rule.id] as Record<string, unknown>;
      const disabledConfig = { ...baseConfig, enabled: false };
      const triggerAll = "should TBD fast some if possible " + Array.from({ length: 200 }, () => "word").join(" ") + " System shall do X. It shall also do Y.";
      const issues = rule.check(req("REQ_001", triggerAll), disabledConfig);
      expect(issues, `rule "${rule.id}" ran despite being disabled`).toHaveLength(0);
    }
  });

  it("issues produced by each rule carry the rule's category from the JSON config", () => {
    const triggers: Record<string, string> = {
      weakModal: "The system should respond.",
      ambiguousWords: "Response shall be fast.",
      forbiddenTerms: "Performance target is TBD.",
      wordCount: Array.from({ length: 200 }, (_, i) => `word${i}`).join(" "),
      multipleShall: "System shall do X and shall do Y.",
      vagueQuantifiers: "The system shall handle some requests.",
      escapeClauses: "The system shall respond if possible.",
      multipleSentences: "The system shall respond. It shall also log the event.",
    };
    for (const rule of RULE_REGISTRY) {
      const config = (qualityRules.rules as Record<string, unknown>)[rule.id] as Record<string, unknown>;
      const issues = rule.check(req("REQ_001", (triggers as Record<string, string>)[rule.id]), config);
      for (const issue of issues) {
        expect(issue.category).toBe(config["category"]);
      }
    }
  });
});

// ── DOC_RULE_REGISTRY ─────────────────────────────────────────────────────────

describe("DOC_RULE_REGISTRY", () => {
  it("contains exactly 1 document-level rule", () => {
    expect(DOC_RULE_REGISTRY).toHaveLength(1);
  });

  it("each rule has a unique ID", () => {
    const ids = DOC_RULE_REGISTRY.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("registry order is stable", () => {
    expect(DOC_RULE_REGISTRY.map((r) => r.id)).toEqual(["undefinedAcronyms"]);
  });

  it("every registered rule ID exists in quality-rules.json", () => {
    for (const rule of DOC_RULE_REGISTRY) {
      expect(qualityRules.rules).toHaveProperty(rule.id);
    }
  });

  it("every doc rule fires when given a document that triggers it", () => {
    const docTriggers: Record<string, ReturnType<typeof req>[]> = {
      undefinedAcronyms: [
        req("REQ_001", "The ECU shall transmit CAN messages."),
        req("REQ_002", "Electronic Control Unit (ECU) and Controller Area Network (CAN) shall be validated."),
      ],
    };
    for (const rule of DOC_RULE_REGISTRY) {
      const config = (qualityRules.rules as Record<string, unknown>)[rule.id];
      const issues = rule.check(docTriggers[rule.id], config);
      expect(issues.length, `doc rule "${rule.id}" produced no issues`).toBeGreaterThan(0);
    }
  });

  it("disabled doc rules produce no issues", () => {
    for (const rule of DOC_RULE_REGISTRY) {
      const baseConfig = (qualityRules.rules as Record<string, unknown>)[rule.id] as Record<string, unknown>;
      const disabledConfig = { ...baseConfig, enabled: false };
      const issues = rule.check([req("REQ_001", "The ECU shall transmit CAN messages.")], disabledConfig);
      expect(issues, `doc rule "${rule.id}" ran despite being disabled`).toHaveLength(0);
    }
  });
});

// ── weakModalRule ─────────────────────────────────────────────────────────────

describe("weakModalRule", () => {
  it("returns no issues when body has no weak modals", () => {
    expect(weakModalRule.check(req("REQ_001", "The system shall authenticate users."), termCfg(["should"]))).toHaveLength(0);
  });

  it("flags a weak modal in body text", () => {
    const issues = weakModalRule.check(req("REQ_001", "The system should respond quickly."), termCfg(["should"]));
    expect(issues).toHaveLength(1);
    expect(issues[0].type).toBe("weak-modal");
    expect(issues[0].severity).toBe("warning");
    expect(issues[0].targetId).toBe("REQ_001");
    expect(issues[0].category).toBe("language");
    expect(issues[0].message).toContain("should");
  });

  it("is case-insensitive", () => {
    expect(weakModalRule.check(req("REQ_001", "This SHOULD be done."), termCfg(["should"]))).toHaveLength(1);
    expect(weakModalRule.check(req("REQ_001", "This Should be done."), termCfg(["should"]))).toHaveLength(1);
  });

  it("matches only whole terms, not substrings", () => {
    expect(weakModalRule.check(req("REQ_001", "Use the canonical form."), termCfg(["can"]))).toHaveLength(0);
  });

  it("produces one issue per matched term", () => {
    const issues = weakModalRule.check(
      req("REQ_001", "The unit should respond quickly and may also log events."),
      termCfg(["should", "may"]),
    );
    expect(issues).toHaveLength(2);
    expect(issues.every((i) => i.type === "weak-modal")).toBe(true);
  });

  it("returns no issues when disabled", () => {
    expect(weakModalRule.check(req("REQ_001", "The system should respond."), { ...termCfg(["should"]), enabled: false })).toHaveLength(0);
  });

  it("handles multi-word terms", () => {
    const issues = weakModalRule.check(req("REQ_001", "The system ought to respond quickly."), termCfg(["ought to"]));
    expect(issues).toHaveLength(1);
    expect(issues[0].message).toContain("ought to");
  });

  it("issue IDs are unique across different terms", () => {
    const issues = weakModalRule.check(
      req("REQ_001", "It should work and may also fail."),
      termCfg(["should", "may"]),
    );
    expect(new Set(issues.map((i) => i.id)).size).toBe(2);
  });
});

// ── weakModalRule — CAN / May false-positive regression ───────────────────────

describe("weakModalRule — CAN/May false positive regression", () => {
  it("CAN all-uppercase does not trigger weakModal (automotive acronym)", () => {
    expect(
      weakModalRule.check(req("REQ_001", "The ECU shall transmit CAN messages."), termCfg(["can"])),
    ).toHaveLength(0);
  });

  it("CAN bus phrasing does not trigger weakModal", () => {
    expect(
      weakModalRule.check(req("REQ_001", "The CAN bus shall operate at 500 kbps."), termCfg(["can"])),
    ).toHaveLength(0);
  });

  it("lowercase 'can' capability wording triggers weakModal", () => {
    const issues = weakModalRule.check(
      req("REQ_001", "The module can send diagnostic frames."),
      termCfg(["can"]),
    );
    expect(issues).toHaveLength(1);
    expect(issues[0].type).toBe("weak-modal");
  });

  it("title-case 'Can' modal (sentence-start) triggers weakModal", () => {
    const issues = weakModalRule.check(
      req("REQ_001", "Can the system detect faults?"),
      termCfg(["can"]),
    );
    expect(issues).toHaveLength(1);
  });

  it("'May YYYY' month reference does not trigger weakModal", () => {
    expect(
      weakModalRule.check(
        req("REQ_001", "This requirement is valid from May 2026."),
        termCfg(["may"]),
      ),
    ).toHaveLength(0);
  });

  it("'May DD' date reference does not trigger weakModal", () => {
    expect(
      weakModalRule.check(req("REQ_001", "Deadline is May 15."), termCfg(["may"])),
    ).toHaveLength(0);
  });

  it("lowercase 'may' modal triggers weakModal", () => {
    const issues = weakModalRule.check(
      req("REQ_001", "The system may respond within 10ms."),
      termCfg(["may"]),
    );
    expect(issues).toHaveLength(1);
    expect(issues[0].type).toBe("weak-modal");
  });

  it("title-case 'May' not followed by digit triggers weakModal (modal usage)", () => {
    const issues = weakModalRule.check(
      req("REQ_001", "May the system respond to errors?"),
      termCfg(["may"]),
    );
    expect(issues).toHaveLength(1);
  });

  it("SHOULD all-uppercase still triggers weakModal (case-insensitive behaviour preserved)", () => {
    expect(
      weakModalRule.check(req("REQ_001", "This SHOULD be verified."), termCfg(["should"])),
    ).toHaveLength(1);
  });

  it("should/could/might/would/ought to are unaffected", () => {
    const pairs: [string, string][] = [
      ["should", "The system should handle errors."],
      ["could", "The module could retry once."],
      ["might", "The component might reboot."],
      ["would", "The device would alert the user."],
      ["ought to", "The software ought to validate inputs."],
    ];
    for (const [term, body] of pairs) {
      const issues = weakModalRule.check(req("REQ_001", body), termCfg([term]));
      expect(issues, `term "${term}" should trigger`).toHaveLength(1);
    }
  });
});

// ── ambiguousWordsRule ────────────────────────────────────────────────────────

describe("ambiguousWordsRule", () => {
  it("returns no issues for clear, measurable text", () => {
    expect(ambiguousWordsRule.check(req("REQ_001", "Response time shall be under 200ms."), termCfg(["fast"]))).toHaveLength(0);
  });

  it("flags an ambiguous word", () => {
    const issues = ambiguousWordsRule.check(req("REQ_001", "Response shall be fast."), termCfg(["fast"]));
    expect(issues).toHaveLength(1);
    expect(issues[0].type).toBe("ambiguous-word");
    expect(issues[0].targetId).toBe("REQ_001");
  });

  it("matches 'etc.' including the trailing dot", () => {
    const issues = ambiguousWordsRule.check(req("REQ_001", "Covers errors, warnings, etc."), termCfg(["etc."]));
    expect(issues).toHaveLength(1);
    expect(issues[0].message).toContain("etc.");
  });

  it("does not match 'etc' without the dot when the term is 'etc.'", () => {
    expect(ambiguousWordsRule.check(req("REQ_001", "The etc field."), termCfg(["etc."]))).toHaveLength(0);
  });

  it("returns no issues when disabled", () => {
    expect(ambiguousWordsRule.check(req("REQ_001", "It shall be fast."), { ...termCfg(["fast"]), enabled: false })).toHaveLength(0);
  });
});

// ── forbiddenTermsRule ────────────────────────────────────────────────────────

describe("forbiddenTermsRule", () => {
  const cfg: TermListRuleConfig = {
    id: "forbiddenTerms",
    category: "completeness",
    enabled: true,
    severity: "error",
    title: "Forbidden",
    description: "Test",
    terms: ["TBD", "TBC", "N/A"],
    message: "{id}: '{term}' forbidden.",
  };

  it("returns no issues for clean body text", () => {
    expect(forbiddenTermsRule.check(req("REQ_001", "The system shall respond in 200ms."), cfg)).toHaveLength(0);
  });

  it("flags TBD as an error", () => {
    const issues = forbiddenTermsRule.check(req("REQ_001", "Performance target is TBD."), cfg);
    expect(issues).toHaveLength(1);
    expect(issues[0].type).toBe("forbidden-term");
    expect(issues[0].severity).toBe("error");
    expect(issues[0].message).toContain("TBD");
  });

  it("is case-insensitive", () => {
    expect(forbiddenTermsRule.check(req("REQ_001", "Value is tbd."), cfg)).toHaveLength(1);
  });

  it("does not flag partial word matches", () => {
    expect(forbiddenTermsRule.check(req("REQ_001", "See ATBD document."), cfg)).toHaveLength(0);
  });

  it("matches N/A correctly", () => {
    const issues = forbiddenTermsRule.check(req("REQ_001", "Error handling is N/A for this release."), cfg);
    expect(issues).toHaveLength(1);
    expect(issues[0].message).toContain("N/A");
  });

  it("returns no issues when disabled", () => {
    expect(forbiddenTermsRule.check(req("REQ_001", "Value is TBD."), { ...cfg, enabled: false })).toHaveLength(0);
  });
});

// ── wordCountRule ─────────────────────────────────────────────────────────────

describe("wordCountRule", () => {
  function cfg(maxWords: number, enabled = true): WordCountRuleConfig {
    return {
      id: "wordCount", category: "structure", enabled, severity: "warning",
      title: "Word Count", description: "Too long",
      maxWords,
      message: "{id} is too long ({actual} words, limit {maxWords}).",
    };
  }

  const shortBody = "The system shall respond.";
  const longBody = Array.from({ length: 20 }, (_, i) => `word${i}`).join(" ");

  it("returns no issues when word count is under the limit", () => {
    expect(wordCountRule.check(req("REQ_001", shortBody), cfg(50))).toHaveLength(0);
  });

  it("returns no issues when word count equals the limit", () => {
    expect(wordCountRule.check(req("REQ_001", shortBody), cfg(4))).toHaveLength(0);
  });

  it("flags body that exceeds the word limit", () => {
    const issues = wordCountRule.check(req("REQ_001", longBody), cfg(10));
    expect(issues).toHaveLength(1);
    expect(issues[0].type).toBe("word-count");
    expect(issues[0].severity).toBe("warning");
    expect(issues[0].message).toContain("20");
    expect(issues[0].message).toContain("10");
    expect(issues[0].targetId).toBe("REQ_001");
  });

  it("returns no issues when disabled", () => {
    expect(wordCountRule.check(req("REQ_001", longBody), cfg(1, false))).toHaveLength(0);
  });

  it("handles empty body without error", () => {
    expect(wordCountRule.check(req("REQ_001", ""), cfg(10))).toHaveLength(0);
  });
});

// ── multipleShallRule ─────────────────────────────────────────────────────────

describe("multipleShallRule", () => {
  function cfg(maxCount: number, enabled = true): MultipleShallRuleConfig {
    return {
      id: "multipleShall", category: "structure", enabled, severity: "warning",
      title: "Multiple SHALL", description: "Too many SHALL",
      maxCount,
      message: "{id} contains {count} SHALL statements.",
    };
  }

  it("returns no issues when body has no SHALL", () => {
    expect(multipleShallRule.check(req("REQ_001", "The system should respond."), cfg(1))).toHaveLength(0);
  });

  it("returns no issues for exactly one SHALL (maxCount = 1)", () => {
    expect(multipleShallRule.check(req("REQ_001", "The system shall respond."), cfg(1))).toHaveLength(0);
  });

  it("flags two SHALL statements when maxCount is 1", () => {
    const issues = multipleShallRule.check(req("REQ_001", "The system shall respond and shall log the event."), cfg(1));
    expect(issues).toHaveLength(1);
    expect(issues[0].type).toBe("multiple-shall");
    expect(issues[0].message).toContain("2");
    expect(issues[0].targetId).toBe("REQ_001");
  });

  it("is case-insensitive (counts SHALL, shall, Shall)", () => {
    const issues = multipleShallRule.check(req("REQ_001", "The system SHALL respond. It SHALL also log. It Shall alert."), cfg(1));
    expect(issues).toHaveLength(1);
    expect(issues[0].message).toContain("3");
  });

  it("returns no issues when disabled", () => {
    expect(multipleShallRule.check(req("REQ_001", "System shall do X and shall do Y."), cfg(1, false))).toHaveLength(0);
  });
});

// ── vagueQuantifiersRule ──────────────────────────────────────────────────────

describe("vagueQuantifiersRule", () => {
  const ALL_TERMS = [
    "some", "many", "few", "several", "various", "numerous", "multiple",
    "adequate number of", "sufficient number of", "a number of",
  ];

  function cfg(terms = ALL_TERMS, enabled = true): TermListRuleConfig {
    return {
      id: "vagueQuantifiers", category: "language", enabled, severity: "warning",
      title: "Vague Quantifiers", description: "No vague quantifiers.",
      terms,
      message: "{id}: Vague quantifier '{term}' found.",
    };
  }

  it("returns no issues for an empty body", () => {
    expect(vagueQuantifiersRule.check(req("REQ_001", ""), cfg())).toHaveLength(0);
  });

  it("returns no issues when body contains no vague quantifiers", () => {
    expect(vagueQuantifiersRule.check(
      req("REQ_001", "The system shall process exactly 1000 requests per second."),
      cfg(),
    )).toHaveLength(0);
  });

  it.each(ALL_TERMS)("flags '%s' as a vague quantifier", (term) => {
    const body = `The system shall handle ${term} requests.`;
    const issues = vagueQuantifiersRule.check(req("REQ_001", body), cfg([term]));
    expect(issues).toHaveLength(1);
    expect(issues[0].type).toBe("vague-quantifier");
    expect(issues[0].severity).toBe("warning");
    expect(issues[0].message).toContain(term);
  });

  it("flags multiple distinct vague quantifiers in one requirement", () => {
    const issues = vagueQuantifiersRule.check(
      req("REQ_001", "The system shall process several requests and many responses."),
      cfg(["several", "many"]),
    );
    expect(issues).toHaveLength(2);
    expect(issues.some((i) => i.message.includes("several"))).toBe(true);
    expect(issues.some((i) => i.message.includes("many"))).toBe(true);
  });

  it("produces one issue even when the same term appears multiple times", () => {
    const issues = vagueQuantifiersRule.check(
      req("REQ_001", "The system shall handle some requests and some responses."),
      cfg(["some"]),
    );
    expect(issues).toHaveLength(1);
  });

  it("is case-insensitive", () => {
    expect(vagueQuantifiersRule.check(req("REQ_001", "The system shall handle Some requests."), cfg(["some"]))).toHaveLength(1);
    expect(vagueQuantifiersRule.check(req("REQ_001", "The system shall handle SEVERAL items."), cfg(["several"]))).toHaveLength(1);
  });

  it("does not match 'some' inside 'someone'", () => {
    expect(vagueQuantifiersRule.check(
      req("REQ_001", "The system shall notify someone when complete."),
      cfg(["some"]),
    )).toHaveLength(0);
  });

  it("does not match 'many' inside 'company'", () => {
    expect(vagueQuantifiersRule.check(
      req("REQ_001", "The system shall support the company's operations."),
      cfg(["many"]),
    )).toHaveLength(0);
  });

  it("does not match 'few' inside 'fewer'", () => {
    expect(vagueQuantifiersRule.check(
      req("REQ_001", "The system shall complete in fewer than 5 steps."),
      cfg(["few"]),
    )).toHaveLength(0);
  });

  it("returns no issues when disabled", () => {
    expect(vagueQuantifiersRule.check(
      req("REQ_001", "The system shall handle some requests."),
      cfg(["some"], false),
    )).toHaveLength(0);
  });

  it("issue IDs are unique across different matched terms", () => {
    const issues = vagueQuantifiersRule.check(
      req("REQ_001", "Handle several items and various configurations."),
      cfg(["several", "various"]),
    );
    expect(new Set(issues.map((i) => i.id)).size).toBe(2);
  });

  it("works with the full production term list from quality-rules.json", () => {
    const config = qualityRules.rules.vagueQuantifiers;
    const body = "The system shall process a number of requests with sufficient number of retries.";
    const issues = vagueQuantifiersRule.check(req("REQ_001", body), config);
    expect(issues.length).toBeGreaterThanOrEqual(2);
    expect(issues.some((i) => i.message.includes("a number of"))).toBe(true);
    expect(issues.some((i) => i.message.includes("sufficient number of"))).toBe(true);
  });
});

// ── escapeClausesRule ─────────────────────────────────────────────────────────

describe("escapeClausesRule", () => {
  function cfg(terms = ["if possible", "where appropriate"], enabled = true): TermListRuleConfig {
    return {
      id: "escapeClauses", category: "language", enabled, severity: "warning",
      title: "Escape Clauses", description: "No escape clauses.",
      terms,
      message: "{id}: Escape clause '{term}' found.",
    };
  }

  it("returns no issues when body contains no escape clauses", () => {
    expect(escapeClausesRule.check(req("REQ_001", "The system shall respond within 200ms."), cfg())).toHaveLength(0);
  });

  it("flags a single escape clause", () => {
    const issues = escapeClausesRule.check(
      req("REQ_001", "The system shall respond if possible."),
      cfg(),
    );
    expect(issues).toHaveLength(1);
    expect(issues[0].type).toBe("escape-clause");
    expect(issues[0].severity).toBe("warning");
    expect(issues[0].targetId).toBe("REQ_001");
    expect(issues[0].category).toBe("language");
    expect(issues[0].message).toContain("if possible");
  });

  it("produces one issue per distinct matched term", () => {
    const issues = escapeClausesRule.check(
      req("REQ_001", "The system shall respond if possible and where appropriate."),
      cfg(),
    );
    expect(issues).toHaveLength(2);
    expect(issues.map((i) => i.message).some((m) => m.includes("if possible"))).toBe(true);
    expect(issues.map((i) => i.message).some((m) => m.includes("where appropriate"))).toBe(true);
  });

  it("produces one issue even when the same clause appears twice in the body", () => {
    const issues = escapeClausesRule.check(
      req("REQ_001", "The system shall respond if possible, and if possible also log events."),
      cfg(["if possible"]),
    );
    expect(issues).toHaveLength(1);
  });

  it("is case-insensitive", () => {
    expect(escapeClausesRule.check(req("REQ_001", "The system shall comply If Possible."), cfg())).toHaveLength(1);
    expect(escapeClausesRule.check(req("REQ_001", "The system shall comply IF POSSIBLE."), cfg())).toHaveLength(1);
  });

  it("does not match a phrase embedded inside a larger word", () => {
    // "possible" in "if-possible" uses a hyphen — the phrase "if possible" (with space) won't match
    expect(escapeClausesRule.check(req("REQ_001", "The flag isPossible shall be set."), cfg())).toHaveLength(0);
  });

  it("does not match when the phrase is preceded by a word character", () => {
    // "notif possible" — "if possible" preceded by "t" (word char) → no match
    expect(escapeClausesRule.check(req("REQ_001", "The notif possible event."), cfg())).toHaveLength(0);
  });

  it("returns no issues when disabled", () => {
    expect(
      escapeClausesRule.check(
        req("REQ_001", "The system shall respond if possible."),
        cfg(["if possible"], false),
      ),
    ).toHaveLength(0);
  });

  it("issue IDs are unique across different matched terms", () => {
    const issues = escapeClausesRule.check(
      req("REQ_001", "Respond if possible and where appropriate."),
      cfg(),
    );
    expect(new Set(issues.map((i) => i.id)).size).toBe(2);
  });

  it("works with the full production term list from quality-rules.json", () => {
    const fullConfig = qualityRules.rules.escapeClauses;
    const body = "The system shall respond where applicable and if feasible.";
    const issues = escapeClausesRule.check(req("REQ_001", body), fullConfig);
    expect(issues).toHaveLength(2);
    expect(issues.some((i) => i.message.includes("where applicable"))).toBe(true);
    expect(issues.some((i) => i.message.includes("if feasible"))).toBe(true);
  });
});

// ── multipleSentencesRule ─────────────────────────────────────────────────────

describe("multipleSentencesRule", () => {
  function cfg(enabled = true): MessageRuleConfig {
    return {
      id: "multipleSentences", category: "structure", enabled, severity: "warning",
      title: "Multiple Sentences", description: "Single obligation per requirement.",
      message: "{id} contains {count} sentences. Consider splitting.",
    };
  }

  it("returns no issues for an empty body", () => {
    expect(multipleSentencesRule.check(req("REQ_001", ""), cfg())).toHaveLength(0);
  });

  it("returns no issues for a single sentence ending with a period", () => {
    expect(multipleSentencesRule.check(req("REQ_001", "The system shall respond within 200ms."), cfg())).toHaveLength(0);
  });

  it("returns no issues for a single sentence with no terminal punctuation", () => {
    expect(multipleSentencesRule.check(req("REQ_001", "The system shall respond within 200ms"), cfg())).toHaveLength(0);
  });

  it("returns no issues for a single question ending with '?'", () => {
    expect(multipleSentencesRule.check(req("REQ_001", "Does the system support TLS?"), cfg())).toHaveLength(0);
  });

  it("returns no issues for a single exclamation ending with '!'", () => {
    expect(multipleSentencesRule.check(req("REQ_001", "The system shall never fail!"), cfg())).toHaveLength(0);
  });

  it("flags two sentences separated by a period", () => {
    const issues = multipleSentencesRule.check(
      req("REQ_001", "The system shall respond within 200ms. It shall also log the event."),
      cfg(),
    );
    expect(issues).toHaveLength(1);
    expect(issues[0].type).toBe("multiple-sentences");
    expect(issues[0].severity).toBe("warning");
    expect(issues[0].targetId).toBe("REQ_001");
    expect(issues[0].message).toContain("2");
  });

  it("flags three sentences and reports the correct count", () => {
    const issues = multipleSentencesRule.check(
      req("REQ_001", "The system shall respond. It shall log the event. It shall send an alert."),
      cfg(),
    );
    expect(issues).toHaveLength(1);
    expect(issues[0].message).toContain("3");
  });

  it("flags mixed terminators (period + question mark)", () => {
    const issues = multipleSentencesRule.check(
      req("REQ_001", "The system shall respond within 200ms. Is that acceptable?"),
      cfg(),
    );
    expect(issues).toHaveLength(1);
    expect(issues[0].message).toContain("2");
  });

  it("does not count a decimal number as a sentence terminator", () => {
    expect(multipleSentencesRule.check(req("REQ_001", "The system shall operate at 3.14 GHz."), cfg())).toHaveLength(0);
  });

  it("does not count section/version references as sentence terminators", () => {
    expect(multipleSentencesRule.check(req("REQ_001", "See section 3.2.1 for details."), cfg())).toHaveLength(0);
  });

  it("does not count 'e.g.' as a sentence terminator", () => {
    expect(multipleSentencesRule.check(req("REQ_001", "The system shall support protocols, e.g. TCP and UDP."), cfg())).toHaveLength(0);
  });

  it("does not count 'i.e.' as a sentence terminator", () => {
    expect(multipleSentencesRule.check(req("REQ_001", "The threshold, i.e. the upper limit, shall be 100ms."), cfg())).toHaveLength(0);
  });

  it("does not count 'vs.' as a sentence terminator", () => {
    expect(multipleSentencesRule.check(req("REQ_001", "The system shall evaluate TCP vs. UDP performance."), cfg())).toHaveLength(0);
  });

  it("handles leading and trailing whitespace correctly", () => {
    const issues = multipleSentencesRule.check(
      req("REQ_001", "  The system shall respond. It shall log.  "),
      cfg(),
    );
    expect(issues).toHaveLength(1);
  });

  it("returns no issues when disabled", () => {
    expect(
      multipleSentencesRule.check(
        req("REQ_001", "The system shall respond. It shall log."),
        cfg(false),
      ),
    ).toHaveLength(0);
  });

  it("issue ID is stable and unique per requirement", () => {
    const issues = multipleSentencesRule.check(
      req("REQ_007", "First sentence. Second sentence."),
      cfg(),
    );
    expect(issues[0].id).toBe("multiple-sentences-REQ_007");
  });
});

// ── runAllValidations — integration ───────────────────────────────────────────

describe("runAllValidations — integration", () => {
  it("returns no issues for a clean, well-formed requirement", () => {
    const issues = runAllValidations(
      [req("REQ_001", "The system shall authenticate users within 2 seconds.")],
      new Set(["Draft"]),
    );
    expect(issues).toHaveLength(0);
  });

  it("still catches structural violations from existing rules", () => {
    const reqs = [
      req("REQ_002", "The system shall respond."),
      req("REQ_001", "The system shall log events."),
    ];
    const issues = runAllValidations(reqs, new Set(["Draft"]));
    expect(issues.some((i) => i.type === "requirement-order")).toBe(true);
  });

  it("catches language issues via the registry", () => {
    const issues = runAllValidations([req("REQ_001", "The system should respond quickly.")], new Set(["Draft"]));
    expect(issues.some((i) => i.type === "weak-modal")).toBe(true);
  });

  it("catches forbidden terms via the registry", () => {
    const issues = runAllValidations([req("REQ_001", "Performance target is TBD.")], new Set(["Draft"]));
    expect(issues.some((i) => i.type === "forbidden-term")).toBe(true);
  });

  it("attaches category to all issues", () => {
    const reqs = [
      req("REQ_002", "The system shall respond."),
      req("REQ_001", "The system should log events."),
    ];
    const issues = runAllValidations(reqs, new Set(["Draft"]));
    expect(issues.every((i) => i.category !== undefined)).toBe(true);
  });

  it("issues from registry rules appear in registry order per requirement", () => {
    const issues = runAllValidations(
      [req("REQ_001", "System should respond TBD and shall do X shall do Y.")],
      new Set(["Draft"]),
    );
    const registryIssueTypes = issues
      .filter((i) => ["weak-modal", "ambiguous-word", "forbidden-term", "word-count", "multiple-shall"].includes(i.type))
      .map((i) => i.type);
    // weak-modal comes before forbidden-term (registry order)
    const weakIdx = registryIssueTypes.indexOf("weak-modal");
    const forbiddenIdx = registryIssueTypes.indexOf("forbidden-term");
    expect(weakIdx).toBeLessThan(forbiddenIdx);
  });

  it("returns a flat array for an empty document", () => {
    expect(runAllValidations([], new Set())).toEqual([]);
  });

  it("catches undefined acronyms through the engine (document-level rule)", () => {
    const reqs = [
      req("REQ_001", "The ECU shall transmit CAN messages."),
      req("REQ_002", "Electronic Control Unit (ECU) and Controller Area Network (CAN) shall be validated."),
    ];
    const issues = runAllValidations(reqs, new Set(["Draft"]));
    expect(issues.some((i) => i.type === "undefined-acronym" && i.targetId === "REQ_001")).toBe(true);
  });
});

// ── undefinedAcronymsRule ─────────────────────────────────────────────────────

describe("undefinedAcronymsRule", () => {
  function cfg(ignored = ["TBD", "TBC", "TODO", "REQ", "ID"], enabled = true): AcronymRuleConfig {
    return {
      id: "undefinedAcronyms",
      category: "consistency",
      enabled,
      severity: "warning",
      title: "Undefined Acronyms",
      description: "Acronyms should be defined before first use.",
      ignored,
      message: "{id}: '{term}' appears to be an undefined acronym. Define it as: Full Name ({term}).",
    };
  }

  it("returns no issues for an empty document", () => {
    expect(undefinedAcronymsRule.check([], cfg())).toHaveLength(0);
  });

  it("returns no issues when all acronyms are defined before use", () => {
    const reqs = [
      req("REQ_001", "Electronic Control Unit (ECU) shall be tested."),
      req("REQ_002", "The ECU shall respond within 200ms."),
      req("REQ_003", "ECU messages shall be logged."),
    ];
    expect(undefinedAcronymsRule.check(reqs, cfg())).toHaveLength(0);
  });

  it("flags an acronym used before it is defined", () => {
    const reqs = [
      req("REQ_001", "The ECU shall transmit CAN messages."),
      req("REQ_002", "Electronic Control Unit (ECU) shall communicate."),
    ];
    const issues = undefinedAcronymsRule.check(reqs, cfg());
    const ecuIssue = issues.find((i) => i.message.includes("ECU"));
    expect(ecuIssue).toBeDefined();
    expect(ecuIssue?.targetId).toBe("REQ_001");
    expect(ecuIssue?.type).toBe("undefined-acronym");
    expect(ecuIssue?.severity).toBe("warning");
    expect(ecuIssue?.category).toBe("consistency");
  });

  it("flags multiple undefined acronyms in the same requirement", () => {
    const reqs = [
      req("REQ_001", "The ECU shall transmit CAN messages."),
      req("REQ_002", "Electronic Control Unit (ECU) and Controller Area Network (CAN) shall be validated."),
    ];
    const issues = undefinedAcronymsRule.check(reqs, cfg());
    expect(issues.some((i) => i.message.includes("ECU") && i.targetId === "REQ_001")).toBe(true);
    expect(issues.some((i) => i.message.includes("CAN") && i.targetId === "REQ_001")).toBe(true);
  });

  it("does not re-flag an acronym after it has been defined", () => {
    const reqs = [
      req("REQ_001", "Electronic Control Unit (ECU) shall be validated."),
      req("REQ_002", "The ECU shall respond."),
      req("REQ_003", "ECU messages shall be logged."),
    ];
    expect(undefinedAcronymsRule.check(reqs, cfg())).toHaveLength(0);
  });

  it("ignores acronyms listed in the ignored set", () => {
    // CAN is in the ignored list → no warning even though it is never defined
    expect(
      undefinedAcronymsRule.check(
        [req("REQ_001", "The system CAN respond.")],
        cfg(["CAN"]),
      ),
    ).toHaveLength(0);
  });

  it("ignores REQ and ID from the default config ignored list", () => {
    expect(
      undefinedAcronymsRule.check(
        [req("REQ_001", "The REQ ID shall be unique.")],
        cfg(["REQ", "ID"]),
      ),
    ).toHaveLength(0);
  });

  it("produces one issue per acronym per requirement even when the acronym appears multiple times", () => {
    const reqs = [req("REQ_001", "The ECU shall respond. ECU must also log. ECU is critical.")];
    const issues = undefinedAcronymsRule.check(reqs, cfg());
    expect(issues.filter((i) => i.message.includes("ECU"))).toHaveLength(1);
  });

  it("recognises a multi-word definition with a hyphenated word", () => {
    const reqs = [
      req("REQ_001", "Anti-lock Braking System (ABS) shall be validated."),
      req("REQ_002", "The ABS shall activate within 50ms."),
    ];
    expect(undefinedAcronymsRule.check(reqs, cfg())).toHaveLength(0);
  });

  it("does not count the acronym inside a definition pattern as a standalone usage", () => {
    // "Electronic Control Unit (ECU)" — the "(ECU)" is the definition marker,
    // not a standalone use, so no issue should be raised for this requirement.
    expect(
      undefinedAcronymsRule.check(
        [req("REQ_001", "Electronic Control Unit (ECU) shall be tested.")],
        cfg(),
      ),
    ).toHaveLength(0);
  });

  it("requires at least 2 words before the acronym in parens to qualify as a definition", () => {
    // "the (ECU)" — only 1 word before parens → not a definition
    const reqs = [
      req("REQ_001", "the (ECU) bus shall respond."),
      req("REQ_002", "The ECU shall operate."),
    ];
    const issues = undefinedAcronymsRule.check(reqs, cfg());
    // ECU is used in both reqs and never properly defined
    expect(issues.some((i) => i.message.includes("ECU"))).toBe(true);
  });

  it("only emits issues for requirements that use the undefined acronym", () => {
    const reqs = [
      req("REQ_001", "The system shall respond."),
      req("REQ_002", "The ECU shall transmit."),
      req("REQ_003", "Electronic Control Unit (ECU) shall be validated."),
    ];
    const issues = undefinedAcronymsRule.check(reqs, cfg());
    expect(issues).toHaveLength(1);
    expect(issues[0].targetId).toBe("REQ_002");
  });

  it("returns no issues when disabled", () => {
    expect(
      undefinedAcronymsRule.check(
        [req("REQ_001", "The ECU shall transmit CAN messages.")],
        cfg(["REQ", "ID"], false),
      ),
    ).toHaveLength(0);
  });

  it("issue IDs are unique across requirements and acronyms", () => {
    const reqs = [
      req("REQ_001", "The ECU shall transmit CAN messages."),
      req("REQ_002", "The ABS shall activate."),
    ];
    const issues = undefinedAcronymsRule.check(reqs, cfg());
    expect(new Set(issues.map((i) => i.id)).size).toBe(issues.length);
  });

  it("correctly handles mixed requirement ordering: no warning after definition", () => {
    const reqs = [
      req("REQ_001", "The system shall be tested."),
      req("REQ_002", "Controller Area Network (CAN) protocol is used."),
      req("REQ_003", "CAN messages shall be logged."),
      req("REQ_004", "CAN bus shall not exceed 500 kbps."),
    ];
    expect(undefinedAcronymsRule.check(reqs, cfg())).toHaveLength(0);
  });

  it("works with the full production config from quality-rules.json", () => {
    const config = qualityRules.rules.undefinedAcronyms;
    const reqs = [
      req("REQ_001", "The ECU shall transmit CAN messages."),
      req("REQ_002", "Electronic Control Unit (ECU) and Controller Area Network (CAN) shall be validated."),
    ];
    const issues = undefinedAcronymsRule.check(reqs, config);
    expect(issues.some((i) => i.message.includes("ECU"))).toBe(true);
    expect(issues.some((i) => i.message.includes("CAN"))).toBe(true);
  });

  // ── diagnostic wording ────────────────────────────────────────────────────

  it("diagnostic message preserves {id}: prefix and uses hedged wording", () => {
    const issues = undefinedAcronymsRule.check(
      [req("REQ_001", "The ECU shall respond.")],
      cfg(),
    );
    expect(issues).toHaveLength(1);
    expect(issues[0].message).toMatch(/^REQ_001:/);
    expect(issues[0].message).toContain("appears to be an undefined acronym");
    expect(issues[0].message).toContain("Define it as: Full Name");
    expect(issues[0].message).toContain("ECU");
  });
});

// ── undefinedAcronymsRule — false-positive regression (BUILTIN_EXCLUDED) ─────

describe("undefinedAcronymsRule — false-positive regression", () => {
  function cfg(ignored = ["TBD", "TBC", "TODO", "REQ", "ID"], enabled = true): AcronymRuleConfig {
    return {
      id: "undefinedAcronyms",
      category: "consistency",
      enabled,
      severity: "warning",
      title: "Undefined Acronyms",
      description: "Acronyms should be defined before first use.",
      ignored,
      message: "{id}: '{term}' appears to be an undefined acronym. Define it as: Full Name ({term}).",
    };
  }

  const BUILTIN_EXCLUDED_TOKENS = [
    // Requirement-language keywords
    "SHALL", "SHOULD", "MAY", "MUST", "WILL",
    // Logical/grammatical connectives
    "NOT", "AND", "OR", "IF", "NOR",
    // Requirement quantifiers
    "ALL", "ANY", "NONE", "EACH", "EVERY", "SOME",
    // Universal boolean and activation-state literals
    "TRUE", "FALSE", "ENABLED", "DISABLED", "ACTIVE", "INACTIVE", "ON", "OFF",
  ];

  it.each(BUILTIN_EXCLUDED_TOKENS)(
    "built-in exclusion '%s' is never flagged as an undefined acronym",
    (token) => {
      const issues = undefinedAcronymsRule.check(
        [req("REQ_001", `The ${token} condition shall be verified.`)],
        cfg(),
      );
      expect(issues.filter((i) => i.message.includes(token))).toHaveLength(0);
    },
  );

  it("composite: ALL, ENABLED, ANY, ACTIVE, DISABLED, NOT, TRUE produce zero issues", () => {
    const issues = undefinedAcronymsRule.check(
      [req(
        "REQ_001",
        "ALL outputs SHALL be ENABLED when ANY input is ACTIVE or DISABLED. The system SHALL NOT respond if TRUE is returned.",
      )],
      cfg(),
    );
    expect(issues).toHaveLength(0);
  });
});

// ── undefinedAcronymsRule — automotive acronym regression ─────────────────────

describe("undefinedAcronymsRule — automotive acronym regression", () => {
  function cfg(ignored = ["TBD", "TBC", "TODO", "REQ", "ID"], enabled = true): AcronymRuleConfig {
    return {
      id: "undefinedAcronyms",
      category: "consistency",
      enabled,
      severity: "warning",
      title: "Undefined Acronyms",
      description: "Acronyms should be defined before first use.",
      ignored,
      message: "{id}: '{term}' appears to be an undefined acronym. Define it as: Full Name ({term}).",
    };
  }

  it.each(["ECU", "ABS", "ADAS", "UDS", "HVAC", "CAN", "HV", "LV", "SOC", "EOL"])(
    "undefined domain acronym '%s' is flagged when not defined",
    (token) => {
      const issues = undefinedAcronymsRule.check(
        [req("REQ_001", `The ${token} shall respond.`)],
        cfg(),
      );
      expect(issues.some((i) => i.message.includes(token))).toBe(true);
    },
  );

  it("mixed sentence: ECU, CAN, ABS flagged; ACTIVE not flagged; exactly 3 issues", () => {
    const issues = undefinedAcronymsRule.check(
      [req("REQ_001", "The ECU SHALL transmit the CAN message when ABS is ACTIVE.")],
      cfg(),
    );
    expect(issues.some((i) => i.message.includes("ECU"))).toBe(true);
    expect(issues.some((i) => i.message.includes("CAN"))).toBe(true);
    expect(issues.some((i) => i.message.includes("ABS"))).toBe(true);
    expect(issues.filter((i) => i.message.includes("ACTIVE"))).toHaveLength(0);
    expect(issues.filter((i) => i.type === "undefined-acronym")).toHaveLength(3);
  });
});

// ── undefinedAcronymsRule — definition detection ──────────────────────────────

describe("undefinedAcronymsRule — definition detection", () => {
  function cfg(ignored = ["TBD", "TBC", "TODO", "REQ", "ID"], enabled = true): AcronymRuleConfig {
    return {
      id: "undefinedAcronyms",
      category: "consistency",
      enabled,
      severity: "warning",
      title: "Undefined Acronyms",
      description: "Acronyms should be defined before first use.",
      ignored,
      message: "{id}: '{term}' appears to be an undefined acronym. Define it as: Full Name ({term}).",
    };
  }

  it.each([
    ["Electronic Control Unit (ECU)", "ECU"],
    ["Controller Area Network (CAN)", "CAN"],
    ["Advanced Driver Assistance System (ADAS)", "ADAS"],
    ["Unified Diagnostic Services (UDS)", "UDS"],
    ["Anti-lock Braking System (ABS)", "ABS"],
    ["High Voltage (HV)", "HV"],
    ["Low Voltage (LV)", "LV"],
    ["State of Charge (SOC)", "SOC"],
    ["End of Line (EOL)", "EOL"],
    ["End-of-Line (EOL)", "EOL"],
    ["End-of-Life (EOL)", "EOL"],
  ] as [string, string][])(
    "definition '%s' resolves %s and suppresses later uses",
    (definitionPhrase, acronym) => {
      const reqs = [
        req("REQ_001", `${definitionPhrase} shall be performed.`),
        req("REQ_002", `The ${acronym} process shall be validated.`),
      ];
      expect(undefinedAcronymsRule.check(reqs, cfg())).toHaveLength(0);
    },
  );

  it("multiple definitions in one requirement: ECU, CAN, ABS all resolved", () => {
    const reqs = [
      req(
        "REQ_001",
        "Electronic Control Unit (ECU), Controller Area Network (CAN), and Anti-lock Braking System (ABS) interfaces SHALL be supported.",
      ),
      req("REQ_002", "The ECU SHALL transmit the CAN message when ABS is ACTIVE."),
    ];
    expect(undefinedAcronymsRule.check(reqs, cfg())).toHaveLength(0);
  });

  it("guard: 'the (ECU)' is NOT a valid definition — only 1 word unit before acronym", () => {
    const reqs = [
      req("REQ_001", "the (ECU) bus shall respond."),
      req("REQ_002", "The ECU shall operate."),
    ];
    const issues = undefinedAcronymsRule.check(reqs, cfg());
    expect(issues.some((i) => i.message.includes("ECU"))).toBe(true);
  });

  it("guard: 'a (ABS)' is NOT a valid definition — only 1 word unit before acronym", () => {
    const reqs = [
      req("REQ_001", "a (ABS) system shall be fitted."),
      req("REQ_002", "The ABS shall activate."),
    ];
    const issues = undefinedAcronymsRule.check(reqs, cfg());
    expect(issues.some((i) => i.message.includes("ABS"))).toBe(true);
  });

  it("boundary: End-of-Line (EOL) within a longer sentence defines EOL", () => {
    const reqs = [
      req("REQ_001", "The system uses End-of-Line (EOL) as the calibration standard."),
      req("REQ_002", "The EOL test shall pass."),
    ];
    expect(undefinedAcronymsRule.check(reqs, cfg())).toHaveLength(0);
  });

  it("boundary behavior: 'The state is HIGH (HV)' satisfies the ≥2-word guard (greedy match)", () => {
    // "The state is HIGH" = 4 word units; the ≥2-unit guard is satisfied.
    // This is the same greedy behavior as the previous definition regex.
    const reqs = [
      req("REQ_001", "The state is HIGH (HV)."),
      req("REQ_002", "The HV system shall respond."),
    ];
    expect(undefinedAcronymsRule.check(reqs, cfg())).toHaveLength(0);
  });

  it("boundary behavior: 'The result SHALL be PASS (PAS)' satisfies the ≥2-word guard", () => {
    const reqs = [
      req("REQ_001", "The result SHALL be PASS (PAS)."),
      req("REQ_002", "The PAS value shall be logged."),
    ];
    expect(undefinedAcronymsRule.check(reqs, cfg())).toHaveLength(0);
  });
});

// ── undefinedAcronymsRule — definition ordering ───────────────────────────────

describe("undefinedAcronymsRule — definition ordering", () => {
  function cfg(ignored = ["TBD", "TBC", "TODO", "REQ", "ID"], enabled = true): AcronymRuleConfig {
    return {
      id: "undefinedAcronyms",
      category: "consistency",
      enabled,
      severity: "warning",
      title: "Undefined Acronyms",
      description: "Acronyms should be defined before first use.",
      ignored,
      message: "{id}: '{term}' appears to be an undefined acronym. Define it as: Full Name ({term}).",
    };
  }

  it("definition before use: no issue", () => {
    const reqs = [
      req("REQ_001", "Electronic Control Unit (ECU) SHALL be validated."),
      req("REQ_002", "The ECU SHALL respond."),
    ];
    expect(undefinedAcronymsRule.check(reqs, cfg())).toHaveLength(0);
  });

  it("use before definition: issue on first requirement", () => {
    const reqs = [
      req("REQ_001", "The ECU SHALL transmit."),
      req("REQ_002", "Electronic Control Unit (ECU) SHALL be validated."),
    ];
    const issues = undefinedAcronymsRule.check(reqs, cfg());
    expect(issues).toHaveLength(1);
    expect(issues[0].targetId).toBe("REQ_001");
    expect(issues[0].message).toContain("ECU");
  });

  it("definition in previous requirement: all later uses are valid", () => {
    const reqs = [
      req("REQ_001", "Controller Area Network (CAN) is used."),
      req("REQ_002", "CAN messages SHALL be logged."),
      req("REQ_003", "CAN bus SHALL NOT exceed 500 kbps."),
    ];
    expect(undefinedAcronymsRule.check(reqs, cfg())).toHaveLength(0);
  });

  it("definition and use in the same requirement: no issue", () => {
    const reqs = [
      req("REQ_001", "Anti-lock Braking System (ABS) SHALL activate within 50ms of the ABS trigger."),
    ];
    expect(undefinedAcronymsRule.check(reqs, cfg())).toHaveLength(0);
  });
});

// ── undefinedAcronymsRule — configured ignored terms ─────────────────────────

describe("undefinedAcronymsRule — configured ignored terms", () => {
  function cfg(ignored = ["TBD", "TBC", "TODO", "REQ", "ID"], enabled = true): AcronymRuleConfig {
    return {
      id: "undefinedAcronyms",
      category: "consistency",
      enabled,
      severity: "warning",
      title: "Undefined Acronyms",
      description: "Acronyms should be defined before first use.",
      ignored,
      message: "{id}: '{term}' appears to be an undefined acronym. Define it as: Full Name ({term}).",
    };
  }

  it.each(["TBD", "TBC", "TODO", "REQ", "ID"])(
    "default configured-ignore token '%s' is not flagged",
    (token) => {
      const issues = undefinedAcronymsRule.check(
        [req("REQ_001", `The ${token} value shall be verified.`)],
        cfg(),
      );
      expect(issues.filter((i) => i.message.includes(token))).toHaveLength(0);
    },
  );

  it("RPM is not flagged when in cfg.ignored", () => {
    const issues = undefinedAcronymsRule.check(
      [req("REQ_001", "The RPM SHALL not exceed 6000.")],
      cfg(["RPM", "TBD", "TBC", "TODO", "REQ", "ID"]),
    );
    expect(issues.filter((i) => i.message.includes("RPM"))).toHaveLength(0);
  });

  it("custom project term VBATT is not flagged when in cfg.ignored", () => {
    const issues = undefinedAcronymsRule.check(
      [req("REQ_001", "The VBATT SHALL be above 9 V.")],
      cfg(["VBATT", "TBD", "TBC", "TODO", "REQ", "ID"]),
    );
    expect(issues.filter((i) => i.message.includes("VBATT"))).toHaveLength(0);
  });

  it("CAN is not flagged when explicitly in cfg.ignored", () => {
    const issues = undefinedAcronymsRule.check(
      [req("REQ_001", "The CAN bus SHALL transmit messages.")],
      cfg(["CAN", "TBD", "TBC", "TODO", "REQ", "ID"]),
    );
    expect(issues.filter((i) => i.message.includes("CAN"))).toHaveLength(0);
  });

  it("CAN is flagged when not in cfg.ignored and not defined", () => {
    const issues = undefinedAcronymsRule.check(
      [req("REQ_001", "The CAN bus SHALL transmit messages.")],
      cfg(),
    );
    expect(issues.some((i) => i.message.includes("CAN"))).toBe(true);
  });
});

// ── undefinedAcronymsRule — conservative policy (ambiguous engineering terms) ─

describe("undefinedAcronymsRule — conservative policy", () => {
  function cfg(ignored = ["TBD", "TBC", "TODO", "REQ", "ID"], enabled = true): AcronymRuleConfig {
    return {
      id: "undefinedAcronyms",
      category: "consistency",
      enabled,
      severity: "warning",
      title: "Undefined Acronyms",
      description: "Acronyms should be defined before first use.",
      ignored,
      message: "{id}: '{term}' appears to be an undefined acronym. Define it as: Full Name ({term}).",
    };
  }

  it.each(["HIGH", "FAULT", "VALID", "INIT", "SAFE"])(
    "ambiguous engineering term '%s' remains a lexical candidate and is flagged when undefined",
    (token) => {
      const issues = undefinedAcronymsRule.check(
        [req("REQ_001", `The ${token} condition shall be checked.`)],
        cfg(),
      );
      expect(issues.some((i) => i.message.includes(token))).toBe(true);
    },
  );
});

// ── undefinedAcronymsRule — document-wide scan (docContent path) ──────────────

// Shared helpers for document-wide tests
function docCfg(ignored = ["TBD", "TBC", "TODO", "REQ", "ID"]): AcronymRuleConfig {
  return {
    id: "undefinedAcronyms",
    category: "consistency",
    enabled: true,
    severity: "warning",
    title: "Undefined Acronyms",
    description: "",
    ignored,
    message: "{id}: '{term}' appears to be an undefined acronym. Define it as: Full Name ({term}).",
  };
}

function heading(level: number, text: string): JSONContent {
  return { type: "heading", attrs: { level }, content: [{ type: "text", text }] };
}
function para(text: string): JSONContent {
  return { type: "paragraph", content: [{ type: "text", text }] };
}
function codeBlockNode(text: string): JSONContent {
  return { type: "codeBlock", content: [{ type: "text", text }] };
}
function acronymTable(col0: string, col1: string, rows: [string, string][]): JSONContent {
  return {
    type: "table",
    content: [
      {
        type: "tableRow",
        content: [
          { type: "tableHeader", content: [{ type: "paragraph", content: [{ type: "text", text: col0 }] }] },
          { type: "tableHeader", content: [{ type: "paragraph", content: [{ type: "text", text: col1 }] }] },
        ],
      },
      ...rows.map(([acro, def]) => ({
        type: "tableRow",
        content: [
          { type: "tableCell", content: [{ type: "paragraph", content: [{ type: "text", text: acro }] }] },
          { type: "tableCell", content: [{ type: "paragraph", content: [{ type: "text", text: def }] }] },
        ],
      })),
    ],
  };
}

// ── Fallback behavior (docContent absent or empty) ────────────────────────────

describe("undefinedAcronymsRule — fallback when docContent absent", () => {
  it("absent docContent uses RequirementRef[] path: issue has targetId", () => {
    const issues = undefinedAcronymsRule.check(
      [req("REQ_001", "The ECU shall respond.")],
      docCfg(),
      // no third argument
    );
    expect(issues).toHaveLength(1);
    expect(issues[0].targetId).toBe("REQ_001");
  });

  it("empty docContent array falls back to RequirementRef[] path: issue has targetId", () => {
    const issues = undefinedAcronymsRule.check(
      [req("REQ_001", "The ECU shall respond.")],
      docCfg(),
      [],
    );
    expect(issues).toHaveLength(1);
    expect(issues[0].targetId).toBe("REQ_001");
  });

  it("fallback preserves cross-requirement definition ordering", () => {
    const reqs = [
      req("REQ_001", "The ECU shall respond."),
      req("REQ_002", "Electronic Control Unit (ECU) is defined here."),
    ];
    const issues = undefinedAcronymsRule.check(reqs, docCfg(), undefined);
    expect(issues.some((i) => i.message.includes("ECU"))).toBe(true);
    expect(issues.every((i) => i.targetId !== undefined)).toBe(true);
  });
});

// ── Acronym table detection ───────────────────────────────────────────────────

describe("undefinedAcronymsRule — docContent: acronym table detection", () => {
  it("table with 'Acronym'/'Definition' header defines terms: ECU not flagged in following paragraph", () => {
    const docContent: JSONContent[] = [
      acronymTable("Acronym", "Definition", [["ECU", "Electronic Control Unit"]]),
      para("The ECU shall respond."),
    ];
    const issues = undefinedAcronymsRule.check([], docCfg(), docContent);
    expect(issues.filter((i) => i.message.includes("ECU"))).toHaveLength(0);
  });

  it("table with 'Term'/'Meaning' header is recognized as acronym table", () => {
    const docContent: JSONContent[] = [
      acronymTable("Term", "Meaning", [["CAN", "Controller Area Network"]]),
      para("The CAN bus shall transmit messages."),
    ];
    const issues = undefinedAcronymsRule.check([], docCfg(), docContent);
    expect(issues.filter((i) => i.message.includes("CAN"))).toHaveLength(0);
  });

  it("table with 'Abbreviations'/'Description' header is recognized", () => {
    const docContent: JSONContent[] = [
      acronymTable("Abbreviations", "Description", [["ABS", "Anti-lock Braking System"]]),
      para("The ABS shall activate within 50ms."),
    ];
    const issues = undefinedAcronymsRule.check([], docCfg(), docContent);
    expect(issues.filter((i) => i.message.includes("ABS"))).toHaveLength(0);
  });

  it("table with 'Abbr'/'Full Name' header is recognized", () => {
    const docContent: JSONContent[] = [
      acronymTable("Abbr", "Full Name", [["HVAC", "Heating Ventilation Air Conditioning"]]),
      para("The HVAC unit shall maintain temperature."),
    ];
    const issues = undefinedAcronymsRule.check([], docCfg(), docContent);
    expect(issues.filter((i) => i.message.includes("HVAC"))).toHaveLength(0);
  });

  it("table with 'acronyms'/'expansion' (lowercase) header is recognized", () => {
    const docContent: JSONContent[] = [
      acronymTable("acronyms", "expansion", [["OBD", "On-Board Diagnostics"]]),
      para("The OBD port shall be accessible."),
    ];
    const issues = undefinedAcronymsRule.check([], docCfg(), docContent);
    expect(issues.filter((i) => i.message.includes("OBD"))).toHaveLength(0);
  });

  it("table with unrecognized header ('Name'/'Value') is NOT treated as acronym table: acronym still flagged", () => {
    const docContent: JSONContent[] = [
      acronymTable("Name", "Value", [["ECU", "Electronic Control Unit"]]),
      para("The ECU shall respond."),
    ];
    const issues = undefinedAcronymsRule.check([], docCfg(), docContent);
    // ECU appears in table body text and in the paragraph → both are scanned
    expect(issues.some((i) => i.message.includes("ECU"))).toBe(true);
  });

  it("acronym table row with empty definition cell is skipped: acronym not added to defined set", () => {
    const docContent: JSONContent[] = [
      acronymTable("Acronym", "Definition", [["ECU", ""]]),
      para("The ECU shall respond."),
    ];
    const issues = undefinedAcronymsRule.check([], docCfg(), docContent);
    expect(issues.some((i) => i.message.includes("ECU"))).toBe(true);
  });

  it("acronym table row with lowercase/non-acronym value in col 0 is skipped", () => {
    const docContent: JSONContent[] = [
      acronymTable("Acronym", "Definition", [["word", "some definition"]]),
      para("The WORD state shall be active."),
    ];
    // 'word' is not a valid acronym token (not uppercase), 'WORD' is flagged
    const issues = undefinedAcronymsRule.check([], docCfg(), docContent);
    expect(issues.some((i) => i.message.includes("WORD"))).toBe(true);
  });
});

// ── Document-wide scan: heading context ──────────────────────────────────────

describe("undefinedAcronymsRule — docContent: heading context", () => {
  it("heading matching a req ID sets context: subsequent block issue has that targetId", () => {
    const reqs = [req("REQ_001", "The ECU shall respond.")];
    const docContent: JSONContent[] = [
      heading(1, "REQ_001 [Draft] Motor Control"),
      para("The ECU shall respond."),
    ];
    const issues = undefinedAcronymsRule.check(reqs, docCfg(), docContent);
    expect(issues.some((i) => i.targetId === "REQ_001" && i.message.includes("ECU"))).toBe(true);
  });

  it("heading not matching any req ID resets context to null: issue has no targetId", () => {
    const reqs = [req("REQ_001", "")];
    const docContent: JSONContent[] = [
      heading(1, "Introduction"),
      para("The ECU shall respond."),
    ];
    const issues = undefinedAcronymsRule.check(reqs, docCfg(), docContent);
    const ecuIssue = issues.find((i) => i.message.includes("ECU"));
    expect(ecuIssue).toBeDefined();
    expect(ecuIssue?.targetId).toBeUndefined();
  });

  it("blocks before any heading have null context: issue has no targetId", () => {
    const reqs = [req("REQ_001", "")];
    const docContent: JSONContent[] = [
      para("The ECU shall respond."),
      heading(1, "REQ_001"),
      para("Normal body text."),
    ];
    const issues = undefinedAcronymsRule.check(reqs, docCfg(), docContent);
    const ecuIssue = issues.find((i) => i.message.includes("ECU"));
    expect(ecuIssue?.targetId).toBeUndefined();
  });

  it("non-requirement heading followed by req heading: context switches correctly", () => {
    const reqs = [req("REQ_001", "")];
    const docContent: JSONContent[] = [
      heading(1, "Introduction"),
      para("Introductory text with ECU."),
      heading(2, "REQ_001 [Draft] Power Control"),
      para("The ECU output shall be stable."),
    ];
    const issues = undefinedAcronymsRule.check(reqs, docCfg(), docContent);
    const introIssue = issues.find((i) => i.message.includes("ECU") && i.targetId === undefined);
    const reqIssue = issues.find((i) => i.message.includes("ECU") && i.targetId === "REQ_001");
    expect(introIssue).toBeDefined();
    expect(reqIssue).toBeDefined();
  });

  it("req heading with numeric suffix boundary: REQ_001 does not match REQ_0010 heading", () => {
    const reqs = [req("REQ_001", ""), req("REQ_0010", "")];
    const docContent: JSONContent[] = [
      heading(1, "REQ_0010 High Voltage"),
      para("The HV system shall operate."),
    ];
    const issues = undefinedAcronymsRule.check(reqs, docCfg(), docContent);
    const hvIssue = issues.find((i) => i.message.includes("HV"));
    // REQ_0010 heading should match REQ_0010, not REQ_001
    expect(hvIssue?.targetId).toBe("REQ_0010");
  });
});

// ── Document-wide scan: scoping and ordering ──────────────────────────────────

describe("undefinedAcronymsRule — docContent: scoping and ordering", () => {
  it("definition in early block clears use in later block: no issue", () => {
    const docContent: JSONContent[] = [
      para("Electronic Control Unit (ECU) is defined in this preamble."),
      heading(1, "REQ_001"),
      para("The ECU shall respond within 10ms."),
    ];
    const issues = undefinedAcronymsRule.check(
      [req("REQ_001", "")],
      docCfg(),
      docContent,
    );
    expect(issues.filter((i) => i.message.includes("ECU"))).toHaveLength(0);
  });

  it("use before definition (doc order) is flagged", () => {
    const docContent: JSONContent[] = [
      heading(1, "REQ_001"),
      para("The ECU shall respond."),
      para("Electronic Control Unit (ECU) is defined here."),
    ];
    const issues = undefinedAcronymsRule.check(
      [req("REQ_001", "")],
      docCfg(),
      docContent,
    );
    expect(issues.some((i) => i.message.includes("ECU"))).toBe(true);
  });

  it("acronym table before use: ECU not flagged in any subsequent block", () => {
    const docContent: JSONContent[] = [
      acronymTable("Acronym", "Definition", [["ECU", "Electronic Control Unit"], ["CAN", "Controller Area Network"]]),
      heading(1, "REQ_001"),
      para("The ECU shall transmit CAN messages."),
    ];
    const issues = undefinedAcronymsRule.check(
      [req("REQ_001", "")],
      docCfg(),
      docContent,
    );
    expect(issues.filter((i) => i.message.includes("ECU") || i.message.includes("CAN"))).toHaveLength(0);
  });

  it("code block: acronyms inside codeBlock are not flagged", () => {
    const docContent: JSONContent[] = [
      heading(1, "REQ_001"),
      codeBlockNode("ECU_STATE = ACTIVE; CAN_ID = 0x1A0;"),
    ];
    const issues = undefinedAcronymsRule.check(
      [req("REQ_001", "")],
      docCfg(),
      docContent,
    );
    // codeBlock content returns " " from extractBodyText — no acronyms found
    expect(issues.filter((i) => i.message.includes("ECU") || i.message.includes("CAN"))).toHaveLength(0);
  });
});

// ── Document-wide scan: issue shape ──────────────────────────────────────────

describe("undefinedAcronymsRule — docContent: issue shape", () => {
  it("document-level issue: targetId is undefined (no fake doc:N value)", () => {
    const docContent: JSONContent[] = [para("The ECU output is undefined.")];
    const issues = undefinedAcronymsRule.check([], docCfg(), docContent);
    const ecuIssue = issues.find((i) => i.message.includes("ECU"));
    expect(ecuIssue).toBeDefined();
    expect(ecuIssue?.targetId).toBeUndefined();
  });

  it("document-level issue: documentIndex is a non-negative integer", () => {
    const docContent: JSONContent[] = [para("The ECU output is undefined.")];
    const issues = undefinedAcronymsRule.check([], docCfg(), docContent);
    const ecuIssue = issues.find((i) => i.message.includes("ECU"));
    expect(ecuIssue?.documentIndex).toBeTypeOf("number");
    expect(ecuIssue!.documentIndex).toBeGreaterThanOrEqual(0);
  });

  it("requirement-context issue: targetId is set to the req ID", () => {
    const docContent: JSONContent[] = [
      heading(1, "REQ_042"),
      para("The ECU shall respond."),
    ];
    const issues = undefinedAcronymsRule.check(
      [req("REQ_042", "")],
      docCfg(),
      docContent,
    );
    const ecuIssue = issues.find((i) => i.message.includes("ECU"));
    expect(ecuIssue?.targetId).toBe("REQ_042");
  });

  it("requirement-context issue: documentIndex is also set", () => {
    const docContent: JSONContent[] = [
      heading(1, "REQ_001"),
      para("The ECU shall respond."),
    ];
    const issues = undefinedAcronymsRule.check(
      [req("REQ_001", "")],
      docCfg(),
      docContent,
    );
    const ecuIssue = issues.find((i) => i.message.includes("ECU"));
    expect(ecuIssue?.documentIndex).toBeTypeOf("number");
  });

  it("document-level message: no '{id}: ' prefix", () => {
    const docContent: JSONContent[] = [para("The ECU output is undefined.")];
    const issues = undefinedAcronymsRule.check([], docCfg(), docContent);
    const ecuIssue = issues.find((i) => i.message.includes("ECU"));
    expect(ecuIssue?.message).toBeDefined();
    expect(ecuIssue?.message).not.toMatch(/^[A-Z_0-9]+:/);
    expect(ecuIssue?.message).toContain("appears to be an undefined acronym");
  });

  it("requirement-context message: preserves '{id}: ' prefix", () => {
    const docContent: JSONContent[] = [
      heading(1, "REQ_007"),
      para("The ECU shall respond."),
    ];
    const issues = undefinedAcronymsRule.check(
      [req("REQ_007", "")],
      docCfg(),
      docContent,
    );
    const ecuIssue = issues.find((i) => i.message.includes("ECU"));
    expect(ecuIssue?.message).toMatch(/^REQ_007:/);
  });

  it("issue IDs are unique across all issues in one run", () => {
    const docContent: JSONContent[] = [
      para("The ECU system uses CAN and ABS."),
      heading(1, "REQ_001"),
      para("ECU output via CAN shall be verified."),
    ];
    const issues = undefinedAcronymsRule.check(
      [req("REQ_001", "")],
      docCfg(),
      docContent,
    );
    const ids = issues.map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

// ── undefinedAcronymsRule — dedup and aggregation regressions ─────────────────

describe("undefinedAcronymsRule — docContent: dedup and aggregation", () => {
  it("same acronym in 2 paragraphs under one requirement → exactly 1 issue", () => {
    const docContent: JSONContent[] = [
      heading(1, "REQ_001"),
      para("The ECU shall respond."),
      para("The ECU output voltage is measured."),
    ];
    const issues = undefinedAcronymsRule.check([req("REQ_001", "")], docCfg(), docContent);
    expect(issues.filter((i) => i.message.includes("ECU"))).toHaveLength(1);
    expect(issues[0].targetId).toBe("REQ_001");
  });

  it("same acronym in 2 non-requirement paragraphs → exactly 1 issue (doc-context dedup)", () => {
    const docContent: JSONContent[] = [
      para("The ECU system needs review."),
      para("The ECU output must be stable."),
    ];
    const issues = undefinedAcronymsRule.check([], docCfg(), docContent);
    expect(issues.filter((i) => i.message.includes("ECU"))).toHaveLength(1);
    expect(issues[0].targetId).toBeUndefined();
  });

  it("same acronym before definition in 2 different requirements → 1 issue per requirement", () => {
    const docContent: JSONContent[] = [
      heading(1, "REQ_001"),
      para("The ECU shall respond."),
      heading(1, "REQ_002"),
      para("The ECU output voltage."),
    ];
    const issues = undefinedAcronymsRule.check(
      [req("REQ_001", ""), req("REQ_002", "")],
      docCfg(),
      docContent,
    );
    const ecuIssues = issues.filter((i) => i.message.includes("ECU"));
    expect(ecuIssues).toHaveLength(2);
    expect(ecuIssues.some((i) => i.targetId === "REQ_001")).toBe(true);
    expect(ecuIssues.some((i) => i.targetId === "REQ_002")).toBe(true);
  });

  it("3 document-level blocks with different acronyms → 3 distinct issues with unique IDs", () => {
    const docContent: JSONContent[] = [
      para("The ECU system operates."),
      para("The CAN bus transmits."),
      para("The ABS must activate."),
    ];
    const issues = undefinedAcronymsRule.check([], docCfg(), docContent);
    const found = issues.filter((i) => ["ECU", "CAN", "ABS"].some((t) => i.message.includes(t)));
    expect(found).toHaveLength(3);
    expect(new Set(found.map((i) => i.id)).size).toBe(3);
    found.forEach((i) => expect(i.targetId).toBeUndefined());
  });

  it("mixed requirement and document issues are both present", () => {
    const docContent: JSONContent[] = [
      para("The ECU is mentioned."),
      heading(1, "REQ_001"),
      para("The CAN bus transmits."),
    ];
    const issues = undefinedAcronymsRule.check([req("REQ_001", "")], docCfg(), docContent);
    const docIssue = issues.find((i) => i.targetId === undefined && i.message.includes("ECU"));
    const reqIssue = issues.find((i) => i.targetId === "REQ_001" && i.message.includes("CAN"));
    expect(docIssue).toBeDefined();
    expect(reqIssue).toBeDefined();
  });

  it("issue IDs are unique after per-context dedup (same acronym under same req in 2 paras)", () => {
    const docContent: JSONContent[] = [
      heading(1, "REQ_001"),
      para("The ECU shall respond."),
      para("The ECU output voltage."),
    ];
    const issues = undefinedAcronymsRule.check([req("REQ_001", "")], docCfg(), docContent);
    expect(new Set(issues.map((i) => i.id)).size).toBe(issues.length);
    // Dedup: only 1 ECU issue for REQ_001
    expect(issues.filter((i) => i.message.includes("ECU"))).toHaveLength(1);
  });

  it("acronym table with 'Definitions' (plural) col-1 header is recognized", () => {
    const docContent: JSONContent[] = [
      acronymTable("Acronym", "Definitions", [["ECU", "Electronic Control Unit"]]),
      para("The ECU shall respond."),
    ];
    const issues = undefinedAcronymsRule.check([], docCfg(), docContent);
    expect(issues.filter((i) => i.message.includes("ECU"))).toHaveLength(0);
  });

  it("acronym table with 'Meanings' (plural) col-1 header is recognized", () => {
    const docContent: JSONContent[] = [
      acronymTable("Term", "Meanings", [["CAN", "Controller Area Network"]]),
      para("The CAN bus shall transmit."),
    ];
    const issues = undefinedAcronymsRule.check([], docCfg(), docContent);
    expect(issues.filter((i) => i.message.includes("CAN"))).toHaveLength(0);
  });

  it("acronym table after first usage: pre-definition issue remains, later usage clean", () => {
    const docContent: JSONContent[] = [
      heading(1, "REQ_001"),
      para("The ECU shall respond."),
      acronymTable("Acronym", "Definition", [["ECU", "Electronic Control Unit"]]),
      heading(1, "REQ_002"),
      para("The ECU output shall be stable."),
    ];
    const issues = undefinedAcronymsRule.check(
      [req("REQ_001", ""), req("REQ_002", "")],
      docCfg(),
      docContent,
    );
    expect(issues.some((i) => i.targetId === "REQ_001" && i.message.includes("ECU"))).toBe(true);
    expect(issues.some((i) => i.targetId === "REQ_002" && i.message.includes("ECU"))).toBe(false);
  });
});

// ── Integration regressions ───────────────────────────────────────────────────

describe("undefinedAcronymsRule — integration: runAllValidations with docContent", () => {
  it("runAllValidations with docContent fires document-wide scan: issue has documentIndex", () => {
    const docContent: JSONContent[] = [
      para("The ECU output shall not exceed limits."),
    ];
    const issues = runAllValidations([], new Set(), docContent);
    const ecuIssue = issues.find((i) => i.type === "undefined-acronym" && i.message.includes("ECU"));
    expect(ecuIssue).toBeDefined();
    expect(ecuIssue?.documentIndex).toBeTypeOf("number");
    expect(ecuIssue?.targetId).toBeUndefined();
  });

  it("runAllValidations without docContent fires fallback scan: issue has targetId", () => {
    const reqs = [req("REQ_001", "The ECU shall respond.")];
    const issues = runAllValidations(reqs, new Set());
    const ecuIssue = issues.find((i) => i.type === "undefined-acronym" && i.message.includes("ECU"));
    expect(ecuIssue).toBeDefined();
    expect(ecuIssue?.targetId).toBe("REQ_001");
  });
});
