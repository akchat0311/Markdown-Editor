# Grammar & Spell-Check — Design Specification

Status: **Draft for review** · No prior document exists — this is a fresh
design, not an update.

## 0. Search result, and a correction to the brief

Before writing anything, I searched exhaustively for a prior grammar/spell-check
design document or implementation notes:

- **`docs/`** — 5 files, none related (`markdown-architecture.md`,
  `test-traceability-v1-design.md`, `test-traceability-v1-implementation-plan.md`,
  `split-view-scroll-sync-design.md`, `document-bundle-save-design.md`).
- **`git log --all -i --grep="spell\|grammar"`**, and a search for deleted
  files matching those terms across every commit on every branch — zero hits.
- **Code** — the only matches for "spell" in `src/` are the native HTML
  `spellCheck`/`spellcheck` attribute on a handful of inputs; no custom
  spell/grammar feature or scaffolding exists.
- **`CLAUDE.md`** and prior-session memory — no mention.

Per your confirmation, this document starts fresh, following the same
audit-then-design pattern as the scroll-sync and bundle-save docs.

**The audit also surfaces a framing correction worth stating up front**: "add
grammar/spell-check" undersells what already exists and overstates what's
missing uniformly.

- Native browser spellcheck is **already on** in the rich editor
  (`App.tsx:143`, `editorProps: { attributes: { spellcheck: "true" } }`).
- It is **explicitly off** in source/split view's raw markdown textarea
  (`SourcePane.tsx:148`, `spellCheck={false}`) — an intentional-looking,
  undocumented asymmetry (see §7).
- **Grammar checking does not exist at all**, in any form.
- The app already has a "language" category of custom prose-quality rules
  (`weakModal`, `ambiguousWords`, `forbiddenTerms`, `vagueQuantifiers`,
  `escapeClauses`, `multipleSentences` — `src/validation/rules/`), but these
  are requirement-writing *style* rules (banned words, sentence-count caps),
  not spelling or grammatical correctness in the traditional sense.
- There is **no ignore-list/custom-dictionary mechanism** connecting the
  app's own domain vocabulary (the acronym list already tracked for
  `undefinedAcronymsRule`) to spellcheck — native spellcheck will flag every
  requirement ID, acronym, and part number as a misspelling today, with no
  way for a user to teach it otherwise.

So the real gaps are: **grammar checking (genuinely new)**, **spellcheck
consistency between the two editing panes**, and **an ignore-list that both
old and new "language" tooling can share** — not "spell-check from scratch."

---

## 1. Current architecture

### 1.1 The validation pipeline (rules/registry/engine)

Rule contract — `src/validation/types.ts:16-19,56-63`:

```ts
export interface QualityRule {
  readonly id: RuleId;
  check(req: RequirementRef, config: unknown): ValidationIssue[];
}
export interface DocumentQualityRule {
  readonly id: RuleId;
  check(requirements: ReadonlyArray<RequirementRef>, config: unknown,
        docContent?: ReadonlyArray<JSONContent>): ValidationIssue[];
}
```

`RequirementRef` (`src/services/documentValidationService.ts:8-19`) is
`{ id, num, statusText, bodyText }` — **`bodyText` is one flattened string
per requirement; there is no character-offset map back into the PM doc.**

Violation shape — `src/types/validation.ts:4-21`:

```ts
export interface ValidationIssue {
  id: string;
  severity: "warning" | "error";
  type: string;
  message: string;
  targetId?: string;      // requirement ID — coarse, whole-requirement grain
  category?: ValidationCategory;
  documentIndex?: number; // for issues with no targetId
}
```

**No `from`/`to`/offset field exists anywhere.** Every rule addresses issues
by `targetId` (a requirement heading) or `documentIndex` (a top-level block)
— never a text range within a body. This is the single most consequential
fact for this design (§2).

Registry (the `COMPANION_REGISTRY` analog for rules) —
`src/validation/registry.ts:23-45`:

```ts
export const RULE_REGISTRY: QualityRule[] = [
  weakModalRule, ambiguousWordsRule, forbiddenTermsRule, wordCountRule,
  multipleShallRule, vagueQuantifiersRule, escapeClausesRule, multipleSentencesRule,
];
export const DOC_RULE_REGISTRY: DocumentQualityRule[] = [ undefinedAcronymsRule ];
```

Engine — `src/validation/engine.ts:31-64`, `runAllValidations()`: 4
structural checks (order/duplicate/status/empty), then
`requirements × RULE_REGISTRY`, then `DOC_RULE_REGISTRY`, flattened into one
`ValidationIssue[]`. Per-rule config comes from the static
`src/config/quality-rules.json` — not user-editable at runtime by anything
in the app today.

### 1.2 Where results surface — a list, not decorations

- Store: `src/stores/validationStore.ts:15-18` — flat `{ issues, setIssues }`.
- Wiring: `App.tsx:505-521` — `useDocumentValidation` (debounced, §1.5)
  pushes into the store; one toast fires the first time an ordering
  violation appears.
- Panel: the "Quality tab" is `src/layout/tabs/InsightsTab.tsx` (registered
  in `Dashboard.tsx:19-27`). `buildRuleGroups()`
  (`InsightsTab.tsx:75-127`) groups issues by rule → category, and —
  **critically** — **dedupes by `targetId`**: `if (seen.has(issue.targetId))
  continue;`. One row per requirement per rule, no matter how many times
  that rule fired for that requirement.
- Clicking a row navigates to the **requirement heading**, not a specific
  word (`Dashboard.tsx:76-87`, `handleNavigateByTargetId` → outline lookup →
  `pmPos`).
- **No inline ProseMirror decoration plugin for validation issues exists.**
  I checked every plugin in `src/editor/plugins/` — none reference
  `useValidationStore` or `ValidationIssue`. Violations are a list-only
  affordance today.

### 1.3 Decoration precedent to build on

`src/editor/plugins/inlineMathDecorations.ts` is the right template:

- `findMathRanges()` (lines 18-34) walks `doc.descendants`, merges
  contiguous matching text nodes into `{from, to}` ranges.
- `Decoration.inline(range.from, range.to, { class: "..." })` (lines 94-101)
  — where a squiggle class would go.
- `Decoration.widget(range.from, factory, { side: -1, ... })` (lines
  102-109) for a click-to-interact affordance (the math widget's click
  handler moves the cursor into edit mode — the same shape a "click a
  misspelling → see suggestions" popover would use).
- Plugin `apply()` only rebuilds `if (tr.docChanged || tr.selectionSet ||
  meta?.reload)`, otherwise maps the old `DecorationSet` through
  `tr.mapping` (lines 125-131) — the standard "don't recompute on every
  transaction" idiom, directly reusable.
- The `view()` hook lazy-loads KaTeX via a cached promise, then dispatches a
  `reload` meta transaction once ready (lines 140-152) — this is also the
  established pattern for lazy-loading a dictionary/grammar engine (§4.3).

**No squiggly-underline CSS exists anywhere** — I grepped
`src/styles/index.css` for `wavy`/`squiggl`; the only `text-decoration` rule
is a plain link underline. A spelling/grammar squiggle class is new, from
scratch.

### 1.4 Review comments are requirement-level, not word-level

`ReviewFile` (`src/types/reviewComment.ts:20-23`) keys comments **only by
`reqId`**; `ReviewComment` has no `from`/`to`/anchor-text field at all. The
badge widget renders once per heading, and the drawer opens a whole thread
for that ID. **Reusing the review-comment system for word-level spelling
suggestions would be an architectural mismatch** — it would need a real
schema change (touching `migrateComment()`, the file format, persistence),
not adaptation. Not recommended (§3).

### 1.5 SourcePane has no validation surface at all

`SourcePane.tsx:148` sets `spellCheck={false}` on the `<textarea>`. No
custom validation touches it — `useDocumentValidation` reads only
`editor.state.doc` (`useDocumentValidation.ts:55`). A `<textarea>` cannot
render inline decorations at all (no decoration API); any custom
spelling/grammar squiggle in source mode would need a separate overlay
mechanism (a mirrored `<div>` with highlighted spans positioned behind/over
the textarea) — real, known technique, but new infrastructure with no
precedent in this codebase.

### 1.6 Debounce pattern (reused, not reinvented)

`useDocumentValidation.ts:15,43-90` — 500ms, keyed off doc **content**
identity (`useEditorState` with `equalityFn: (a,b) => a === b`, so
cursor-only transactions don't retrigger) plus status-config changes, single
`useEffect` + `timerRef` + `clearTimeout`/`setTimeout`. Same idiom as
`useRequirementIndex.ts` (300ms) and `SourcePane.tsx`'s own resync (250ms) —
consistent rhythm across the codebase; a checker should match it, not invent
a fourth interval.

### 1.7 Async/lazy-load precedent — and what's absent

- **Lazy dynamic `import()`, cached, reload-via-meta**: `katexLoader.ts:6-15`
  and `MermaidView.tsx:8-13` — both cache the import promise, resolve once
  per session. This is the established pattern for "load something heavy
  once."
- **Cached fetch of a local static asset with fallback**:
  `requirementStatusService.ts:19-40` (`fetch("/config/requirement-statuses.json")`).
  Closest existing shape to "load a bundled dictionary from `public/`."
- **No `Worker`/`postMessage` anywhere in `src/`** — zero precedent for
  off-main-thread work.
- **No external network API precedent for content, anywhere.** Every
  persistence mechanism in this app is local: FSAA files, IndexedDB, static
  bundled JSON. This app has never sent document content over the network.
  That's a meaningful fact for §3.

### 1.8 Settings pattern

`uiStore.ts`'s `scrollSyncMode` (added in a prior design this session) is
the template: typed field + setter/toggle action + `partialize` entry if it
should survive reload. **There is no existing live, user-editable ignore-list
pattern** — `AcronymRuleConfig.ignored` (`types.ts:47-49`) is a *static*
array in `quality-rules.json`, read-only at runtime; nothing in the app lets
a user add a word to it. A checker's ignore-list would be the first feature
needing a genuinely live, user-editable list.

---

## 2. Architectural mismatches this design must resolve

1. **`ValidationIssue` has no text range.** It cannot drive inline squiggles
   as-is — a spelling/grammar issue needs `{from, to}` PM positions.
   Overloading `ValidationIssue` with optional range fields would force
   every existing consumer (`InsightsTab`, `OverviewTab`, the toast logic)
   to reason about a field they don't use. **Recommendation: a new,
   parallel issue type**, not an extension of `ValidationIssue` (§4.1).

2. **`InsightsTab`'s grouping dedupes per `targetId`.** Fine for "this
   requirement has a style violation" (one flag). Wrong for spelling, which
   routinely produces many distinct misspellings per requirement — piping
   them through `runAllValidations`/`InsightsTab` unmodified would silently
   drop all but the first hit per requirement. **Recommendation: if the
   Quality tab surfaces spelling/grammar at all, it's a *count* per
   requirement ("3 spelling issues"), not enumerable rows** — the inline
   editor squiggle is the primary UI for individual instances (§4.4).

3. **A `<textarea>` cannot decorate.** Any custom rule-based squiggle is
   rich-editor-only. Source mode gets, at best, native spellcheck (§7).

---

## 3. Strategy evaluation

**A. Native browser spellcheck only, changes nothing else.** Rejected as a
complete solution: no grammar at all; inconsistent between panes today;
zero ignore-list integration (every acronym/requirement-ID flagged
forever); browser-dependent behavior that can't be tested or made
consistent across Chrome/Safari/Firefox.

**B. Fully custom spelling *and* grammar engine, bundled dictionary.**
Rejected for the spelling half specifically: reinventing dictionary lookup
duplicates what the browser already does well, costs real bundle size
(English wordlists are typically hundreds of KB to 1MB+ compressed even
gzipped), and — worse — would **diverge from the user's own browser
dictionary** (their personal added words wouldn't apply to a bundled
checker, and vice versa), a confusing double-standard. Grammar is a
different story — no native browser grammar-check exists at all, so there's
nothing to defer to there.

**C. External API (LanguageTool-style service).** Most capable option for
both spelling and grammar, but: this app has **never sent content over the
network** (§1.7) — introducing one would be the first such dependency, a
real philosophy/privacy departure, not a small addition. Engineering
requirement documents are frequently proprietary or export-controlled;
silently phoning a third party with document text by default would be a
significant, unstated behavior change. **Recommendation: never default-on.
If offered at all, it's an explicit, off-by-default, clearly-disclosed
opt-in** (e.g. "bring your own LanguageTool endpoint") — a v2+ idea, not
scoped further here.

**D. Hybrid — recommended, spelling mechanism updated by §3a's concrete
library evaluation below:**
- **Spelling**: at the time this section was first drafted, the plan was to
  keep native browser spellcheck as the primary mechanism and work around
  its lack of a customization API via per-span `spellcheck="false"`. §3a's
  concrete library pass **supersedes that** — a bundled `retext-spell` +
  `nspell` + `dictionary-en` engine turns out to be small enough (150–300 KB
  gzipped, KaTeX's weight class) to justify replacing native spellcheck
  outright rather than working around it, because it *solves* the
  ignore-list problem instead of routing around it (`nspell.add()` is a
  real API; the browser has none). See §3a for the full reasoning — this
  bullet is kept only for the historical "why hybrid" framing.
- **Grammar**: build a small, bundled, **rule-based** (not ML/statistical)
  checker, lazy-loaded via the `katexLoader.ts` pattern, deliberately modest
  in scope for v1 (repeated words, basic punctuation/spacing issues,
  sentence-initial capitalization — the kind of checks that are cheap,
  high-precision, and low-noise). Never calls a network API by default.
  §3a confirms this over adopting Harper *for v1 specifically* — not a
  rejection of Harper, a sequencing call (§3a's "Revisit Harper" paragraph).
- Both surface as **new inline decorations** in the rich editor (squiggle +
  click-to-see-suggestions), with an **optional, count-based** Quality-tab
  integration, never per-instance rows (per §2.2).
- Source mode: §7 no longer needs to choose "native spellcheck or nothing"
  — since spelling is now a bundled engine either way (previous bullet),
  the same engine can run against the raw textarea's content via the
  overlay-highlighting technique §7 already identified as necessary there,
  giving source mode real parity with the rich pane instead of depending on
  whichever native behavior a given browser happens to have. Still no
  custom *grammar* squiggles in source mode for v1 (per §2.3 — a
  `<textarea>` overlay is enough new work for spelling parity alone; layer
  grammar on later).

---

## 3a. Concrete library evaluation

§4.3 originally deferred "which engine" as an implementation-time decision.
This section resolves it, against real numbers — not web-search summaries.
Registry metadata came from `npm view`; the Harper size came from actually
downloading and inflating the published tarball (`npm pack harper.js`,
`tar -xzf`), not a bundler estimate, since Harper ships a WASM binary that
tools like Bundlephobia don't measure meaningfully.

| | **Harper** (`harper.js`) | **LanguageTool** (self-hosted) | **retext-spell** + `nspell` + `dictionary-en` | **write-good** |
|---|---|---|---|---|
| **(1) Browser compat** | Yes — WASM, ESM, any modern browser | N/A — it's a server; browser only makes HTTP calls to it | Yes — pure JS, ESM | Yes — pure JS |
| **(2) Offline, no external API** | Yes — fully local, privacy-first by design | **No, architecturally** — even "self-hosted" is a client-server split requiring a running Java process. This app has zero backend today (FSAA files + IndexedDB only — confirmed in the bundle-save design audit: "never sent content over the network"). Adding *any* server, local or not, breaks "open in a browser, it just works." | Yes — dictionary is a bundled/fetched static asset, all lookups client-side | Yes |
| **(3) Bundle size** | **~18.2 MB raw / ~8.2 MB gzipped** WASM binary (measured directly — both the "full" and "slim" builds are essentially the same size in v2.4.0, despite the name) | N/A in-browser; server install is hundreds of MB + a JVM | ~640 KB unpacked total (engine 66 KB + `dictionary-en` 575 KB) — realistically **~150–300 KB gzipped**, in KaTeX's weight class | 41.8 KB unpacked — negligible |
| **(4) TypeScript** | Yes — ships `.d.ts`, wrapper largely written in TS | N/A (REST API; only a thin client wrapper could be typed) | Yes — `retext-spell` ships types | No official types; would need to write or find community ones |
| **(5) Maintenance** | **Very active** — 11.1k★, 4,433 commits, latest release Jun 2026, recently adopted by **Automattic** (WordPress.com) — strong signal against abandonment | Very active, large mature project | Moderate — `retext-spell` last published Feb 2024, `nspell` Jun 2022, but the parent `unified` ecosystem (which this app already depends on via `remark`) is still active (`unified` 11.0.5, Jun 2024) | **Abandoned** — last published Jun 2022, no signs of ongoing maintenance |
| **(6) Licensing** | **Apache-2.0** — permissive + explicit patent grant | LGPL (core) — moot for a pure network dependency, but a real constraint if ever vendored/linked | MIT (+BSD for `dictionary-en`) — fully permissive | MIT |
| **(7) ProseMirror/TipTap integration** | No existing plugin for any web text editor (only VS Code/Neovim/Helix/Emacs/Zed/Obsidian, all via LSP or native plugin APIs) — needs a from-scratch adapter mapping `Lint` spans → PM positions, following `inlineMathDecorations.ts`'s established range→`Decoration.inline` pattern (§1.3) | The offset-bearing JSON response would map to PM positions easily *if* the server dependency weren't disqualifying on its own | Also needs an adapter (retext/nlcst AST → PM positions), similarly moderate effort — **but the ignore-list problem (§4.5) disappears entirely**: `nspell.add(word)` is a first-class API, so the app's own vocabulary is added directly into the dictionary instead of needing per-span `spellcheck="false"` DOM workarounds | Trivial — plain regex matches with string indices |
| **(8) Performance on large documents** | Likely the fastest *once loaded* — Rust/WASM, and the docs explicitly ship a `WorkerLinter` (recommended over `LocalLinter` "due to potential high LCP" on the main thread) — but **this app has zero Web Worker precedent today** (verified: no `Worker`/`postMessage` anywhere in `src/`), so adopting Harper means introducing worker infrastructure for the first time, not just a library | Reportedly the *opposite* — Harper's own project documentation cites LanguageTool as "memory-intensive, slow," which is part of its own stated reason for existing | Pure-JS Hunspell-style lookup — the same algorithm class real desktop spell-checkers use; fast enough for interactive per-keystroke-adjacent use at the debounce rhythm this app already runs (§1.6); not competitive with Rust/WASM on raw throughput, but spelling doesn't need that | Trivial/fast — small fixed regex set |
| **(9) Fit for technical requirements docs** | Real grammar checking would catch genuine sentence-construction errors, but like any general-purpose English checker it isn't tuned for acronyms/part-numbers/"shall"-statements — real false-positive risk, and the **API is explicitly marked early-access/unstable** by its own docs, a meaningful risk for a first dependency | Best-in-class open-source grammar accuracy, but disqualified on architecture (row 2), independent of quality | Spelling only, no grammar — but that's already this design's recommended v1 scope (§3.D): don't rebuild spelling, ship the ignore-list, keep grammar modest | **Significant overlap with rules this app already built and maintains itself** (`weakModal`, `ambiguousWords`, `vagueQuantifiers`, `escapeClauses` in `src/validation/rules/`) — adopting an abandoned library to duplicate working, actively-maintained in-house code isn't a good trade |

**Also considered, briefly**: `compromise` (actively maintained general NLP
toolkit — POS tagging, tokenization — `~135 KB` gzipped) is not a
spelling/grammar checker at all; it's a possible *building block* for
future custom grammar heuristics (e.g. detecting number disagreement via
part-of-speech tags) if the team ever wants to go past regex-based rules.
Not a v1 candidate since it doesn't check anything out of the box.

### Recommendation

**Spelling (v1): `retext-spell` + `nspell` + `dictionary-en`.** Concretely,
not Harper, for four compounding reasons: a **~25–30× smaller** download
(150–300 KB vs. 8.2 MB gzipped), it **eliminates** rather than works around
the ignore-list platform constraint from §4.5 (`nspell.add()` vs. per-span
`spellcheck="false"`), it's in the **same `unified`/`remark` family this
app's markdown pipeline already depends on** (architectural consistency,
not a new paradigm), and it needs **no new Worker infrastructure** for a
first release. This *replaces* native spellcheck as the mechanism (not just
supplements it), which also resolves §7's asymmetry directly: the same
engine now runs in both the rich editor (via decorations) and, in
principle, source mode (via the same overlay-highlighting technique
already flagged as necessary there) — one consistent implementation
instead of leaning on inconsistent per-browser native behavior.

**Grammar (v1): keep it custom and modest, as originally scoped in §4.2 —
not Harper, not LanguageTool.** LanguageTool is disqualified by its server
dependency, independent of its quality. Harper is genuinely the
best-in-class *offline* option technically (Apache-2.0, Automattic-backed,
Worker-first design that already anticipates browser use) — but its 8.2 MB
payload and the requirement to stand up this app's first-ever Worker
architecture are a lot to take on in the same release as the ignore-list
and decoration-plugin foundation. Ship the small, dependency-free,
synchronous rule set from §4.2 first (repeated words, capitalization,
spacing — genuinely useful, genuinely cheap, zero new architecture).

**Revisit Harper explicitly as a v2 "deep grammar check," not a rejection.**
Once the ignore-list + decoration-plugin infrastructure exists and has
proven itself with real usage, Harper is the natural upgrade path for
real grammatical analysis: lazy-loaded only on explicit user opt-in (never
on load), run in a Web Worker (first one in this codebase — a deliberate,
scoped architecture addition at that point, not an incidental one), with
its own loading-state UI given the multi-second first-load cost of an 8 MB
WASM module. This is the same "pay for the tool only when the user asks for
it" shape as `handleOpenFolder`'s optional heavier capability, not a new
philosophy.

---

## 4. Recommended design detail

### 4.1 New data model — parallel to `ValidationIssue`, not merged into it

```ts
// src/types/proseCheck.ts (new)
export type ProseIssueKind = "spelling" | "grammar";

export interface ProseIssue {
  id: string;
  kind: ProseIssueKind;
  from: number;           // absolute PM position
  to: number;
  ruleId: string;
  message: string;
  suggestions?: string[]; // e.g. ["the"] for "teh"
}
```

Kept separate from `ValidationIssue` deliberately (§2.1) — no existing
consumer needs to change, and the two systems can evolve independently.

### 4.2 Rule engine shape — familiar contract, different grain

`QualityRule.check(req: RequirementRef, config): ValidationIssue[]`
operates on a whole requirement with no position tracking. A prose rule
needs the opposite — text plus an offset so relative matches map back to
absolute document positions:

```ts
// src/proseCheck/types.ts (new)
export interface ProseRule {
  readonly id: string;
  readonly kind: ProseIssueKind;
  check(text: string, baseOffset: number): Omit<ProseIssue, "id" | "kind" | "ruleId">[];
}
```

`text`/`baseOffset` reuse the same `bodyText`-per-requirement extraction
already built for `useDocumentValidation` (`extractBodyText`,
`getNodeSectionRange`) — no new text-extraction machinery needed, just a
position (the requirement's starting PM offset) threaded through alongside
it, which the existing extraction doesn't currently carry but easily could.

Registry, mirroring `RULE_REGISTRY` exactly:

```ts
// src/proseCheck/registry.ts (new)
export const PROSE_RULE_REGISTRY: ProseRule[] = [
  repeatedWordRule, sentenceCapitalizationRule, doubleSpaceRule, /* … */
];
```

### 4.3 Grammar engine loading

Same shape as `katexLoader.ts`: if a bundled ruleset needs its own data file
(unlikely for a small v1 rule set — most of the above are pure regex/string
checks needing no dictionary at all) load it lazily via a cached dynamic
`import()`, dispatch a `reload` meta transaction on resolution, exactly like
`inlineMathDecorations.ts:140-152`. For the modest v1 scope in §3.D, this
may not even be necessary — plain synchronous rules, like the existing
`QualityRule`s, may suffice initially. Flag as an implementation-time
decision once the actual v1 ruleset is chosen, not a v0 blocker.

### 4.4 Decoration plugin

New `src/editor/plugins/proseCheckDecorations.ts`, modeled directly on
`inlineMathDecorations.ts`: 500ms-debounced (matching §1.6) recompute on doc
change, `Decoration.inline(from, to, { class: "spelling-error" |
"grammar-error" })` for the squiggle, `Decoration.widget` for a
click-triggered suggestion popover (accept suggestion / ignore this
instance / add word to ignore-list). New CSS in `src/styles/index.css`:

```css
.spelling-error { text-decoration: wavy underline; text-decoration-color: theme_red; }
.grammar-error   { text-decoration: wavy underline; text-decoration-color: theme_purple; }
```

Optional Quality-tab integration: a new `ValidationCategory`-style summary
row ("12 spelling issues, 3 grammar issues" — count only, per §2.2), sourced
from the same `ProseIssue[]`, not funneled through `runAllValidations`.

### 4.5 Ignore-list / domain-vocabulary suppression

**New persisted setting**, in `useConfigStore` (semantically fits better
than `uiStore` — it's document/domain vocabulary, like `requirementPattern`,
not view-mode state):

```ts
ignoredWords: string[];
addIgnoredWord(word: string): void;
removeIgnoredWord(word: string): void;
```

**Seeded from `AcronymRuleConfig.ignored`** so the two "language" systems
don't fight each other — an acronym already known-good to
`undefinedAcronymsRule` shouldn't also get flagged as a misspelling.

**Updated by §3a**: with `nspell` as the spelling engine (not native
browser spellcheck), this is no longer a DOM-attribute workaround — it's a
direct API call. On load (and whenever `ignoredWords` changes),
`nspell.add(word)` teaches the in-memory dictionary every ignored word, and
`nspell.remove(word)` undoes it. There's no `spellcheck="false"`
per-span decoration to build, no NodeView attribute trick, nothing
analogous to `rawHtmlInline`'s wrapper needed — the false-positive is
prevented at the dictionary level, before a `ProseIssue` would ever be
created for it. This is a strictly simpler mechanism than the one
originally proposed here (kept below, struck through in spirit, for the
record of why the simpler path won):

<details>
<summary>Original proposal, superseded — per-span spellcheck="false"</summary>

Before choosing `nspell`, the working assumption was that no browser API
exists to inject a custom wordlist into *native* spellcheck, so the only
lever would have been the `spellcheck` DOM attribute applied per-span (e.g.
wrapping a requirement ID in a decoration/NodeView setting
`spellcheck="false"`, similar in spirit to how `rawHtmlInline` renders a
`<span data-raw-html-inline>` wrapper per `CLAUDE.md`'s rawHtmlInline
invariant). That constraint is real for native spellcheck specifically —
it just no longer applies once the engine is a bundled dictionary the app
owns outright.

</details>

---

## 5. Files affected (once approved)

**New `package.json` dependencies** (per §3a): `retext-spell`, `nspell`,
`dictionary-en` — ~150–300 KB gzipped combined, lazy-loaded, never in the
main bundle. No dependency added for grammar in v1 (custom, dependency-free
rules per §4.2); Harper is explicitly deferred (§9 phase 6), not added now.

| File | Change |
|---|---|
| `src/editor/utils/spellLoader.ts` | **New** — `katexLoader.ts`-shaped cached lazy-loader for the `nspell` instance, wires `ignoredWords` via `nspell.add()`/`remove()` |
| `src/types/proseCheck.ts` | **New** — `ProseIssue` type |
| `src/proseCheck/types.ts` | **New** — `ProseRule` contract (grammar rules) |
| `src/proseCheck/registry.ts` | **New** — `PROSE_RULE_REGISTRY` |
| `src/proseCheck/rules/*.ts` | **New** — individual grammar rule implementations |
| `src/editor/plugins/proseCheckDecorations.ts` | **New** — squiggle decoration plugin, covers both spelling (via `spellLoader.ts`) and grammar (via `PROSE_RULE_REGISTRY`) |
| `src/editor/utils/useProseCheck.ts` | **New** — 500ms-debounced hook, mirrors `useDocumentValidation.ts` |
| `src/stores/configStore.ts` | Add `ignoredWords` + actions |
| `src/editor/SourcePane.tsx` | Phase 4 (§9): overlay-highlighting for source-mode spelling parity; the pre-existing `spellCheck={false}` stays as-is (native spellcheck is no longer the mechanism at all, so this attribute becomes moot rather than something to flip) |
| `src/styles/index.css` | New `.spelling-error`/`.grammar-error` classes |
| `src/layout/tabs/InsightsTab.tsx` | Optional: count-based summary row |

No changes to `src/validation/*`, `src/types/validation.ts`, review
persistence, traceability, or the bundle save pipeline.

---

## 6. Bundle-save integration — recommend NOT a companion artifact

Should the ignore-list be a `COMPANION_REGISTRY` sidecar (e.g.
`<stem>.dictionary.json`)? **Recommend no.** A personal ignore-list is
conceptually a user-level preference (like an actual browser dictionary
addition), not per-document data — it should apply across every document a
user opens, not reset per file. A persisted Zustand store (global,
`localStorage`) matches that model directly; folding it into the
per-document bundle save pipeline would be solving a problem it doesn't
have (§0's "reuse the registry" principle from the bundle-save design cuts
the other way here — this data genuinely isn't document-scoped, so it
shouldn't borrow that pipeline just because a pipeline exists). A
per-document/shared-team-vocabulary ignore-list is a defensible v2 idea, but
starting global-only is the simpler, correct default.

---

## 7. The `SourcePane` spellcheck asymmetry — largely resolved by §3a, one caveat remains

`SourcePane.tsx:148`'s `spellCheck={false}` has **no comment explaining
it** — I won't assert a historical reason I can't verify. My working
hypothesis, stated as a hypothesis: raw markdown syntax (`**bold**`, `#
heading`, `` `code` ``, bare URLs) would produce a lot of spurious red
squiggles on structural punctuation/tokens that don't exist in the rendered
rich view (where TipTap has already converted that syntax into real
formatting).

**With native spellcheck, this was a hard "all-or-nothing" limitation** — a
`<textarea>` has no way to selectively suppress the browser's own
spellcheck on substrings, so scoping it away from markdown syntax the way
the rich editor can (`spellcheck="false"` on inline-code/URL marks
specifically) wasn't possible there. **With `nspell` as the engine (§3a),
this constraint disappears too**: the overlay-highlighting mechanism §1.5
already identified as necessary for source-mode decorations is *our own*
code, computing its own ranges over the raw markdown text — it can simply
skip fenced/inline code spans, URLs, and markdown syntax tokens when
building highlight ranges (the same kind of exclusion `undefinedAcronymsRule`
and friends already apply via `extractBodyText`), the same way the rich
editor's decoration plugin would. The remaining open question is genuinely
just implementation cost (building and testing the overlay), not a platform
wall.

**Recommendation**: build the overlay for source-mode parity (§3.D), but
sequence it *after* the rich-editor decoration plugin ships and is
validated (§9) — it's meaningfully more UI work (mirroring a `<textarea>`'s
exact text layout/scroll position in an overlay `<div>` is fiddly to get
pixel-perfect) for a pane that, in split view, always has the rich pane
sitting right next to it already showing spelling state.

---

## 8. Regression risks

- **Decoration collision**: the new plugin must coexist visually with
  `traceabilityBadgePlugin`, `reviewCommentBadgePlugin`, and
  `requirementStatusPlugin` — all of which already decorate near requirement
  headings. Needs a manual check for visual/z-index clashes, not just a
  unit test.
- **False positives on domain vocabulary are the primary trust risk.** Part
  numbers, acronyms, and unit abbreviations are everywhere in engineering
  requirements. If the ignore-list (§4.5) doesn't ship in the *same*
  release as the checker, the feature will feel broken on first use and
  likely get disabled by users immediately — sequencing matters (§9).
- **Debounce recompute cost at scale**: existing validation rules are cheap
  regex scans; a real grammar ruleset could be meaningfully more expensive
  per keystroke-adjacent recompute on very large documents. The 500ms
  debounce absorbs typical cases; flag as a v2 concern (incremental,
  changed-requirement-only recomputation) rather than a v1 blocker, since
  typical document sizes here are modest (per `CLAUDE.md`'s fidelity-first,
  single-document editing model).
- **`InsightsTab` must not silently mis-render** if `ProseIssue`s are ever
  accidentally pushed through the `ValidationIssue` path instead of their
  own — keeping the types genuinely separate (§2.1) is what prevents this,
  not a runtime guard.

---

## 9. Implementation phases

Updated per §3a's concrete library choice (`retext-spell`/`nspell`/
`dictionary-en` for spelling, a small bundled custom rule set for grammar,
Harper deferred to v2 opt-in):

1. **Ignore-list infrastructure alone** — `configStore` field + actions,
   seeded from `AcronymRuleConfig.ignored`. No checker wired in yet, so
   there's nothing for it to feed — foundational, independently testable,
   unblocks nothing risky.
2. **Spelling engine** — `retext-spell`/`nspell`/`dictionary-en` behind the
   `katexLoader.ts` lazy-load pattern (§1.7), `nspell.add()` wired to the
   ignore-list from phase 1, decoration plugin in the rich editor only
   (`Decoration.inline` squiggle, modeled on `inlineMathDecorations.ts`,
   §1.3). This is now the *first* user-visible piece, not grammar — it's
   the smaller, lower-risk half of §3a's recommendation, and ships with the
   ignore-list already live so there's no false-positive-heavy first
   impression (§8).
3. **Grammar rule engine** — pure functions (`ProseRule[]`), unit-tested
   exactly like existing validation rules, reusing the same decoration
   plugin/pipeline phase 2 already built (extend it, don't duplicate it).
4. **Source-mode spelling parity** — the overlay-highlighting mechanism for
   `SourcePane`'s raw markdown textarea (§7), reusing the same `nspell`
   instance and ignore-list. Sequenced after the rich pane is proven, per
   §7's recommendation, since it's meaningfully more UI work than the
   engine integration itself.
5. **Optional Quality-tab count summary** — least essential, trickiest fit
   with `InsightsTab`'s existing per-`targetId` dedup model (§2.2).
6. **v2**: Harper as an explicit, off-by-default, worker-based "deep
   grammar check" opt-in (§3a) — deliberately deferred until phases 1–5
   have shipped and the lighter-weight foundation has proven itself. Fully
   architected (provider layer, lazy-load/loading UX, worker/message flow,
   incremental-analysis performance strategy, diagnostics shape, ignore
   mechanism, settings UX, extensibility) in
   `docs/harper-integration-architecture.md` — audit confirms Harper is
   *still* the right engine for this phase, with higher confidence than
   this section originally had (see that doc's closing verdict).

## Open questions for you

1. **External API (§3.C)** — confirm out of scope for v1, opt-in-only if
   ever added at all? (Unchanged by §3a — still recommended out of scope.)
2. **Global vs. per-document ignore-list (§6)** — confirm global-first?
   (Unchanged by §3a.)
3. ~~**Source-mode spellcheck (§7)**~~ — resolved by §3a/§7's update: no
   longer a native-spellcheck-or-nothing decision. Confirm the *sequencing*
   instead — phase 4 (source-mode overlay) after phase 2 (rich-pane
   spelling) ships and is validated, rather than building both panes at once?
4. **New, from §3a: Harper as a v2 opt-in (§9 phase 6)** — confirm this
   sequencing (ship the lightweight custom grammar rules first, offer
   Harper later as an explicit power-user upgrade) rather than reaching for
   Harper's stronger grammar accuracy from the start despite its size/Worker
   cost?
