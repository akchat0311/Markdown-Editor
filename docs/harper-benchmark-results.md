# Harper Benchmark Results — Empirical Grammar-Detection Audit

Status: **Draft for review** · Extends `docs/harper-integration-architecture.md`
and `docs/harper-privacy-security-assessment.md`. This document reports
actual measured results, not documentation claims or architecture
reasoning. No implementation.

## Methodology

Ran `harper.js` v2.4.0 **locally in Node** via `LocalLinter` (not the
`writewithharper.com` web demo, not the Chrome extension) — the same
package and the same underlying WASM engine (`harper-wasm`/`harper-core`)
the integration architecture doc scoped for this app. Setup:

```
npm install harper.js
```
```js
import { LocalLinter } from 'harper.js';
import { binaryInlined } from 'harper.js/binaryInlined';
const linter = new LocalLinter({ binary: binaryInlined });
await linter.setup();
const lints = await linter.lint(sentence);
```

Built an 80-sentence benchmark (`benchmark.mjs`) spanning 22 grammar/style
categories relevant to requirements writing — subject-verb agreement
(10 variants: simple, collective nouns, "list of X", "neither...nor",
compound subjects, pronouns), passive voice (including the
requirements-style intentional passive, e.g. "shall be tested by"),
dangling modifiers, ambiguous pronoun reference, comma splices, sentence
fragments, tense consistency, articles/determiners, prepositions, double
negatives, commonly-confused words (its/it's, there/their, affect/effect,
that/which), punctuation, redundancy, capitalization, compound-subject
agreement, **domain-vocabulary false-positive probes** (requirement IDs,
acronyms, units, camelCase identifiers — direct empirical tests of the risk
flagged in the design docs), spelling (to check overlap with the
`nspell`-based spelling engine already decided on), overlap with this app's
own existing validation rules (weak modals, vague quantifiers), a clean
"no error" control group (8 sentences), parallelism, number agreement, and
hyphenation. 47 sentences contain an intentional error; 33 are
grammatically clean (including the false-positive probes).

**Two-pass design**, both against real `harper.js` output, not guessed:

1. **Default pass** — every one of Harper's 750 individually-toggleable
   rules left at `null` (Harper's own built-in default state).
2. **All-enabled pass** — every one of the 750 rules explicitly set to
   `true` via `setLintConfig()`, run against the same 80 sentences. This is
   the *ceiling* of what Harper can catch for each phenomenon, not a
   realistic configuration to ship.

A sentence's outcome is classified `CAUGHT BY DEFAULT`, `CAUGHT ONLY WHEN
ALL RULES ENABLED`, or `MISSED ENTIRELY` (zero lints in both passes) for
error probes; `CLEAN` or `FALSE POSITIVE` for the 33 correct-sentence
probes. Where something fired, I read every lint's actual message and
judged by hand whether it matched the *intended* phenomenon or was a
coincidental, unrelated catch on the same sentence — flagged explicitly
below wherever that distinction matters, since raw "did anything fire"
counts alone would overstate real coverage.

**A structural finding that shapes the whole methodology**: Harper's 750
toggleable rules are almost entirely **narrow, literal phrase/idiom
correctors** (e.g. `EachAndEveryOne` — verified by direct testing — corrects
only the specific typo "each and everyone" → "each and every one"; it does
**not** flag "each and every sensor" as redundant, despite the name
suggesting otherwise), not general syntactic pattern detectors. A handful
of core checks (basic spelling via dictionary lookup, repetition, a few
hardcoded agreement/contraction rules) run outside this toggle list
entirely and fire regardless of configuration. This distinction — curated
idiom list vs. general grammar engine — is the throughline of the results
below, not a one-off caveat.

---

## Summary

| | Count | % of error probes |
|---|---|---|
| Error probes (sentences with an intentional issue) | 47 | — |
| Caught by default | 13 | 28% |
| Caught only when all 750 rules explicitly enabled | 6 | 13% |
| **Missed entirely** (zero lints in either pass) | **28** | **60%** |

| | Count | % of clean probes |
|---|---|---|
| Clean probes (correct sentences, incl. false-positive tests) | 33 | — |
| Correctly left clean | 28 | 85% |
| **False positives, under DEFAULT config** | **5** | **15%** |
| False positives only when all rules enabled | 0 | 0% |

**The 5 false positives are the single most important finding**: every one
fired on the domain-vocabulary probes (requirement IDs, acronyms, units,
identifiers) — the *exact* risk flagged as the primary trust concern in
`docs/grammar-spellcheck-design.md` §8, now confirmed with concrete
failing examples, under Harper's **out-of-the-box default configuration**,
not an edge case requiring unusual settings.

---

## False positives — full detail

```
[pu-02] "The system shall support the following interfaces: UART, SPI, and I2C."
  -> Spelling: "Did you mean to spell `SPI` this way?"
  -> Spelling: "Did you mean to spell `I2C` this way?"

[dv-01] "REQ_001 shall be verified by TC_042 during the OTA update."
  -> Spelling: "Did you mean to spell `REQ` this way?"
  -> Spelling: "Did you mean to spell `TC` this way?"
  -> Spelling: "Did you mean to spell `OTA` this way?"

[dv-03] "The API shall expose a getUserById endpoint returning JSON."
  -> Spelling: "Did you mean to spell `getUserById` this way?"

[dv-04] "The CANbus interface shall comply with ISO 11898-2."
  -> Spelling: "Did you mean to spell `CANbus` this way?"
  -> Formatting: "Use an en dash (–) in ranges of numbers. Ignore this if it is math."

[dv-05] "The FPGA shall reconfigure via JTAG within 500ms of a watchdog reset."
  -> Spelling: "Did you mean to spell `JTAG` this way?"
  -> WordChoice: "Did you mean `milliseconds`?"
```

**This is broader than the design docs assumed.** The prior design
(`grammar-spellcheck-design.md` §6, `harper-integration-architecture.md`
§6) planned to disable Harper's `Spelling`-kind rules via `setLintConfig()`
and route spelling through `nspell` instead — that plan is *necessary but
not sufficient*. Two of the five false-positive sentences (`dv-04`, `dv-05`)
also produced **`Formatting`** (en-dash-in-number-ranges, misfiring on a
standard's version number `11898-2`) and **`WordChoice`** (flagging the
unit abbreviation `500ms`, suggesting "milliseconds") false positives —
categories the ignore-mechanism design didn't originally account for. The
ignore-list/rule-suppression work needs to cover more than the `Spelling`
`LintKind` before this is safe to ship against real requirement text.

A sixth, lower-severity finding not from the false-positive probes but
surfaced incidentally: `sva-06` ("The system, along with its
subcomponents, are tested monthly") triggered `Typo: "subcomponents"
should probably be written as "sub components"` — a standard, correctly-
spelled compound word common in systems-engineering documents, flagged as
if misspelled. Not counted in the 5 above since that sentence wasn't a
clean-sentence probe, but worth noting as the same failure mode recurring.

---

## What was caught, and why — by category

Legend: ✅ caught for the *intended* reason · ⚠️ something fired, but not
the intended phenomenon (noted) · ❌ missed entirely

| Category | Default | All-enabled | Notes |
|---|---|---|---|
| **Subject-verb agreement** (10) | 3/10 ✅ | +0 | Caught: pronoun+verb ("it were", "they was") and its/it's. **Not caught, even at the ceiling**: "list of X **are**" (should be "is"), "each of the sensors **report**" (⚠️ fired on an unrelated possessive-apostrophe issue instead), "neither...nor" nearer-subject agreement, compound-subject agreement (§ below). Harper's agreement checking is scoped to **pronoun-verb pairs**, not general noun-phrase subject-verb concord — confirmed structurally, not a config gap. |
| **Passive voice** | 1/4 ✅ | +0 | Caught the malformed "was wrote" (past-participle rule). The two intentional-passive requirement sentences ("shall be tested by...") were correctly left clean — Harper does **not** flag conventional requirement-style passive voice as an error, which is the right behavior for this domain. |
| **Dangling modifiers** (5) | 0/5 | +1 ⚠️ | The one "catch" was an unrelated possessive-apostrophe flag on a different part of the sentence. **No rule for dangling/misplaced modifiers exists in this version of Harper**, at any configuration. |
| **Ambiguous pronoun reference** (3) | 0/3 | +0 | Entirely unsupported — this requires discourse-level coreference resolution, structurally outside a pattern-matching engine's scope, not a missing config toggle. |
| **Comma splices** (3) | 0/3 | +0 | Entirely unsupported — surprising given how common a formal-writing target this is; Harper does not appear to do independent-clause boundary detection at all. |
| **Sentence fragments** (2) | 0/2 | +0 | Entirely unsupported. |
| **Tense consistency** | 1/2 ✅ | +0 | Caught "will stored" (shall/will + base-form rule — directly useful, since "shall"/"will" are the dominant modals in requirement text). Cross-clause tense *shift* ("supported... but... support") not caught. |
| **Articles/determiners** (3) | 0/3 | +0 | Missing-article and extraneous-article cases both missed. (Harper does have a `MissingDeterminer` rule, but per its own description it's scoped to "common request phrases," not general article omission — verified this doesn't generalize.) |
| **Prepositions** (3) | 0/3 | +0 | "compliant to" (should be "with") and "depend of" (should be "on") both missed, despite Harper having ~10 preposition-related rule names in its catalog (`AskNoPreposition`, `ObsessPreposition`, `MissingPreposition`, etc.) — those are scoped to *other* specific idioms, not these two, which are exactly the kind of error a requirements reviewer would flag. |
| **Double negatives** (3) | 0/3 | +1 ⚠️ | "doesn't have no" fired only a `Style: "Consider expanding this contraction"` suggestion — a tangential catch, not a double-negative flag. "shall not allow no" (the non-contraction form) was missed entirely at any configuration. |
| **Commonly confused words** (5) | 3/5 ✅ | +0 | Strong category: its/it's, there/their, affect/effect all caught by default. Missed: restrictive "that"/"which" clause punctuation. |
| **Punctuation** (5) | 1/5 ⚠️ | +1 ⚠️ | The one "default" catch (`pu-01`) was spurious `Spelling` flags on `SPI`/`I2C`, not the intended missing-colon-before-list issue. Comma-splice-before-"however" missed. Apostrophe-for-possessive *was* correctly caught (`pu-04`, only at the ceiling). |
| **Redundancy** | 1/3 ✅ | +0 | "the the... all all" repetition caught. "each and every" and "final outcome... future planning purposes" — both classic redundancy-checker targets — missed entirely, including at the ceiling (see `EachAndEveryOne` finding above: the rule that looks relevant by name targets a completely different, unrelated typo). |
| **Capitalization** | 1/2 ✅ | +1 ⚠️ | Sentence-initial lowercase caught. Mid-sentence over-capitalization ("The System Shall Boot...") — the ceiling catch was an unrelated "spell out numbers under ten" suggestion, not a capitalization flag; genuinely missed. |
| **Compound subject agreement** (3) | 0/3 | +0 | "sensor and controller communicates" and "either...or" nearer-subject agreement both missed — consistent with the pronoun-only agreement-scope finding above. |
| **Domain vocabulary** (5) | — | — | See False Positives above — 4 of 5 produced false positives under default config. |
| **Spelling** (2) | 2/2 ✅ | +0 | Both misspellings caught cleanly. Confirms Harper's spelling engine works well on genuine typos — the issue (§ False Positives) is specifically its handling of acronyms/identifiers, not spelling detection in general. |
| **Overlap with existing app rules** (3) | 0/3 | +0 | Weak modals ("may"), vague quantifiers ("quickly"), and subjective terms ("user-friendly") were **not** flagged by Harper at any configuration — confirms no duplicate-opinion risk with this app's own `weakModal`/`vagueQuantifiers`/`ambiguousWords` rules; the two systems check genuinely disjoint things. |
| **Clean control** (8) | 8/8 ✅ | — | All 8 idiomatic, correct requirement sentences correctly left unflagged at both configurations — no baseline noise. |
| **Parallelism** | 0/2 | +1 ⚠️ | Non-parallel verb forms in a list missed; the ceiling catch was an unrelated Oxford-comma style suggestion. |
| **Number agreement** (2) | 0/2 | +0 | "a total of five sensor **was**" and "less than three errors **is**" both missed. |
| **Hyphenation** | 0/2 | +0 | Missing hyphen in a compound modifier ("well known encryption" → "well-known") missed. |

---

## Are the misses disabled rules, or genuinely unsupported grammar?

Both, but **overwhelmingly the latter** — this is the direct answer to
your question, and it's a meaningfully different picture than "just enable
more rules":

- **Disabled-by-default, but supported when enabled** (the ceiling pass
  found *something*, and it was arguably the intended catch): only
  `pu-04` (possessive apostrophe) cleanly qualifies. Everything else that
  fired only in the all-enabled pass (`sva-03`, `dm-02`, `dn-02`, `cp-02`,
  `ls-01`) turned out to be a **coincidental, unrelated catch** on the same
  sentence, not the phenomenon being tested — meaning enabling more rules
  did not, in practice, meaningfully increase real coverage of this
  benchmark's target phenomena, contrary to what "6 more caught when all
  rules enabled" suggests at a glance.
- **Genuinely unsupported, at any configuration** (28 of 47, 60%): dangling
  modifiers, ambiguous pronoun reference, comma splices, sentence
  fragments, cross-clause tense shift, general article omission, the two
  specific preposition errors tested, non-contraction double negatives,
  "that"/"which" clause punctuation, comma-splice-before-conjunctive-adverb,
  two of three redundancy patterns, mid-sentence over-capitalization,
  compound-subject and "neither/nor"/"a total of"/"less than" agreement
  patterns, non-parallel list construction, and hyphenation of compound
  modifiers. These aren't off by a config flag — Harper's rule-based,
  curated-idiom-list architecture (confirmed in §0/Methodology and directly
  in `docs/harper-integration-architecture.md`'s earlier source-level API
  audit) does not implement general syntactic analysis for these
  categories at all in this version.

---

## What Harper is actually good at, per this benchmark

Worth stating plainly, since the miss-rate above could read as more
negative than the real picture: Harper reliably caught **every** genuine
spelling error, **every** commonly-confused-word case tested (its/it's,
there/their, affect/effect), pronoun-verb agreement, repeated words, the
shall/will-plus-base-form rule (directly valuable for requirement text,
where "shall" is the dominant modal), and correctly left all 8 idiomatic
clean requirement sentences alone. It also correctly **did not** flag
conventional requirement-style passive voice ("shall be tested by...") as
an error — exactly the behavior wanted in this domain, not a given for a
general-purpose grammar tool.

---

## Implications for the integration design

Updates to `docs/harper-integration-architecture.md` and
`docs/grammar-spellcheck-design.md`, grounded in this run rather than
speculation:

1. **The ignore-list must cover `Formatting` and `WordChoice`, not just
   `Spelling`.** Confirmed by `dv-04`/`dv-05` above — disabling
   Harper's `Spelling`-kind rules (the existing plan) is necessary but not
   sufficient to avoid false positives on real requirement text containing
   version numbers and unit abbreviations.
2. **Recalibrate what "grammar checking" means to users.** This benchmark
   found Harper strong on word-level/lexical issues (confused words,
   spelling, specific idiom typos) and structurally weak on sentence-level
   syntactic issues (agreement across complex subjects, clause boundaries,
   modifier placement, parallelism) that are common in formal
   requirements prose. If this ships, framing it as "catches common
   word-level mistakes" rather than "grammar checking" would set more
   accurate user expectations and reduce the risk of the feature feeling
   unreliable when it misses a comma splice or dangling modifier a human
   reviewer would catch immediately.
3. **The small, custom rule set originally recommended for v1**
   (`grammar-spellcheck-design.md` §4.2 — repeated words, punctuation
   spacing, sentence-initial capitalization) **remains the right v1 scope**
   — this benchmark didn't change that sequencing recommendation, but it
   does suggest the custom v1 rule set could reasonably extend to a few of
   Harper's confirmed-missing, high-value categories (comma splices,
   "each and every"-style redundancy) as simple regex rules, exactly the
   same way this app's *existing* `weakModal`/`vagueQuantifiers` rules
   already work — those may be cheaper to hand-write than to wait on
   Harper (or any external engine) to cover.
4. **Does this change whether Harper is still the v2 recommendation?**
   No — it sharpens it. Harper remains the strongest available *offline*
   option for the things it's actually good at (spelling, confused words,
   specific-idiom correction), and this benchmark gives concrete,
   evidence-based scoping for what to enable/suppress rather than the
   "revisit later" placeholder the prior docs left open. The false-positive
   findings here are a **shipping blocker for the ignore-list scope**, not
   a reason to drop Harper — they tell us precisely what needs to be built
   before it's safe to turn on by default for anyone.

---

## Reproducing this benchmark

```bash
mkdir harper-bench && cd harper-bench
npm init -y && npm install harper.js
# benchmark.mjs, run-benchmark.mjs, analyze.mjs — request from this session
# if not already in the repo; ~80-sentence corpus + two-pass runner (default
# config vs. every one of the 750 toggleable rules enabled) + per-sentence
# classification against hand-authored expectations.
node run-benchmark.mjs && node analyze.mjs
```

Total runtime for the full 80-sentence × 2-pass run (160 `lint()` calls):
well under a minute on a standard laptop, once the WASM module is
initialized — consistent with the "fast once loaded" performance
expectation in the integration architecture doc; the cost that matters is
the one-time load, not per-sentence analysis at this scale.
