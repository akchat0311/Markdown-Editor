# Test Case Traceability v1 — Design Specification

Status: **Draft for review** · Intended as the implementation contract once approved.

This document specifies v1 of test-case traceability for the requirements
editor. It is grounded in the existing codebase: the review-comment sidecar
system (`*.review.json`), the requirement index
(`buildRequirementIndex` in `src/editor/utils/requirementOps.ts`), the ID
rename-migration plugin (`src/editor/plugins/requirementIdMigrationPlugin.ts`),
and the CSV export pipeline (`src/services/reviewExportService.ts`).

---

## 0. Decision audit — where the proposal was changed and why

Two of the proposed decisions were revised after auditing them against the
existing architecture. Everything else is adopted as proposed.

### 0.1 ❌ Fixed filename `test-traceability.json` → ✅ per-document sidecar `<stem>.trace.json`

The proposed single fixed filename is the weakest decision in the brief, for
four concrete reasons:

1. **The app is multi-document.** `tabStore` holds N open tabs, each with its
   own `fileHandle` and `reviewHandle`. A single fixed filename gives no rule
   for which document's requirements a `test-traceability.json` belongs to.
   Two markdown files in the same folder would silently share (and corrupt)
   one traceability file.
2. **Discovery is stem-based.** `documentBundleService.ts` finds companions by
   deriving the name from the markdown stem (`spec.md → spec.review.json`)
   inside a `FileSystemDirectoryHandle`. A fixed name either breaks this
   convention or forces a second, different discovery mechanism.
3. **The requirement index is per-document.** Requirement IDs are only unique
   within one document (the pattern is global config, so `REQ_001` exists in
   *every* document). Links stored in a document-agnostic file would be
   ambiguous the moment a second document is opened.
4. **Consistency is cheap.** The entire review lifecycle (open, discover,
   save, Save-As, handle-on-tab, dirty tracking) already exists and is proven.
   Mirroring it costs near zero design risk; inventing a parallel scheme costs
   real risk.

**Decision:** companion file per markdown document, named
`<stem>.trace.json` (`spec.md → spec.trace.json`). Bundle layout becomes:

```
spec.md            — content, structure, requirement IDs (source of truth)
spec.review.json   — review comments (source of truth for reviews)
spec.trace.json    — test cases + links (source of truth for traceability)
```

Cross-document traceability (one test case covering requirements in several
documents) is explicitly **out of scope for v1** (§11 discusses the upgrade
path).

### 0.2 ⚠️ CSV "matrix" → long-format rows as the v1 deliverable, wide grid deferred

A literal grid (requirements as rows, test cases as columns, ✕ at
intersections) is what "traceability matrix" evokes, but as a CSV artifact it
is weak:

- It is **unfilterable and unsortable** in Excel — the primary consumer.
- It **degrades with scale**: 300 test cases means 300 columns; reviewers
  scroll horizontally hunting for ✕ marks.
- It **cannot carry per-row context** (section, title) without ambiguity.
- Every industry RTM interchange format (DOORS, Polarion, Jama exports) is
  long-format; the grid is a *pivot view* users can build in Excel in three
  clicks from long-format data.

**Decision:** v1 exports **long format** — one row per requirement↔test-case
link, plus one row per *untraced* requirement (empty test-case cells) and one
row per *orphan* test case (empty requirement cells). This makes coverage gaps
— the entire point of an RTM — directly filterable. A wide-grid variant is a
future additive export (§11), not a v1 blocker. If stakeholders insist on the
literal grid for v1, §7.3 specifies it as an alternate; only one should be
implemented.

### 0.3 ✅ Decisions adopted unchanged

- Tool-managed metadata; **nothing stored in markdown** (no HTML comments, no
  front-matter, no heading annotations). The parser/serializer round-trip
  invariant is untouched — traceability never enters the ProseMirror document.
- Reviews remain completely separate: separate file, separate store, separate
  dashboard tab. The only shared code is generic infrastructure (file
  pickers, CSV cell escaping, the rename-migration plugin hook).
- Test case = **ID + Title only**. No status, steps, owner, priority,
  execution results, attachments.
- Relationships are many-to-many.
- Requirement titles/statuses/sections are **never duplicated** into the JSON;
  they are resolved live from the requirement index at render/export time.

---

## 1. Goals and non-goals

### Goals

1. Let a user define lightweight test cases (ID + title) associated with the
   current document.
2. Let a user link/unlink test cases to requirements, many-to-many.
3. Show coverage at a glance: which requirements have no test case, which
   test cases reference no (existing) requirement.
4. Export a requirement↔test-case traceability CSV built from the *live*
   requirement index at export time.
5. Survive requirement ID renames and renumbering without silently orphaning
   links (same guarantee review comments already have).
6. Persist in a human-readable, diffable, versioned JSON sidecar following
   the established `.review.json` lifecycle.

### Non-goals (v1)

- Test execution, status, priority, owner, steps, expected results,
  attachments, runs, or history.
- Any coupling with the review system or other metadata systems.
- Cross-document links; test-case reuse across documents.
- Storing anything in markdown; editor decorations/badges inside the text.
- Import from external test-management tools.
- Link-level metadata (coverage type, rationale).
- Real-time multi-user merging of the JSON file.

---

## 2. JSON schema (v1)

File: `<stem>.trace.json`, UTF-8, pretty-printed (2-space indent, matching
`serializeReview`).

```json
{
  "_version": 1,
  "testCases": [
    { "id": "TC-001", "title": "Login with valid credentials" },
    { "id": "TC-002", "title": "Login lockout after 3 failures" }
  ],
  "links": [
    { "tc": "TC-001", "req": "REQ_001" },
    { "tc": "TC-002", "req": "REQ_001" },
    { "tc": "TC-002", "req": "REQ_007" }
  ]
}
```

### Field contract

| Field | Type | Rules |
| --- | --- | --- |
| `_version` | number | Always written as `1`. Loader tolerates absence (treated as 1). Keys starting with `_` are reserved, mirroring `ReviewFile`. |
| `testCases[].id` | string | Non-empty after trim. Unique within the file, **exact-string (case-sensitive)** comparison — identical to requirement-ID duplicate semantics in `analyzeRequirements`. No format restriction (users may follow their org's convention: `TC-001`, `UT_LOGIN_3`, …). |
| `testCases[].title` | string | Non-empty after trim. Free text. |
| `links[].tc` | string | Must reference an `id` present in `testCases`. Links violating this are **dropped on load** with a toast (see §6/§10 — the referenced entity lives in the same file, so a miss is file corruption, not expected state). |
| `links[].req` | string | A requirement ID string exactly as produced by `matchRequirementId` (e.g. `REQ_001`). **May reference a requirement that does not currently exist in the document** — this is expected state (deleted/renamed-away requirement, or file opened against an older document), kept and surfaced as *broken*, never auto-deleted. |

### Why this shape (and not alternatives)

- **`links` as a flat array of `{tc, req}` pair objects** rather than an
  adjacency map (`{ "TC-001": ["REQ_001", …] }`):
  - A pair list is symmetric — neither side is privileged, matching the
    many-to-many model. Adjacency maps bias one direction and force a scan to
    answer the other.
  - Pair *objects* (not tuples) allow additive per-link fields in v2 without a
    schema break — the single cheapest extensibility hedge available, and it
    costs nothing now.
  - Validation (dedupe, dangling detection) is a trivial single pass.
- **`testCases` as an array, not a map keyed by ID:** preserves user-defined
  display order for free, and keeps the "rename an ID" operation from being a
  key-move (the review store's key-move rename is a recurring source of
  conflict-handling complexity).
- **No titles, statuses, or sections of requirements in the file** — per the
  adopted decision. The file only ever contains: test case IDs, test case
  titles, and requirement ID strings.
- **No internal UUID for test cases.** The user-facing ID *is* the primary
  key. This is safe in v1 precisely because test cases and links live in the
  same file managed by the same store: renaming a test case ID rewrites its
  `links[].tc` entries in the same synchronous state update — atomicity by
  construction, no dangling window. A hidden UUID would add indirection with
  zero v1 payoff. (Requirement IDs offer no such option — they live in
  markdown — which is why the *req* side needs rename migration, §6.3.)

---

## 3. Relationship model

```
Requirement (lives in markdown; identity = pattern-matched heading ID)
     ▲  0..*
     │        links[] = set of (tc, req) pairs, duplicates forbidden
     ▼  0..*
Test case (lives in trace.json; identity = user-facing ID string)
```

- **Cardinality:** unrestricted many-to-many. Zero is meaningful on both
  sides: a requirement with zero links is *untraced* (a coverage gap); a test
  case with zero links is *unlinked* (allowed — users create test cases first,
  link later).
- **Link identity:** the pair `(tc, req)`. `links` is a *set*: creating an
  existing pair is a no-op in the UI; duplicates found on load are silently
  deduplicated (and the store marked dirty so the next save normalizes the
  file).
- **Referential integrity, asymmetric by design:**
  - `tc` side — *strong*: enforced within the file (drop-on-load if violated;
    impossible to violate through the UI).
  - `req` side — *weak*: a link may point at a requirement absent from the
    current document. It renders as **broken** and is excluded from coverage
    counts' "covered" bucket, but the data is preserved (see §10 for
    rationale).
- **Direction of authoring:** the UI supports linking from either side
  (from a test case, pick requirements; from a requirement, pick test cases).
  Both write the same pair.

---

## 4. UI/UX workflows

All traceability UI lives in a new **Traceability** dashboard tab
(`Dashboard.tsx` already anticipates this: *"Add future tabs (Traceability,
…) here. No other files need to change."*). Nothing is added to the editor
surface, toolbar, or slash commands in v1.

### 4.1 Traceability tab layout

Two-pane master-detail, consistent with the Requirements tab's list+drawer
pattern:

```
┌────────────────────────────────────────────────────────────────┐
│ Coverage: 12/20 requirements traced · 8 test cases · 2 broken  │
│ [+ New Test Case]                        [Export CSV] [Save ▾] │
├──────────────────────────┬─────────────────────────────────────┤
│ Test Cases               │ TC-002 — Login lockout              │
│ ─────────────────────    │ ─────────────────────────           │
│ ▸ TC-001  Login valid  2 │ ID    [TC-002        ]  Title [...] │
│ ▸ TC-002  Lockout      3 │                                     │
│ ▸ TC-003  Reset pw     0 │ Linked requirements                 │
│                          │  REQ_001  Auth service   [unlink]   │
│ Requirements (by doc     │  REQ_007  Account lock   [unlink]   │
│  order, from live index) │  REQ_099  ⚠ not found    [unlink]   │
│ ▸ REQ_001  Auth        2 │                                     │
│ ▸ REQ_002  Session     0 │ [+ Link requirement…]  (typeahead   │
│   …                    … │   over current requirement index)   │
└──────────────────────────┴─────────────────────────────────────┘
```

- The left pane has two sections (or a toggle): **by test case** and **by
  requirement**. Both show a link-count badge; zero-count rows get a subtle
  "untraced/unlinked" treatment so gaps are scannable.
- The requirement list is the live `RequirementIndex` (id, title, section,
  status already available in `RequirementRecord`) — never data from the
  JSON.
- Selecting an item shows its detail: for a test case, its linked
  requirements (resolved against the index; unresolvable ones flagged ⚠);
  for a requirement, its linked test cases.

### 4.2 Workflows

| Workflow | Behaviour |
| --- | --- |
| **Create test case** | "+ New Test Case" opens an inline form: ID (pre-filled with a suggestion, see below) + Title. Validation on submit (§6). New test case appended to `testCases`. |
| **ID suggestion** | Derived from the *last* test case ID in the list via the existing `derivePattern`/`formatId` machinery (e.g. last = `TC-007` → suggest `TC-008`). If no test cases exist or the last ID has no numeric suffix, the field is empty. Suggestion only — fully editable. No test-case pattern configuration in v1. |
| **Edit test case** | ID and title editable in the detail pane. ID rename cascades to `links[].tc` in the same store update; rename to an existing ID is rejected inline. |
| **Delete test case** | Confirmation dialog stating the number of links that will be removed (`Delete TC-002 and its 3 requirement links?`). Deletes the test case and all its links. |
| **Link** | From a test-case detail: "+ Link requirement…" opens a typeahead listing the current requirement index (ID + title + section), excluding already-linked IDs. From a requirement detail: symmetric picker over test cases. Selecting adds the pair. |
| **Unlink** | Per-row unlink button. No confirmation (single-pair, trivially re-creatable). |
| **Broken link repair** | Broken rows (⚠) offer **Unlink** and **Relink…** (opens the requirement picker pre-filtered to nothing — user picks the renamed/new target; implemented as unlink+link). No auto-repair heuristics in v1. |
| **Navigate** | Clicking a requirement anywhere in the tab navigates the editor to it (§9). |

### 4.3 Empty / first-run states

- No trace file loaded and no data: the tab shows an explainer with two
  actions — **New Test Case** (starts an in-memory traceability set; file is
  created on first save) and **Load trace file…** (manual picker, same as
  reviews' non-blocking CTA when directory discovery is unavailable).
- Requirement pattern not configured (`RequirementIndex` is null): the tab
  still lists test cases, but linking is disabled with an inline notice
  ("Configure a requirement pattern to link requirements"), mirroring how
  other requirement-dependent features degrade.

---

## 5. Dashboard changes

1. **New tab** `traceability` appended to `TABS` in `Dashboard.tsx`
   (`TabId` union gains `"traceability"`). Per the existing comment, no other
   file changes for tab registration.
2. **Overview tab** gains one stat tile: **Traced requirements — n/total**
   (requirements with ≥ 1 non-broken link). One tile only; no charts in v1.
3. **Requirements tab**: *no change in v1.* Adding a linked-count column is
   tempting but expands scope (column, sorting, drawer section); deferred.
4. **Reviews tab**: untouched, per constraints.
5. **StatusBar / Header**: traceability dirty-state indicator and save action
   surface wherever review save actions currently surface (StatusBar receives
   `onSaveTrace` alongside `onSaveReview`), keeping one consistent
   save-affordance pattern. No new top-level chrome.

---

## 6. Validation rules

### 6.1 On user input (blocking, inline)

| Rule | Message |
| --- | --- |
| Test case ID non-empty after trim | "ID is required." |
| Test case ID unique (exact string) | "TC-002 already exists." |
| Title non-empty after trim | "Title is required." |
| Link pair not already present | (silent no-op — picker already excludes linked items) |

### 6.2 On load (repair + report, never hard-fail)

Loader = `migrateTraceFile(raw)`, mirroring `migrateReviewFile`: tolerant,
coercing, never throws on structural oddities — but unlike reviews it *reports*
what it repaired (single summary toast).

| Condition | Action |
| --- | --- |
| Not valid JSON | Load nothing; error toast "Couldn't read spec.trace.json: invalid JSON." Existing in-memory state untouched. **Never overwrite the file on disk from this state** — saving is disabled until the user explicitly does Save-As or reloads (prevents clobbering a file the app couldn't parse). |
| `_version` missing | Treat as 1. |
| `_version` > 1 | Load best-effort (forward-tolerant read of known fields), warn "trace file was written by a newer version"; saving keeps `_version` as read? No — v1 has no newer version to protect; write `1` and note the risk in the toast. Simplest honest behaviour for v1. |
| Test case with empty/missing id or title | Dropped, counted in repair toast. |
| Duplicate test case IDs | First occurrence wins; later ones dropped, counted. |
| Link whose `tc` is not in `testCases` | Dropped, counted (intra-file corruption). |
| Duplicate link pairs | Deduplicated silently; store marked dirty. |
| Link whose `req` is not in the current index | **Kept.** Flagged broken in UI. Not an error — expected lifecycle state. |

### 6.3 Continuous (live invariant, not a check)

Requirement ID renames in the document must migrate `links[].req`
automatically — specified in §8.4/§10.2. There is deliberately **no** "validate
now" button; the broken-link state is always derived live from
`links × RequirementIndex`, so it can never go stale.

---

## 7. Export design (CSV)

### 7.1 Pipeline

Follows `reviewExportService.ts` exactly: a pure
`collectTraceExportRows(...)` → `generateTraceCsv(rows)` →
`downloadTraceCsv(csv, documentName)` chain in a new
`src/services/traceExportService.ts`. Reuses the RFC 4180 cell escaping, UTF-8
BOM, CRLF conventions (extract `csvCell` into a shared helper rather than
duplicating it — the one permissible touch outside the traceability
vertical).

**The requirement index is recomputed synchronously at export time** from the
live editor (as `collectReviewExportRows` does via `analyzeRequirements`) —
never taken from the debounced `useRequirementIndex` hook, which can be up to
300 ms stale.

### 7.2 Row model (primary deliverable — long format)

One row per link; plus one row per untraced requirement; plus one row per
test case with zero links. Requirement rows follow **current document order**
(the "current requirement index" per the brief); orphan test cases follow at
the end in `testCases` order.

| Column | Source | Notes |
| --- | --- | --- |
| Document | tab `fileName`/title | as reviews export |
| Requirement ID | index / link | empty for orphan test-case rows |
| Requirement Title | live index | empty if broken/orphan-TC row |
| Section | live index | " |
| Requirement Status | live index (resolved label) | " |
| Test Case ID | link / testCases | empty for untraced-requirement rows |
| Test Case Title | testCases | " |
| Link State | derived | `Linked`, `Untraced` (req, no TCs), `Unlinked` (TC, no reqs), `Broken` (link whose req is not in index) |

Broken links export with the stored Requirement ID, empty title/section/
status, and `Link State = Broken` — they must appear in the artifact (an RTM
that silently hides broken traces defeats its purpose).

Filename: `<stem>.trace.csv` (mirrors `<stem>.reviews.csv`).

### 7.3 Alternate: literal wide matrix (only if mandated; do not build both)

Row 1: `Requirement ID, Requirement Title, <TC-001>, <TC-002>, …` (test cases
in `testCases` order). One row per requirement in index order; `X` at
intersections. Two trailing synthetic rows are **not** included (orphan TCs
are simply columns whose cells are all empty; broken links get a final
`(unresolved)` requirement-row group). Weaknesses per §0.2 stand; if chosen,
cap at a warning when test cases exceed ~200 columns.

---

## 8. Persistence lifecycle

Mirror of the review lifecycle, component for component.

### 8.1 State: `traceStore` (zustand)

```
{ testCases, links, isDirty, loaded }
+ load(data) / reset() / markSaved()
+ addTestCase / updateTestCase(rename cascades links) / deleteTestCase(cascades links)
+ addLink / removeLink
+ migrateRequirementTarget(oldId, newId)   ← §8.4
+ remapRequirementIds(map)                 ← bulk renumber, §8.4
```

Single global store, reset+loaded on tab switch — exactly the review store's
model. Selectors derive: links-by-tc, links-by-req, broken set (against the
index), coverage counts. No derived data is stored.

### 8.2 Creation

No file is created until the user saves. First save with no stored handle
runs **Save Trace As** (`showSaveFilePicker`, suggested name
`<stem>.trace.json`); the returned handle is stored on the tab
(`TabData.traceHandle`, alongside `reviewHandle`) and in workspace
persistence so it survives reload, matching lines ~286/370/382 of `App.tsx`
where `reviewHandle` is threaded through.

### 8.3 Loading

- On document open **with** a directory handle: attempt discovery of
  `deriveTraceFileName(markdownName)` via a generalized
  `documentBundleService` (`findCompanionFile(dirHandle, name)` shared with
  reviews). Found → parse via `migrateTraceFile`, load store, store handle.
- Without a directory handle (plain `showOpenFilePicker` — FSAA cannot see
  siblings): non-blocking CTA in the Traceability tab ("Load trace file…"),
  same UX as reviews.
- Browser-fallback (`<input type=file>`): load without a handle; saving falls
  back to download, as reviews do.

### 8.4 Saving & dirty tracking

- Explicit save (no autosave — reviews have none; consistency wins and the
  file is small enough that losing unsaved edits is bounded by the
  `beforeunload` guard, which must extend its dirty check to
  `traceStore.isDirty`).
- Save writes `{_version: 1, testCases, links}` pretty-printed through
  `writeToFileHandle` (permission re-request handled there).
- **Rename integration (the critical invariant):**
  - `requirementIdMigrationPlugin`'s `view().update` — which already calls
    `reviewStore.migrateReviewTarget` for safe renames — additionally calls
    `traceStore.migrateRequirementTarget(oldId, newId)`. Semantics for links
    are simpler than for comments: rewrite `req` on affected pairs, then
    dedupe (**set union** — a rename can never lose a link, so the review
    system's "conflict" outcome does not exist here).
  - The **bulk renumber** flow (`OutlinePanel.tsx`, which suppresses the
    plugin via the `skip` meta and calls `renumberComments` per entry) calls
    `traceStore.remapRequirementIds(oldId→newId map)` **once, as an atomic
    batch** — per-entry sequential renames are wrong for renumbering because
    old and new ID spaces overlap (`REQ_003→REQ_001` while `REQ_001→REQ_002`
    would chain). The review store's per-entry `renumberComments` has this
    latent hazard; do not copy it.
  - Duplicate-creating renames are already reverted by the plugin before
    stores are touched — no traceability handling needed.

### 8.5 Tab switch / close

Store contents, dirty flag, and handle are per-tab (persisted with workspace
state like `reviewHandle`). Closing a dirty tab triggers the existing
unsaved-changes flow, extended to mention unsaved traceability.

---

## 9. Navigation behaviour

- **Traceability → editor:** clicking a requirement (in the requirement list,
  or inside a test-case detail) resolves its ID against the live index at
  click time and calls the existing `onNavigateToEditor(pmPos)`. Resolution
  is by ID, not stored position — `Dashboard.handleNavigateByTargetId`
  already implements exactly this; reuse it. Broken IDs render
  non-clickable (⚠, no navigation).
- **Requirement → traceability:** none in v1 (no editor-surface affordances).
  The by-requirement list in the tab is the entry point.
- **Test cases** have no document location; selecting one only changes the
  detail pane.

---

## 10. Error handling

### 10.1 Broken links (requirement no longer in index)

Design stance: **preserve, flag, never auto-delete.** Rationale:

- Deletion of a requirement heading is frequently transient: cut/paste of a
  section, an undo away, or a mid-edit state (the index is debounced 300 ms —
  auto-deleting on "missing from index" would race normal typing).
- The link is user-authored data in a *different file* from the document;
  destroying it as a side effect of a markdown edit violates the
  source-of-truth split.

Behaviour: broken rows are visually flagged (⚠ "REQ_099 — not found"),
excluded from "traced" coverage counts, exported with `Link State = Broken`,
and individually repairable (Unlink / Relink, §4.2). If the requirement
reappears (undo, paste-back), the link heals automatically because brokenness
is derived live, never stored.

### 10.2 Renames and renumbering

Handled proactively (§8.4), so renames do not *create* broken links. A rename
performed **outside the app** (editing the .md in another editor) is
indistinguishable from delete+create and correctly surfaces as a broken link
plus an untraced requirement — repairable via Relink. This is accepted v1
behaviour, stated here so it is not filed as a bug.

### 10.3 Deleted test cases

Cascade within the store (confirmation dialog shows the link count).
A test case can never be "broken" — the `tc` side is intra-file (§3).

### 10.4 File-level errors

| Failure | Handling |
| --- | --- |
| Trace file unparseable on load | Error toast; store untouched; saving to the stored handle disabled until reload or Save-As (§6.2 — never clobber what we couldn't read). |
| Write failure (permission revoked, disk) | Error toast with retry; dirty flag stays set. Same contract as `writeToReviewHandle` (throws; caller surfaces). |
| Discovery failure other than NotFound | Logged, treated as not-found (mirrors `findReviewFile`). |
| Trace file for a *different* document loaded manually | Undetectable in v1 (file carries no document identity). Every link simply resolves broken. Accepted; §11 notes the `document` field as the v2 fix. |

---

## 11. Future extensibility (explicitly not built now)

The v1 schema was shaped so each of these is **additive** (no migration
beyond `_version` bump, or none at all):

| Future need | Path | v1 provision |
| --- | --- | --- |
| Test-case fields (status, steps, owner…) | add optional fields to `testCases[]` objects | objects, not tuples |
| Link metadata (coverage type, rationale) | add optional fields to `links[]` objects | pair objects, not tuples/map |
| Cross-document links | add `doc` to link pairs + a workspace-level trace file | per-document file keeps v1 simple; nothing in the pair shape prevents a `doc` field |
| File↔document identity check | add top-level `document` field | reserved: loader already ignores unknown top-level keys |
| Wide-matrix / Excel / HTML export | new generator over the same row model | rows model isolated in `traceExportService` per the review-export precedent |
| Schema evolution | `_version` + `migrateTraceFile` choke point | in place from day one |

Deliberately **not** provisioned (would be speculative): test-case UUIDs,
hierarchical test suites, link directionality/typing, per-link timestamps,
multi-file merge tooling.

---

## 12. Risks and trade-offs

| # | Risk / trade-off | Assessment & mitigation |
| --- | --- | --- |
| 1 | **User-facing TC ID as primary key.** Renames are safe intra-file (§2), but once CSVs are exported or files shared, an ID rename silently disconnects external artifacts. | Accepted for v1 smallness. The confirmation-free rename is intra-tool-consistent (requirement IDs behave the same). Revisit only if external round-tripping becomes a feature. |
| 2 | **Requirement-side links keyed by mutable string IDs.** Whole classes of bugs (rename, renumber, external edits) follow. | The rename-migration plugin + batch remap (§8.4) covers in-app mutation; broken-link UX (§10.1) covers the rest. This is the same trade-off reviews already made — no new risk class. |
| 3 | **Explicit save only.** Unsaved traceability edits lost on crash. | Bounded by `beforeunload` guard + dirty indicator. Consistent with reviews; adding autosave for one sidecar but not the other would be more confusing than the risk warrants. |
| 4 | **Per-document trace files** can't express shared test cases across specs. | Correct v1 scope cut (§0.1). Upgrade path preserved (§11). |
| 5 | **Long-format CSV** may disappoint stakeholders expecting a literal grid. | §0.2 rationale; grid derivable via pivot; alternate spec'd (§7.3) if overruled — decide before implementation, build one. |
| 6 | **Concurrent external modification** of `.trace.json` while the app holds it in memory: last writer wins, no merge. | Accepted (identical to reviews). Pretty-printed JSON keeps git diffs/merges humane, which is the realistic collaboration channel. |
| 7 | **Global store per active tab** (not per-tab instances) means a bug in tab-switch reset corrupts another tab's data. | Mirrors the proven review-store pattern and its existing reset points; deviation would cost more than it saves. |
| 8 | **Duplicate requirement IDs in the document** (already detected by `analyzeRequirements`): a link resolves to *both*. | Navigation goes to the first match (existing `handleNavigateByTargetId` behaviour); coverage counts by ID, not heading. Duplicates are already surfaced as a document-quality problem elsewhere; traceability doesn't re-litigate them. |
| 9 | **`skip`-meta flows** (bulk renumber, duplicate reassign) bypass the migration plugin; any *future* ID-mutating feature must remember to call the trace remap too. | Single choke point: route all explicit ID mutations through one `migrateRequirementIdEverywhere(oldId,newId | map)` helper that fans out to review + trace stores, so the next feature can't forget one of them. |

---

## Appendix A — Implementation surface (for planning, not instruction)

New: `src/types/traceability.ts`, `src/stores/traceStore.ts`,
`src/persistence/traceFilePersistence.ts`, `src/services/traceExportService.ts`,
`src/layout/tabs/TraceabilityTab.tsx`.
Touched: `Dashboard.tsx` (tab registration), `tabStore.ts` (`traceHandle`),
`documentBundleService.ts` (generalize companion lookup), `App.tsx`
(load/save wiring, beforeunload, workspace persistence),
`requirementIdMigrationPlugin.ts` (+ trace migration call),
`OutlinePanel.tsx` renumber flow (+ batch remap), StatusBar/Header save
affordances, `reviewExportService.ts` (extract shared `csvCell`).
Tests: schema load/repair matrix (§6.2), link migration under rename/renumber
(including the overlapping-renumber case §8.4), export row model incl.
untraced/unlinked/broken rows, TC rename cascade atomicity.
