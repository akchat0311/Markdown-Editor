# Harper Integration Architecture — Deep-Dive Audit

Status: **Draft for review** · Extends `docs/grammar-spellcheck-design.md`
§3a/§9 (Harper deferred to v2, opt-in). This document architects that v2
phase in detail, per your request. Still no implementation.

Confirmed starting premises from your brief, matching where the prior
design doc already landed: native browser spellcheck stays as the spelling
solution (§3a of the prior doc), the existing requirement-writing quality
rules stay untouched, and grammar checking is the one real gap. This
document is scoped entirely to architecting Harper as the engine for that
gap — not re-litigating spelling.

**See also**:
- `docs/harper-privacy-security-assessment.md` — a dedicated source-level
  audit (not documentation-only) of Harper's network/telemetry behavior,
  specifically verifying it's safe for this editor's confidential-document,
  offline, local-first use case. That document confirms zero network-
  capable code exists anywhere in `harper.js`/`harper-wasm`/`harper-core`,
  resolves the "Integrations" (`AddIntegration`/etc.) ambiguity this
  document's §0 could only see via docs summaries (they belong to the
  separate desktop app, not `harper.js`), and informs one addition to the
  Risks list below (§ Risks).
- `docs/harper-benchmark-results.md` — an 80-sentence benchmark actually
  run against `harper.js` locally (not the web demo), reporting real
  detection/miss/false-positive rates rather than architectural reasoning.
  Confirms the false-positive risk this document's §6/§8 anticipated
  (domain vocabulary), but finds it's **broader than planned** — it also
  hits the `Formatting`/`WordChoice` lint categories, not just `Spelling`
  — and finds Harper structurally misses ~60% of common formal-writing
  grammar issues (comma splices, dangling modifiers, complex-subject
  agreement) regardless of rule configuration, not because they're
  disabled. Read that document's "Implications for the integration design"
  section before finalizing §6's ignore-list scope.

---

## 0. New facts gathered for this audit

Beyond what the prior doc verified (Apache-2.0, ~18.2 MB raw / ~8.2 MB
gzipped WASM, 11.1k★, Automattic-backed, early-access API), this audit
pulled the actual `Lint`/`Linter`/`WorkerLinter` API surface and one
real-world integration precedent:

- **`WorkerLinter` manages its own Web Worker internally.** It "spins up a
  dedicated web worker to do processing on a separate thread" — the app
  does not need to author a worker file or a `postMessage` protocol by
  hand. This changes the earlier design doc's risk framing (§ Risks below).
- **`Lint` objects are WASM-backed and require manual disposal** —
  `.free()` and `[Symbol.dispose]()` are present on the class. This is a
  real, new category of cleanup discipline for this codebase.
- **Harper ships a rich control API already**: `setLintConfig`/
  `getLintConfig` (per-rule enable/disable/reset), `ignoreLint`,
  `importWords`/`clearWords` (a built-in custom dictionary, separate from
  browser spellcheck and separate from any spelling engine), `getDialect`/
  `setDialect`, `applySuggestion(text, lint, suggestion)`.
- **A real production integration exists**: `MarkEdit-proofreading`
  (a markdown editor's Harper integration) documents a 24 MB packaged size
  ("large because it runs completely locally" — their words), a default
  `autoLintDelay` of **1000ms**, and three tiered rule presets (strict/
  standard/relaxed, progressively disabling Enhancement/Style/WordChoice,
  then Readability/Redundancy/Repetition categories) — real-world
  validation that this exact integration shape (WASM engine + text editor +
  configurable debounce + tiered aggression) ships in production, not just
  documentation claims.

---

## 1. Integration architecture — where does Harper live?

Not a single answer — four layers, each answering a different part of your
question:

```
Settings toggle (§8)
      │  enables/disables
      ▼
GrammarProvider interface  ← the "future extensibility" layer (§9)
      │  Harper is ONE implementation
      ▼
harperProvider.ts (new)  ← the "service" layer
      │  owns lazy-load, WorkerLinter lifecycle, .free() discipline
      ▼
harper.js's WorkerLinter  ← the worker itself; Harper manages this internally
      │  async lint(text) → Lint[]
      ▼
grammarCheckDecorations.ts (new plugin)  ← maps GrammarIssue[] → Decoration.inline
      │  same buildDecorations/apply idiom as inlineMathDecorations.ts
      ▼
ProseMirror DecorationSet (squiggles)
```

- **Provider layer** (new, thin): a `GrammarProvider` interface —
  `{ id, isAvailable(), load(), lint(text): Promise<GrammarIssue[]>, ignore(...), dispose() }`.
  This is the actual answer to §9 — the decoration plugin, the settings
  toggle, and any future Quality-tab integration all talk to this
  interface, never to `harper.js` directly. Same instinct as this
  session's `CompanionArtifact`/`COMPANION_REGISTRY` and `ProseRule`/
  `PROSE_RULE_REGISTRY` — define the contract, let one concrete backend
  satisfy it today.
- **Service**: `src/grammarCheck/harperProvider.ts` — owns the
  `WorkerLinter` instance, the cached lazy-load promise (§2), and the
  WASM-memory disposal discipline `Lint` objects require (§0) that no
  other integration in this app has needed before.
- **Worker**: already handled *by Harper itself* (§0) — the app calls
  `new WorkerLinter(...)`, `await linter.setup()`,
  `await linter.lint(text)`; harper.js does the `postMessage` plumbing.
  This is meaningfully simpler than a hand-rolled worker protocol would
  have been.
- **Plugin**: a new `grammarCheckDecorations.ts`, modeled directly on
  `inlineMathDecorations.ts` (`src/editor/plugins/`) — same
  `buildDecorations(state) → DecorationSet` / `apply(tr, old, ...)` shape.

**Communication with ProseMirror decorations — the one real wrinkle**:
`linter.lint(text)` is `Promise`-based (it crosses a worker boundary); PM
plugin `state.apply()` must be synchronous. This is the *exact* problem
`inlineMathDecorations.ts` already solves for KaTeX: kick off the async
call, and when it resolves, dispatch `tr.setMeta(key, { reload: true,
issues })` to trigger a synchronous decoration rebuild using the
now-ready results (`inlineMathDecorations.ts:140-152`'s pattern, reused
verbatim in shape, different payload).

---

## 2. Lazy loading

- **Download only when enabled**: yes, straightforwardly, by never
  `import`ing `harper.js` at module top-level anywhere in the app's static
  import graph — only inside `harperProvider.ts`'s `load()` function,
  called exclusively from the settings toggle's enable handler (§8). Same
  shape as `katexLoader.ts`'s `ensureKatex()`, just triggered by an
  explicit user action instead of "first math node encountered."
- **Init on first use, not editor startup**: yes — `WorkerLinter.setup()`
  is an explicit async lifecycle call; nothing in Harper's design requires
  constructing it at editor-mount time. `load()` should cache the setup
  promise (resolve once, reuse — identical caching shape to
  `katexLoader.ts`) and only ever be called from the enable path.
- **Expected UX while loading — genuinely different from KaTeX/Mermaid**:
  8.2 MB gzipped (and MarkEdit's real-world 24 MB packaged figure) is not
  a sub-second, invisible load like KaTeX's ~200–300 KB. This needs an
  explicit "Enabling…" loading state on the toggle itself (§8) — silently
  fetching 8 MB in the background with no UI feedback would read as a
  hang, not a feature. A failure path (offline, asset 404, CDN hiccup)
  needs a toast, matching this app's existing `useToastStore` convention
  used throughout the bundle-save and review/traceability flows.
- **Cross-session caching**: standard browser HTTP caching (correct
  `Cache-Control` headers on the served WASM asset) gives "loaded once per
  browser profile, near-instant on repeat" for free — no custom Service
  Worker needed. This is a deployment/hosting concern for whoever serves
  the built app, not an integration-code concern; flagging it so it isn't
  missed at build-config time.

---

## 3. Worker architecture

- **Should analysis run in a Worker?** Unambiguously yes. An 8 MB WASM
  engine doing real linguistic analysis is exactly the CPU-heavy,
  don't-block-the-main-thread case Workers exist for, and harper.js's own
  docs explicitly steer integrators toward `WorkerLinter` over
  `LocalLinter` for "interactive web applications."
- **What messages flow**: since `WorkerLinter` owns its own worker
  internally, the app never touches raw `postMessage` — the "message
  flow" the app needs to design is at the React/plugin level, not the
  wire level:
  1. Doc content changes → debounce timer (below) fires.
  2. `provider.lint(changedText)` called (async).
  3. On resolve: dispatch `tr.setMeta(grammarCheckKey, { reload: true, issues })`.
  4. Plugin `apply()` sees the meta, rebuilds `DecorationSet` synchronously.

  The library-level API vocabulary available for this (confirmed from the
  docs) is `setup`, `lint`, `setLintConfig`, `getLintConfig`, `ignoreLint`,
  `importWords`, `clearWords`, `applySuggestion`, `dispose` — everything
  the provider layer needs is already a named method, not something to
  invent a protocol for.
- **Throttling**: reuse the app's existing `timerRef` +
  `clearTimeout`/`setTimeout` debounce idiom (`useDocumentValidation.ts`,
  `useRequirementIndex.ts`, `SourcePane.tsx`'s own resync all share this
  shape) — but at a **longer interval than the existing 500ms
  convention**. MarkEdit's real-world default is 1000ms for exactly this
  engine; recommend matching that (or going a bit longer), as a
  *separate* debounce from the existing 500ms validation one, since the
  two have genuinely different cost profiles and shouldn't be coupled.
- **Stale-result guard, not optional**: if the user keeps typing and a
  new debounce fires before the previous `lint()` call resolves, the
  earlier result must be discarded when it eventually arrives — a
  monotonic request-generation counter (increment on each new `lint()`
  call, ignore any resolution whose generation doesn't match the latest)
  is the standard fix for this class of async race. Nothing in this
  codebase currently needs this pattern (existing debounced work —
  `useDocumentValidation`, `useRequirementIndex` — is synchronous once the
  timer fires), so it's new discipline, not a reused pattern.

---

## 4. Performance

**Honest baseline**: no published Harper benchmarks were found during this
audit verifying throughput at specific document sizes — the numbers below
are reasoned from what's architecturally knowable (Rust/WASM rule-based
engines scale with text length, not requirement count directly), not
measured. Recommend an actual measurement spike (open a synthetic
500-requirement document, measure real `lint()` wall-clock time) before
locking in a specific debounce interval or incremental-analysis threshold —
flagged as a concrete pre-implementation task, not guessed further here.

| Scale | Expected cost | Notes |
|---|---|---|
| 10 requirements | Negligible per-run cost | Dominated by the one-time WASM load/init (already paid at enable-time, §2), not by analysis itself |
| 500 requirements | **This is where "whole doc vs. changed-only" (your question) stops being optional** | If per-run cost scales with total document character count and 500 requirements produce a genuinely large document, a full-document relint on every debounce tick risks visible interaction lag |
| 5000 requirements | Likely infeasible to whole-document-relint per tick even with a fast native engine | Also worth confirming as a scoping question: is a 5000-requirement *single* markdown document a realistic scenario for this app's architecture today (single-PM-doc, single-file FSAA model)? Independent of the Harper decision |

**Recommendation: analyze only changed requirements, not the whole
document, on every tick.** This reuses infrastructure that already
exists rather than inventing new extraction machinery:

- `useDocumentValidation.ts` already builds one `bodyText` string per
  requirement (`RequirementRef.bodyText`) on every debounce pass.
- Track a "dirty set": compare each requirement's `bodyText` to the
  version cached from the *previous* successful lint pass — a cheap
  string comparison, not a real diff — and call `provider.lint()` only for
  requirements whose text actually changed.
- Merge with cached results for unchanged requirements, whose PM
  positions get remapped via `tr.mapping` — the same fallback path
  `inlineMathDecorations.ts:130` already uses (`old.map(tr.mapping,
  tr.doc)`) when nothing relevant changed.

This turns per-tick cost from **O(document size)** into **O(size of what
changed since the last pass)** — a materially different scaling story,
achieved by adding a diff layer on top of extraction the codebase already
performs, not by building new text-extraction infrastructure.

A full-document pass should still run at coarser moments (document load,
tab switch) to catch anything the incremental path might miss, not on
every keystroke-adjacent tick.

---

## 5. Diagnostics

**New `GrammarIssue` type — now precisely specified**, since Harper's
actual `Lint` API is known (not the more speculative `ProseIssue` sketch
in the prior design doc):

```ts
interface GrammarIssue {
  id: string;        // derived from span + lintKind — stable across re-lints of unchanged text
  from: number;       // PM position: lint.span() offset + the requirement's baseOffset
  to: number;
  message: string;    // lint.message()
  lintKind: string;   // lint.lint_kind() — Harper's own category taxonomy
  suggestions: string[]; // lint.suggestions()
}
```

**Not funneled through `ValidationIssue`/`runAllValidations`/
`InsightsTab`** — same reasoning as the prior design's §2.2, now doubly
confirmed: Harper issues are per-instance, word/phrase-level; `InsightsTab`
dedupes by `targetId`, which would silently collapse all but one grammar
issue per requirement.

- **Optional Quality-tab integration**: a count-only summary row per
  requirement ("REQ_042: 3 grammar issues"), grouped from `GrammarIssue[]`
  purely for the count — never enumerable per-instance rows there (per the
  prior doc's §4.4). Clicking navigates to the requirement, same as other
  Quality rows; the inline squiggles remain the real per-instance UI.
- **Inline squiggles**: `Decoration.inline(from, to, { class:
  "grammar-error" })`, the wavy-underline CSS already scoped in the prior
  design (§4.4).
- **Hover/click suggestions**: model directly on
  `inlineMathDecorations.ts`'s click-to-interact widget — hover or click
  the squiggle → popover showing `message()` + `suggestions()` → clicking
  a suggestion calls `linter.applySuggestion(text, lint, suggestion)`,
  dispatches a PM transaction replacing `[from, to]` with the result, and
  **disposes the `Lint` object** (`.free()` / `[Symbol.dispose]()`) — new
  cleanup discipline this codebase hasn't needed before (§ Risks).

---

## 6. Ignore mechanism

**Global, not per-document** — same reasoning as the prior design's §6 for
the spelling ignore-list (a personal dictionary is a user-level
preference, not document data).

**But Harper's ignore surface has a different shape than a flat word
list**, and needs its own store(s), not reuse of a spelling ignore-list:

- **Word-level** (e.g. "don't flag `REQ_001` as a typo") — spelling's
  domain, feeds `nspell.add()` per the prior design. Not Harper's concern.
- **Rule-category-level** (e.g. "disable the Repetition rule entirely") —
  `setLintConfig()`, a whole-category on/off/default switch. Recommend a
  `ignoredGrammarRules: Record<lintKind, boolean>` store, mirroring
  MarkEdit's tiered-preset pattern (§0).
- **Instance-level** (e.g. "don't flag passive voice in *this* sentence,
  but still flag it elsewhere") — `ignoreLint(lint)`, a one-off dismissal
  keyed by the specific `Lint`. Needs its own smaller
  `ignoredGrammarInstances: string[]` (keyed by the `GrammarIssue.id`
  shape above).

Recommend designing these three as related-but-distinct stores from the
start, rather than conflating them into one flat "ignored words" list —
retrofitting the distinction later, after a UI has shipped around a single
flat list, would be a harder migration than building the (small) extra
structure now.

**Coexistence with browser spellcheck**: since the prior design already
has spelling handled by a bundled `nspell` engine (replacing native
spellcheck, not supplementing it — §3a of that doc) rather than the
browser's native spellcheck, there's no browser-vs-Harper conflict to
resolve directly. There *is* a real configuration detail, though: Harper is
a general-purpose grammar checker and its own rule set includes some
spelling-adjacent checks. Those need to be **explicitly disabled via
`setLintConfig()`** so Harper and the spelling engine don't produce two
different, possibly-conflicting squiggles (and two different suggestion
lists) for the same word. This is a concrete configuration task, not an
abstract "they'll coexist fine."

**Updated by the benchmark (`docs/harper-benchmark-results.md`)**:
disabling `Spelling`-kind rules is necessary but not sufficient. The
benchmark found domain-vocabulary false positives (requirement IDs,
acronyms, units) also land in the `Formatting` (en-dash-in-number-range,
misfiring on a standard's version number) and `WordChoice` (unit
abbreviations like "500ms") categories. The ignore-list/suppression work
needs to account for all three `LintKind`s that misfired in that run, not
just `Spelling` — confirmed with concrete failing examples, not
anticipated risk.

---

## 7. Bundle size — confirming true lazy-load

Confirmed, with one caveat to watch at implementation time. As long as
`harper.js`'s dynamic `import()` (and the WASM fetch it triggers) only
happens inside the code path gated by the settings toggle being on — never
imported at module top-level anywhere reachable from the app's initial
bundle graph — a user who never enables grammar-check downloads zero extra
bytes. This is standard, already-proven Vite behavior in this exact
codebase: `katexLoader.ts` and `MermaidView.tsx` already demonstrate
dynamic-`import()`-based code-splitting working correctly for KaTeX/
Mermaid today.

**The one real footgun**: a stray *value* import of `harper.js` anywhere
outside the lazy-loaded module (not a `import type`, which TS normally
elides) would silently pull the whole 8 MB into the main bundle graph.
Recommend a bundle-analysis check (`vite-bundle-visualizer` or equivalent)
at implementation time to *empirically confirm* zero-cost-when-disabled,
rather than trusting code review alone to catch it.

---

## 8. Settings UX

**Recommend a single "Enable Grammar Checking" toggle** — not a separate
"load Harper" action distinct from "enable the feature." From the user's
perspective, loading *is* enabling; a two-step "load, then enable" flow
would just be confusing.

- **Loading state is not optional here**, unlike this session's
  `scrollSyncMode`/Sync Scroll toggle (which flips instantly, zero load
  cost). This toggle needs a visible "Enabling…" state (spinner/dimmed)
  between click and ready, given §2's multi-second-on-first-load reality.
  Don't reuse the Sync Scroll toggle's instant-flip interaction pattern
  wholesale — the loading state is a real, necessary difference.
- **Persist the preference** (same `partialize` pattern as
  `scrollSyncMode`) so the user isn't re-enabling every session.
- **On a returning session where it was previously enabled**: recommend a
  silent, non-blocking background reload (matching how other persisted
  preferences in this app just "stay on" without re-prompting) rather than
  requiring the user to re-click — the "Enabling…" loading affordance
  mainly matters for the cold-start/first-ever-enable case, since repeat
  loads should be fast via browser HTTP caching (§2). If the background
  reload fails (offline, cache evicted), surface that via toast rather
  than silently leaving grammar-check dark.
- **Location**: I haven't audited a general app-wide "settings/
  preferences" surface this session — everything I've seen (Sync Scroll,
  Split view) lives as a StatusBar toggle. If that's the established
  convention for editor-behavior toggles, this fits there directly;
  confirm before assuming, since a heavier, load-bearing toggle like this
  might warrant a more discoverable home than the StatusBar's compact
  pill row.
- **Tiered aggression** (MarkEdit's strict/standard/relaxed presets, §0)
  is a reasonable stretch/v2.1 idea once the basic on/off ships and
  there's real usage signal about false-positive rates — not required for
  an initial toggle.

---

## 9. Future extensibility

Yes — this is the actual purpose of the `GrammarProvider` interface in
§1, not an afterthought bolted on. A future alternative engine (Harper
development stalling, a domain-specific engine, or — per the prior
design's §3.C — an eventual opt-in external API) implements the same
`{ isAvailable, load, lint, ignore, dispose }` contract. The decoration
plugin, the settings toggle, and any Quality-tab integration all talk to
`GrammarProvider`, never to `harper.js` directly — swapping or adding a
provider is a registration change, not an editor-UI change. Same
architectural instinct this app has already applied twice this session
(`COMPANION_REGISTRY`, `PROSE_RULE_REGISTRY`).

**One design detail worth getting right now, cheaply, rather than later
at higher cost**: `GrammarIssue.lintKind` as sketched in §5 is currently
"whatever string Harper calls its own categories" — a genuinely
provider-agnostic design should translate that into a small, normalized
taxonomy (e.g. `"repetition" | "punctuation" | "capitalization" |
"other"`) at the provider-adapter boundary, so Harper's specific category
names never leak into the UI/settings-config layer directly. Cheap to do
now with one provider; a real migration if a second provider shows up
after the UI has already keyed off Harper's raw category strings.

---

## Deliverables

### Recommended architecture

Layered: a `GrammarProvider` interface (extensibility) → a
`harperProvider.ts` service (lazy-load + WASM lifecycle + dispose
discipline) → Harper's own `WorkerLinter` (worker, managed by the library
itself, no hand-rolled protocol needed) → a `grammarCheckDecorations.ts`
plugin modeled on `inlineMathDecorations.ts` (async-load-then-sync-reload
pattern) → inline squiggle decorations, with an incremental
(changed-requirements-only) analysis strategy layered on the extraction
machinery `useDocumentValidation.ts` already has.

### Files likely to change (once approved — still no code now)

| File | Change |
|---|---|
| `src/grammarCheck/grammarProvider.ts` | **New** — the provider interface (§1, §9) |
| `src/grammarCheck/harperProvider.ts` | **New** — Harper-specific implementation: lazy `WorkerLinter` load, `.free()` discipline, `setLintConfig` for disabling Harper's own spelling-adjacent rules |
| `src/types/grammarIssue.ts` | **New** — `GrammarIssue` type (§5) |
| `src/editor/plugins/grammarCheckDecorations.ts` | **New** — squiggle decoration plugin (§1, §5) |
| `src/editor/utils/useGrammarCheck.ts` | **New** — debounced (≥1000ms), incremental (changed-requirements-only, §4), generation-guarded (§3) hook |
| `src/stores/configStore.ts` | Add `grammarCheckEnabled`, `ignoredGrammarRules`, `ignoredGrammarInstances` (§6, §8) |
| `src/styles/index.css` | `.grammar-error` wavy-underline class (already scoped in the prior design doc) |
| `src/layout/StatusBar.tsx` (or wherever settings ultimately live, §8) | New toggle with loading state |
| `src/layout/tabs/InsightsTab.tsx` | Optional: count-based summary row (§5) |

No changes to `src/validation/*`, review/traceability persistence, or the
bundle save pipeline — same isolation the prior design doc established.

### Risks

- **WASM memory management** (`.free()`/dispose discipline on every
  `Lint`) — a genuinely new bug-surface category for this codebase; no
  existing integration (KaTeX renders to a string, holds no persistent
  WASM handles) has needed this discipline before.
- **WASM asset sourcing** — per the privacy assessment, `harper.js` lets
  the integrator choose where the `.wasm` binary is served from
  (`createBinaryModuleFromUrl(url)`, no hardcoded remote default). Use the
  inlined build or self-host the asset; don't point it at
  `writewithharper.com` or an npm CDN, to keep the load same-origin.
- **Async-vs-synchronous PM decoration state** — the same shape as KaTeX's
  existing solved problem, but must not skip the generation-counter guard
  (§3) or stale results can render out of order.
- **Bundle-graph leakage** — a single stray non-type import could silently
  add 8 MB to everyone's initial load; needs empirical verification
  (bundle analysis), not just code review, before shipping.
- **Dual/triple ignore-list complexity** (§6) if word-level,
  rule-category-level, and instance-level ignores aren't designed as
  distinct stores from the start.
- **Cross-engine duplicate opinions** — Harper's built-in spelling-adjacent
  rules must be explicitly turned off via `setLintConfig()`, or users see
  two different squiggles/suggestions for the same word from two engines.
- **Early-access API instability** (carried over from the prior doc,
  still true) — `harper.js`'s own docs state the API isn't yet stable;
  needs a version pin and changelog-watch discipline, not a "set and
  forget" dependency.
- **Unverified performance at real scale** (§4) — no benchmark data found;
  recommend a measurement spike before committing to specific thresholds.

### Performance implications

Negligible at small scale (cost dominated by one-time load, already paid
at opt-in time). Becomes architecturally significant around several
hundred requirements if analysis is naive whole-document-per-tick — solved
by incremental (changed-only) analysis reusing existing `bodyText`
extraction, not by a fundamentally different approach. Debounce should be
≥1000ms (matching real-world precedent), separate from the existing 500ms
validation debounce rather than sharing it, since the two have different
cost profiles.

### Is Harper still the recommendation after this audit?

**Yes — and more confidently than the prior design doc's §3a**, for
reasons this deeper audit specifically surfaced:

1. `WorkerLinter` manages its own worker internally — the "first
   hand-rolled Worker in this codebase" risk from §3a overstated the
   lift; it's closer to "first *library-managed* worker," a meaningfully
   smaller integration cost.
2. Harper's control API (`setLintConfig`, `ignoreLint`, `importWords`,
   `applySuggestion`) already answers most of "how would we even control
   this" — the app isn't building that from scratch, just wiring to it.
3. A real shipping product (MarkEdit) has already proven this exact shape
   — WASM grammar engine + editor + configurable debounce + tiered
   presets — works in production, not just in documentation.
4. The 8.2 MB size concern is real and unchanged, but is now precisely
   scoped to a one-time, explicitly-opted-into cost, not an ongoing tax —
   confirmed lazy-loadable with the same proven mechanism this codebase
   already uses for KaTeX/Mermaid.

This doesn't change the *sequencing* from the prior design (still v2,
still gated behind the lighter ignore-list + spelling + custom-rule
foundation shipping first, per that doc's §9) — the reasons for that
sequencing (ship something low-risk and prove the pattern before taking on
an 8 MB dependency and a new Worker-adjacent architecture) still hold. What
changes is confidence in Harper *specifically* being the right engine to
build toward, versus treating it as one option among several to revisit
later.
