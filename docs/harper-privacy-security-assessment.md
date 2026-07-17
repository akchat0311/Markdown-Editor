# Harper — Privacy & Security Assessment

Status: **Draft for review** · Extends `docs/harper-integration-architecture.md`.
Source-level audit, not a documentation-only review. No implementation.

## Methodology

Rather than trust the project's own "privacy-first" tagline, this audit
cloned `Automattic/harper` (`master`, shallow clone, audited on the date of
this document) and grepped the actual source across every angle that could
leak document content: network-capable crate/package dependencies, direct
`fetch`/`XMLHttpRequest`/`WebSocket` call sites, and telemetry/analytics
keywords — across the *entire* monorepo, then narrowed to characterize
exactly which findings apply to the packages we'd actually pull in
(`harper.js`, `harper-wasm`, `harper-core`, `lint-framework`,
`harper-editor` — the npm-installable, embeddable pieces) versus the
project's other, separate products (marketing website, browser extension,
desktop app, LSP server) that we would never depend on.

**What this audit is not**: not a line-by-line formal security audit or
pen-test, not a disassembly/verification that the published `.wasm` binary
matches this source (a standard trust assumption for any open-source
dependency consumed as a compiled artifact), and not a recursive audit of
`harper-core`'s own transitive dependencies' dependencies (a `cargo audit`
pass is recommended before actual implementation, not performed here). It
is a targeted, comprehensive, source-level check of every plausible
network/telemetry vector — real evidence, not marketing claims taken on
faith.

---

## 1. Network requests — `harper.js` / `harper-wasm` / `harper-core`: none

**Zero hits.** Grepped `packages/harper.js/`, `harper-wasm/`,
`harper-core/`, `packages/lint-framework/`, and `packages/harper-editor/`
for `fetch(`, `XMLHttpRequest`, `new WebSocket`, `axios.` — nothing.

**Dependency-tree confirmation** (not just call-site grepping — checked
what's even *capable* of making a network call): `harper-core/Cargo.toml`
and `harper-wasm/Cargo.toml` depend only on data-structure crates (`fst`,
`hashbrown`, `trie-rs`), text-processing crates (`pulldown-cmark`, `regex`,
`unicode-*`), serialization (`serde`, `serde_json`), and WASM bindings
(`wasm-bindgen`, `serde-wasm-bindgen`). **No `reqwest`, `hyper`, `ureq`,
`tokio`, or any other network-capable crate appears anywhere in either
dependency list.** `harper.js`'s own `package.json` has exactly one
dependency: `fflate` (a pure compression library, used for decompressing
the WASM payload/dictionaries — not networking).

The only place a network-capable crate appears in the *whole monorepo* is
`harper-ls` (the Language Server Protocol binary used by desktop editor
integrations like Neovim/Emacs), which imports `tokio::net::TcpListener` —
verified this is a **local TCP socket for LSP client↔server IPC**
(`harper-ls/src/main.rs:58`, `TcpListener::bind(DEFAULT_ADDRESS)`, gated
behind a `--stdio` flag that defaults to stdio transport instead). This is
a separate compiled binary we would never embed — irrelevant to a browser
integration via `harper.js`, but included here for completeness rather
than silently omitted.

## 2. Rule/dictionary updates fetched at runtime — none

No auto-update mechanism exists in `harper.js`/`harper-wasm`/`harper-core`.
The one customization mechanism — **"Weirpacks"**, Harper's custom
rule-pack format — is entirely local: `loadWeirpackFromBlob(blob)` and
`loadWeirpackFromBytes(bytes)` are the *only* loading methods that exist
(`packages/harper.js/src/Linter.ts`, `LocalLinter.ts`, `WorkerLinter/index.ts`,
`harper-wasm/src/lib.rs:529-532`) — both take caller-supplied binary data.
**There is no `loadWeirpackFromUrl` or equivalent** anywhere in the source.
If we ever wanted to let a user "install" a Weirpack, that would be *our*
code choosing to fetch or read a file — Harper itself never reaches out to
find one.

## 3. Telemetry — none

Grepped for `telemetry`, `analytics`, `sentry`, `posthog`, `mixpanel`,
`amplitude`, `segment.io`, `google-analytics`, `gtag` across every `.rs`/
`.ts`/`.js`/`.toml` file in the repo. The only hits anywhere were two false
positives inside `harper-core`'s own unit tests — the word **"analytics"**
appearing as *example prose the grammar checker analyzes*
(`harper-core/src/linting/plural_decades/four_digits.rs:783`: `"...esoteric
analytics blog posts of the 2010's..."`; `compound_nouns/mod.rs:166`:
`"The dash board shows real-time analytics."`) — not telemetry code.

The one crate with a suggestive name, **`harper-stats`**, was inspected in
full (`harper-stats/src/lib.rs`, `record.rs`, `summary.rs`): it's a
purely local, in-memory `Stats { records: Vec<Record> }` structure for
summarizing lint counts (e.g. "how many issues of each kind were found")
via `std::io` read/write — no network dependency in its `Cargo.toml`
(`uuid`, `chrono`, `serde` only), no transmission of any kind. It exists to
produce local summaries (e.g. for CLI output), not to report anywhere.

## 4. Document content sent externally — never, in the embeddable library

This is the question that matters most for confidential engineering
documents, so it gets the most scrutiny: **within `harper.js`/
`harper-wasm`/`harper-core`/`lint-framework`/`harper-editor` — the code
that would actually ship in our bundle — there is no code path, default or
optional, that transmits any text anywhere.** Confirmed by both the network
call-site search (§1) and the dependency-tree check (§1) — there's nothing
present that even *could* send content over a network within these
packages.

**The one exception in the entire monorepo**, found and fully traced: the
separate **Chrome extension** product (`packages/chrome-plugin/`, not
`harper.js`) has a "Report Problematic Lint" feature
(`packages/chrome-plugin/src/popup/ReportProblematicLint.svelte`) that
POSTs to `https://writewithharper.com/api/problematic-lints`. Traced end to
end:

- **Explicit and user-initiated** — a form the user must open and submit,
  not a background process.
- **Disclosed in the UI itself**: *"Only the data you enter below will be
  sent to the Harper maintainer."*
- **Scoped to exactly three fields**: the specific `example` text (a
  form-editable field, defaults to the flagged phrase but the user can
  change it — not an automatic bulk-document capture), `rule_id`, and free
  -text `feedback`. Not the document, not surrounding context, not
  anything the user didn't type/leave in that one form field.
- **Sent to a Harper-maintainer-controlled endpoint**, not a third party.

**This feature is entirely inapplicable to our integration.** The
architecture already decided (`harper-integration-architecture.md` §1) is
to embed `harper.js`'s `WorkerLinter` directly — we would never install or
load Harper's Chrome extension, so this code path is never reachable from
our app regardless of what it does.

## 5. WASM binary loading — source-controlled, no hardcoded remote default

Checked whether the `.wasm` binary itself is fetched from a Harper-owned
server by default. It is not:

```ts
// packages/harper.js/src/binaries/binary.ts
import { default as binaryUrl } from 'harper-wasm/harper_wasm_bg.wasm?no-inline';
export const binary = BinaryModuleImpl.create(binaryUrl, 'full');
```

`binaryUrl` resolves through the **integrator's own build tool** (a
Vite/Rollup-style asset-URL import) — the `.wasm` file ends up wherever
*our* bundler places static assets, served from *our* origin. There is also
a `binaryInlined.ts` variant that embeds the WASM as a base64 data URL
directly inside the JS bundle — literally zero additional network requests
for it, since it travels with the code already downloaded. **No hardcoded
`writewithharper.com`, `unpkg`, `jsdelivr`, or any other remote default
exists anywhere in `harper.js`'s source** — grepped explicitly, zero hits
outside one unrelated doc-comment link. `createBinaryModuleFromUrl(url)`
requires the caller to supply the URL; there's no silent fallback.

## 6. Optional features that could change this behavior

Enumerated everything found capable of a network call anywhere in the
monorepo, and why each is — or isn't — reachable from our integration:

| Feature | Where | Sends document content? | Reachable from `harper.js`? |
|---|---|---|---|
| Weirpack loading | `harper.js`/`harper-wasm` | No — local bytes/Blob only, no URL variant | Yes, but harmless (no network capability exists) |
| Chrome extension update check | `packages/chrome-plugin` | No — version string only | **No** — separate product |
| Chrome extension "Report Problematic Lint" | `packages/chrome-plugin` | Only the user-typed example, explicit/disclosed | **No** — separate product |
| `harper-ls` TCP listener | `harper-ls` (LSP binary) | No — local IPC socket only | **No** — separate binary, not used |
| Desktop app auto-updater | `harper-desktop` | No — app version check | **No** — separate Tauri app |
| Desktop "Integrations" (`AddIntegration`/etc.) | `harper-desktop` (macOS/Windows system-wide text-field hooking, e.g. `mac_broker`) | N/A — OS-level accessibility integration, not a network feature at all | **No** — separate app; this resolves the ambiguity flagged in the prior integration-architecture doc, which found these request types via a docs summary without source access |

**Net finding: there is no optional configuration reachable from the
`harper.js` npm package that changes this behavior.** Every network-capable
feature that exists anywhere in Harper's ecosystem lives in a product we
are not adopting.

## 7. Corroborating context

The project's own stated position — *"No cloud round-trips, no telemetry,
no LLM in the loop"* — matches this audit's independent, source-level
findings exactly. Worth noting as a consistency check (marketing claim and
actual code agree), not as the basis for the conclusion itself — the
conclusion here rests on §1–§6's source evidence, not on the tagline.

---

## Verdict

**Harper, integrated via `harper.js`'s `WorkerLinter` (never the Chrome
extension or desktop app), is safe for this editor's offline, local-first,
confidential-documents use case**, based on a source-level audit rather
than documentation claims alone. No code path — default or optional —
exists within the packages we'd actually depend on that transmits document
content anywhere, under any circumstance.

## Recommendations to preserve this guarantee in our integration

1. **Prefer the `binaryInlined` build, or explicitly self-host the `.wasm`
   asset** — never point `createBinaryModuleFromUrl` at a
   `writewithharper.com` or third-party CDN URL. Keeps the WASM fetch
   same-origin, avoiding even a metadata-only cross-origin request (no
   document content involved either way, but worth minimizing on general
   principle for a confidential-documents tool).
2. **Only ever depend on `harper.js` directly** — never the Chrome
   extension or desktop app packages, which is what the integration
   architecture doc already planned; this audit confirms that plan is the
   right one specifically because it's the only surface with zero
   network-capable code anywhere in it.
3. **If a "custom rules" UI is ever built** (importing a Weirpack), keep it
   local-file-only, consistent with this app's existing FSAA-based file
   model — don't add a "fetch a Weirpack from a URL" feature without
   separately re-evaluating it as *our own* new code, since Harper itself
   provides no such capability to inherit risk from.
4. **Pin the exact `harper.js` version and re-run a pass like this on any
   upgrade** — this is a point-in-time audit of one commit; the early
   -access/unstable API status already flagged in the integration
   architecture doc means future releases warrant a fresh check, not an
   assumption that this conclusion holds indefinitely.
