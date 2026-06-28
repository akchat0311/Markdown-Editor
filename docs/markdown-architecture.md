# Markdown Pipeline Architecture

This document describes how the editor converts markdown text into a ProseMirror
document and back, with complete fidelity to the original source. It is written
for contributors adding new markdown features or debugging round-trip regressions.

---

## Overview

The editor is a fidelity-first tool. The canonical form of every document is the
markdown file on disk. The editor is a transformation layer, not a store.

```
Markdown source
     │
     │  remark-parse  (+ remark-gfm, remark-math)
     ▼
MDAST  (Abstract Syntax Tree — data is intact, but some information already lost)
     │
     │  MDAST fidelity transformers  (run in order; each is explained below)
     │    1. transformHtmlEntities      src/markdown/entityPreservation.ts
     │    2. transformInlineMarks       src/markdown/inlineMark.ts
     │    3. attachOrderedListItemValues src/markdown/parser.ts
     ▼
Transformed MDAST
     │
     │  MDAST → ProseMirror conversion  src/markdown/parser.ts
     │    blockToPM / listNodeToPM / blockquoteToPM / tableNodeToPM
     │    flattenInline / flattenSingleNode / groupUnderlinePairs
     ▼
ProseMirror JSON document  (held in memory by TipTap)
     │
     │  User edits (TipTap / ProseMirror)
     ▼
ProseMirror JSON document  (after edits)
     │
     │  PM → MDAST conversion  src/markdown/serializer.ts
     │    blockToMdast / listItemToMdast / calloutToMdast / tableToMdast
     │    inlineToMdast / nodesWithMarks / applyMark
     ▼
MDAST
     │
     │  mdast-util-to-markdown  (+ gfmToMarkdown, mathToMarkdown)
     │  with custom listItem handler
     ▼
Raw markdown string
     │
     │  Serializer post-processing  src/markdown/serializer.ts
     │    unescapeUnderscores / &#x20; normalization / trailing-whitespace trim
     ▼
Markdown source  (written to disk)
```

---

## Stage 1 — remark-parse

**Entry point:** `parseMarkdownToDoc` in `src/markdown/parser.ts`

```ts
const processor = unified()
  .use(remarkParse)
  .use(remarkGfm, { singleTilde: false })
  .use(remarkMath);
```

`processor.parse(markdown)` converts the source string into an MDAST tree. By
the time it returns, several pieces of information have already been permanently
discarded:

| Lost information | Reason |
|---|---|
| HTML entity spelling (`&amp;` → `&`) | `mdast-util-from-markdown` decodes character references unconditionally |
| Per-item ordered list numbers | Only `List.start` (first item) is stored; `onenterlistitemvalue` ignores items 2+ |
| Callout alias names (`NOTE`, `CAUTION`, …) | Stored as blockquote text; alias recognition happens later |

These losses are recovered by the **MDAST fidelity transformers** in Stage 2,
which have access to both the tree and the original source string.

**`singleTilde: false`** is set so that `~text~` is not parsed as strikethrough
by remark-gfm. This keeps the tilde available for the custom subscript syntax
(`~text~`), which is applied later by `transformInlineMarks`.

---

## Stage 2 — MDAST fidelity transformers

These three transformers modify the MDAST in-place. They run in this exact order.
Changing the order is a correctness bug, not a style preference.

### 2a. `transformHtmlEntities` — entity preservation

**File:** `src/markdown/entityPreservation.ts`

**Why here:** remark has already decoded character references into plain text.
Text nodes still carry their original `position.start.offset` /
`position.end.offset` pointing into the raw markdown source. Slicing the source
at those offsets and scanning for `&…;` patterns lets us recover the original
entity spelling.

For each entity found, the text node is split: plain-text segments become `text`
nodes; entity spellings become MDAST `html` inline nodes. Downstream,
`flattenSingleNode`'s `case "html"` branch maps these to `rawHtmlInline` PM
atoms, which the serializer emits verbatim.

**Why before `transformInlineMarks`:** `transformInlineMarks` creates synthetic
text nodes from substrings of decoded text. Those synthetic nodes have no
`position` field. If entity recovery ran after, it would silently skip them —
and entities inside highlighted/superscript spans would be lost.

**What it cannot do:** it cannot recover entities whose decoded value is
identical to the raw source text. An entity like `&foo;` (unknown name) is left
as-is by remark; the recovered `html` node will contain `&foo;` verbatim, which
is correct for round-tripping. A *backslash-escaped* entity (`\&amp;`) is
correctly excluded because the backslash count before `&` is odd.

### 2b. `transformInlineMarks` — custom delimiter syntax

**File:** `src/markdown/inlineMark.ts`

**Syntax handled:**

| Source syntax | MDAST node type | PM mark |
|---|---|---|
| `==text==` | `mark` | `highlight` |
| `^text^` | `superscript` | `superscript` |
| `~text~` (single) | `subscript` | `subscript` |

**Why here:** remark has no built-in support for these syntaxes, and extending
the remark tokenizer would be significantly more complex than a post-parse
MDAST walk. By the time this transformer runs, code spans, math, links, and
other structured nodes have already been tokenized, so only genuine plain-text
nodes remain to be inspected. The transformer safely skips all `inlineCode`,
`inlineMath`, `html`, and other opaque node types.

**Why not in the PM converter:** the converter (`flattenSingleNode`) processes
one node at a time; splitting a text node across multiple PM nodes from there
would require returning a slice instead of a single result, complicating the
interface. The MDAST-level split keeps the converter simple.

**Why not at remark parse time:** `processor.parse()` does not run transformer
plugins (those run only when using `processor.process()` or `processor.run()`).
A unified plugin would require switching to `process()`, which changes the
async/sync contract.

### 2c. `attachOrderedListItemValues` — per-item list numbering

**File:** `src/markdown/parser.ts` (inline function)

**Why here:** `onenterlistitemvalue` in `mdast-util-from-markdown` only stores
the first item's number in `List.start`. Items 2+ have no `value` field on
their MDAST `listItem` nodes. Like entity recovery, this is a source-position
trick: each `listItem.position.start.offset` points at the digit(s) of the
marker. A `/^(\d+)[.)]/` match on `source.slice(offset)` extracts the number.

The extracted values are attached to the MDAST nodes as `(li as any).value` so
the downstream `listNodeToPM` call can read them into `listItem.attrs.value`.

**Why not at the serializer level:** the PM schema must declare `value` as an
attribute for ProseMirror to preserve it through edits. If the value were
recovered only at serialize time (e.g. from the MD source on disk), it would
be lost the moment the user made any edit, and the next save would emit
sequential numbers. Storing it in the PM node ensures fidelity through the
full edit session.

---

## Stage 3 — MDAST → ProseMirror conversion

**File:** `src/markdown/parser.ts`

The transformed MDAST is converted to ProseMirror JSON by a recursive set of
functions. This is where the structural decisions happen.

### Block-level dispatch — `blockToPM`

Handles every `RootContent` node type. Key decisions:

- **`"html"` (block)** → `rawHtmlBlock` — the HTML string is stored as an attr.
  No attempt is made to parse or interpret the HTML. Fidelity over editability.
- **`"definition"`** → `linkDefinition` — without this, link definitions would
  be dropped and all associated reference links would lose their URLs.
- **`"code"`** → `codeBlock` with `language` and `metadata` attrs — the
  metadata (everything after the first whitespace in the info string) is
  preserved as a separate attr; `mdast-util-to-markdown` would otherwise
  discard it, and it is needed for Mermaid, line-number directives, etc.
- **`"list"`** → dispatched to `listNodeToPM`.
- **`"blockquote"`** → dispatched to `blockquoteToPM` (callout detection).

### List conversion — `listNodeToPM`

Decides between `taskList / taskItem`, `orderedList / listItem`, and
`bulletList / listItem`. Three fidelity concerns:

1. **`spread` attr** — `List.spread` (blank lines between items) and
   `ListItem.spread` (blank lines within an item) are stored on the PM nodes.
   The `SpreadBulletList`, `SpreadOrderedList`, and `SpreadListItem` TipTap
   extensions declare these attrs so ProseMirror does not strip them. Without
   explicit attr declarations, ProseMirror normalizes unknown attrs away during
   `setContent` → `getJSON`.

2. **`start` attr** — `orderedList.attrs.start` stores the first item's number
   for correct sequential fallback when `value` is absent.

3. **`value` attr** — `listItem.attrs.value` stores the per-item marker number
   recovered by `attachOrderedListItemValues`.

### Callout detection — `blockquoteToPM`

When the first child of a blockquote is a paragraph whose text matches
`/^\[!(\w+)\]$/i`, the blockquote is a callout. `parseCalloutFull` returns
both the canonical type (`"info"`, `"warning"`, `"success"`, `"danger"`) and
the original marker word (`"NOTE"`, `"note"`, `"CAUTION"`, …). Both are stored
as PM attrs (`type` for rendering, `marker` for serialization).

Non-matching blockquotes become standard `blockquote` PM nodes.

### Inline conversion — `flattenInline` / `flattenSingleNode`

Converts an array of MDAST phrasing content nodes to PM inline nodes. The two
fidelity operations that live here (rather than in a separate MDAST transformer)
are:

**Underline pairing — `groupUnderlinePairs`**

Consecutive `html("<u>")` / `html("</u>")` node pairs are grouped into a single
underline mark spanning the nodes between them. This cannot be done as a prior
MDAST transform because `<u>` and `</u>` are separate MDAST `html` inline
nodes; recognising them as a matching pair requires scanning the sibling list,
which is only natural to do at the point where the sibling list is being
iterated. A separate MDAST transformer that converted `<u>…</u>` pairs into a
wrapper node would work, but it would add complexity (paired-delimiter matching,
unmatched-tag handling) with no benefit — the same code already runs here.

**Reference links — `flattenSingleNode` case `linkReference` / `imageReference`**

Reference-style links (`[text][ref]`) and image references (`![alt][ref]`) are
stored in the PM document as `rawHtmlInline` atoms containing their raw markdown
text (e.g. `[text][ref]`). This is the correct structural choice because:

- ProseMirror has no native "reference link" node type.
- The referenced definition must stay in sync with the link text for re-parse to
  reconstruct the `linkReference` node correctly.
- Storing the raw markdown text inside a `rawHtmlInline` atom means it passes
  through the editor untouched and is emitted verbatim by the serializer.

**LaTeX (inline math) — `flattenSingleNode` case `inlineMath`**

The `$…$` delimiters are stripped; the LaTeX source is stored as text content
with the `inlineMath` mark. The serializer re-adds the `$` delimiters.

**`<br>` variants — `flattenSingleNode` case `html`**

`<br>`, `<br/>`, `<BR>` etc. are converted to `hardBreak` PM nodes for visual
rendering. All other inline HTML becomes `rawHtmlInline`.

**Inherited marks**

`flattenInline` passes the current mark context (`inherited: PMMark[]`) down
through recursive calls. When a `rawHtmlInline` atom is created, it receives
these inherited marks. The serializer uses them to coalesce consecutive nodes
sharing the same outermost mark into a single MDAST wrapper — e.g.
`[H<sub>2</sub>O](url)` becomes one `link` MDAST node (one `<a>` element, one
tab stop) rather than three.

---

## Stage 4 — ProseMirror (editor)

The PM JSON document is held by TipTap. Normal editing, cursor movement, and
command dispatch happen here. No fidelity logic runs at this stage; it is all
handled at the boundaries.

The fidelity invariants that survive editing:

- `spread`, `start`, and `value` attrs on list nodes — because the `Spread*`
  extensions declare them.
- `rawHtmlInline` and `rawHtmlBlock` attrs — stored in standard PM node attrs.
- `callout.type` and `callout.marker` attrs — declared in `Callout.ts`.
- `codeBlock.language` and `codeBlock.metadata` attrs — declared in
  `MermaidCodeBlock`.
- `linkDefinition.label`, `.url`, `.title` attrs — declared in `LinkDefinition`.

**When the user edits a list item:** the `value` attr is `null` on newly
inserted items (the TipTap extension defaults). The serializer falls back to
sequential numbering for those items. Existing items with stored values are
not affected.

**When the user changes a callout type via the dropdown:** `CalloutView.tsx`
sets `marker: null` alongside the new `type`. This prevents the stale original
marker from being carried forward to the wrong type.

---

## Stage 5 — PM → MDAST conversion

**File:** `src/markdown/serializer.ts` — `serializeDocToMarkdown`

The PM JSON is converted to an MDAST tree by `blockToMdast` and its helpers.

### Ordered list serialization — `listItemToMdast` + `listItemHandler`

`listItemToMdast` copies `node.attrs.value` onto the MDAST `listItem` as a
non-standard `value` field. The custom `listItem` handler in
`TO_MARKDOWN_OPTIONS.handlers` reads this field and temporarily patches
`parent.start = node.value` + `incrementListMarker = false` before calling
`defaultHandlers.listItem`. This causes the built-in handler to compute
`start + 0 = value`, producing the exact marker number.

The GFM extension also provides a `listItem` handler (for task-list checkboxes).
It is loaded first via `extensions`. The top-level `handlers` option runs second
and would clobber the GFM handler. To avoid this, the custom handler holds a
reference to `gfmTaskListItemToMarkdown().handlers.listItem` and delegates to
it for all non-per-item cases.

### Callout serialization — `calloutToMdast`

Reads `node.attrs.marker` (e.g. `"NOTE"`) if present; otherwise falls back to
`formatCalloutMarker(type)` (e.g. `"[!INFO]"`). This preserves alias spellings
and casing exactly as authored.

### Mark-group serialization — `nodesWithMarks`

The central challenge of inline serialization: consecutive PM nodes that share
a mark (e.g. `H`, `<sub>`, `2`, `</sub>`, `O` all inside a link) must become
a single MDAST `link` node, not N separate link nodes. `nodesWithMarks` solves
this by grouping by outermost mark and recursing with that mark stripped.

`MARK_PRIORITY` controls nesting order:

```ts
const MARK_PRIORITY = [
  "link",        // always outermost
  "bold",
  "italic",
  "highlight",
  "superscript",
  "subscript",
  "underline",
  "strike",      // always innermost
];
```

`code` and `inlineMath` are **excluded** from `MARK_PRIORITY`. They describe a
node's fundamental character (raw/verbatim), not a wrapper. They are emitted
as leaf nodes after all wrapper marks have been stripped.

### Table `<br>` serialization

Inside table cells, `hardBreak` PM nodes are emitted as `{type:"html",
value:"<br>"}` rather than `{type:"break"}`. This is because
`mdast-util-gfm` collapses `break` nodes inside table cells to a space.

---

## Stage 6 — mdast-util-to-markdown

`toMarkdown(root, TO_MARKDOWN_OPTIONS)` converts the MDAST tree to a markdown
string. The non-default options and their rationale:

| Option | Value | Reason |
|---|---|---|
| `bullet` | `"-"` | Project convention; `-` is the canonical bullet |
| `bulletOther` | `"*"` | Alternate bullet for adjacent lists to prevent thematic-break collisions |
| `emphasis` | `"*"` | Canonical emphasis; reserves `_` for non-emphasis use |
| `strong` | `"*"` | Canonical strong; reserves `__` |
| `fence` | `` "`" `` | Canonical fence character |
| `fences` | `true` | Always use fenced code blocks (never indented) |
| `incrementListMarker` | `true` | Sequential fallback for items without stored `value` |
| `listItemIndent` | `"one"` | Single space after list bullet |
| `rule` | `"-"` | Canonical thematic break character |
| `ruleSpaces` | `false` | No spaces between dashes in thematic breaks |
| `tightDefinitions` | `true` | Link definitions have no blank lines between them |
| `singleTilde` | `false` | ` ~~text~~ ` for strikethrough; preserves `~` for subscript |
| `handlers.listItem` | custom | Per-item ordered list numbering |

---

## Stage 7 — Serializer post-processing

After `toMarkdown` produces a string, three cleanup passes run in
`serializeDocToMarkdown`:

### `&#x20;` → ` ` (space normalization)

`mdast-util-to-markdown` encodes trailing spaces as `&#x20;` to make them
visible in the source. The editor uses these for a specific purpose in some
constructs (table cell padding). They are restored to literal spaces because
that is how the original source was written.

### Trailing whitespace trim

Every line has trailing horizontal whitespace stripped (regex `/[^\S\r\n]+$/gm`).
This normalizes lines that mdast-util-to-markdown emits with incidental trailing
spaces (e.g. table row padding).

### `unescapeUnderscores` — unnecessary escape removal

`mdast-util-to-markdown` maintains an additive-only `unsafe` list that escapes
characters that could be misread as markdown syntax. Two of its escape rules
produce unnecessary backslashes in our codebase:

**`\_` → `_`**
Underscores in identifiers like `REQ_001` get backslash-escaped because they
could form emphasis (`_text_`). Since the editor uses `*` for emphasis
(not `_`), underscores in plain text are never emphasis delimiters.

**`\[text]` → `[text]`**
Square brackets that are not followed by `(` or `[` (i.e. they cannot start a
link or reference) get backslash-escaped. Requirement status markers like
`[Draft]` are not links.

The unescape is skipped inside fenced code blocks, `$$` display-math blocks,
and `$…$` inline-math spans where `\` is LaTeX syntax, not a markdown escape.

The `\[!TYPE]` pattern for callout markers is explicitly excluded:
the `(?!!)` negative lookahead in the bracket-unescape regex preserves the
backslash before `[!`, which correctly prevents `[!NOTE]` from being parsed as
a link on re-read.

---

## Fidelity features reference

### HTML entity preservation

| Aspect | Detail |
|---|---|
| Stage | MDAST transformer (`transformHtmlEntities`) |
| Mechanism | Source-position slice + entity regex + parallel (si, di) walk |
| PM representation | `rawHtmlInline` atoms with `attrs.html = "&amp;"` etc. |
| Serializer path | `nodesWithMarks` base case → `{type:"html", value:"&amp;"}` |
| Cannot run earlier | remark has already decoded entities before the tree is returned |
| Cannot run later | `transformInlineMarks` creates synthetic text nodes without positions |

### Ordered list marker preservation

| Aspect | Detail |
|---|---|
| Stage | MDAST transformer (`attachOrderedListItemValues`) + custom serializer handler |
| Mechanism | `listItem.position.start.offset` → `/^(\d+)[.)]/` match on source |
| PM representation | `listItem.attrs.value: number \| null` |
| Serializer path | `listItemToMdast` → `listItemHandler` patches `parent.start` |
| Cannot use MDAST | `listItem` has no `value` field in the MDAST spec |
| Cannot use serializer only | `value` must survive editing in PM attrs; serializer-only recovery would lose it on first edit |

### Inline mark transforms (highlight / superscript / subscript)

| Aspect | Detail |
|---|---|
| Stage | MDAST transformer (`transformInlineMarks`) |
| Mechanism | Regex splits on `==…==`, `^…^`, `~…~` within text nodes |
| PM representation | `highlight`, `superscript`, `subscript` marks |
| Serializer path | `applyMark` emits `html("==")` / `html("^")` / `html("~")` delimiter pairs |
| Cannot use remark | remark plugin interface requires `process()` not `parse()`; regex approach is simpler |

### Underline pairing

| Aspect | Detail |
|---|---|
| Stage | MDAST → PM conversion (`groupUnderlinePairs` inside `flattenInline`) |
| Mechanism | Paired `html("<u>")` / `html("</u>")` siblings → `underline` mark |
| PM representation | `underline` mark |
| Serializer path | `applyMark("underline")` emits `html("<u>")` … `html("</u>")` flanking nodes |
| Cannot be earlier | Requires scanning sibling list; no richer structural representation in MDAST |

### Raw HTML preservation (block)

| Aspect | Detail |
|---|---|
| Stage | MDAST → PM conversion (`blockToPM` case `"html"`) |
| Mechanism | MDAST block `html` node → `rawHtmlBlock` PM atom with `attrs.html` |
| Serializer path | `blockToMdast` case `"rawHtmlBlock"` → `{type:"html", value:…}` |
| Why atom | Block HTML is opaque; no in-editor editing is intended or safe |

### Raw HTML preservation (inline)

| Aspect | Detail |
|---|---|
| Stage | MDAST → PM conversion (`flattenSingleNode` case `"html"`) |
| Mechanism | MDAST inline `html` node → `rawHtmlInline` PM atom |
| PM representation | `rawHtmlInline` node with `attrs.html` and inherited mark context |
| Serializer path | `nodesWithMarks` base case → `{type:"html", value:…}` |
| Inherited marks | Atoms inside links receive the link mark; serializer groups them into one `link` node |
| `<br>` special case | `<br>` variants → `hardBreak`; inside tables → re-emitted as `html("<br>")` to avoid GFM collapsing |

### Reference links

| Aspect | Detail |
|---|---|
| Stage | MDAST → PM conversion (`flattenSingleNode` cases `linkReference` / `imageReference`) |
| Mechanism | Raw markdown text (`[text][ref]`, `![alt][ref]`) stored verbatim in `rawHtmlInline` |
| Serializer path | Emitted as `{type:"html", value:"[text][ref]"}` → passes through verbatim |
| Why rawHtmlInline | No PM node type for "reference link"; the raw text + definition pair must stay in sync |

### Link definitions

| Aspect | Detail |
|---|---|
| Stage | MDAST → PM conversion (`blockToPM` case `"definition"`) |
| Mechanism | MDAST `definition` node → `linkDefinition` PM block atom |
| PM representation | `linkDefinition` with `label`, `url`, `title` attrs |
| Serializer path | `blockToMdast` case `"linkDefinition"` → MDAST `definition` node |
| Why not rawHtmlBlock | `mdast-util-to-markdown` handles URL / title quoting correctly for `definition` nodes; preserving structure is better than raw text |

### Callout preservation

| Aspect | Detail |
|---|---|
| Stage | MDAST → PM conversion (`blockquoteToPM`) + serializer (`calloutToMdast`) |
| Mechanism | First child paragraph matches `/^\[!(\w+)\]$/i`; `parseCalloutFull` returns both canonical type and original marker |
| PM representation | `callout` node with `attrs.type` (canonical) and `attrs.marker` (original spelling) |
| Serializer path | `calloutToMdast` uses `attrs.marker` when set; falls back to `formatCalloutMarker(type)` |
| UI reset | `CalloutView` sets `marker: null` on type-change so stale markers cannot persist across a type switch |

### Code block metadata

| Aspect | Detail |
|---|---|
| Stage | MDAST → PM conversion (`blockToPM` case `"code"`) |
| Mechanism | `node.meta` (everything after the first whitespace in the fence info string) → `codeBlock.attrs.metadata` |
| PM representation | `codeBlock` with `language` and `metadata` attrs (declared by `MermaidCodeBlock`) |
| Serializer path | `blockToMdast` case `"codeBlock"` → `{type:"code", lang:…, meta:…}` |
| Why separate attr | Without `metadata`, `title="Example"` in ` ```ts title="Example" ` is silently dropped; ProseMirror strips undeclared attrs |

### Loose list preservation

| Aspect | Detail |
|---|---|
| Stage | MDAST → PM conversion (`listNodeToPM`) + serializer |
| Mechanism | `List.spread` and `ListItem.spread` → `spread` attrs on PM list/item nodes |
| PM representation | `spread` attr on `bulletList`, `orderedList`, `taskList`, `listItem`, `taskItem` |
| Serializer path | `listItemToMdast` reads `spread`; `mdast-util-to-markdown` uses it for blank-line output |
| Why custom extensions | TipTap's built-in list extensions do not declare `spread`; ProseMirror strips undeclared attrs silently |

### LaTeX preservation (block and inline)

| Aspect | Detail |
|---|---|
| Stage | MDAST → PM conversion |
| Inline mechanism | `inlineMath` MDAST node → text with `inlineMath` mark; `$` delimiters stripped |
| Block mechanism | `math` MDAST node → `codeBlock` with `language: "$$"` sentinel |
| Serializer (inline) | `nodesWithMarks` → `{type:"inlineMath", value:…}` → mathToMarkdown adds `$…$` |
| Serializer (block) | `blockToMdast` case `"codeBlock"` detects `language === "$$"` → `{type:"math", value:…}` |
| `unescapeUnderscores` | Skips `$…$` inline-math spans because `\` is LaTeX syntax, not markdown |

### Table `<br>` preservation

| Aspect | Detail |
|---|---|
| Stage | Serializer (`nodesWithMarks` with `inTable = true`) |
| Mechanism | `hardBreak` inside a table cell → `{type:"html", value:"<br>"}` instead of `{type:"break"}` |
| Why | `mdast-util-gfm` serializes `break` inside a table cell as a space, destroying the line break |
| Why not stored as html | `hardBreak` PM nodes are the correct semantic form; the re-emission as `html` is a serializer-only workaround |

---

## Design principles

These rules should guide all future work on the pipeline.

**1. Canonical form is the file, not the PM document.**
The serializer must produce output that remark can parse back into an equivalent
PM document. If round-tripping a document produces a different file without user
edits, that is a bug.

**2. Recover information from source positions, not heuristics.**
When remark discards information (entity spelling, per-item list numbers), use
`position.start.offset` to recover it from the original source string. This is
exact. Heuristics (e.g. "re-encode every `&`") produce false positives.

**3. Store fidelity information in PM attrs.**
If a piece of information must survive user edits, it belongs in a PM attr
declared on the appropriate extension. Information that is only needed at
serialize time but cannot be recovered from structure (e.g. original marker
casing) must be stored in attrs, not recomputed.

**4. Prefer structural transformations over regex post-processing.**
`unescapeUnderscores` is the last resort. New constructs should be handled by
extending the PM schema or customizing the `toMarkdown` handler, not by adding
another regex to the post-processing pass.

**5. Mark extension declarations as load-bearing.**
`addAttributes()` declarations in TipTap extensions are not optional metadata.
ProseMirror silently strips any attr not declared in the schema. Every attr that
the serializer reads must be declared. Add attrs to the relevant extension before
writing parser code that stores them.

**6. MDAST transformers run in a fixed order.**
`transformHtmlEntities` must run before `transformInlineMarks` because entity
recovery needs original `position` data. `attachOrderedListItemValues` can run
last because it only reads positions, not decoded text. Changing this order is a
correctness bug.

**7. Do not attempt to invert mdast-util-to-markdown's unsafe escapes selectively.**
The `unescapeUnderscores` post-processing removes two specific unnecessary
escapes (`\_` and `\[…]`). Do not add more removals without verifying that the
unescaped character cannot appear in a context where it would trigger markdown
parsing on re-read.

**8. The GFM task-list handler is a dependency, not a built-in.**
The `handlers.listItem` override in `TO_MARKDOWN_OPTIONS` runs after the GFM
extension's handler. Any future override must delegate to the GFM handler for
unordered list items; otherwise task-list checkboxes (`[x]` / `[ ]`) will be
silently dropped.

---

## Extension guide — where does a new construct belong?

Use this decision tree when adding support for a new markdown construct.

### Does remark parse it into the MDAST correctly?

**No — the syntax is non-standard (e.g. `==highlight==`, `^super^`):**
→ Add an **MDAST transformer** (Stage 2). Walk the tree, find the text nodes,
and split them into custom MDAST nodes. Add a case to `flattenSingleNode` in
the PM converter. Add the serializer path in `applyMark` or `blockToMdast`.

**Yes — remark handles it but loses information during parsing:**
→ Add an **MDAST transformer** that reads source positions to recover the lost
data. Attach the recovered data to the MDAST nodes as non-standard fields before
the PM converter runs.

**Yes — remark parses it but the PM schema has no node type for it:**
→ Add a **PM extension** (a new `Node.create()` or `Mark.create()`). Handle the
MDAST → PM mapping in `blockToPM` or `flattenSingleNode`. Handle the PM → MDAST
mapping in `blockToMdast` or `nodesWithMarks`. Make sure to declare all attrs
that the serializer reads.

### Where does the information live at serialize time?

**In PM node attrs (e.g. `spread`, `value`, `marker`):**
→ Read it in the appropriate `*ToMdast` function and attach it to the MDAST
node. If `mdast-util-to-markdown` doesn't support it natively, use a custom
handler in `TO_MARKDOWN_OPTIONS.handlers`.

**As opaque content (raw HTML, raw markdown text):**
→ Use `rawHtmlInline` or `rawHtmlBlock` as the PM representation. The serializer
emits them as MDAST `html` nodes, which `mdast-util-to-markdown` outputs verbatim.

**As a structural transformation (e.g. ordered list numbering):**
→ Use a custom `handlers.*` entry in `TO_MARKDOWN_OPTIONS`. Hold a reference to
`defaultHandlers.*` (and any GFM extension handler) and delegate for cases your
custom logic does not handle.

### Does it require post-processing on the serialized string?

Avoid this if at all possible. If a backslash escape is unnecessary, fix it in
`unescapeUnderscores`. Do not add regex-based transformations that operate on
the markdown string for anything that has structural content — those transforms
are fragile and order-dependent.

### Schema checklist for a new PM node

1. Does it need `atom: true`? (opaque content that ProseMirror cannot split)
2. Does it need `selectable: false`? (inline atoms the cursor passes over)
3. What attrs does the serializer read? → declare them all in `addAttributes()`.
4. Does `renderHTML` / `parseHTML` round-trip correctly for the TipTap HTML
   clipboard path (not the markdown path)?
5. If it replaces a StarterKit node, add `nodeName: false` to
   `StarterKit.configure({…})` and export the replacement from `SpreadLists.ts`
   or a new file.

---

## Known limitations

The following source normalizations are intentional and are not treated as bugs.

| Construct | Original | Normalized |
|---|---|---|
| Emphasis delimiter | `_text_` | `*text*` |
| Strong delimiter | `__text__` | `**text**` |
| Bullet style | `* item` or `+ item` | `- item` |
| Thematic break style | `***` or `___` | `---` |
| Thematic break spacing | `- - -` | `---` |
| Fenced code style | `~~~` fences | ` ``` ` fences |
| Ordered list delimiter | `1)` style | `1.` style |
| Setext headings | `Heading\n======` | `## Heading` |
| Link title quoting | `[text](url 'title')` | `[text](url "title")` |
| Bare autolinks | `<https://example.com>` | `https://example.com` (when autolink is enabled) |
| Indented code blocks | four-space-indented code | fenced code block |
| Consecutive blank lines | three or more blank lines | two blank lines |

These normalizations happen because `mdast-util-to-markdown` has its own
canonical form for each construct and there is no API to opt out per-construct.
Adding preservation for any of these would require either a custom serializer
handler or additional source-position recovery, and none are commonly significant
for the documents this editor targets.
