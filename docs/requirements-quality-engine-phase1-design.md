# Requirements Writing Quality Engine — Phase 1 Design Specification

Status: **Draft for review** · Builds directly on
`docs/requirements-quality-engine-audit.md`. Design only, no code.

---

## 1. Overall philosophy

**Engineering writing assistant, not general grammar checker.** This is
the one sentence every design decision below should trace back to. Made
concrete:

- **Deterministic and explainable over statistically clever.** Every rule
  must be able to say, in plain language, exactly why it fired — matching
  the existing 13 rules' message-template convention. No rule should ever
  produce a suggestion the engine itself can't justify.
- **Domain-aware, not generic-English-aware.** House conventions this
  domain actually wants — `SHALL` as the mandatory modal, intentional
  passive voice ("shall be tested by..."), acronym-dense prose, embedded
  requirement IDs and part numbers — are first-class inputs to every rule,
  not exceptions bolted on afterward. `weakModal.ts`'s hand-tuned `CAN`/
  `May` overrides (§1 of the audit) are the existing proof this works;
  every new rule inherits that same obligation to check itself against
  real engineering-document vocabulary before shipping.
- **Bias toward under-flagging, not over-flagging.** `docs/harper-benchmark-
  results.md` demonstrated concretely what happens when this bias is
  wrong — a real grammar engine's default configuration produced false
  positives on `REQ_001`, `SPI`, `CANbus`, `500ms` and eroded trust
  immediately. This engine's rules are simpler than Harper's, which makes
  false positives *easier* to introduce carelessly, not harder — every new
  rule needs an explicit false-positive check against realistic domain text
  before it ships, not just against synthetic test sentences.
- **Not a general grammar checker, on purpose.** `docs/harper-benchmark-
  results.md` and the audit both independently concluded that general
  subject-verb agreement, comma splices, sentence fragments, and ambiguous
  pronoun reference are structurally hard for *any* pattern-based engine,
  Harper included. This engine should not chase those. Its value is in the
  much larger set of high-precision, requirement-specific checks (single
  obligation per requirement, measurable criteria, defined acronyms,
  consistent terminology) that a general grammar checker has no concept of
  at all — that's the actual competitive space, not "grammar checking, but
  worse than Harper."
- **No ML, no external engine, no network.** Consistent with every design
  decision made in the Harper-evaluation docs — this stays a pure,
  synchronous, in-browser rule engine.

---

## 2. Rule taxonomy

The requested 5 categories (Writing Hygiene, Requirement Language,
Engineering Rules, Requirement Completeness, Consistency) don't have an
exact 1:1 mapping from today's 5 (`structure`, `language`, `completeness`,
`consistency`, `traceability`) — worth resolving explicitly rather than
letting individual rules drift into whichever category feels closest at
migration time.

**Category charters** (a one-line test for "does this rule belong here"):

| New category | Charter | Existing rules that land here |
|---|---|---|
| **Writing Hygiene** | Mechanical, typography-level correctness — true regardless of domain, would apply to *any* prose. | *(none today — this category is entirely new, exactly Phase 1's scope)* |
| **Requirement Language** | How a requirement is *worded* — modal choice, vagueness, sentence construction, single-obligation phrasing. | `weakModal`, `ambiguousWords`, `vagueQuantifiers`, `escapeClauses`, `wordCount`, `multipleShall`, `multipleSentences` |
| **Engineering Rules** | Domain-specific correctness a general writing tool has no concept of — units, acronyms, numeric formatting. | `undefinedAcronyms` |
| **Requirement Completeness** | Is this requirement (or the document) missing something it needs to be usable at all? | `missingStatus`, `emptyBody` |
| **Consistency** | Internal coherence — does the document agree with itself (IDs, ordering, terminology)? | `requirementOrder`, `duplicateId` |

**The two genuine boundary calls, flagged rather than silently
resolved:**

1. `requirementOrder`/`duplicateId` moved from `structure` into
   **Consistency** (not Completeness) — a misordered or duplicated ID is
   an internal-coherence problem, not a missing-content problem. Defensible
   either way; this is the recommended default, not the only reasonable one.
2. `wordCount`/`multipleShall`/`multipleSentences` moved into
   **Requirement Language** (not a new "structure" bucket) — reframed as
   "is this requirement worded as a single, atomic, well-scoped
   obligation," which is a *language/construction* quality, not a
   document-structure one. This mirrors how requirements-engineering
   literature (e.g. EARS-style "atomic requirement" guidance) usually
   frames it.

`traceability` (declared, unused by any current rule per the audit)
carries forward unchanged — reserved for this engine to eventually connect
with the app's separate traceability feature, out of scope here.

**Recommendation**: use exactly the 5 requested categories as designed
above. An explicit "Document Structure" 6th category was considered for
`requirementOrder`/`duplicateId` and rejected as unnecessary — Consistency
already covers it cleanly without fragmenting the taxonomy further.

---

## 3. Severity model

`ValidationSeverity` grows from 2 values to 3: `"info" | "warning" |
"error"`. Purely additive to the type — no existing rule's severity value
changes meaning.

**The distinguishing question per tier is *impact*, not *confidence***:

| Severity | Question | Default population |
|---|---|---|
| **Error** | Is this objectively broken or release-blocking, with near-zero legitimate exceptions? | Forbidden terms/placeholders (existing), duplicate IDs (existing), unbalanced parentheses/quotes (new — genuinely malformed), broken/dangling requirement references (new — objectively wrong) |
| **Warning** | Does this likely need a human decision, with real legitimate exceptions? | **The default tier** — nearly everything existing already uses it, and most new rules should too: weak modals, vague quantifiers, escape clauses, word count, multiple-shall, requirement ordering, missing status, most Writing Hygiene and Engineering Rules items |
| **Info** | Is this a low-confidence heuristic, or purely advisory rather than a "problem"? | Passive voice (must stay non-blocking — this domain's house style intentionally uses it, confirmed by the Harper benchmark), readability score (a metric, not pass/fail), progressive/present-perfect tense nudges, double-negative heuristic (lower precision than a term-list match) |

**Recommended default for Phase 1's Writing Hygiene rules specifically:
`Warning`, not `Error`.** These are 100%-deterministic and virtually
zero-false-positive once correctly implemented, which might argue for
`Error` — but `Error` in this engine's existing convention signals
*workflow-blocking* significance (a duplicate ID or an unresolved `TBD`
genuinely blocks release-readiness), not *certainty of correctness*. A
double space is trivially fixable and mildly embarrassing, not
release-blocking. Reserve `Error` for genuine malformation
(unbalanced-parens/broken-references), keep the rest at `Warning`.

---

## 4. Rule metadata

Evolved `BaseRuleConfig` (additive — every existing field keeps its exact
current meaning):

```ts
interface BaseRuleConfig {
  readonly id: string;
  readonly category: ValidationCategory;       // now the 5(+1)-value taxonomy from §2
  readonly severity: ValidationSeverity;        // now 3-value, per §3
  readonly title: string;
  readonly description: string;

  /** The shipped baseline — was "enabled" today. Renamed for clarity once
   *  a live override layer (§6) can make the EFFECTIVE state diverge from
   *  this default; today, before that layer exists, this is still the
   *  only source of truth, identical to current behavior. */
  readonly enabledByDefault: boolean;

  /** True if this rule exposes tunable parameters beyond on/off/severity
   *  (a term list, a threshold, an ignore list) — false for rules with
   *  nothing to configure (most Writing Hygiene rules). Lets a future
   *  settings UI (§7) know whether to show an "Advanced" section for a
   *  given rule without inspecting its config shape at runtime. */
  readonly configurable: boolean;

  /** FUTURE, not implemented now (§5). Declares whether issues from this
   *  rule CAN carry a deterministic quickFix — a rule can only honestly
   *  set this true once it actually populates ValidationIssue.quickFix.
   *  Defaults to false/absent for every existing and Phase 1 rule. */
  readonly quickFixCapable?: boolean;

  /** FUTURE, not implemented now. Optional link/path to a longer
   *  explanation of why the rule exists and how to resolve it — useful
   *  once rule count reaches 40-50 and "why did this fire" needs an
   *  answer beyond the one-line message. */
  readonly documentationLink?: string;
}
```

`enabled` → `enabledByDefault` is a rename with a purpose, not
bikeshedding: it's the field that makes §6's runtime-override layer
coherent — the JSON always describes the *shipped default*; a separate,
optional runtime layer can override it per-user without mutating the
file. Without this rename, "enabled" would ambiguously mean two different
things once overrides exist.

---

## 5. `ValidationIssue` evolution — designed for future quick fixes, not implementing them

**The core design problem**: today's rules operate on `bodyText`, a
flattened string with no position mapping back to the document (audit
§0). A quick fix needs to know *exactly* what text to replace. The
constraint is to add this capability without rewriting any of the 13
existing rules, which will never populate it and must keep working
exactly as they do today.

**The unlock**: Phase 1 (and most of Phase 2/3's) rules are regex-based
scans against `bodyText`. A regex match already carries `match.index` and
`match[0].length` — a bodyText-relative character range is *free* for
these rules to report, no new plumbing required at the rule level. Rules
that can't cheaply produce a range (most of today's 13, and any future
rule requiring real judgment) simply don't populate the field — identical
to their behavior today.

```ts
export interface ValidationIssue {
  // ── Existing fields — UNCHANGED, same meaning ──
  id: string;
  severity: ValidationSeverity;
  type: string;
  message: string;
  targetId?: string;
  category?: ValidationCategory;
  documentIndex?: number;

  // ── NEW, both optional — zero impact on any existing rule ──

  /**
   * Character range within the string the rule scanned (today, always
   * RequirementRef.bodyText). Absent = whole-requirement-level issue,
   * exactly today's universal behavior for all 13 existing rules.
   */
  range?: { from: number; to: number };

  /**
   * A deterministic, mechanical fix for THIS issue instance. Only
   * meaningful alongside `range`. Absent by default and MUST stay absent
   * for anything requiring human judgment (a vague-quantifier rewrite has
   * no deterministic fix — there's no single correct measurable value to
   * substitute). `replacement` is the exact text to substitute into
   * `range` — empty string covers pure removal (e.g. delete a duplicate
   * word); a zero-width `range` covers pure insertion (e.g. append a
   * missing period) — one shape covers replace/remove/insert without a
   * discriminated union.
   */
  quickFix?: { label: string; replacement: string };
}
```

No change to the `QualityRule`/`DocumentQualityRule` `check()` method
signatures — both still return `ValidationIssue[]`. This is purely
additive at the object-shape level.

**Explicitly out of scope for this design** (per "do not implement quick
fixes" — named so it's a tracked future decision, not a vague deferral):

1. **The `bodyText`-offset → ProseMirror-position mapping.** A
   requirement's `bodyText` is a concatenation across multiple blocks
   (`useDocumentValidation.ts`'s `.map(extractBodyText).join("")`) — a
   single offset into that joined string does not, by itself, identify
   which block (and where within it) the offset came from. Turning a
   `range` into an actual editable document position needs a parallel
   offset table (each block's contribution range within `bodyText`, plus
   that block's own starting position) built once, generically, at the
   same point `bodyText` itself is constructed — not per-rule.
2. **An "Apply Fix" UI action** (a button on a Quality-panel row, or an
   inline decoration interaction) that actually performs the edit.
3. **Any inline decoration/squiggle rendering** — `range` alone doesn't
   imply inline UI; that's the same net-new plugin infrastructure scoped
   (and deliberately not built) in the grammar-spellcheck design docs.

Populating `range` today costs nothing and creates zero new UI surface —
it's inert data until (1)-(3) above are separately designed and built.

---

## 6. Runtime configuration — audit and recommendations

**Is the current JSON sufficient?** For 13 rules, yes. For 40-50, no — three
concrete gaps, not a vague "could be better":

1. **No live override layer exists.** Every rule's `enabled`/severity/
   thresholds are fixed at build time (audit §0). At 13 rules this is
   tolerable; at 40-50, "this rule is too noisy for our team, we can't turn
   it off without a developer editing JSON and rebuilding" becomes a real
   recurring complaint. **Recommend a new persisted store** (same
   `partialize`-backed Zustand pattern already used throughout this app —
   `uiStore`'s `scrollSyncMode`, the grammar-spellcheck design's
   `ignoredWords`) holding sparse overrides:
   ```ts
   ruleOverrides: Record<string, { enabled?: boolean; severity?: ValidationSeverity }>
   ```
   The engine computes each rule's *effective* config as
   `{ ...jsonDefault, ...(overrides[ruleId] ?? {}) }` at evaluation time —
   `enabledByDefault` (§4) stays the shipped baseline; the override is the
   only thing that changes per-user, per-browser-profile, global (not
   per-document, matching the same reasoning `docs/grammar-spellcheck-
   design.md` §6 used for the spelling ignore-list: a "which rules bother
   me" preference is a personal setting, not document data).
2. **No shape validation on `quality-rules.json`.** Every rule casts its
   config with an unchecked `config as TermListRuleConfig`-style
   assertion (audit §1, every rule file). At 13 hand-written entries this
   has never caused a problem; at 40-50, a typo'd field name in the JSON
   produces a silent `undefined` deep inside a rule's logic (e.g.
   `.terms.forEach` on an unexpectedly-missing `terms` array) rather than
   a caught error. **Recommend a build-time (not runtime) schema check** —
   either a lightweight hand-rolled shape validator run in a test/lint
   step, or a `satisfies`-based TypeScript check tying each rule ID's JSON
   entry to its rule's expected config interface. Not a runtime cost
   either way; purely a "catch this before it ships" safety net.
3. **A new config shape is needed for terminology/synonym-pair rules**
   (flagged in the audit §5) — nothing today models "these terms should
   not both appear" the way `TermListRuleConfig` models "flag any of these
   terms." Worth designing once:
   ```ts
   interface PairedTermsRuleConfig extends MessageRuleConfig {
     readonly pairs: ReadonlyArray<{ terms: readonly string[]; canonical?: string }>;
   }
   ```
   Not needed for Phase 1 (none of the 7 Writing Hygiene rules need it) —
   noted here so it's designed once, deliberately, before the first rule
   that needs it is built ad hoc.

**One structural recommendation, not urgent**: consider splitting
`quality-rules.json` by category (`src/config/quality-rules/
writingHygiene.json`, `requirementLanguage.json`, etc., merged at import
time) once the file approaches 40-50 entries — a single flat file at that
size becomes a diff-review and navigation burden. Not a Phase 1 blocker;
worth doing whenever the file first feels unwieldy, not on a schedule.

The existing `"_version": 1` field already anticipates future migration
(same pattern `configStore.ts` uses) — no change needed there.

---

## 7. UI evolution — scaling the Quality panel to 40-50 rules

`InsightsTab.tsx`'s existing **"Browse by Category"** section (audit §1 —
collapsible, category-grouped, already built) is the right foundation to
scale from — it doesn't need replacing, it needs to become the *primary*
view rather than a secondary one:

1. **Make category-grouped browsing primary; keep the flat "Needs
   Attention" list but bound it.** At 40-50 rules, a flat list of rule
   groups (even collapsed) becomes a long scroll. Recommend "Needs
   Attention" becomes a genuinely bounded "top issues across all
   categories" view (e.g. capped count, highest severity/impact first —
   it already sorts this way), with "Browse by Category" as the
   comprehensive view for anyone who wants everything.
2. **De-emphasize `Info`-severity issues visually**, consistent with §3's
   "advisory, not a problem" framing — collapsed by default and visually
   quieter than `Warning`/`Error`, so 40-50 rules including several
   `Info`-tier ones doesn't read as "50 things are wrong" when most are
   low-confidence nudges.
3. **A rule-management surface is a genuinely new UI need, not a scaling
   tweak.** Once §6's override layer exists, someone needs to actually see
   and toggle it — a list of all rules (id, category, severity, current
   effective enabled state) with a toggle per row. Whether this lives as a
   new tab, a panel within the existing Quality tab, or a modal is an open
   question worth deciding when §6 is actually built, not now — but it's
   real, additive UI work, not something "Browse by Category" already
   covers (that section shows *triggered* rules only, never rules with
   zero current issues, which a management surface needs to).
4. **Add a compact per-category count strip** to the existing 4-stat-card
   header (Requirements/Issues/Rules Triggered/Errors) — a glanceable
   "Writing Hygiene: 12 · Requirement Language: 8 · ..." row, cheaper to
   scan than opening each category section to see its count.
5. **Design row components so a future "Fix" action is additive.** Once
   §5's `quickFix` field starts being populated (not now), the existing
   `RequirementRow` component should be able to grow a conditional "Fix"
   button without restructuring — worth keeping in mind when any Phase 1
   UI touch-up happens, not a task to do now.
6. **No performance concern identified.** `buildRuleGroups`/
   `buildCategoryGroups` are `O(issues)`, not `O(rules)` — rule *count*
   scaling to 40-50 doesn't change this; only issue *volume* per document
   would, and nothing in the audit or this design suggests that's
   currently a problem. Not flagging speculative work here.

---

## 8. Implementation roadmap — Phase 1: Writing Hygiene

All 7 rules are requirement-level (`QualityRule`, into `RULE_REGISTRY`) —
none need document-wide context, so this phase touches zero registry-tier
architecture. All 7 should populate `range` (§5) from day one — it's
free given they're regex/index-based, and sets up future quick-fix/inline
capability without committing to build it now.

**Recommended build order** (dependency- and effort-aware, not just the
order requested):

| Order | Rule | Complexity | Why here |
|---|---|---|---|
| 1 | **Double spaces** | Trivial — single regex (`/ {2,}/`), zero edge cases | Build first — simplest possible case, establishes the Phase 1 rule *shape* (config type, `range` population, test structure) every other rule in this phase copies |
| 2 | **Capitalization** (sentence-initial) | Trivial — first-non-whitespace-char check | Same shape as #1, independent |
| 3 | **Repeated words** | Easy — `\b(\w+)\s+\1\b` case-insensitive | One real nuance: "that that" is occasionally legitimate ("the reason **that that** value...") — needs a small override list, same pattern as `weakModal.ts`'s `CAN`/`May` handling (§1 of the audit) — not a new technique, a known-good one |
| 4 | **Comma spacing** | Easy — two checks (`/,\S/` missing-space-after, `/\s,/` space-before) | Slightly more surface than #1-3 (2 patterns, not 1) but no new technique |
| 5 | **Extract the shared sentence-scrub utility** | *(refactor, not a rule)* | **Do this before #6/#7.** `multipleSentences.ts` already has the exact false-positive-avoidance logic both remaining rules need (multi-part numbers, `e.g./i.e./vs.`, single-letter initials — audit §1). Promote it into a new shared, exported helper (`rules/_sentenceScrub.ts`, mirroring `_pattern.ts`'s existing shared-helper convention), and refactor `multipleSentences.ts` to use it. Three rules then share one canonical implementation instead of two new ones copy-pasting (and inevitably drifting from) the existing one. |
| 6 | **Missing terminal punctuation** | Easy, given #5 | Uses the shared scrub utility directly — does the cleaned text end in `.!?`? |
| 7 | **Period spacing** | Easy, given #5 | Same utility, checking spacing around retained (non-scrubbed) periods |
| 8 | **Parentheses balancing** | Easy–Medium — the one rule needing real logic, not a single regex | Stack-based open/close counting, not a regex one-liner — genuinely a different effort shape from #1-7, correctly saved for last. Scoped to `(`/`)` only per this phase's explicit list; quote-balancing (mentioned in the audit as a related idea) is a natural follow-on but needs different logic (a toggle/parity check, since `"` serves as both open and close depending on position — not a drop-in reuse of the same function with different characters) and is **not** included in this phase. |

**No new config type needed for any of the 7** — all fit
`MessageRuleConfig` (id/category/severity/enabledByDefault/configurable/
title/description/message), several with `configurable: false` since
there's nothing to tune beyond on/off/severity (double spaces, missing
terminal punctuation, capitalization, parens balancing have no term list
or threshold at all).

**Quick-fix-capability preview** (not built now, but worth noting per §5
since it validates the data model against real cases): double spaces,
repeated words, missing terminal punctuation, capitalization, and comma
spacing all have an obvious, unambiguous deterministic fix (collapse
spaces, remove the duplicate, append a period, uppercase the first letter,
insert/remove a space) — genuine `quickFixCapable` candidates once that
capability is built. **Parentheses balancing is likely not** — *where* to
insert a missing closing paren is often ambiguous (end of sentence? end of
clause?), so it should probably stay a flag-only rule even after quick
fixes exist for the others.

**Rough sizing**: 1-2 hours each for #1-4 and #6-7 (once the shared
utility from #5 exists), a half-day for #5's extraction-and-refactor
(touches an existing, well-tested rule — `multipleSentences.ts` has 16
existing tests that must keep passing), 2-3 hours for #8 given its
stack-logic and nested/unmatched test cases. **Whole phase: realistically
2-3 days**, consistent with the audit's original "quick wins: 1-2 days
each" estimate collapsed down by the shared-infrastructure reuse this
ordering enables.
