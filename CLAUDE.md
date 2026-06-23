# MD Editor — Developer Reference

## Architecture overview

```
Markdown file
     │  parseMarkdownToDoc (src/markdown/parser.ts)
     ▼
ProseMirror JSON doc (PMNode tree)
     │  TipTap editor
     ▼
ProseMirror JSON doc (after edits)
     │  serializeDocToMarkdown (src/markdown/serializer.ts)
     ▼
Markdown file
```

The editor is a round-trip fidelity tool: markdown in → edit → markdown out.
The canonical form is markdown; the editor is a transformation layer, not a
source-of-truth store.

---

## Inline HTML preservation — the rawHtmlInline invariant

### Problem

Markdown can contain arbitrary inline HTML (`<sub>`, `<kbd>`, `<span class="…">`,
inline `<!-- comments -->`, etc.). Remark parses these as MDAST `html` inline
nodes. Without special handling, the serializer would either escape the angle
brackets or drop the tags.

### Solution

**rawHtmlInline** (`src/editor/extensions/RawHtmlInline.ts`) is a TipTap inline
atom node that stores the raw HTML string verbatim and emits it back as an MDAST
`html` node, bypassing `mdast-util-to-markdown`'s normal escaping logic.

Key properties:
- `group: "inline"`, `inline: true`, `atom: true`, `selectable: false`
- `attrs: { html: string }` — the verbatim HTML fragment (e.g. `"<sub>"`)
- `parseHTML`: matches `span[data-raw-html-inline]` (editor ↔ clipboard path)
- `renderHTML`: emits the html string as a TEXT child of `<span data-raw-html-inline>` — no XSS risk because it's textContent, not innerHTML

The `<br>` special case: `<br>` variants become `hardBreak` PM nodes (not
rawHtmlInline) so that the editor renders them as visual line breaks. Inside
table cells, the serializer re-emits them as `html("<br>")` to prevent GFM's
mdast-util-gfm from collapsing them to a space.

`<u>…</u>` special case: `groupUnderlinePairs` in the parser intercepts `<u>`
and `</u>` html node PAIRS before rawHtmlInline processing and converts them to
an underline mark. This means `<u>` never becomes a rawHtmlInline atom.

### The inherited-marks invariant

**Invariant**: Every `rawHtmlInline` node carries the mark context that was
active at its parse site. These marks are stored in the `marks` field of the PM
node (same field used by text nodes).

Implementation: `flattenSingleNode` (`parser.ts`, case `"html"`) passes
`marks: inherited` when creating rawHtmlInline atoms:

```ts
return node.value
  ? [{ type: "rawHtmlInline", attrs: { html: node.value }, marks: inherited }]
  : [];
```

**Why this matters**: an atom parsed inside a link (`[H<sub>2</sub>O](url)`)
receives `marks: [link(url)]`. An atom parsed at the top level (between two
links) receives `marks: []`. The serializer uses these marks to determine group
membership — it never relies on positional heuristics.

---

## Mark-group serializer — nodesWithMarks

### Problem

The old serializer processed each PM node independently:

```
for each node:
  textNodeToMdast(node)   ← applied mark stack to a SINGLE node
```

This caused `[H<sub>2</sub>O](url)` to split into three separate links
(`[H](url)<sub>[2](url)</sub>[O](url)`) because each text node wrapped itself
in its own link. The accessibility impact: 1 link → 3 links → 3 tab stops.

### Solution

`nodesWithMarks` (`serializer.ts`) is a recursive algorithm that groups
consecutive PM nodes sharing the same outermost mark and wraps the group in a
single MDAST node.

```
nodesWithMarks(nodes, stripped, inTable)
  │
  │  stripped: marks already handled by ancestor calls (grows by 1 per level)
  │
  ├─ hardBreak → emit break/html immediately, no grouping
  │
  ├─ base cases (outerMark is null — no more wrapper marks to handle):
  │   ├─ rawHtmlInline → {type:"html", value}
  │   ├─ text + inlineMath → {type:"inlineMath"}
  │   ├─ text + code      → {type:"inlineCode"}
  │   └─ text (plain)     → {type:"text"}
  │
  └─ group case (outerMark is set):
      ├─ collect j: advance while nodes[j] also carries outerMark with same attrs
      │  STOP at: hardBreak, node lacking outerMark, end of array
      ├─ recurse: nodesWithMarks(group, stripped ∪ {outerMark}, inTable)
      └─ wrap:    applyMark(outerMark, markObj, children)
```

### MARK_PRIORITY

```ts
const MARK_PRIORITY = [
  "link",        // outermost — always wraps everything else
  "bold",
  "italic",
  "highlight",
  "superscript",
  "subscript",
  "underline",
  "strike",      // innermost
];
```

`pickOuterMark(activeMarks)` returns the first entry in this list that any
active mark matches. The order determines nesting: `link` being first means the
serializer always produces `[**text**](url)` (link outside bold), matching the
form remark would produce if bold is inside the link in the original source.

`code` and `inlineMath` are intentionally **excluded** from MARK_PRIORITY. They
are "exclusive" marks that describe the fundamental character of a node (not a
wrapper), so they are emitted as leaf nodes after all wrapper marks have been
stripped. This means `` [`code`](url) `` and `` **`code`** `` both work
correctly: link (or bold) wraps the inlineCode MDAST node.

### Link grouping

Two nodes join the same link group only when their link marks have:
- identical `attrs.href`
- identical `attrs.title`

This is enforced by `markAttrsEqual`. Nodes between two links with the same URL
are NOT merged because they lack the link mark entirely (they were parsed at the
top level, not inside a link).

### Complexity

- Recursion depth ≤ `|MARK_PRIORITY|` = 8
- Each level scans its group O(n) — total O(n × 8) = O(n)
- No mutable shared state; `stripped` is a new Set per call

---

## Block HTML preservation

`rawHtmlBlock` (`src/editor/extensions/RawHtmlBlock.ts`) handles block-level
HTML nodes from remark (e.g. `<details>`, `<div>`, `<!-- comments -->`). It is
an opaque block atom; the serializer emits it as an MDAST block `html` node.

---

## Custom inline mark syntax

Handled by `transformInlineMarks` (`src/markdown/inlineMark.ts`) as a post-parse
MDAST transformer BEFORE the PM node flattening step:

| Syntax       | Mark        | Serialized back as |
| ------------ | ----------- | ------------------ |
| `==text==`   | highlight   | `html("==")` delimiters |
| `^text^`     | superscript | `html("^")` delimiters  |
| `~text~`     | subscript   | `html("~")` delimiters  |

These marks appear in MARK_PRIORITY (highlight, superscript, subscript) and
participate in mark grouping like any other wrapper mark.

---

## Test coverage

| File | What it tests |
| ---- | ------------- |
| `tests/unit/html-fidelity-audit.test.ts` | Every inline HTML construct through the full pipeline (52 tests, all exact round-trips) |
| `tests/unit/link-mark-semantics.test.ts` | Link accessibility invariant, structural position, mixed marks, code interactions (44 tests) |
| `tests/unit/markdown-roundtrip.test.ts` | Full markdown feature coverage + corpus document exact round-trip |
| `tests/fixtures/corpus.md` | Realistic technical document exercising all inline HTML paths |

When adding support for a new inline HTML element:
1. Verify `groupUnderlinePairs` does not consume it.
2. Verify `transformInlineMarks` marks it as OPAQUE (html nodes are OPAQUE by default).
3. The rawHtmlInline path handles it automatically — no parser change needed.
4. Add a fixture to `html-fidelity-audit.test.ts` (Group C).
