# Document Bundle Save Pipeline — Design Specification

Status: **Draft for review** · Design only, no implementation yet.

This document specifies a unified save pipeline so Ctrl+S (and Save As) also
saves/renames dirty companion sidecar files (`.review.json`,
`.test-traceability.json`) instead of requiring a trip to the Dashboard. It is
grounded in an audit of the current save architecture — `src/App.tsx`,
`src/persistence/workspaceSave.ts`, `src/persistence/documentBundleService.ts`,
`src/persistence/{fileAccess,reviewFilePersistence,traceabilityFilePersistence,
workspacePersistence}.ts`, `src/stores/tabStore.ts` — not on the assumption
that today's gap is as wide as the brief describes.

---

## 0. Corrections to the brief

**"Traceability (and eventually Reviews) require users to open the Dashboard
and manually save"** is only half true. I found an existing, working
prototype of exactly the pipeline being requested — for review only:

- Ctrl+S is already bound to `handleSaveWorkspace` (`App.tsx:1207`), not to
  the markdown-only `handleSave`. `handleSaveWorkspace` (`App.tsx:967-978`)
  already calls `saveWorkspace()` (`src/persistence/workspaceSave.ts`), which
  **already saves the markdown document AND the dirty review file in one
  Ctrl+S**, with no Dashboard visit required.
- **Traceability was simply never plugged into this existing pipeline.**
  `handleSaveTraceability`/`handleSaveTraceabilityAs` (`App.tsx:618-670`) are
  structurally identical to their review counterparts but are only ever
  invoked from the Traceability tab's own Save buttons
  (`TraceabilityTab.tsx:173,182`) — never from `handleSaveWorkspace`.

This changes the shape of the work: it's not "build a bundle pipeline from
scratch," it's **"generalize the existing 2-artifact orchestrator into an
N-artifact one, and register traceability into it."** That's good news for
scope, but two things the existing prototype does are *not* good enough to
just reuse as-is:

1. **`saveWorkspace()`'s failure handling is the opposite of what's being
   asked for.** Current implementation (`workspaceSave.ts:10-12`):
   ```ts
   if (docDirty) await saveDoc();
   if (reviewLoaded && reviewDirty) await saveReview();
   ```
   If `saveDoc()` throws, `saveReview()` is **never attempted** — confirmed by
   the existing test's own comment (`tests/unit/workspaceSave.test.ts:78-79`):
   *"review was not called because saveDoc threw synchronously before it."*
   The brief's requirement — one companion failing must never block or
   silently skip another — needs per-item isolation this function doesn't
   have. This is a deliberate behavior change, not a bug-preserving refactor.

2. **Save As does not touch companions at all today.** `handleSaveAs`
   (`App.tsx:892-924`) only calls `saveAsMarkdownFile`, updates
   `fileHandle`/`fileName`/`title`, and calls `saveWorkspaceDoc({ fileHandle,
   fileName })` — **without** `reviewHandle`/`traceabilityHandle`. Two latent
   bugs fall out of this, both relevant to the new design:
   - The in-memory `tab.reviewHandle`/`tab.traceabilityHandle` are left
     pointing at the **old** filename's sidecars after a rename — silently
     wrong, not just missing.
   - The persisted IndexedDB workspace record (`workspacePersistence.ts`)
     **drops** the review/traceability handle fields on the next save,
     because `saveWorkspaceDoc` only writes fields it's explicitly passed
     (`workspacePersistence.ts:53-55`). A page reload after a Save As loses
     the companion handles even though the in-memory tab still has (the
     wrong) ones.

3. **`showSaveFilePicker` grants no directory access — a hard platform
   constraint, not an implementation gap.** This is the load-bearing fact for
   §5 below: FSAA deliberately does not expose a saved file's parent
   directory (same reason `documentBundleService.ts`'s own doc comment gives
   for why sibling discovery needs a `FileSystemDirectoryHandle`, not a file
   handle). First Save and Save As both go through `showSaveFilePicker`
   (`fileAccess.ts:193`, `saveAsMarkdownFile`). Whatever directory the user
   picks for `EngineControl.md`, **the app cannot silently derive a sibling
   handle for `EngineControl.review.json` in that same directory from the
   returned handle alone** — that capability only exists when a separate
   `FileSystemDirectoryHandle` is already held (from "Open Folder"). §5 below
   treats this explicitly rather than assuming it away.

---

## 1. Current architecture

### 1.1 Handle storage — already per-tab, already bundle-shaped

`TabData` (`tabStore.ts:7-22`) already stores three handles side by side:

```ts
fileHandle?: FileSystemFileHandle;
reviewHandle?: FileSystemFileHandle;        // comment at :15 already calls out "companion" naming
traceabilityHandle?: FileSystemFileHandle;  // comment at :17-18 ditto
```

Nothing needs to change here — the per-tab bundle association already exists
in exactly the shape a registry-based pipeline needs.

### 1.2 The two mirror-stores and per-tab swap

`useReviewCommentsStore` and `useTraceabilityStore` are both **single global
stores that mirror only the active tab's data** — confirmed by
`reviewCommentsStore.ts:65-80` and `traceabilityStore.ts:146-173`, both
exposing `load()`/`reset()`/`markSaved()` and nothing tab-scoped internally.
The per-tab illusion is maintained by a swap effect that stashes/restores
state on `activeTabId` change — I found the traceability half of this at
`App.tsx:456-499` (`traceActiveTabId` effect, `stashTraceabilityState`/
`restoreTraceabilityState`/`dropTraceabilityState`). This means: **"save
every dirty companion" always means "save the currently active tab's
companions"** — never reaches across tabs — which is already the only
consistent interpretation given how the stores work, not a new constraint
the design introduces.

### 1.3 documentBundleService.ts — naming/discovery already matches the brief

Already implements exactly the bundle convention described in the brief,
with **zero document metadata in the JSON**:

```ts
// documentBundleService.ts:29-39
export function deriveReviewFileName(markdownName: string): string {
  return markdownName.replace(/\.md$/i, ".review.json");
}
export function deriveTraceabilityFileName(markdownName: string): string {
  return markdownName.replace(/\.md$/i, ".test-traceability.json");
}
```

`findReviewFile`/`findTraceabilityFile` (lines 113-159) do stem-based sibling
discovery given a `FileSystemDirectoryHandle`, already used by
`attemptBundleLoad` (`App.tsx:681-758`) on document open. **No changes needed
here** — the save side just needs to call these same derivation functions,
which it already does for Save As (`App.tsx:549`, `:622`).

### 1.4 Write primitives — already schema-stable, already shared

`reviewFilePersistence.ts` and `traceabilityFilePersistence.ts` are
near-identical parallel structures (`openXFile`/`writeToXHandle`/
`saveXFileAs`), both funneling through the one shared low-level primitive,
`writeToFileHandle` (`fileAccess.ts:149-184`), which already handles the
FSAA readwrite-permission upgrade dance (`queryPermission`/
`requestPermission`) that a handle from `showOpenFilePicker` needs. Both
serializers write only their existing schema fields
(`{_version:1,...comments}` / `{version:1,testCases,links}`) — **confirming
the brief's "no document metadata, no format changes" constraint is already
naturally satisfied**, nothing to guard against.

### 1.5 Dirty-flag conventions (per store, already independent)

| Store | Dirty field | Set true | Set false |
|---|---|---|---|
| `tabStore` | `TabData.isDirty` | any edit (`App.tsx` onUpdate) | `markTabSaved()` after write |
| `reviewCommentsStore` | `isDirty` | any `addComment`/`respondToComment`/etc. | `markSaved()` |
| `traceabilityStore` | `isDirty` | any mutation, or a **repaired** load (`traceabilityStore.ts:158`) | `markSaved()` |

All three are read via `getState()` snapshots inside one-shot save handlers
(no subscriptions needed) — same pattern the new pipeline should keep.

### 1.6 UI surface today

Three near-identical "Save / Save As / Load" button clusters:
`StatusBar.tsx:62-84` (review only — a status pill, not a full control),
`ReviewsTab.tsx:292-310`, `TraceabilityTab.tsx:170-188`
(`data-testid="save-review-btn"`, `"save-traceability-btn"`, etc.). Each
`onSaveX`/`onSaveXAs` prop traces straight to the corresponding
`handleSaveX`/`handleSaveXAs` in `App.tsx`.

---

## 2. Companion registry — the core new abstraction

Replace the hardcoded 2-argument `saveWorkspace()` with a small descriptor
per companion type, and one orchestrator that iterates the list. This is the
concrete answer to "future companion files should register with this
pipeline":

```ts
// src/persistence/companionArtifact.ts (new)
export interface CompanionArtifact<TData> {
  id: string;                      // "review" | "traceability" | future ones
  label: string;                   // "review comments" — for toasts
  deriveFileName(markdownName: string): string;
  isLoaded(): boolean;             // reviewLoaded / traceability `loaded`
  isDirty(): boolean;
  getData(): TData;
  serialize(data: TData): string;  // reuses existing serializeReview / serializeTraceability
  getHandle(tab: TabData): FileSystemFileHandle | undefined;
  markSaved(): void;
  onHandleChange(handle: FileSystemFileHandle): void; // updateActiveTab({ xHandle: handle }) + workspaceDoc persist
}
```

`reviewFilePersistence.ts` and `traceabilityFilePersistence.ts` stay exactly
as they are (their `write.../save...As` functions become the `serialize` +
write step inside each artifact's implementation) — **no changes to the
sidecar read/write layer**, only a new thin adapter per companion type plus
one orchestrator:

```ts
// src/persistence/bundleSave.ts (new, replaces workspaceSave.ts)
export interface CompanionSaveResult {
  id: string;
  status: "saved" | "skipped" | "failed";
  error?: string;
}

export async function saveBundle(
  saveDoc: () => Promise<{ ok: boolean; error?: string }>,
  docDirty: boolean,
  companions: CompanionArtifact<unknown>[],
  writeCompanion: (c: CompanionArtifact<unknown>) => Promise<void>,
): Promise<{ doc: "saved" | "skipped" | "failed"; companions: CompanionSaveResult[] }> {
  const docResult = docDirty ? await saveDoc() : { ok: true };
  const doc = !docDirty ? "skipped" : docResult.ok ? "saved" : "failed";

  const results: CompanionSaveResult[] = [];
  for (const c of companions) {
    if (!c.isLoaded() || !c.isDirty()) { results.push({ id: c.id, status: "skipped" }); continue; }
    try {
      await writeCompanion(c);           // handles "no handle yet" internally (§5)
      c.markSaved();
      results.push({ id: c.id, status: "saved" });
    } catch (e) {
      results.push({ id: c.id, status: "failed", error: (e as Error).message });
      // deliberately NOT rethrown — one failure must not block the next companion
    }
  }
  return { doc, companions: results };
}
```

Key change from today's `saveWorkspace()`: **the markdown save failing no
longer skips companion attempts, and each companion is independently
try/caught** — directly fixing the two failure-isolation gaps in §0.1. Every
companion in the loop still gets attempted regardless of what happened to the
document or to earlier companions in the list; the caller (`App.tsx`) turns
the returned result into one or more toasts (one for the doc, one per failed
companion — successes stay silent/ambient, matching today's low-noise
pattern where only the *first* save of a session or an error gets a toast).

`App.tsx` registers exactly two companions today:

```ts
const companions: CompanionArtifact<unknown>[] = [
  reviewCompanion(reviewStore),        // wraps useReviewCommentsStore
  traceabilityCompanion(),             // wraps useTraceabilityStore
];
```

A third sidecar in the future adds one more descriptor to this array — no
other file changes.

---

## 3. Save flow — Ctrl+S, handles already exist

```
Ctrl+S
  → handleSaveWorkspace (unchanged entry point)
  → saveBundle(saveDoc, tab.isDirty, companions, writeCompanion)
      doc dirty?  → writeToFileHandle(tab.fileHandle, tab.markdown)
      for each companion (review, traceability):
        loaded && dirty?
          has handle? → writeToXHandle(handle, data)      // direct write, no picker
          no handle?  → delegates to §5's create-silently-if-possible path
  → toast per failure; silent on full success
```

No additional dialogs when handles already exist for every dirty artifact —
this is the common steady-state case and needs no new platform capability,
only the registry generalization from §2.

---

## 4. Save As flow (rename) — pending the §5 spike

```
Save As: EngineControl.md → VehicleControl.md
  → saveAsMarkdownFile(...) → new fileHandle              (unchanged, today's flow)
  → for each companion that is loaded (regardless of dirty — a rename
    orphans the old handle either way):
      newName = companion.deriveFileName("VehicleControl.md")
      saveXFileAs(companion.getData(), newName)            // chained native picker, §5
      updateActiveTab({ xHandle: newHandle })
  → saveWorkspaceDoc({ fileHandle, fileName, reviewHandle, traceabilityHandle })
    (fixes the existing bug at App.tsx:914 that drops these fields today)
```

No `removeEntry`/orphan cleanup in this version — each companion picker
already shows the target folder pre-navigated near the new markdown location
(best-effort via `startIn`, same pattern `openReviewFile` already uses), and
the user explicitly confirms each destination, so there's no silent
directory write to clean up after. The old-name sidecar is simply left where
it was; cleaning it up automatically isn't safe without directory listing
access anyway. (If §5's spike lands on the directory-handle fallback
instead, this section reverts to the original `removeEntry`-based design —
noted here so the two sections stay consistent with whichever §5 outcome
ships.)

---

## 5. First Save / Save As UX — REVISED per your feedback, deferred to a Phase-3 spike

**Status: not settled — Phase 1 and 2 don't depend on this; revisit before
starting Phase 3.** My original recommendation (directory-picker-first, §5
v1 below) optimized for "zero dialogs on every future save" and treated
that as the top priority. Your feedback reprioritizes: preserve the
*familiar* single-file Save-As gesture wherever the platform allows it, and
only reach for directory-handle machinery when there's no other way — because
a directory handle brings a second, heavier permission lifecycle (FSAA
directory grants need re-confirming most sessions; `checkDirHandlePermission`/
`requestDirHandlePermission` exist precisely because of this) that a plain
file handle doesn't have. That reprioritization changes the answer, so I
re-examined it rather than just softening the wording.

**The reframe: this may not need a new mechanism at all.** Today's
`handleSaveReviewAs`/`handleSaveTraceabilityAs` (`App.tsx:545-572, 618-646`)
are already exactly the "familiar Save As" gesture — `showSaveFilePicker`
with a pre-derived `suggestedName` (`deriveReviewFileName(tab.fileName)`),
one native dialog, no directory permission involved at all (handles from
`showSaveFilePicker` carry *implicit* readwrite permission —
`reviewFilePersistence.ts` comment, confirmed in §1.4). **The gap isn't that
this flow doesn't exist — it's that nothing calls it automatically.** A
revised Phase 3 could be: on First Save / Save As, run the markdown picker
first (unchanged, exactly today's UX), then — only for stores that are
loaded-and-dirty — chain into that companion's *existing* `saveXFileAs`
automatically, each showing its own native, pre-filled Save dialog. No new
`FileSystemDirectoryHandle` concept, no new permission model, every
resulting handle persists and is reused silently by every future Ctrl+S via
the existing per-file `checkHandlePermission` path — the "no further
prompts" property is preserved by handle reuse, the same way it already
works for the markdown file today, not by remembering a directory.

**The one thing I can't verify from reading code, and want to check before
committing to this:** whether a second (and third) `showSaveFilePicker()`
call, issued programmatically right after the first one resolves — not from
a fresh physical click — reliably proceeds in your target browsers, or
whether "user activation" gets consumed by the first dialog and the second
is silently blocked. This is the "strictly required by the platform" branch
condition you asked for: if chained pickers turn out to be unreliable, *that*
is when falling back to something heavier (one directory picker, or a
"Save companions" button requiring its own explicit click) becomes
necessary — not by default. I'd verify this empirically (a small throwaway
Playwright script against the dev server, same approach used to verify the
scroll-sync feature) as the first step of Phase 3, before writing the real
implementation.

**§5 v1 (directory-picker-first) is kept below for reference, demoted to the
fallback path if chained pickers prove unreliable** — not the default plan
anymore:

<details>
<summary>Original directory-picker proposal (fallback candidate only)</summary>

A `FileSystemDirectoryHandle` is only available from two sources: the
in-session `useWorkspaceStore.dirHandle` (set by "Open Folder") or the
IndexedDB-persisted `workspacePersistence.ts` `WorkspaceDoc.dirHandle`.
When available, `dirHandle.getFileHandle(name, { create: true })` creates a
companion silently — but note the same collision risk flagged originally:
this call **silently overwrites** an existing same-named file with no native
warning, so it would still need a pre-create existence probe + one
confirm-the-whole-bundle dialog if ever implemented.

</details>

---

## 6. Handle management

**Per-file handles remain the primary model** (revised from the §5 v1
"per-tab bundle directory" framing — no new `bundleDirHandle` field unless
the §5 spike lands on the fallback tier). Each companion keeps exactly the
handle shape it has today (`tab.reviewHandle`, `tab.traceabilityHandle`),
acquired via its own chained Save-As picker (§4/§5) and reused silently by
every subsequent Ctrl+S for as long as it stays valid.

**Persisting all handles together.** `saveWorkspaceDoc` (called after every
successful handle-acquiring operation — first save, Save As, a companion's
own "load" picking up a handle) must always pass the *current* values of
`fileHandle`/`reviewHandle`/`traceabilityHandle`, not just the ones that
changed in that call — this directly fixes the bug at `App.tsx:914` (§0.2)
where `handleSaveAs` today passes only `fileHandle`/`fileName` and silently
drops the other two from the persisted record.

**Handle lifetime vs. tab lifetime.** Closing a tab does not need to revoke
or clear its handles — they simply stop being referenced. Reopening the same
`.md` file later re-triggers `attemptBundleLoad`'s existing discovery
(`App.tsx:681-758`), independent of this pipeline.

### 6.1 Stale-handle recovery — the gap you flagged, not covered above until now

A companion handle can stop working two structurally different ways, and the
pipeline needs to tell them apart rather than treating both as one generic
"save failed, stay dirty" outcome:

- **Permission revoked** (`NotAllowedError`) — the file still exists, the
  browser just needs re-asking. Already handled: `writeToFileHandle`
  (`fileAccess.ts:155-173`) queries and, if needed, re-requests `readwrite`
  permission before writing. If the user then denies it, that's a real,
  reportable failure — correctly left dirty, no further automation possible
  without the user's consent.
- **Handle gone stale** (`NotFoundError`, and to a lesser extent
  `NotAllowedError` that persists even after a re-request) — the underlying
  file was deleted, renamed, or moved *outside the app* since the handle was
  captured. This is the case you're asking about, and today's code does NOT
  distinguish it: `handleSaveReview` (`App.tsx:575-593`) only falls back to
  `handleSaveReviewAs` when `tab.reviewHandle` is **absent** — a
  present-but-stale handle instead throws inside the `try`, shows a generic
  error toast, and leaves the user with no discoverable recovery path except
  manually opening the Dashboard and clicking "Save As" themselves. That's
  the "failing indefinitely" behavior you're describing, and it already
  exists today for review, independent of anything new in this design.

**Fix: on `NotFoundError` specifically, treat the handle as if it were never
there and fall straight into the same acquisition path First Save already
uses** (§5) — auto-recreate without asking if a still-valid directory handle
happens to be available for that companion, otherwise show the one
already-existing native Save-As picker, pre-filled with the derived name, as
a single explicit recovery gesture. Concretely, in the `writeCompanion` step
of `saveBundle` (§2):

```ts
try {
  await c.writeToHandle(handle, data);
} catch (e) {
  if ((e as DOMException).name === "NotFoundError") {
    c.clearStaleHandle();       // updateActiveTab({ xHandle: undefined })
    return c.saveAs();          // same picker flow as first save — one gesture, not a dead end
  }
  throw e; // permission-denied-after-retry, or genuinely unexpected — report, stay dirty
}
```

This isn't a new mechanism — it's a new *trigger* for the exact acquisition
logic Phase 3 already has to build, applied reactively (on a write failure)
in addition to proactively (on first save). Worth landing **as part of
Phase 1** (review) rather than deferred to Phase 3, since it's really a
correctness fix to "failure handling never leaves the user stuck," in the
same spirit as the per-companion try/catch isolation already scoped there —
Phase 2 then gets it for traceability for free by reusing the same
`saveBundle` code path.

---

## 7. Compatibility with existing review persistence

- **No JSON schema/format changes**, confirmed already true (§1.4) and
  unaffected by this design — the registry wraps existing serializers, it
  doesn't touch them.
- **Manual Load stays exactly as-is.** `handleLoadReview`/
  `handleLoadTraceability` (`App.tsx:526-542`, `599-615`) are unrelated to
  the save path and need zero changes — "advanced recovery/import" per the
  brief, already implemented as a picker-based escape hatch.
- **Manual Save buttons call the same pipeline, not a parallel path.** Per
  your instruction, `ReviewsTab`'s and `TraceabilityTab`'s `data-testid=
  "save-review-btn"`/`"save-traceability-btn"` buttons (currently calling
  standalone `handleSaveReview`/`handleSaveTraceability`) get rewired to
  invoke `saveBundle` scoped to just that one companion (or the full bundle —
  see open question in §9 Phase 5) instead of their own independent
  handler. `handleSaveReview`/`handleSaveReviewAs`/`handleSaveTraceability`/
  `handleSaveTraceabilityAs` as standalone functions are retired; their
  picker/write logic moves into each companion's `CompanionArtifact`
  implementation and is called from one place.
- **StatusBar's "Unsaved Review Comments" pill** (`StatusBar.tsx:62-84`)
  becomes purely a status readout once Ctrl+S already covers it automatically
  — still useful (shows the user *why* nothing needs manual action), but its
  `onClick={onSaveReview}` now triggers the shared pipeline rather than the
  old standalone save, per the same "no separate persistence path" rule.

---

## 8. Regression risks

- **`workspaceSave.test.ts` encodes the OLD (to-be-changed) failure
  semantics as intentional** (`tests/unit/workspaceSave.test.ts:75-82`) — the
  "review was not called because saveDoc threw synchronously before it" test
  will need its expectation flipped (companion attempted regardless of doc
  outcome) once `saveBundle` replaces `saveWorkspace`. This is an
  intentional, called-out behavior change, not an oversight.
- **Existing `data-testid`s are load-bearing for tests.** `tests/unit/
  traceabilityTab.test.tsx` and likely a `reviewsTab` equivalent reference
  `save-review-btn`/`save-traceability-btn`/`save-review-as-btn`/etc.
  directly. Repurposing what these buttons call (§7) is safe: same testid,
  same visible behavior (still writes the file), only the internal call path
  changes.
- **Multi-tab isolation must hold**: since `reviewCommentsStore`/
  `traceabilityStore` only ever mirror the active tab (§1.2), `saveBundle`
  must always read `getActiveTab(useTabStore.getState())` at call time, never
  a stale closed-over tab reference — same pattern `handleSaveReview` etc.
  already use correctly today, just needs to be preserved in the refactor.
- **Chained-picker reliability is unverified** (§5) — the whole revised
  Phase-3 plan rests on a second/third `showSaveFilePicker()` call succeeding
  without a fresh user gesture. This needs the empirical spike *before*
  Phase 3 is implemented, not discovered mid-implementation.
- **Stale-handle recovery (§6.1) touches an existing, currently-silent gap**:
  once shipped, a companion save that used to fail with a bare error toast
  will instead pop a Save-As picker. That's a visible behavior change for
  anyone who already has a stale handle sitting around — worth a changelog
  note, not just a code diff.
- **Autosave (`useAutosave.ts`) is unaffected** — it's markdown-only,
  IndexedDB-only crash recovery, orthogonal to this disk-write pipeline. No
  change needed, worth stating explicitly so it isn't accidentally scoped in.

---

## 9. Implementation phases

**Approved: proceed with Phases 1 and 2 now.** Phase 3 is gated on the §5
spike — not started until that's resolved.

1. **Registry + `saveBundle` with correct failure isolation, review only,
   including stale-handle recovery (§6.1).** Introduce
   `CompanionArtifact`/`saveBundle` (§2), port review into it, add the
   `NotFoundError` → auto-reacquire path from §6.1, update
   `workspaceSave.test.ts`'s semantics for the new isolation behavior.
   `handleSaveWorkspace`/Ctrl+S steady-state behavior for review is
   unchanged from the user's perspective except when a handle has actually
   gone stale (a real bug fix, not a regression) — this phase is otherwise
   an internal refactor, fully covered by updated unit tests.
2. **Register traceability into the same pipeline.** One new
   `CompanionArtifact` entry, inheriting stale-handle recovery for free.
   This alone delivers the core complaint — traceability no longer needs a
   Dashboard visit for normal saves. Existing handles (documents already
   using Open Folder or already carrying a traceability handle from manual
   load) get automatic Ctrl+S saves immediately; no dialog changes yet.
3. **§5 spike, then First-Save/Save-As chaining.** First: a small
   throwaway script verifying whether sequential `showSaveFilePicker` calls
   survive without a fresh user gesture across target browsers. If yes:
   wire First Save / Save As to chain into each dirty companion's existing
   `saveXFileAs` automatically (§4/§5), plus the `saveWorkspaceDoc` fix
   (§0.2/§6) so all handles persist together. If no: fall back to the §5 v1
   directory-picker design (kept in the `<details>` block) or a
   "Save companions" follow-up button requiring its own click — revisit with
   you once the spike result is in, since either fallback changes the UX
   contract described here.
4. **UI cleanup.** Repurpose `ReviewsTab`/`TraceabilityTab`/`StatusBar` Save
   buttons to call the shared pipeline (§7); update their tests for the new
   call path (same testids, same user-visible behavior).
5. **Open item to confirm before this phase**: should the manual "Save"
   button in `ReviewsTab` (say) save *only* review, or the whole bundle when
   clicked? Leaning toward "whole bundle" — it's simpler (one code path,
   matches "one document" framing) and never surprises the user by silently
   leaving a dirty traceability store behind. Flag if per-companion manual
   save should stay scoped to just that one file.

