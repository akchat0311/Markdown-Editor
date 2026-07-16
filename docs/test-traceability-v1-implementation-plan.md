# Test Case Traceability v1 — Implementation Plan

Status: **Frozen design → implementation roadmap.** No design decisions are made
here; every choice below is either a frozen decision or a direct mirror of an
existing, proven pattern in the codebase. Optimized for minimum churn and
minimum regression risk: the review-comment vertical is copied structurally,
not modified behaviourally.

Frozen inputs honored throughout: sidecar `<document>.test-traceability.json`;
schema `{ "version": 1, "testCases": [], "links": [] }`; TC ID is primary key;
requirement IDs are the existing markdown IDs; many-to-many; broken links
preserved; rename/renumber auto-migrates; CSV export only; TC = ID + Title.

---

## 1. Exact architecture

### 1.1 Data ownership — one new store

**`src/stores/traceabilityStore.ts`** (new, zustand) owns all traceability
state, structurally mirroring `reviewCommentsStore.ts`:

```ts
interface TraceabilityState {
  testCases: TestCase[];          // { id, title }
  links: TraceLink[];             // { tc, req }
  isDirty: boolean;
  loaded: boolean;
  /** Set true when the sidecar existed but failed to parse — blocks Save
      to the stored handle so an unreadable file is never clobbered. */
  loadError: boolean;

  load(data: TraceabilityFile): void;
  reset(): void;
  markSaved(): void;

  addTestCase(id: string, title: string): void;
  updateTestCase(oldId: string, patch: { id?: string; title?: string }): void; // id rename cascades links[].tc in the same set()
  deleteTestCase(id: string): void;                                            // cascades links

  addLink(tc: string, req: string): void;      // set semantics: no-op if pair exists
  removeLink(tc: string, req: string): void;

  migrateRequirementTarget(oldId: string, newId: string): void; // single rename, union-dedupe
  remapRequirementIds(mapping: ReadonlyMap<string, string>): void; // atomic batch (renumber)
}
```

`migrateTraceabilityFile(raw): TraceabilityFile` lives in this module
(placement mirrors `migrateReviewFile` in `reviewCommentsStore.ts`): tolerant
loader that drops malformed test cases, drops links whose `tc` is not in
`testCases`, dedupes pairs, keeps links whose `req` matches nothing (frozen:
broken links preserved), and treats missing `version` as 1.

No requirement titles/sections/statuses are ever stored — resolved live from
`RequirementIndex` at render/export time.

### 1.2 Persistence — one new service + one extension

- **`src/persistence/traceabilityFilePersistence.ts`** (new): line-for-line
  structural copy of `reviewFilePersistence.ts` —
  `openTraceabilityFile({startIn})`, `writeToTraceabilityHandle(handle, data)`,
  `saveTraceabilityFileAs(data, suggestedName)`. Serialization writes
  `{ version: 1, testCases, links }` pretty-printed (2-space), reusing
  `writeToFileHandle` from `fileAccess.ts` for permission handling.
- **`src/persistence/documentBundleService.ts`** (extend): add
  `deriveTraceabilityFileName(markdownName)` (`spec.md →
  spec.test-traceability.json`) and `findTraceabilityFile(dirHandle, name)`.
  Implementation detail to avoid duplication: extract the existing
  `findReviewFile` body into a private generic
  `findCompanionFile<T>(dirHandle, fileName, migrate)` and re-implement both
  public functions as thin wrappers. **Public signatures of
  `deriveReviewFileName`/`findReviewFile` are unchanged** — zero call-site churn.

### 1.3 UI — one new dashboard tab

- **`src/layout/tabs/TraceabilityTab.tsx`** (new): all v1 traceability UI
  (test-case manager, link editor, coverage summary, load/save/export
  actions). Registered in `Dashboard.tsx` exactly as its own comment
  instructs ("Add future tabs (Traceability, …) here"). Props mirror
  `ReviewsTab`'s pattern:

  ```tsx
  {activeTab === "traceability" && (
    <TraceabilityTab
      onNavigate={handleNavigate}                 // pmPos navigation (resolve ID → pmPos via live index, as handleNavigateByTargetId does)
      onLoadTraceability={onLoadTraceability}     // threaded from App.tsx like onLoadReview
      onSaveTraceability={onSaveTraceability}
      onSaveTraceabilityAs={onSaveTraceabilityAs}
      onExportCsv={onExportTraceabilityCsv}
    />
  )}
  ```

  Requirement data comes from `useRequirementIndex(editor, pattern)` inside
  the tab (same hook `RequirementsTab` uses), never from the sidecar.
- **`src/layout/StatusBar.tsx`** (extend): traceability dirty indicator +
  save/save-as affordances, mirroring the existing `onSaveReview` /
  `onSaveReviewAs` props and `reviewIsDirty` subscription (lines 16–30, 63, 72).

### 1.4 Export — one new service + one tiny extraction

- **`src/services/traceabilityExportService.ts`** (new):
  `collectTraceabilityExportRows(...)` → `generateTraceabilityCsv(rows)` →
  `downloadTraceabilityCsv(csv, documentName)`, mirroring
  `reviewExportService.ts`'s three-stage shape (§6).
- **`src/services/csvUtils.ts`** (new, ~20 lines): `csvCell()` plus the
  BOM/CRLF assembly helper, moved out of `reviewExportService.ts`, which then
  imports them. This is the only behavioural touch to review code and it is a
  pure move (covered by existing review-export tests).

### 1.5 Reused review infrastructure (no changes needed)

| Reused as-is | From |
| --- | --- |
| `writeToFileHandle`, permission check/request | `persistence/fileAccess.ts`, `workspacePersistence.ts` |
| FSAA picker patterns incl. `startIn` fallback, `<input>` fallback, download fallback | `reviewFilePersistence.ts` (copied structurally) |
| Companion discovery via directory handle | `documentBundleService.ts` (generalized) |
| Live requirement metadata | `useRequirementIndex`, `buildRequirementIndex`, `analyzeRequirements`, `matchRequirementId` (`requirementOps.ts`) |
| Rename detection | `requirementIdMigrationPlugin.ts` (`detectRenames`, `collectHeadingIds`) — extended, not modified in logic |
| Navigation | `Dashboard.handleNavigate` / `handleNavigateByTargetId` pattern |
| Toasts, close-confirm dialog, beforeunload guard | `toastStore`, `App.tsx` close flow (extended) |
| CSV escaping/BOM/CRLF | extracted `csvUtils.ts` |
| ID suggestion for new test cases | `derivePattern` + `formatId` (`requirementOps.ts`) |

Explicitly **not** reused: `reviewCommentsStore` itself, `ReviewsTab`,
review export row model — reviews and traceability stay fully independent
(frozen decision).

---

## 2. Exact files to modify

| File | Change | Size |
| --- | --- | --- |
| `src/stores/tabStore.ts` | Add `traceabilityHandle?: FileSystemFileHandle` to `TabData` (next to `reviewHandle`). | 1 line |
| `src/persistence/documentBundleService.ts` | Extract private `findCompanionFile`; add `deriveTraceabilityFileName`, `findTraceabilityFile`. | ~25 lines |
| `src/persistence/workspacePersistence.ts` | Add optional `traceabilityHandle` to `WorkspaceDoc` (line ~29) and to `saveWorkspaceDoc`'s record assembly (line ~52). | ~4 lines |
| `src/App.tsx` | (a) `handleLoadTraceability` / `handleSaveTraceability` / `handleSaveTraceabilityAs` callbacks mirroring the review trio (lines 454–520); (b) extend `attemptBundleLoad` (lines ~529–560): `traceabilityStore.reset()` first, then discover `deriveTraceabilityFileName(markdownName)` via `findTraceabilityFile`; (c) restore `traceabilityHandle` in workspace-restore paths (lines ~286, ~370, ~382) and persist it in every `saveWorkspaceDoc` call; (d) include `isTraceabilityDirty` in `hasUnsavedChangesRef` (line ~406) and in the tab close-confirm flow (~line 876/926); (e) thread the new callbacks into `<Dashboard>` (~1146) and `<StatusBar>` (~1152). | ~90 lines |
| `src/layout/Dashboard.tsx` | Add `"traceability"` to `TabId` + `TABS`; add `onLoadTraceability`/`onSaveTraceability`/`onSaveTraceabilityAs`/`onExportTraceabilityCsv` to `DashboardProps`; render `<TraceabilityTab>`. | ~20 lines |
| `src/layout/StatusBar.tsx` | Add traceability dirty indicator + save props, mirroring review ones. | ~25 lines |
| `src/editor/plugins/requirementIdMigrationPlugin.ts` | In `view().update`, alongside `reviewStore.migrateReviewTarget(oldId, newId)` (line ~185), call the shared migration helper (§5). Requirement-heading renames only — section-review targets (`section:2.1`) never carry traceability links; the helper filters them via `isSectionReviewTarget`. | ~6 lines |
| `src/layout/OutlinePanel.tsx` | In `handleRenumber` (line ~1911): after dispatch, build `Map(entry.id → newId)` from `replacements` (changed pairs only) and call `traceabilityStore.remapRequirementIds(map)` **once**. Do **not** copy the per-entry `renumberComments` loop for traceability (§5.3). `handleReassignDuplicate` needs no traceability call (original ID keeps its links — same reasoning as the review comment there). | ~6 lines |
| `src/services/reviewExportService.ts` | Replace local `csvCell` + BOM/CRLF assembly with imports from `csvUtils.ts`. Pure move. | −20/+2 lines |

No changes to: parser, serializer, editor extensions, review store, review
persistence, ReviewsTab, validation engine, quality rules. Markdown pipeline
is untouched (frozen: markdown never contains test metadata).

## 3. Exact new files to create

| File | Contents |
| --- | --- |
| `src/types/traceability.ts` | `TestCase { id; title }`, `TraceLink { tc; req }`, `TraceabilityFile { version?: number; testCases: TestCase[]; links: TraceLink[] }`. |
| `src/stores/traceabilityStore.ts` | Store per §1.1 + `migrateTraceabilityFile`. |
| `src/persistence/traceabilityFilePersistence.ts` | Open / write-to-handle / save-as, per §1.2. |
| `src/services/csvUtils.ts` | `csvCell`, `assembleCsv(header, lines)` (BOM + CRLF). |
| `src/services/traceabilityExportService.ts` | Row model + generator + download, per §6. |
| `src/services/requirementIdMigration.ts` | Shared fan-out helper, per §5.4. |
| `src/layout/tabs/TraceabilityTab.tsx` | Tab UI per §1.3. |
| `tests/unit/traceability-store.test.ts` | Store actions, cascade rename/delete, migrate/remap semantics, `migrateTraceabilityFile` repair matrix. |
| `tests/unit/traceability-migration.test.ts` | Plugin-driven rename migration + renumber batch remap, incl. overlapping renumber (`REQ_003→REQ_001` while `REQ_001→REQ_002`). |
| `tests/unit/traceability-export.test.ts` | Row assembly (linked/untraced/unlinked/broken), CSV escaping, document order. |

---

## 4. Lifecycle

Every step mirrors the review lifecycle; deviations are marked **Δ** and are
corrections the frozen design requires (broken-link preservation, no
clobbering), not redesigns.

| Event | Behaviour |
| --- | --- |
| **Open document** | `attemptBundleLoad` runs after any markdown open (existing hook point, App.tsx ~529). **Δ First action: `traceabilityStore.reset()`** — prevents the previous document's data bleeding into a document with no sidecar (the review store skips this; see risk R2 — do not import that bug). Then, if a `dirHandle` exists, attempt discovery. |
| **Open sidecar (found)** | `findTraceabilityFile(dirHandle, deriveTraceabilityFileName(name))` → `migrateTraceabilityFile(JSON.parse(text))` → `store.load(data)`, `loaded: true`, `isDirty: false`; handle stored via `updateActiveTab({ traceabilityHandle })` and persisted with `saveWorkspaceDoc`. Success toast mirrors "Review file loaded". |
| **Open sidecar (manual)** | Traceability tab "Load…" action → `openTraceabilityFile({ startIn: mdHandle })` (picker pre-navigated to the markdown's folder, exactly like `handleLoadReview` line 454). |
| **Missing sidecar** | Store stays empty (`loaded: false`), no file created, no error. No extra toast (the review flow already toasts on open; a second toast per open is noise) — the Traceability tab renders an empty state with **New Test Case** and **Load file…** CTAs. File is created only on first save. |
| **Unparseable sidecar** | Error toast; store reset; **Δ `loadError: true` disables Save-to-handle** (Save As remains available) so the app never overwrites a file it could not read. |
| **Save** | `handleSaveTraceability`: if `tab.traceabilityHandle` exists → `writeToTraceabilityHandle(handle, {version:1, testCases, links})`, `markSaved()`, success toast; on throw → error toast, dirty stays set. No handle → falls through to Save As (identical to `handleSaveReview`, line 502). |
| **Save As** | `saveTraceabilityFileAs(data, suggested)` with `suggested = tab.fileName ? deriveTraceabilityFileName(tab.fileName) : "document.test-traceability.json"`; on success store handle on tab + `saveWorkspaceDoc` (identical to `handleSaveReviewAs`, line 473). Browser fallback: download, no handle. |
| **Rename document** (markdown Save As / fileName change) | Sidecar handle is untouched; subsequent saves keep writing the original sidecar file. The **next** Save As suggests the new stem. Auto-discovery on a later open of the renamed markdown will not find the old sidecar — user must Load manually. This exactly matches review behaviour today; accepted, listed as risk R6. |
| **Close tab** | Existing `handleRequestClose` confirm flow extended: prompt when `traceabilityStore.isDirty` (in addition to markdown/review dirty). Handle is dropped with the tab. `traceabilityStore.reset()` on close of the tab that loaded it. |
| **Autosave** | **None for the sidecar.** `useAutosave` snapshots only markdown to IndexedDB as crash recovery ("autosave to IndexedDB is just crash recovery, not the authoritative save" — its own comment); reviews have no autosave either. Traceability saves are explicit only. Consequence (unsaved edits lost on crash) is bounded by the beforeunload guard and listed as risk R5. |
| **Dirty state** | `isDirty` set by every mutating store action, cleared by `markSaved()`/`load()`/`reset()`. Surfaced in: StatusBar indicator, Traceability tab Save button state, `hasUnsavedChangesRef` (beforeunload, App.tsx ~406), close-tab confirm. |

---

## 5. Rename migration — exact mechanics

### 5.1 What already exists

`requirementIdMigrationPlugin` computes, per document-changing transaction, a
list of `RenameEntry { oldId, newId, isDuplicate, pos }` by diffing heading-ID
maps across the transaction (`detectRenames` with `tr.mapping.map`). Its
`view().update`:

1. For **safe renames** → `reviewStore.migrateReviewTarget(oldId, newId)`.
2. For **duplicate-creating renames** → reverts the document edit (no store
   writes) and toasts.

Flows that manage IDs themselves (bulk renumber, duplicate reassign) suppress
the plugin with `tr.setMeta(requirementIdMigrationKey, { skip: true })` and do
their own store migration.

### 5.2 Extension for traceability (plugin path — single renames)

In `view().update`, for each safe rename, additionally migrate traceability.
Semantics are **simpler than reviews**: rewrite `req` on every link where
`req === oldId`, then dedupe pairs (union). A rename can merge two link sets
but can never lose a link, so the review system's `"conflict"` outcome does
not exist — no new toast, no blocking. Duplicate-creating renames are
reverted before any store is touched, so — as with reviews — they require no
traceability handling. Section-review targets (`section:…`) are filtered out:
links only ever reference requirement IDs.

### 5.3 Renumber path (`OutlinePanel.handleRenumber`) — batch, not sequential

The renumber flow bypasses the plugin (skip meta) and currently migrates
review comments **per entry sequentially** (`renumberComments(entry.id, newId)`
in a loop, line ~1933). **Do not replicate that loop for traceability**:
renumbering maps old→new IDs whose ranges overlap (`REQ_003→REQ_001` while the
old `REQ_001→REQ_002`), and sequential single renames chain through
intermediate states — link sets would merge incorrectly. Instead:

```ts
const mapping = new Map(
  replacements.filter(r => r.entry.id !== r.newId).map(r => [r.entry.id, r.newId]),
);
useTraceabilityStore.getState().remapRequirementIds(mapping);
```

`remapRequirementIds` applies the whole map in **one pass over the original
link array** (each `req` looked up once against the map, then dedupe) — no
intermediate states, atomicity by construction. The existing review loop is
left untouched (changing it is out of scope and a regression risk; noted as
risk R1).

`handleReassignDuplicate` needs no traceability code: the first occurrence
keeps the old ID, so links correctly stay with it — the same rationale already
documented in that function for review comments.

### 5.4 Recommended shared helper

**`src/services/requirementIdMigration.ts`**:

```ts
/** Fan-out for a single requirement-ID rename. Returns the review outcome so
 *  the caller (the plugin) can keep its existing conflict toast unchanged. */
export function migrateRequirementIdTargets(oldId: string, newId: string) {
  useTraceabilityStore.getState().migrateRequirementTarget(oldId, newId);
  return useReviewCommentsStore.getState().migrateReviewTarget(oldId, newId);
}
```

The plugin's loop calls this instead of the review store directly (review
behaviour byte-identical — same call, same return handling). Value: it is the
single choke point risk R9 of the design doc asked for — the next
ID-mutating feature cannot migrate one store and forget the other. Renumber
stays separate (batch API) because reviews and traceability intentionally
diverge there (§5.3).

---

## 6. CSV export — exact specification

`src/services/traceabilityExportService.ts`, mirroring the review export's
three stages so future formats reuse the row model.

### 6.1 `collectTraceabilityExportRows(flat, documentName, pattern, statuses, trace)`

Inputs match `collectReviewExportRows`'s conventions: `flat` =
`flattenOutline(deriveOutline(editor))` computed **synchronously at export
time** (never the debounced `useRequirementIndex` value, which can be 300 ms
stale), `pattern` = `useConfigStore` requirement pattern, `trace` =
`useTraceabilityStore.getState()` snapshot.

Algorithm (single pass each, O(reqs + links + testCases)):

1. Build `reqMeta: Map<reqId, { title, section, statusLabel, docOrder }>` via
   `buildRequirementIndex(flat, pattern, statuses)` (it already yields id,
   title, section, status per `RequirementRecord`; document order = array
   index). If the pattern is unconfigured, `reqMeta` is empty and every link
   exports as Broken — the UI disables export with a notice in that case
   rather than producing a misleading file.
2. Build `linksByReq: Map<reqId, tcId[]>` (insertion order = `links` array
   order) and `tcById: Map<tcId, TestCase>`; track `linkedTcIds: Set`.
3. Emit rows in this exact order:
   - **For each requirement in document order** (from `reqMeta`):
     - if it has links → one row per link: `Link State = "Linked"`, with the
       test case's ID and title;
     - if it has none → one row with empty TC cells, `Link State = "Untraced"`.
   - **Broken links** (links whose `req ∉ reqMeta`), in `links` array order:
     one row each with the stored Requirement ID, empty title/section/status,
     the TC ID/title, `Link State = "Broken"`. Broken links must appear —
     frozen decision preserves them, and an RTM that hides them is misleading.
   - **Orphan test cases** (`tc ∉ linkedTcIds`), in `testCases` array order:
     one row each with empty requirement cells, `Link State = "Unlinked"`.

### 6.2 Columns

`Document, Requirement ID, Requirement Title, Section, Requirement Status,
Test Case ID, Test Case Title, Link State` — generated via the shared
`csvCell` (RFC 4180 quoting) and BOM + CRLF assembly from `csvUtils.ts`.

### 6.3 `downloadTraceabilityCsv(csv, documentName)`

Filename `<stem>.test-traceability.csv` (`spec.md →
spec.test-traceability.csv`), Blob + anchor download, identical mechanism to
`downloadReviewCsv`.

Trigger: an **Export CSV** button in the Traceability tab; handler lives in
App.tsx (or the tab) and gathers `flat`/`docContent` from the live editor
exactly as the review export trigger does.

---

## 7. Risks — corruption and data-loss vectors

| # | Risk | Mitigation in this plan |
| --- | --- | --- |
| R1 | **Renumber chaining corrupts links.** Sequential per-pair renames over overlapping old/new ID spaces (the review store's existing loop pattern) would merge unrelated link sets. | `remapRequirementIds` is an atomic batch (§5.3); the overlap case is an explicit unit test. The review loop is deliberately not touched. |
| R2 | **Cross-document contamination.** `reviewCommentsStore.reset()` is never called anywhere in App.tsx today — opening a doc with no review sidecar leaves the previous doc's comments in the store. If copied, traceability links would silently attach to the wrong document and could be **saved into the wrong sidecar**. | `traceabilityStore.reset()` is the first step of `attemptBundleLoad` and runs on tab close (§4). The residual limitation — switching between two already-open tabs does not swap sidecar data — matches reviews and is accepted for v1 (Phase 5 note). |
| R3 | **Clobbering an unreadable file.** Parse failure followed by a Save would overwrite the user's file with an empty store. | `loadError` flag disables Save-to-handle until reload or explicit Save As (§4). |
| R4 | **TC ID rename leaving dangling links.** | `updateTestCase` rewrites `links[].tc` inside the same zustand `set()` — no observable intermediate state; covered by a cascade test. |
| R5 | **Crash loses unsaved sidecar edits.** No autosave/IndexedDB snapshot for the sidecar (matches reviews). | beforeunload guard extended to traceability dirty; dirty indicator in StatusBar. Accepted residual risk, consistent with reviews. |
| R6 | **Document rename orphans the sidecar** (stem mismatch breaks future auto-discovery). | Same behaviour as reviews today; manual Load CTA recovers. Documented, not "fixed" (any auto-rename of user files is out of scope and riskier than the problem). |
| R7 | **Write failure mid-save** (permission revoked, disk). | `writeToFileHandle` already checks/requests permission; on throw the dirty flag stays set and an error toast shows — no silent loss. FSAA `createWritable` writes to a temp file and commits on `close()`, so a failed write does not truncate the original. |
| R8 | **Concurrent external edits** to the sidecar: last writer wins. | Accepted (identical to reviews). Pretty-printed JSON keeps git-level merges humane. |
| R9 | **Untitled documents** (`tab.fileName` undefined): discovery impossible, suggested name falls back to `document.test-traceability.json`. | Mirrors review fallback (App.tsx line 478); no crash path. |
| R10 | **Duplicate requirement IDs in the document**: a link resolves to whichever heading the index lists first. | Existing document-quality problem, already surfaced by `analyzeRequirements.duplicates`; traceability does not add handling. Navigation goes to first match (existing `handleNavigateByTargetId` behaviour). |
| R11 | **Plugin/store races**: `view().update` fires per dispatch; a revert transaction (duplicate rename) must not trigger migration. | Already handled — the revert sets the `skip` meta; traceability migration only runs on `safeRenames`, same guard as reviews. |

---

## 8. Implementation phases

Ordered so every phase lands independently shippable and testable, with the
regression-sensitive integrations (plugin, renumber, App.tsx wiring) isolated
into their own steps.

### Phase 1 — Data model, store, sidecar persistence

- `src/types/traceability.ts`; `src/stores/traceabilityStore.ts` incl.
  `migrateTraceabilityFile`; `src/persistence/traceabilityFilePersistence.ts`;
  `documentBundleService` extension (generic extraction + new derive/find).
- `tabStore.traceabilityHandle`; `workspacePersistence` field.
- App.tsx wiring: load/save/save-as handlers, `attemptBundleLoad` extension
  (with reset-first), workspace restore/persist of the handle, beforeunload +
  close-confirm dirty checks.
- Tests: `traceability-store.test.ts` (actions, cascades, repair matrix);
  bundle-name derivation.
- **Exit criteria:** a sidecar round-trips open → load → mutate (via store
  calls) → save with correct dirty lifecycle; review tests all green
  (documentBundleService refactor verified).

### Phase 2 — Test Case manager UI

- `TraceabilityTab.tsx` (test-case list, create with `derivePattern`/`formatId`
  ID suggestion, edit with cascade rename, delete with link-count confirm,
  empty/load states, Save/Save As/Load actions); `Dashboard.tsx` tab
  registration; `StatusBar.tsx` dirty indicator + save affordances.
- No linking UI yet — test cases only. This keeps the first UI review small.
- **Exit criteria:** full CRUD + persistence usable end-to-end from the UI.

### Phase 3 — Linking requirements

- Link editor in `TraceabilityTab`: by-test-case and by-requirement views via
  `useRequirementIndex`; typeahead picker excluding already-linked pairs;
  unlink; broken-link rendering (⚠, non-clickable) with Unlink/Relink;
  coverage summary line; requirement click → `onNavigate(pmPos)`.
- Pattern-unconfigured degraded state (linking disabled with notice).
- **Exit criteria:** many-to-many linking usable; broken links visible and
  repairable; navigation works.

### Phase 4 — CSV export

- `csvUtils.ts` extraction (+ `reviewExportService` switched to it);
  `traceabilityExportService.ts`; Export button in the tab; export disabled
  when pattern unconfigured.
- Tests: `traceability-export.test.ts` (row ordering, all four Link States,
  escaping, stale-index avoidance by construction); review-export tests rerun
  to certify the extraction.
- **Exit criteria:** exported CSV matches §6 byte-for-byte on a fixture doc.

### Phase 5 — Migration and polish

- `requirementIdMigration.ts` helper; plugin extension (§5.2); renumber batch
  remap in `OutlinePanel` (§5.3).
- Tests: `traceability-migration.test.ts` — single rename, rename-merge
  (union), duplicate-rename revert (no store writes), renumber including the
  overlapping-ID case, reassign-duplicate (no-op for traceability).
- Polish: repair-summary toast on load, Overview-tab coverage stat tile
  (single tile), final pass on empty states and toasts.
- Deferred note (explicitly not in v1): per-tab sidecar state swap on tab
  switch — would need to change review behaviour too; revisit only as a
  joint change.
- **Exit criteria:** rename/renumber migration proven by tests; full manual
  pass of the §4 lifecycle table.

Migration lands last deliberately: Phases 1–4 are additive and cannot regress
existing features; Phase 5 contains the only two touches to shared editor
code paths (`requirementIdMigrationPlugin`, `OutlinePanel.handleRenumber`) and
gets its own focused test suite and review.
