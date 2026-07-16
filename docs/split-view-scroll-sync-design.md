# Split View — Scroll Synchronization: Design Specification

Status: **Draft for review** · Design only, no implementation yet.

This document specifies an optional "Sync Scroll" feature for split view (the
rich TipTap editor and the raw-markdown `SourcePane`, shown side by side). It
is grounded in an audit of the current codebase — `src/editor/EditorMain.tsx`,
`src/editor/SourcePane.tsx`, `src/stores/uiStore.ts`, `src/editor/utils/deriveOutline.ts`,
and `src/layout/StatusBar.tsx` — not on the assumption that cross-pane
position mapping already exists.

---

## 0. Correction to the brief

The brief states "Cursor/selection synchronization already exists where
applicable." **This is not accurate.** I audited for it specifically
(grepped the whole `src/` tree for `scrollTop`, `onScroll`, `selectionStart`,
`selectionEnd`, `coordsAtPos`, `posAtCoords` — zero hits outside dependencies)
and read `SourcePane.tsx` end to end. What actually exists:

- Source ⇄ rich sync today is **100% full-document text replacement**, not
  position-aware: `SourcePane.tsx:131` calls
  `editor.commands.setContent(parseMarkdownToDoc(freshest), { emitUpdate: false })`
  on a 250ms debounce, and `App.tsx`'s `onUpdate` does the reverse
  (`serializeDocToMarkdown(editor.getJSON())`) into the tab store. Neither
  direction touches cursor or scroll position.
- The **only** position-based navigation in the app (`OutlinePanel.tsx:1427`,
  `App.tsx:1246`, `findReplace.ts:265,298`) operates purely in ProseMirror
  position space (`editor.chain().setTextSelection(pmPos).scrollIntoView()`)
  and has **no markdown-source counterpart** — clicking an outline heading
  moves the rich editor's cursor; the source `<textarea>` is untouched by it.
- `parseMarkdownToDoc` (`src/markdown/parser.ts`) discards mdast source
  `position` info after the fidelity transformers run (see
  `docs/markdown-architecture.md`, Stage 1 table) — there is no markdown-char-offset
  ⇄ PM-position map surviving into the live document.

This matters directly for the design: **every mapping primitive below has to
be built from scratch.** Nothing about the recommendation below assumes reuse
of a system that turned out not to exist.

What *does* already exist and is genuinely reusable: `deriveOutline(editor)`
(`src/editor/utils/deriveOutline.ts:19`) walks the live PM doc and returns
heading nodes with absolute `pmPos`, and `findActiveHeadingKey` (same file,
line 75) finds "which heading section contains position X" by linear scan.
This is precisely the primitive the recommended design (§5) builds on.

---

## 1. Current architecture

### 1.1 Split-view shell

`src/editor/EditorMain.tsx` renders the two panes. `splitViewOpen: boolean`
(`uiStore.ts:16`) gates the split branch (lines 65–111); `splitCollapsedPane:
"none" | "editor" | "source"` (`uiStore.ts:19`) governs the collapse/maximize
sub-states. Sync Scroll is only meaningful when both panes are visible, i.e.
`splitViewOpen && splitCollapsedPane === "none"`.

```
EditorMain.tsx (split branch, lines 65-111)
├─ rich pane wrapper: <div className="... overflow-y-auto"> (line 75)
│    └─ EditorToolbar + .doc-page > EditorContent (TipTap's contenteditable)
├─ ResizeHandle (drag-resize between panes)
└─ source pane wrapper
     └─ SourcePane → <textarea> (SourcePane.tsx:141) — native scroll container
```

Both scroll containers are currently **anonymous** — neither has a `ref`
attached. That's the first concrete gap: both need refs before anything else
can be built.

### 1.2 Why raw pixel height diverges between panes

Per `CLAUDE.md` and the parser architecture, one markdown source line can
expand into wildly different rendered heights:

| Source construct | Source height | Rendered height |
|---|---|---|
| `\`\`\`mermaid ... \`\`\`` (10 source lines) | 10 lines | Can be 400px+ diagram, or could error/collapse |
| `$$ ... $$` KaTeX block (1-3 lines) | ~2 lines | Varies with formula complexity, fonts |
| `\| a \| b \|` GFM table (N rows) | N lines | Row height depends on cell wrapping, not 1:1 |
| `![alt](url)` image | 1 line | Depends on natural image dimensions |
| Plain paragraph | 1 line per ~80 chars | Depends on pane width, wraps differently than monospace textarea |

This is the load-bearing fact for the whole design: **any strategy that
assumes source-line-count ∝ rendered-pixel-height will drift, and the drift
is worst exactly in the documents this editor is built for** (spec documents
with tables, diagrams, math, requirement badges).

### 1.3 Existing heading/anchor infrastructure (rich side only)

- `deriveOutline(editor): OutlineNode[]` (`deriveOutline.ts:19-64`) — scans
  `editor.state.doc.forEach`, returns `{ pmPos, level, label, key }[]` in
  document order, including one level into blockquote/callout containers.
- `flattenOutline` (line 67) and `findActiveHeadingKey(flat, cursorPos)`
  (line 75) — binary-search-able-in-spirit linear scan for "which heading
  section owns this position." This exact function is the template for
  "which heading section is at the top of the rich pane's viewport."
- `useRequirementIndex.ts:46` wraps `deriveOutline` with a 300ms debounce —
  precedent for how expensive-ish recomputation is throttled in this
  codebase already.

**No source-side equivalent exists.** The `<textarea>` in `SourcePane.tsx` is
an opaque string; nothing scans it for heading lines today.

### 1.4 Persistence pattern (for the new preference)

`src/stores/uiStore.ts` is a `zustand` + `persist` store,
`localStorage` key `"md-editor-ui"`. Boolean toggle end-to-end, using
`sidebarOpen` as the template:

- State: `uiStore.ts:11`
- Actions: `setSidebarOpen`/`toggleSidebar`, `uiStore.ts:25-26`
- Persisted via `partialize` (`uiStore.ts:127`) — note `splitViewOpen`/
  `splitCollapsedPane` are **deliberately excluded** from `partialize`
  (transient view state), whereas `splitSourceWidth` **is** persisted (a
  real preference). `syncScrollEnabled` belongs in the persisted group — it's
  a preference, not transient view state, same as `splitSourceWidth`.
- UI toggle: `Header.tsx:255-257` (`onClick={toggleSidebar}`).

### 1.5 Toolbar precedent

`src/layout/StatusBar.tsx:96-125` — right-aligned button cluster
(`<div className="ml-auto flex items-center gap-2">`, line 58) already
contains the "Split" and "Source" (`<>`) toggle buttons, reading
`splitViewOpen`/`sourceMode` from `useUIStore` and applying an
accent-background-when-active style. This is the exact slot and exact
styling pattern for a new "🔗 Sync Scroll" button.

---

## 2. Evaluated strategies

**A. Raw `scrollTop` sync.** Reject. Per §1.2, pixel height ratio between
source and rendered content is not remotely constant across a real document.
A doc with one large Mermaid diagram would cause the two panes to snap out of
alignment by an amount equal to the diagram's rendered height minus its
10-line source height, and stay wrong for the rest of the scroll.

**B. Percentage-based (`scrollTop / (scrollHeight - clientHeight)` matched
between panes).** Works today with zero new indexing — no headings needed.
Correct on average across the whole document, but locally wrong around any
disproportionate block (large table/diagram): the follower pane will visibly
overshoot approaching such a block and undershoot leaving it, because it has
no idea the block exists. Acceptable as a **fallback**, not a primary
strategy, for documents/regions where no better anchor is available.

**C. Requirement/heading anchor synchronization.** Reuses `deriveOutline` +
the `findActiveHeadingKey` pattern on the rich side; requires one new
lightweight primitive on the source side (regex line scan for heading
markers). Aligns panes at document *structure* rather than pixel geometry,
which is exactly the property that's invariant across the parse/serialize
round trip (the same N headings, in the same order, exist in both
representations of one document). Coarse on its own — between two headings
with no anchors, it degenerates to "no correction until the next heading."

**D. Cursor-based synchronization.** Doesn't fit the requirement at all: the
spec is "whichever pane the user *scrolls* becomes master," not "whichever
pane has focus/cursor." Cursor-based sync would require a cursor-position
mapping between panes, which — per §0 — doesn't exist and isn't what's being
asked for. Rejected as the driving mechanism; scroll events are the trigger,
not selection changes.

**E. Hybrid — heading-anchored piecewise-linear interpolation, with
whole-document percentage as the fallback when anchors are unavailable or
sparse.** This is C with B's smoothness filling the gaps between anchors, and
B as the total fallback when a document has 0 or 1 headings.

### Recommendation: **E**

Justification:

1. **It's structural, not geometric** — the one property that survives the
   markdown ⇄ PM round trip unchanged is document structure (heading count
   and order), not pixel height. Anchoring sync to that property is the only
   strategy that isn't fighting the very fact stated in the brief
   ("rendered height differs from markdown").
2. **Least new plumbing.** The rich-side half (`deriveOutline`,
   `findActiveHeadingKey`-style lookup) already exists and is proven by the
   Outline panel. Only the source-side heading scanner and the
   coordinate/interpolation glue are net-new.
3. **Graceful degradation matches requirement 2** ("not pixel-perfect unless
   the audit proves it reliable" — the audit in §1.2 proves raw pixel sync is
   *not* reliable, so a non-pixel strategy is mandatory; E's fallback to B
   means a headingless document still gets *some* sync instead of none).
4. **Self-correcting around problem content.** A single oversized block
   (table/diagram) between two headings only degrades interpolation *within
   that one section* — the next heading boundary resets alignment exactly,
   unlike B, whose error compounds across the whole document.
5. **Forward-compatible with future section folding** (see §7) — folding
   only changes the interpolation range between two already-tracked anchors,
   not the anchor set itself.

---

## 3. New store fields

`src/stores/uiStore.ts`:

```ts
interface UIState {
  // ...existing fields
  /** Persisted preference: follow scroll position across split-view panes. */
  syncScrollEnabled: boolean;
}

interface UIActions {
  // ...existing actions
  setSyncScrollEnabled(on: boolean): void;
  toggleSyncScroll(): void;
}
```

Default `false` (matches "OFF (default)" in the brief). Added to `partialize`
alongside `splitSourceWidth` — it's a genuine cross-session preference, not
transient view state like `splitViewOpen`/`splitCollapsedPane`.

No other store changes. Anchor caches (heading pairings, per §5) are derived
state local to the sync hook, not global store state — they're meaningless
outside an active split-view session and would just be stale-state risk if
persisted or shared.

---

## 4. Files that would change

| File | Change |
|---|---|
| `src/stores/uiStore.ts` | Add `syncScrollEnabled` field + actions (§3) |
| `src/layout/StatusBar.tsx` | Add "🔗 Sync Scroll" button next to Split/Source, gated on `splitViewOpen && splitCollapsedPane === "none"` |
| `src/editor/SourcePane.tsx` | Accept a forwarded `ref` (or `onScrollRef`-style callback prop) exposing the `<textarea>` DOM node to the parent |
| `src/editor/EditorMain.tsx` | Attach a ref to the rich pane's `overflow-y-auto` wrapper (line 75); pass both refs + `editor` into the new sync hook; mount hook only in the split branch |
| **New** `src/editor/utils/scrollSync.ts` | Pure functions: source heading scanner, anchor pairing, interpolation math (unit-testable without DOM) |
| **New** `src/editor/utils/useScrollSync.ts` | React hook: scroll listeners, loop-prevention guard, calls into `scrollSync.ts`, applies computed `scrollTop` |
| **New** `tests/unit/scrollSync.test.ts` | Pure-function tests for anchor pairing + interpolation |

No changes needed to `src/markdown/parser.ts`, `serializer.ts`,
`deriveOutline.ts`, or any store other than `uiStore.ts` — the design
deliberately avoids touching the fidelity-critical markdown pipeline.

---

## 5. Synchronization algorithm

### 5.1 Anchor construction (recomputed on content change, debounced)

```
richHeadings   = flattenOutline(deriveOutline(editor))          // existing
                   .map(n => n.pmPos)
sourceHeadings = scanSourceHeadingLines(sourceText)              // NEW, regex per line
                   .map(h => h.charOffset)

anchors = zip(richHeadings, sourceHeadings)   // paired by ORDINAL position,
                                               // not by text match
```

Pairing by ordinal index (n-th heading in the rich doc ↔ n-th heading line in
the source), not by matching heading text, because:
- It sidesteps duplicating `deriveOutline`'s "one level into blockquote/callout"
  traversal logic on the source side — the source scanner only needs a plain
  `/^#{1,6}\s/` (plus a `> #` variant for the blockquote case) line scan.
- Source and rich pane are always two views of the *same currently-loaded
  document* — heading count and order are identical whenever both are
  in a settled (non-mid-edit) state.
- If counts mismatch (a heading was just typed/deleted and the 250ms
  `SourcePane` resync hasn't landed yet), fall back to whole-document
  percentage sync (strategy B) for that cycle rather than pairing wrong
  headings — this is the concrete trigger for the "fallback" half of the
  hybrid, not just headingless documents.

Recomputation triggers: `activeTabId` change (new document), and the same
debounce window `SourcePane` already uses for its own resync (250ms) — anchors
are rebuilt right after that resync lands, keeping them consistent with what
both panes are currently showing. This reuses the existing debounce rhythm
rather than inventing a second one.

### 5.2 Pixel position of an anchor, per pane

- **Rich pane:** `editor.view.coordsAtPos(pmPos).top` gives viewport-relative
  Y; add the container's current `scrollTop` and subtract
  `container.getBoundingClientRect().top` to get a position in the
  container's own scroll-content coordinate space. (`coordsAtPos` is a
  standard `prosemirror-view` method, available via `@tiptap/pm`, unused
  elsewhere in the codebase today — confirmed by audit.)
- **Source pane:** no `coordsAtPos` equivalent exists for a `<textarea>`.
  Approximate via `lineNumber × lineHeight`, where `lineHeight` is read once
  from `getComputedStyle(textarea).lineHeight` (the pane uses a fixed
  monospace font + `leading-relaxed`, so this is stable per pane, not
  per-character — good enough for anchor-level granularity, not claimed to
  be exact).

### 5.3 Scroll handler (fires on whichever pane the user is scrolling)

```
onScroll(sourcePane = "rich" | "source"):
  if isSyncingRef.current: return          // §6 loop prevention
  if !syncScrollEnabled: return
  if anchors.length < 2:
    targetRatio = masterPane.scrollTop / (masterPane.scrollHeight - masterPane.clientHeight)
    apply targetRatio to followerPane      // strategy B fallback
    return

  masterScrollTop = masterPane.scrollTop
  find bounding anchor pair [i, i+1] such that anchor[i].masterPx <= masterScrollTop <= anchor[i+1].masterPx
    (clamp to first/last anchor if scrollTop is before the first heading or after the last)
  fraction = (masterScrollTop - anchor[i].masterPx) / (anchor[i+1].masterPx - anchor[i].masterPx)
  followerTarget = anchor[i].followerPx + fraction * (anchor[i+1].followerPx - anchor[i].followerPx)

  isSyncingRef.current = true
  followerPane.scrollTop = followerTarget
  requestAnimationFrame(() => requestAnimationFrame(() => { isSyncingRef.current = false }))
```

Both directions (source→rich, rich→source) use the same function with the
pane roles swapped — one implementation, not two.

---

## 6. Loop-prevention strategy

Single `isSyncingRef` guard (not per-pane — JS is single-threaded, so the
risk isn't concurrent writes, it's **re-entrant dispatch**: setting
`followerPane.scrollTop` synchronously fires that pane's own `scroll`
listener, which would otherwise recurse into "now sync back the other way").

- **Set the guard before writing the follower's `scrollTop`, clear it on a
  double-`requestAnimationFrame`, not synchronously.** `scroll` events in
  real browsers are frequently dispatched on the next frame rather than
  synchronously with the property write; clearing the guard immediately
  after the write would leave a window where the follower's own resulting
  scroll event arrives *after* the guard is already cleared and gets
  misread as a new user-driven master gesture — causing exactly the
  ping-pong the guard exists to prevent. Double-rAF is the standard-robust
  version of this pattern (one rAF for the browser's own scroll-event
  dispatch, a second as margin for coalesced/batched dispatch).
- This same guard **automatically and correctly** covers the existing
  navigation call-sites that already move the rich pane's scroll position —
  `OutlinePanel.tsx:1427`, `App.tsx:1246`, `findReplace.ts:265,298` (Outline
  click, Dashboard→editor jump, Find/Replace next/prev match). None of these
  need to be modified: when one fires `scrollIntoView()`, the rich pane's
  native `scroll` event fires like any user scroll, the sync hook treats it
  as a normal master-pane scroll, and **the source pane correctly follows it
  for free** — this is a desirable emergent behavior (jump to a heading via
  the Outline, and the source pane scrolls to the same heading too), not a
  conflict to guard against. This was a real finding, not an assumption: I
  checked all `scrollIntoView` call sites (§0) and confirmed none of them
  touch the source `<textarea>`, so there's no competing write to arbitrate.

---

## 7. Edge cases

| Case | Behavior under the recommended design |
|---|---|
| **Mermaid / KaTeX / large tables / images** | Handled by construction — these only affect the *interpolation smoothness within one heading-bounded section* (§2, point 4). No global drift. Worst case: scrolling through the diagram itself feels non-linear (a large jump in the rich pane maps to a small textarea-line jump, or vice versa) — cosmetic, not a correctness break, and self-corrects at the next heading. |
| **Folded sections (future)** | Not built yet (confirmed by audit — no folding feature exists). Forward-compatible: folding a section only changes the interpolation *range* between two already-tracked heading anchors (the folded region's pixel height collapses), it doesn't invalidate the anchor pairing itself. |
| **Find/Replace navigation** | `findReplace.ts:265,298` calls `scrollIntoView()` on the rich pane only. Per §6, the source pane follows automatically when sync is on — desirable, no special-casing needed. |
| **Outline navigation** | Same as Find/Replace — `OutlinePanel.tsx:1427` — follows automatically. |
| **Dashboard navigation** | `App.tsx:1246`, same mechanism, same automatic follow. |
| **Tab switching** | Both panes already reload fully independent content on tab switch (`SourcePane.tsx`'s init effect keyed on `[active, activeTabId]`; TipTap content is reset via existing tab-switch logic in `App.tsx`). The anchor cache must be invalidated and rebuilt for the new document on the same `activeTabId` dependency — this is a genuinely new effect, not reuse of an existing one, since no anchor cache exists today. Scroll position of both panes on tab switch is a pre-existing (unrelated) concern, not something this feature changes. |
| **Heading count/order mismatch mid-edit** | Covered in §5.1 — falls back to percentage sync (B) for that cycle rather than pairing mismatched headings. |
| **Zero or one heading in the document** | Falls back permanently to percentage sync (B) for that document — `anchors.length < 2` branch in §5.3. |
| **Split-view resize (`ResizeHandle`)** | Changes `clientWidth`, not `clientHeight`/`scrollHeight` for either pane (panes are stacked vertically, resized horizontally) — no anchor-pixel recompute needed on resize. |
| **Collapse/maximize one pane** (`splitCollapsedPane`) | Sync hook should no-op entirely (not just skip syncing) when either pane is hidden — gate the hook's mount/listener-attachment on `splitCollapsedPane === "none"`, matching the toolbar button's own visibility gate (§1.5, §4). |

---

## 8. Performance considerations

- **Scroll listeners must not do PM tree walks per event.** `coordsAtPos`
  is only called when *rebuilding anchors* (debounced, §5.1), never inside
  the `onScroll` handler itself — the handler only does array lookup +
  linear interpolation against the already-computed `anchors` array (small,
  O(heading count), typically single digits to low hundreds even for large
  spec documents).
- **`onScroll` fires at high frequency** (potentially every frame during a
  drag-scroll or trackpad fling). The handler itself must stay O(1)-ish:
  anchor lookup can be a linear scan (heading counts are small) or, if that
  ever shows up as a bottleneck, binary search over the sorted `masterPx`
  array — not needed at v1 scale.
  Should NOT be wrapped in its own additional throttle/debounce beyond the
  loop-prevention guard — throttling scroll-follow makes the follower pane
  visibly lag/stutter behind the master, which is worse UX than doing the
  (cheap) computation on every event.
- **`getBoundingClientRect()` calls** (needed once per anchor rebuild, not
  per scroll event) force layout reflow if called during a batch of DOM
  writes — keep anchor rebuild reads and the `scrollTop` writes in separate
  ticks (already naturally true since anchor rebuild is debounce-triggered
  by content change, and scroll writes are triggered by user scroll — they
  don't share a call stack).

---

## 9. Regression risks

- **`SourcePane`'s 250ms content-resync** (`SourcePane.tsx:131`,
  `editor.commands.setContent(...)`) changes the rich pane's document height
  out from under any in-flight interpolation. Anchor rebuild is already tied
  to this same resync (§5.1) specifically to keep this from producing a
  visible snap — but the *in-progress* scroll gesture during the 250ms window
  before resync will interpolate against slightly stale anchors. Low risk
  (250ms is short, headings rarely move within one debounce window) but
  worth a manual test pass during implementation, not just unit tests.
- **`isSyncingRef` guard scope.** If the guard is implemented as a plain
  `useRef` local to a hook instantiated separately per pane (rather than one
  shared hook instance owning both listeners), the two panes could each
  think the guard is "theirs" and both writes could be misclassified. The
  hook must own both listeners and both refs from one call site
  (`EditorMain.tsx`), not be instantiated twice.
- **Forwarding a ref out of `SourcePane`** changes its public props contract
  — every existing call site (`EditorMain.tsx:41` non-split branch, `:106`
  split branch) needs the new prop threaded through; low risk since there
  are only two call sites, both in the same file, but worth flagging.
- **jsdom cannot lay out content** (`getBoundingClientRect`, `coordsAtPos`
  via `prosemirror-view`'s internal DOM measurement all return zeros/no-ops
  in the existing Vitest+jsdom setup). This caps what an automated test can
  verify — anchor-pairing and interpolation *math* (§5.1, §5.3) are
  fully unit-testable as pure functions with injected coordinates; the
  actual "does the browser scroll" wiring is not verifiable by the existing
  test infrastructure and needs a manual verification pass (per the `verify`
  skill's guidance on runtime-surface changes) before shipping.

---

## 10. Implementation phases

1. **Store + toolbar plumbing (no sync behavior yet).** Add
   `syncScrollEnabled` to `uiStore.ts`, wire the StatusBar button, gate its
   visibility on `splitViewOpen && splitCollapsedPane === "none"`. Verifiable
   entirely by existing test patterns (store tests + component tests), zero
   scroll-DOM risk.
2. **Ref plumbing.** Forward a ref out of `SourcePane`, attach a ref to the
   rich pane's scroll container in `EditorMain.tsx`. No behavior change,
   purely structural — a good isolated PR.
3. **Percentage-based sync only (strategy B), feature-complete.** Ship the
   `anchors.length < 2` fallback path as the *entire* v1 behavior first, with
   the loop-prevention guard (§6) fully in place. This alone is already
   strictly better than no sync, is the lowest-risk slice, and exercises the
   riskiest part of the design (the guard) in isolation before layering
   heading-anchor complexity on top.
4. **Heading-anchor interpolation (strategy C/E).** Add
   `scanSourceHeadingLines`, anchor pairing, and the bounded-interpolation
   path from §5.1/§5.3 on top of the now-proven guard from phase 3. Ship
   behind the same `syncScrollEnabled` flag — no new user-facing toggle
   needed, this phase only changes fidelity, not the feature surface.
5. **Edge-case hardening.** Tab-switch anchor invalidation, mid-edit
   heading-count-mismatch fallback (§5.1), manual verification pass across
   Mermaid/KaTeX/table-heavy fixtures and the Outline/Find-Replace/Dashboard
   automatic-follow behavior (§6).
