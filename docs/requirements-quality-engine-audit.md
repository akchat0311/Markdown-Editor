# Requirements Writing Quality Engine — Architecture Audit

Status: **Draft for review** · No implementation. This audits the existing
`src/validation/` engine and its UI surface (`InsightsTab.tsx`) as the
foundation for evolving it into a comprehensive requirements-writing
quality engine, without any external grammar library — confirmed
appropriate given `docs/harper-benchmark-results.md`'s finding that even a
real Rust/WASM grammar engine misses ~60% of common formal-writing issues
regardless of configuration; this audit leans on that as corroborating
evidence for several of the difficulty classifications below, not just
this codebase's own judgment.

**See also**: `docs/requirements-quality-engine-phase1-design.md` — the
follow-on design specification (taxonomy, severity model, rule metadata,
`ValidationIssue` evolution, runtime config, UI scaling, and the Phase 1
"Writing Hygiene" implementation roadmap) building directly on this audit.

---

## 0. Cross-cutting findings (read this before the per-section detail)

1. **Every existing rule is Quality-panel-list-only. Zero inline
   diagnostics exist anywhere in this app today** — not a gap specific to
   any one rule. Confirmed by exhaustive grep: no file that produces a
   ProseMirror `Decoration` references `ValidationIssue` or
   `useValidationStore`, and no file that touches `ValidationIssue` does
   any position/`Decoration` work. `ValidationIssue.documentIndex` is the
   only positional field any issue ever carries, and it's a block-array
   index used purely for list-grouping, never for a PM `from`/`to` range.
   This matters directly for question 1's "inline diagnostics, Quality
   panel diagnostics, or both?" — the honest answer for all 13 existing
   rules is **"Quality panel only."**
2. **Rules operate on a flattened `bodyText` string per requirement, not
   the live PM document.** `useDocumentValidation.ts` builds one joined
   string per requirement (`RequirementRef.bodyText`) by walking
   `docContent` between a heading and the next same-or-higher heading
   (`getNodeSectionRange`, `src/editor/utils/outlineOps.ts:88-107`) and
   concatenating `extractBodyText()` over each block. This is why no rule
   today can point at a specific word — the position information is
   discarded at extraction time, before any rule ever runs.
3. **"Configurable" means build-time JSON, not a runtime settings UI.**
   Every rule's term list, threshold, severity, and enabled flag lives in
   `src/config/quality-rules.json`, imported directly (`import
   qualityRules from "@/config/quality-rules.json"`) by `engine.ts` and
   `InsightsTab.tsx`. Grepped every consumer of that file — none writes to
   it. A developer can edit the JSON and rebuild; an end user cannot tweak
   a threshold or term list from the app UI. This is true of all 13 rules
   uniformly, so it's answered once here rather than 13 times below.
4. **`src/layout/QualityChecksPanel.tsx` is dead code.** Despite the name
   suggesting it's the rendering component, it's just two pure helper
   functions (`groupAndSortIssues`, `numericKey`) that are used **only by
   their own test file** (`tests/unit/qualityChecksPanel.test.tsx`) — the
   real UI (`InsightsTab.tsx`) has its own independent `buildRuleGroups`/
   `buildCategoryGroups` implementation and never imports from this file.
   Flagged in §5 as a cleanup item, not something to build on.
5. **The registry architecture is already sound and already the
   codebase's established idiom.** `RULE_REGISTRY`/`DOC_RULE_REGISTRY`
   (arrays of `{id, check()}` objects, generically iterated by
   `engine.ts`) is structurally identical to `COMPANION_REGISTRY` (bundle
   save) and the `ProseRule`/`PROSE_RULE_REGISTRY` pattern sketched in the
   grammar/spellcheck design doc — this is not a new pattern to invent,
   it's one this app already uses consistently.

---

## 1. Existing Requirement Quality Rules

**Full inventory** (13 rules: 4 structural + 8 requirement-level +
1 document-level):

| Rule | Category | Severity | File | Diagnostics | Test cases |
|---|---|---|---|---|---|
| Requirement Ordering | structure | warning | `documentValidationService.ts:34-59` | Quality panel only | (in a separate `documentValidationService.test.ts`, not audited here) |
| Duplicate Requirement IDs | structure | error | `documentValidationService.ts:68-92` | Quality panel only | same |
| Missing Status | completeness | warning | `documentValidationService.ts:108-140` | Quality panel only | same |
| Empty Requirement Body | completeness | warning | `documentValidationService.ts:148-167` | Quality panel only | same |
| Weak Modal Verbs | language | warning | `rules/weakModal.ts` | Quality panel only | 18 (incl. CAN/May regression) |
| Ambiguous Words | language | warning | `rules/ambiguousWords.ts` | Quality panel only | 5 |
| Forbidden Terms | completeness | error | `rules/forbiddenTerms.ts` | Quality panel only | 6 |
| Requirement Length (word count) | structure | warning | `rules/wordCount.ts` | Quality panel only | 5 |
| Multiple SHALL Statements | structure | warning | `rules/multipleShall.ts` | Quality panel only | 5 |
| Vague Quantifiers | language | warning | `rules/vagueQuantifiers.ts` | Quality panel only | 11 |
| Escape Clauses | language | warning | `rules/escapeClauses.ts` | Quality panel only | 10 |
| Multiple Sentences | structure | warning | `rules/multipleSentences.ts` | Quality panel only | 16 |
| Undefined Acronyms | consistency | warning | `rules/undefinedAcronyms.ts` (228 lines — by far the largest rule) | Quality panel only | ~68 (over 40% of the whole 168-case suite) |

### Per-rule detail

**Requirement Ordering** (`documentValidationService.ts:34-59`) —
Purpose: flag a requirement whose numeric ID suffix is lower than the
running maximum seen so far. Behavior: high-water-mark scan; gaps allowed,
only descending transitions flagged; on a violation the mark is *not*
advanced, so later requirements still compare against the correct ceiling;
entries with `num === null` (non-numeric regex-mode IDs) are skipped
entirely. Limitation: no notion of "renumbered on purpose" vs. genuine
disorder — every descending transition is flagged the same way.

**Duplicate Requirement IDs** (`:68-92`) — Purpose: flag every occurrence
of a repeated ID (not just the 2nd+). Behavior: a `Map<id, count>` pass,
then every instance with `count > 1` gets its own issue so a reviewer can
locate each one. No known limitations beyond exact-string matching (no
near-duplicate/typo detection — see §4's suggested additions).

**Missing Status** (`:108-140`) — Purpose: flag a requirement with no
`[Status]` bracket, or one whose text doesn't match a configured status
alias. Behavior: two-branch check — bracket absent vs. bracket present but
unrecognized; alias comparison is normalized (case/whitespace-insensitive
via `normalizeStatusText`) against the live `statusConfigStore`, not a
static list. Degrades gracefully (bracket-presence-only) when no aliases
are loaded yet. No significant limitations found.

**Empty Requirement Body** (`:148-167`) — Purpose: flag a requirement
whose body is empty or whitespace-only. Behavior: trivial `.trim() === ""`
check per requirement. No limitations.

**Weak Modal Verbs** (`rules/weakModal.ts`) — Purpose: flag non-`SHALL`
modals (`should`, `may`, `can`, `could`, `might`, `would`, `ought to`) in
mandatory-requirement text. Behavior: term-list scan via the shared
`termPattern()` helper, **with two hand-tuned overrides** —
`can` excludes the all-caps `CAN` (Controller Area Network, an automotive
acronym collision) via negative lookahead, and `may` excludes date
references ("May 2024") via a lookahead that skips title-case "May"
immediately followed by whitespace+digit. Maturity: highest test
investment of any term-list rule (18 cases) specifically because of these
domain-collision overrides — a real signal that naive term-matching
against engineering vocabulary produces false positives that need
individual handling, relevant context for §3/§4's new rules.

**Ambiguous Words** (`rules/ambiguousWords.ts`) — Purpose: flag
subjective/unverifiable adjectives (`appropriate`, `adequate`,
`sufficient`, `reasonable`, `robust`, `fast`, `user-friendly`, `simple`,
etc.). Behavior: identical term-list shape to weakModal, no overrides.
Limitation: no domain-collision handling like weakModal's — untested
whether any of these terms produce automotive/engineering false positives
the way "can"/"may" did.

**Forbidden Terms** (`rules/forbiddenTerms.ts`) — Purpose: flag
release-blocking placeholders (`TBD`, `TBC`, `FIXME`, `TODO`,
`placeholder`, `N/A`) as **errors**, not warnings — the only term-list rule
configured at `error` severity. Behavior: identical shape to
ambiguousWords. Notable gap: `XXX` (a very common placeholder convention)
is absent from the term list — flagged in §4 as a one-line config addition.

**Requirement Length** (`rules/wordCount.ts`) — Purpose: flag requirements
exceeding 150 words. Behavior: `bodyText.trim().split(/\s+/)` word count
against a configurable `maxWords`. No limitations found; simple and robust.

**Multiple SHALL Statements** (`rules/multipleShall.ts`) — Purpose: flag
requirements with more than `maxCount` (default 1) occurrences of `shall`
as a proxy for "this requirement expresses more than one obligation."
Behavior: `\bshall\b` global count. Limitation: pure word-count proxy — a
requirement with one `shall` governing three conjoined actions ("shall
validate, store, and notify") is *not* caught by this rule at all (see
§3's "multiple actions" and "multiple conjunction chains").

**Vague Quantifiers** (`rules/vagueQuantifiers.ts`) — Purpose: flag
non-measurable quantities (`some`, `many`, `few`, `several`, `various`,
`numerous`, `multiple`, `a number of`, etc.). Behavior: term-list shape,
11 test cases (most of any simple term-list rule, reflecting the
multi-word-phrase terms like "adequate number of" needing boundary-safety
verification). No limitations found.

**Escape Clauses** (`rules/escapeClauses.ts`) — Purpose: flag
conditional-weakening phrases (`if possible`, `where appropriate`, `as
necessary`, `if feasible`, etc.) that make a requirement's applicability
ambiguous. Behavior: term-list shape. No limitations found. Directly
overlaps with §4's "optional wording" ask — see there.

**Multiple Sentences** (`rules/multipleSentences.ts`) — Purpose: flag
requirements containing more than one sentence. Behavior: the most
carefully-engineered simple rule in the codebase — `countSentences()`
scrubs three known false-positive sources before counting terminal
punctuation: multi-part numbers (`3.14`, `3.2.1`), the three prose
abbreviations `e.g./i.e./vs.`, and single-letter initials (`J. Smith`).
**Explicitly documented known limitations** (in the file's own comment,
lines 14-17): multi-letter abbreviations other than those three (`Fig.`,
`Sec.`) are not handled, nor are URLs containing dots, nor mid-sentence
acronyms with internal dots (`U.S.A. certified`). This scrubbing logic is
directly reusable for §2's "missing terminal punctuation" and "period
spacing" rules — same false-positive sources apply.

**Undefined Acronyms** (`rules/undefinedAcronyms.ts`, 228 lines) —
Purpose: flag acronyms used before being defined (`Full Name (ACRONYM)`
pattern), the most sophisticated rule by far. Behavior: dual-mode —
a full document-wide ordered scan (`checkWithDocContent`, tracking
current-requirement context via heading matches, recognizing acronym
*tables* by header-cell text via `ACRONYM_COL_HEADERS`/`DEF_COL_HEADERS`
sets, deduping by `(context, acronym)` pair) when `docContent` is
available, falling back to a simpler per-requirement-only scan otherwise.
Has a hand-maintained `BUILTIN_EXCLUDED` set (requirement-language
keywords, logical connectives, quantifiers, boolean/state literals — 20
tokens) plus a configurable `ignored` list (`TBD`, `TBC`, `TODO`, `REQ`,
`ID`) layered on top. Maturity: by far the most heavily tested rule (~68
of 168 total test cases across 10 separate `describe` blocks covering
base behavior, false-positive regression, automotive-acronym regression,
definition-ordering, table detection, heading-context, and dedup). No
significant limitations found in the code — this is the one rule in the
codebase that already demonstrates what "mature" looks like for a
document-wide, structurally-aware rule, and is the closest existing
template for §4's "requirement references" and "terminology consistency"
rules.

---

## 2. Grammar Fundamentals

None of these are currently implemented as dedicated rules. Feasibility
assessed against this engine's existing tools (regex over `bodyText`, the
`termPattern()`/`TermListRuleConfig` pattern, and `multipleSentences.ts`'s
proven abbreviation-scrubbing technique) — not against what a full NLP
parser could do.

| Item | Implemented? | Lightweight rule possible? | Needs NLP? |
|---|---|---|---|
| Subject-verb agreement | No | Only narrow heuristics (e.g. "shall" + verb ending in `-s` is almost always wrong: "shall processes") | **Yes, for the general case** — confirmed by `docs/harper-benchmark-results.md`: even Harper's Rust engine only catches pronoun-verb pairs, missing "list of X **are**", compound subjects, "neither/nor" — this is a structural limit of pattern-matching, not an effort gap |
| Singular/plural agreement | No | Only narrow heuristics (same shape as above) | Yes, for the general case, same reasoning |
| a/an article correctness | No | **Yes — genuinely easy.** Purely lexical: check the article against the next word's leading letter/sound, with a small hand-maintained exception list (`an hour`, `a university`) — no different in shape from the existing term-list rules | No |
| Repeated words | No | **Yes — trivial.** `\b(\w+)\s+\1\b` (case-insensitive) | No |
| Double spaces | No | **Yes — trivial.** `/ {2,}/` | No |
| Missing punctuation (sentence-ending) | No | **Yes.** Reuses `multipleSentences.ts`'s existing abbreviation-scrubbing logic; just checks whether the scrubbed text ends in `.!?` instead of counting them | No |
| Sentence capitalization | No | **Yes — trivial.** First non-whitespace character of `bodyText` is lowercase | No |
| Comma spacing | No | **Yes.** `/,\S/` (missing space after) and `/\s,/` (space before) | No |
| Period spacing | No | **Yes**, same shape as comma spacing, reusing the sentence-scrubbing exclusions so `3.14`/`e.g.` aren't misflagged | No |
| Parentheses/quote balancing | No | **Yes.** Stack-based open/close counting per requirement body — more logic than a regex one-liner but still no NLP, straightforward | No |
| Basic punctuation consistency | No | **Depends what "consistency" means** — a single-sentence check (e.g. "does this body use straight or curly quotes") is Easy; a *document-wide* convention-tracking check (e.g. "is the Oxford comma used consistently across all requirements") is Medium, since it needs cross-requirement comparison, not just a per-requirement scan. Needs scope decision before estimating further. | No, either way |

**Nine of eleven items are genuinely easy, regex-only, no-NLP additions** —
this is the strongest, lowest-risk part of the whole roadmap (§6).

---

## 3. Requirement Style

| Item | Classification | Why |
|---|---|---|
| Passive voice | **Medium** | A "to be" + past-participle heuristic (`is/are/was/were/been/being` + word ending `-ed`, with an irregular-verb exception list) is buildable, but will have a real false-positive/negative rate without POS tagging. **Must be advisory/low-severity, not a default error** — this app's own requirement style *intentionally* uses passive voice ("shall be tested by the QA team"), confirmed by the Harper benchmark correctly leaving that pattern unflagged. A naive passive-voice rule here would fight the house style unless carefully scoped (e.g. only flag passive voice *not* immediately following "shall be"). |
| Future tense ("will") | **Easy** | `will` isn't currently in `weakModal`'s term list at all (only `should/may/can/could/might/would/ought to`). Trivial addition — either add it there or give it its own rule with a distinct message, since "will" (a future-descriptive statement) is a different problem than a weak-obligation modal. |
| Progressive tense ("is running") | **Easy** | `is/are/was/were` + word ending `-ing` is a cheap, reasonably reliable heuristic; main false-positive risk is a gerund used as a noun ("the operating system"), a small, listable exception class. |
| Present perfect tense | **Medium** | `has/have/had` + past participle — same shape as passive voice, needs the same irregular-verb list, hence Medium not Easy. |
| Multiple actions in one requirement | **Medium** | *Partially* already covered by proxy (`multipleShall` catches multiple `SHALL`s; `multipleSentences` catches multiple sentences) — but neither catches one `shall` governing several conjoined verb phrases ("shall validate, store, and notify"). A dedicated check needs a curated common-verb list to count verb-like tokens after `shall`, joined by `and`/`or` — buildable, not trivial. |
| Multiple SHALL statements | **Already exists** | `rules/multipleShall.ts` |
| Missing actor | **Easy** | Cheap regex: does `bodyText` (trimmed) start with `/^shall\b/i`? If so, there's no explicit subject before the obligation. |
| Missing measurable value | **Hard** | *Partially* already covered — `ambiguousWords` already flags "fast" as vague. A *general* "this requirement should have a number/unit but doesn't" rule is a real false-positive minefield (most requirements legitimately have no number) — would need per-requirement judgment about whether quantification is even expected, which this engine has no way to know. Not recommended as a general rule; the existing vague-adjective coverage is the practical version of this. |
| Weak verbs | **Easy** | Exactly the same shape as `ambiguousWords`/`vagueQuantifiers` — a curated list (`handle`, `support`, `deal with`, `process` used vaguely, etc.) plugged into the existing `TermListRuleConfig` pattern. |
| Requirement too long | **Already exists** | `rules/wordCount.ts` |
| Multiple conjunction chains | **Easy–Medium** | A simple `and`/`or` occurrence count past a threshold is the same shape as `multipleShall.ts` (Easy). True boolean-logic-chain *structural* detection (nested conditions) would be Hard, but a count-based proxy is a reasonable, cheap Medium-at-most version. |
| Readability | **Medium** | Classic formulas (Flesch Reading Ease / Flesch-Kincaid Grade Level) are pure arithmetic over word/sentence/syllable counts — no NLP. The only non-trivial part is syllable counting, which is a well-trodden heuristic (vowel-group counting, handles English reasonably well in well under 50 lines) — genuinely Medium, not Hard, despite sounding sophisticated. |
| Negative requirements | **Easy** | Term-list rule: `shall not`, `must not`, `will not`, etc. — same shape as every other term-list rule. |
| Double negatives | **Easy–Medium** | A negation-word-proximity heuristic (curated list: `not`, `no`, `never`, `without`, `none`; flag 2+ within a short window) is cheap and buildable. **Calibrate expectations against the Harper benchmark**: even Harper's real grammar engine only catches one narrow phrasing ("didn't...no"), missing the non-contraction form ("shall not allow no unauthorized access") entirely — a hand-rolled heuristic here should aim to *beat* that narrow scope, which is achievable with a general proximity check rather than Harper's literal-phrase-matching approach, but won't be perfect either. |

---

## 4. Engineering Writing Rules

| Item | Implemented? | Assessment |
|---|---|---|
| Undefined abbreviations | **Already exists** | `undefinedAcronymsRule` — the most mature rule in the codebase (§1) |
| Requirement references | Not implemented | **Medium.** "See REQ_005" style cross-references, checked against the actual set of requirement IDs in the document (already computed elsewhere — `undefinedAcronyms.ts`'s `reqIdSet` construction is a direct template). Genuinely valuable: catches dangling references left over from a deleted/renamed requirement. |
| Number/unit formatting | Not implemented | **Medium.** Inconsistent spacing (`10ms` vs `10 ms`) or unit abbreviation, via a curated unit list + adjacency regex. |
| SI unit consistency | Not implemented | **Medium** for a reasonable v1 (flag imperial units, or flag same-document metric/imperial mixing via a document-wide scan structurally similar to `undefinedAcronymsRule`'s pass) — full generality (unit-family classification, conversion-aware checking) would be Hard, but that's not needed for real value. |
| Terminology consistency | Not implemented | **Medium if user-configured, Hard if automatic.** Detecting that "user" and "operator" mean the same thing requires either domain knowledge this engine doesn't have, or a user-maintained synonym-pairs list (same *shape* of investment as maintaining `weakModal`'s term list, but the config shape itself is new — see §5). |
| Magic numbers | Not implemented | **Medium.** A bare numeric literal not adjacent to a unit-like word or otherwise contextualized — real false-positive risk around requirement IDs and section references, needs care but is buildable. |
| Optional wording | **Mostly already exists** | Substantial overlap with `escapeClausesRule`'s existing term list (`if possible`, `where appropriate`, `if feasible`, etc.). Treat as a config *extension* (add more terms), not a new rule — Easy. |
| Placeholder text (TBD, XXX, FIXME) | **Mostly already exists** | `forbiddenTermsRule` already covers `TBD`/`TBC`/`FIXME`/`TODO`/`placeholder`/`N/A`. **Gap**: `XXX` (a very common placeholder convention) is missing from the term list — one-line config addition, Easy. |

**Additional engineering-specific rules worth adding**, not in the
original list:

- **Inconsistent capitalization of defined terms** (e.g. "Engine Control
  Unit" vs. "engine control unit" used inconsistently across the
  document) — Medium, document-wide, same shape as undefined-acronym
  scanning.
- **Requirement ID format consistency** (`REQ-001` vs `REQ_001` mixed
  styles in the same document) — Easy–Medium.
- **Duplicate/near-duplicate requirement text** — two requirements with
  highly similar `bodyText`, a likely copy-paste-without-editing mistake.
  **Medium, and genuinely lightweight**: a Jaccard-similarity-on-word-sets
  or simple Levenshtein-ratio check needs no real NLP and is cheap at
  typical document sizes (`DocumentQualityRule`'s contract already
  receives the full requirements array, so pairwise comparison needs no
  architecture change — see §5).
- **Broken internal markdown links** (a link to a heading/anchor that
  doesn't exist in the document) — Medium, structural rather than
  grammar/style, but high real-world value and fits the existing
  document-scanning pattern.
- **SHALL capitalization consistency** (some standards require `SHALL` in
  full caps for emphasis; flag lowercase `shall` if the document has
  established the all-caps convention elsewhere) — Easy.
- **Requirement table completeness** (a requirements table with a missing
  cell) — Medium, structural.

---

## 5. Rule Architecture

**Is it already plugin/rule-based?** Yes, cleanly. `QualityRule`/
`DocumentQualityRule` (`src/validation/types.ts:16-19,56-63`) are the two
contracts; `RULE_REGISTRY`/`DOC_RULE_REGISTRY` (`registry.ts`) are flat
arrays the engine (`engine.ts:51-61`) iterates generically — it has "no
knowledge of individual rule names or config shapes" (the file's own
comment, line 29). This is the same registry-of-descriptors idiom this
codebase has now applied consistently across several subsystems this
session (bundle-save's `COMPANION_REGISTRY`, the sketched
`PROSE_RULE_REGISTRY` in the grammar-spellcheck design) — not a new
pattern to introduce, an established one to keep using.

**Can new rules be added independently?** Yes — `registry.ts`'s own doc
comments (lines 14-21, 34-41) already spell out the 3-step recipe: create
`src/validation/rules/<id>.ts` exporting a `QualityRule`/
`DocumentQualityRule` object, add it to the relevant registry array, add
its config entry to `quality-rules.json`. No engine changes needed for
either rule tier.

**Which abstractions already exist?**
- `RequirementRef` — the per-requirement flattened data every
  requirement-level rule receives (`id`, `num`, `statusText`, `bodyText`).
- `termPattern()` (`rules/_pattern.ts`) — shared word-boundary-safe regex
  builder, used by 6 of the 8 requirement-level rules.
- Config-type hierarchy: `BaseRuleConfig` → `MessageRuleConfig` →
  `TermListRuleConfig` / `WordCountRuleConfig` /
  `MultipleShallRuleConfig` / `AcronymRuleConfig` — a small, reusable
  family most new term-list or count-threshold rules can slot into
  directly without a new config shape.
- `tag()` (`engine.ts:16-18`) — injects a rule's configured category onto
  every issue it produces, keeping category-tagging out of individual
  rules.
- `extractBodyText()` — the code/inline-code-stripping text extractor
  every rule's input passes through before it ever sees a rule.

**Is refactoring recommended before adding more rules?** Five specific
items, none blocking, all worth deciding consciously rather than drifting
into:

1. **No position data is the one real structural gap**, already flagged
   in §0. It doesn't block any of the rules proposed in §§2–4 (all fit
   the existing Quality-panel-list model exactly as today's 13 rules do)
   — but every one of the ~9 "Easy" grammar-fundamentals additions is
   *exactly* the kind of word-level issue that would benefit most from an
   inline squiggle instead of a list row (a missing article or double
   space is much faster to fix by clicking it in-place than by looking it
   up in a panel). Worth planning for now, before 30 more rules exist
   that would all need retrofitting later, rather than treating it as
   independent of this roadmap.
2. **`DocumentQualityRule` already supports pairwise/cross-requirement
   checks** — worth stating explicitly since it might look like a gap:
   `check(requirements: ReadonlyArray<RequirementRef>, config, docContent?)`
   already receives the *full* requirements array, so "duplicate/
   near-duplicate requirement" (§4) needs zero architecture change, just
   a new file in this existing tier.
3. **Category taxonomy needs a decision, not organic drift.** The 5
   declared `ValidationCategory` values (`structure`, `language`,
   `completeness`, `consistency`, `traceability`) already have an unused
   member — grepped `quality-rules.json`: **zero rules use
   `"traceability"`** today (likely reserved for this app's separate
   traceability feature, not yet wired to this engine). Meanwhile, the
   grammar-fundamentals items (double spaces, repeated words, comma
   spacing) don't map cleanly onto any existing category — they're
   mechanical typography, a different kind of thing than "weak modal
   verbs" even though both would currently land under `language`.
   Recommend deciding whether to add a `grammar`/`typography` category or
   consciously fold everything into `language` *before* adding 20+ rules,
   not after.
4. **New config shapes needed for a few rule types, not most.** Term-list
   and count-threshold rules (the bulk of §§2–4's Easy/Medium items) fit
   existing config types directly. Two new shapes are worth designing
   once, generically: a **numeric-threshold-with-explanation** shape for
   readability (trivially close to `WordCountRuleConfig`'s existing
   shape) and a **paired-terms** shape for terminology-consistency /
   synonym tracking (genuinely new — nothing today models "these two
   terms should not both appear").
5. **`QualityChecksPanel.tsx` should be removed or clearly marked
   deprecated** (§0) before a future contributor builds against it
   thinking it's the active rendering path.

None of these require re-architecting the engine — they're config/
taxonomy decisions and one dead-code cleanup, not a rewrite.

---

## 6. Prioritized Roadmap

Grounded in §§2–4's classifications; ordered by value-to-effort, with the
Harper benchmark's empirical findings used to validate the Hard tier (if a
real grammar engine also structurally can't do it, that's real evidence
for this classification, not just this audit's own judgment).

### Quick wins (1–2 days each — regex-only, no new config shape, mostly reusing the existing `TermListRuleConfig`/count-threshold pattern)

- Double spaces
- Repeated words
- a/an article correctness
- Sentence capitalization
- Comma spacing / period spacing (reuses `multipleSentences.ts`'s
  abbreviation-scrubbing logic directly)
- Missing terminal punctuation (same reuse)
- Parentheses/quote balancing
- Missing actor (starts-with-"shall" check)
- Future tense "will" (term-list, or extend `weakModal`)
- Weak verbs (term-list, mirrors `ambiguousWords`)
- Negative requirements (term-list: "shall not", "must not")
- Multiple conjunction chains (count threshold, mirrors `multipleShall`)
- SHALL capitalization consistency
- Config-only extensions: add `XXX` to `forbiddenTerms`, expand
  `escapeClauses`'s term list for "optional wording"

### Medium effort (needs a small amount of new logic — an exception list, a document-wide scan, or a new-but-reusable config shape)

- Progressive tense / present perfect tense (irregular-verb lists)
- Double negatives (negation-proximity heuristic)
- Requirement references / dangling-reference check (document-wide,
  direct template: `undefinedAcronymsRule`'s `reqIdSet` construction)
- Number/unit formatting consistency
- Magic numbers
- Readability score (syllable heuristic + standard formula)
- Duplicate/near-duplicate requirement detection (word-set similarity,
  zero architecture change per §5)
- Terminology/synonym-pair consistency (needs the new paired-terms config
  shape from §5)
- Multiple actions within one SHALL (verb-phrase counting)
- Inconsistent capitalization of defined terms
- Broken internal markdown links

### Advanced / hard (general syntactic analysis — corroborated as genuinely hard by the Harper benchmark, not just this audit's estimate)

- Subject-verb agreement (general case — Harper misses "list of X are",
  compound subjects, "neither/nor")
- Singular/plural agreement (general case, same reasoning)
- Passive voice (reliable, low-false-positive general detection — and
  must stay advisory given this domain's intentional passive-voice style)
- Ambiguous pronoun reference (discourse-level; Harper found this
  entirely unsupported too — structurally hard for any pattern-based
  engine)
- Comma splices / sentence fragments (Harper: entirely unsupported at
  any configuration — real corroboration this needs actual clause-boundary
  parsing, not a bigger regex)
- SI unit consistency at full generality (unit-family classification,
  conversion-aware — the Medium-scoped version in §4 covers most real
  value without this)
- General missing-measurable-value detection (not recommended at all per
  §3 — false-positive risk is structural, not an effort problem)

---

## 7. Deliverables

**Current rule inventory**: §1's table — 13 rules, all Quality-panel-only,
all configured via build-time JSON, ranging from trivial (`emptyBody`) to
genuinely sophisticated (`undefinedAcronyms`, 228 lines, ~68 dedicated
tests).

**Missing rule inventory**: the full set of unchecked items across §§2–4
— 11 grammar fundamentals (9 of which are Easy), 14 style rules (6 Easy,
5 Medium, 3 Hard/not-recommended), and 6 engineering-writing rules plus 6
additional suggested ones (mostly Medium, 2 already substantially covered
by existing config).

**Complexity estimate**: roughly **15 Quick-win items**, **11 Medium
items**, **6 Hard/advanced items** (one of which — general
missing-measurable-value — isn't recommended as a rule at all).

**Suggested implementation order**: exactly the three-tier roadmap in
§6 — quick wins first (highest count, lowest risk, immediately shippable
with the existing architecture unchanged), then Medium items (spend the
one real design decision — the paired-terms config shape — once, up
front, before multiple Medium rules need it), Hard items last and treated
as genuinely open-ended research rather than scheduled work, given even
Harper doesn't solve them.

**Files likely to change** (once approved — no code written for this
audit):

| File | Change |
|---|---|
| `src/validation/rules/*.ts` | ~20+ new rule files across the quick-win/medium tiers |
| `src/validation/registry.ts` | Add each new rule to `RULE_REGISTRY` or `DOC_RULE_REGISTRY` |
| `src/config/quality-rules.json` | One config entry per new rule; extend `forbiddenTerms`/`escapeClauses` term lists |
| `src/validation/types.ts` | Add the paired-terms config type (terminology consistency) and a numeric-threshold-with-explanation type (readability) if not reusing `WordCountRuleConfig` directly |
| `src/types/validation.ts` | Possibly extend `ValidationCategory` with a `grammar`/`typography` member (§5 decision) |
| `src/layout/QualityChecksPanel.tsx` | Remove or deprecate (dead code, §0/§5) |
| `tests/unit/qualityRules.test.ts` | Extended per new rule, following the existing per-rule `describe` block convention |

No changes needed to `engine.ts`, `InsightsTab.tsx`, `validationStore.ts`,
or `useDocumentValidation.ts` for any Quick-win or Medium rule — the
existing generic iteration and rendering already accommodate an arbitrary
number of registry entries. `InsightsTab.tsx` would only need a change if
a new `ValidationCategory` is added (one entry each to `CATEGORY_ORDER`/
`CATEGORY_LABELS`/`CategoryIcon`).
