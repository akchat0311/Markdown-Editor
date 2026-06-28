# 1. Welcome to MD Editor

A WYSIWYG Markdown editor with first-class support for Mermaid.   diagrams, LaTeX math, tables, callouts, and rich inline formatti.  ng.

Type `/` on any new line to insert blocks. Press **⌘N** to start a new document.

> \[!INFO]
>
> This is a **Sample Document** — read-only and never saved to disk. Open a new file with **⌘N** or **File → New** to start writing your own content.

---

## 1.1 Tables

Tables support per-column horizonta. l alignment (`| :--- |`, `| :---: |`, `| ---: |`) via the bubble toolbar or right-click menu.

| Feature | Shortcut | Notes |
| :- | :-: | -: |
| Bold | ⌘B | |
| Italic | ⌘I | |
| Find | ⌘F | |
| Replace | ⌘H | |
| Source view | ⌘/ | Raw Markdown |
| New tab | ⌘N | |
| Open file | ⌘O | |
| Save | ⌘S | |

---

## 1.2 Requirement Example

Headings can encode requirement IDs — useful for specification documents.

### REQ_001 [Draft]

All API responses shoud include a `Content-Security-Policy` header.

---

*Open **⌘N** to create a new document, or **⌘O** to open an existing Markdown file.*

### REQ_002 [Draft]

The system shall authenticate users via OAuth 2.0 before granting access to protected resources.

$$
TqCalc_TCOT_CalcMode = TqCalc_TCOT_CalcMode + TqCalc_TCOT_CalcMode+ TqCalc_TCOT_CalcMode+ TqCalc_TCOT_CalcMode
$$

### REQ_003 [Draft]

### REQ_004 [Draft]

### REQ_005 [Draft]

### REQ_006 [Draft]

can

### REQ_007 [Draft]

### REQ_008 [Draft]

###

## 1.3 Callouts

> \[!INFO]
>
> Use callouts to surface important information. Insert with `/callout`.

> \[!WARNING]
>
> Warn readers about potential pitfalls or breaking changes.

> \[!SUCCESS]
>
> Confirm that a step completed successfully.

> \[!DANGER]
>
> Alert readers to critical or destructive actions.

---

## 1.4 Task Lists

- [x] WYSIWYG editing with live Markdown sync
- [x] Mermaid diagram rendering
- [x] LaTeX / KaTeX math rendering
- [x] Table alignment controls
- [x] Highlight, superscript, subscript
- [x] Find & Replace
- [ ] Build something great
