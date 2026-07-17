/**
 * Permanent regression corpus for the Requirements Writing Quality engine
 * (src/validation/rules/*, driven by RULE_REGISTRY in src/validation/registry.ts).
 *
 * Scope: this corpus exercises the 15 REQUIREMENT-LEVEL rules in
 * RULE_REGISTRY only (the single-requirement language/hygiene/structure
 * layer: weakModal, ambiguousWords, forbiddenTerms, wordCount,
 * multipleShall, vagueQuantifiers, escapeClauses, multipleSentences,
 * doubleSpaces, sentenceCapitalization, repeatedWords, commaSpacing,
 * missingTerminalPunctuation, periodSpacing, parenthesesBalancing).
 *
 * Deliberately OUT of scope: requirementOrder, duplicateId, missingStatus,
 * emptyBody (cross-requirement/document-order rules in
 * documentValidationService.ts) and undefinedAcronyms (a document-wide,
 * definition-tracking DOC_RULE_REGISTRY rule). Folding those in here would
 * force every valid corpus sentence to spell out full acronym definitions
 * ("Electronic Control Unit (ECU)") to avoid an unrelated false trigger,
 * which would make the corpus read nothing like real requirements prose.
 * Those rules have their own coverage in tests/unit/qualityRules.test.ts.
 *
 * This corpus is meant to be the foundation for every future writing-quality
 * rule: when adding rule #16, add corresponding valid/invalid/edge entries
 * here rather than starting a new one-off fixture.
 */

export interface CorpusEntry {
  /** Unique, human-readable id for the test title — not a real doc requirement ID. */
  reqId: string;
  bodyText: string;
  /** RULE_REGISTRY rule ids expected to fire. Empty for "must never trigger". */
  expectedRuleIds: string[];
  /** Why this entry exists / what it proves. */
  note: string;
}

// ── Valid — realistic, well-formed requirements that must NEVER trigger ──────
//
// Domain terminology deliberately spread across entries per the task brief:
// ECU, CAN, LIN, SPI, I2C, AUTOSAR, ISO 26262, REQ_xxx, TC_xxx, 500 ms,
// 10 km/h, UUID, CRC, Bootloader.

export const VALID_CORPUS: CorpusEntry[] = [
  {
    reqId: "valid-01-can-periodic-tx",
    bodyText: "The ECU shall transmit CAN frames at 500 ms intervals under normal operating conditions.",
    expectedRuleIds: [],
    note: "baseline periodic CAN transmission requirement",
  },
  {
    reqId: "valid-02-bootloader-crc",
    bodyText: "The bootloader shall verify the CRC of the application image before jumping to it.",
    expectedRuleIds: [],
    note: "bootloader/CRC verification, single shall, clean punctuation",
  },
  {
    reqId: "valid-03-multi-interface-list",
    bodyText: "The system shall support LIN, SPI, and I2C communication interfaces simultaneously.",
    expectedRuleIds: [],
    note: "comma-separated interface list with correct spacing",
  },
  {
    reqId: "valid-04-iso26262",
    bodyText: "The gateway shall comply with ISO 26262 ASIL-B requirements for fault detection.",
    expectedRuleIds: [],
    note: "ISO 26262 standard reference, hyphenated ASIL-B token",
  },
  {
    reqId: "valid-05-uuid-fault-log",
    bodyText: "The diagnostic module shall generate a UUID for each logged fault event.",
    expectedRuleIds: [],
    note: "UUID terminology in a single-shall requirement",
  },
  {
    reqId: "valid-06-speed-resolution",
    bodyText: "The vehicle speed signal shall be sampled at 10 km/h resolution across the full range.",
    expectedRuleIds: [],
    note: "10 km/h unit terminology",
  },
  {
    reqId: "valid-07-traceability-refs",
    bodyText: "REQ_204 shall reference TC_045 as its verifying test case in the traceability matrix.",
    expectedRuleIds: [],
    note: "REQ_xxx and TC_xxx identifiers; body starts with an uppercase identifier, not a sentence",
  },
  {
    reqId: "valid-08-autosar-init",
    bodyText: "The AUTOSAR basic software module shall initialize all CAN controllers at startup.",
    expectedRuleIds: [],
    note: "AUTOSAR terminology, single shall",
  },
  {
    reqId: "valid-09-lin-reject",
    bodyText: "The system shall reject malformed LIN frames within 5 ms of reception.",
    expectedRuleIds: [],
    note: "LIN terminology with a millisecond bound",
  },
  {
    reqId: "valid-10-watchdog-reset",
    bodyText: "The watchdog timer shall reset the ECU if the main loop exceeds 200 ms.",
    expectedRuleIds: [],
    note: "ECU terminology, conditional obligation, single shall",
  },
  {
    reqId: "valid-11-flash-erase",
    bodyText: "The flash driver shall erase a sector before writing new bootloader data to it.",
    expectedRuleIds: [],
    note: "bootloader terminology in a two-clause single-sentence requirement",
  },
  {
    reqId: "valid-12-busoff-recovery",
    bodyText: "The network manager shall transition to bus-off recovery after three consecutive CAN errors.",
    expectedRuleIds: [],
    note: "CAN bus-off recovery, hyphenated compound term",
  },
  {
    reqId: "valid-13-spi-sensor-rate",
    bodyText: "The sensor interface shall report acceleration values over SPI at a fixed 1 kHz rate.",
    expectedRuleIds: [],
    note: "SPI terminology with a rate unit",
  },
  {
    reqId: "valid-14-decimal-gain",
    bodyText: "The calibration table shall store gain constants with a precision of 0.01.",
    expectedRuleIds: [],
    note: "decimal number immediately followed by the terminal period (0.01.)",
  },
  {
    reqId: "valid-15-uuid-crc-timestamp",
    bodyText: "The system shall log the UUID, timestamp, and CRC for every stored diagnostic trouble code.",
    expectedRuleIds: [],
    note: "UUID and CRC together in a correctly comma-spaced list",
  },
];

// ── Invalid — each entry triggers EXACTLY one rule ────────────────────────────

export const INVALID_CORPUS: CorpusEntry[] = [
  {
    reqId: "invalid-01-weak-modal",
    bodyText: "The ECU should transmit CAN frames every 500 ms.",
    expectedRuleIds: ["weakModal"],
    note: "'should' instead of 'shall' — CAN (uppercase) must not also trigger weakModal's can/CAN override",
  },
  {
    reqId: "invalid-02-ambiguous-word",
    bodyText: "The system shall provide a robust CAN error handling mechanism.",
    expectedRuleIds: ["ambiguousWords"],
    note: "'robust' is an unmeasurable ambiguous term",
  },
  {
    reqId: "invalid-03-forbidden-term",
    bodyText: "The system shall transmit CAN frames within TBD ms of the trigger event.",
    expectedRuleIds: ["forbiddenTerms"],
    note: "'TBD' placeholder left in a shipped requirement",
  },
  {
    reqId: "invalid-04-word-count",
    bodyText:
      "The system shall " +
      Array.from({ length: 160 }, (_, i) => `param${i}`).join(" ") +
      ".",
    expectedRuleIds: ["wordCount"],
    note: "162 words, over the 150-word limit; distinct filler tokens avoid a repeatedWords side effect",
  },
  {
    reqId: "invalid-05-multiple-shall",
    bodyText: "The system shall transmit CAN frames and the diagnostic module shall log every fault code.",
    expectedRuleIds: ["multipleShall"],
    note: "two independent obligations in one requirement",
  },
  {
    reqId: "invalid-06-vague-quantifier",
    bodyText: "The system shall support several CAN bus configurations during startup.",
    expectedRuleIds: ["vagueQuantifiers"],
    note: "'several' is a non-measurable quantity",
  },
  {
    reqId: "invalid-07-escape-clause",
    bodyText: "The system shall log diagnostic trouble codes where applicable during runtime.",
    expectedRuleIds: ["escapeClauses"],
    note: "'where applicable' weakens the obligation without objective criteria",
  },
  {
    reqId: "invalid-08-multiple-sentences",
    bodyText: "The system shall transmit CAN frames every 500 ms. Reception is confirmed via a CRC check.",
    expectedRuleIds: ["multipleSentences"],
    note: "two sentences, only one shall (isolates multipleSentences from multipleShall)",
  },
  {
    reqId: "invalid-09-double-spaces",
    bodyText: "The system shall transmit  CAN frames every 500 ms.",
    expectedRuleIds: ["doubleSpaces"],
    note: "double space before CAN",
  },
  {
    reqId: "invalid-10-sentence-capitalization",
    bodyText: "the system shall transmit CAN frames every 500 ms.",
    expectedRuleIds: ["sentenceCapitalization"],
    note: "lowercase-starting body",
  },
  {
    reqId: "invalid-11-repeated-words",
    bodyText: "The system shall transmit transmit CAN frames every 500 ms.",
    expectedRuleIds: ["repeatedWords"],
    note: "copy-paste duplication of 'transmit'; uses a non-'shall' word so multipleShall isn't also triggered",
  },
  {
    reqId: "invalid-12-comma-spacing",
    bodyText: "The system shall support CAN,LIN and SPI interfaces.",
    expectedRuleIds: ["commaSpacing"],
    note: "missing space after a non-numeric comma",
  },
  {
    reqId: "invalid-13-missing-terminal-punctuation",
    bodyText: "The system shall transmit CAN frames every 500 ms",
    expectedRuleIds: ["missingTerminalPunctuation"],
    note: "no terminal punctuation at all",
  },
  {
    reqId: "invalid-14-period-spacing",
    bodyText: "The system shall transmit CAN frames.Then it logs the event via CRC.",
    expectedRuleIds: ["periodSpacing"],
    note: "missing space after an internal period; the internal period is not followed by whitespace so multipleSentences still counts only 1 terminator",
  },
  {
    reqId: "invalid-15-parentheses-balancing",
    bodyText: "The system shall transmit CAN frames (see REQ_204 for timing constraints.",
    expectedRuleIds: ["parenthesesBalancing"],
    note: "unmatched opening parenthesis",
  },
];

// ── Edge cases — documented boundary behavior (both correct exclusions and
//    known, accepted false positives from the design's under-flagging bias) ──

export const EDGE_CASE_CORPUS: CorpusEntry[] = [
  {
    reqId: "edge-01-numeric-comma-formatting",
    bodyText: "The buffer shall hold 10,000 CAN frames without overflow.",
    expectedRuleIds: [],
    note: "digit-flanked comma (10,000) must be exempt from commaSpacing",
  },
  {
    reqId: "edge-02-decimal-not-sentence-break",
    bodyText: "The gain constant shall be 3.14 within a 500 ms window.",
    expectedRuleIds: [],
    note: "decimal number must not be treated as multiple sentences or a spacing error",
  },
  {
    reqId: "edge-03-eg-abbreviation-parens",
    bodyText: "The interface (e.g. SPI or I2C) shall be configurable at boot.",
    expectedRuleIds: [],
    note: "'e.g.' abbreviation inside balanced parentheses must not trigger periodSpacing or multipleSentences",
  },
  {
    reqId: "edge-04-legitimate-that-that",
    bodyText: "The reason that that value was selected is documented in TC_045.",
    expectedRuleIds: [],
    note: "'that that' is a legitimate repeat, excluded from repeatedWords",
  },
  {
    reqId: "edge-05-digit-starting-body",
    bodyText: "500 ms is the maximum allowed response time for the ECU.",
    expectedRuleIds: [],
    note: "a digit-starting body is not a capitalization violation",
  },
  {
    reqId: "edge-06-cross-block-join-known-limitation",
    bodyText: "The system shall log CAN faults.Reception is confirmed via CRC.",
    expectedRuleIds: ["periodSpacing"],
    note:
      "KNOWN, ACCEPTED LIMITATION: useDocumentValidation.ts joins multi-block requirement bodies with " +
      "an empty-string separator, so a genuine paragraph/list-item boundary can look identical to a " +
      "missing-space typo. This entry simulates that joined shape directly; see periodSpacing.ts for the " +
      "full false-positive analysis and the reason it was not fixed in Phase 1.",
  },
  {
    reqId: "edge-07-bare-leading-dot-decimal",
    bodyText: "The tolerance shall be .5 mm at the connector interface.",
    expectedRuleIds: [],
    note: "bare leading-dot decimal (.5) must be scrubbed, not treated as a sentence break or spacing error",
  },
  {
    reqId: "edge-08-colon-terminated-list-intro",
    bodyText: "The system shall support the following protocols:",
    expectedRuleIds: [],
    note: "colon is an accepted terminal punctuation mark (list introduction pattern)",
  },
  {
    reqId: "edge-09-semicolon-terminated",
    bodyText: "The system shall detect a CAN bus-off condition; recovery is handled automatically by the network stack;",
    expectedRuleIds: [],
    note: "semicolon is an accepted terminal punctuation mark",
  },
  {
    reqId: "edge-10-nested-balanced-parens",
    bodyText: "The system shall report the fault code (e.g. P0100 (mass air flow)) within 500 ms.",
    expectedRuleIds: [],
    note: "nested, balanced parentheses combined with an 'e.g.' abbreviation must not trigger parenthesesBalancing or periodSpacing",
  },
  {
    reqId: "edge-11-multi-part-version-number",
    bodyText: "The bootloader shall report firmware version 2.4.1 over the diagnostic interface.",
    expectedRuleIds: [],
    note: "multi-part version number (2.4.1) must be fully scrubbed, not just its first segment",
  },
];
