# Project Omega — System Requirements Specification

<!-- SRS-2024-001 | revision 2.4 | status: Draft -->

## 1. Introduction

This document defines the **functional and non-functional requirements** for
Project Omega. All requirements are traceable to the master SRS.

For questions, contact the [systems engineering team](mailto:syseng@example.com).
See also the [project wiki](https://wiki.example.com/omega) for context.

## 2. Chemical and Scientific Notation

The system shall display chemical formulae without corruption:

- H<sub>2</sub>O (water)
- CO<sub>2</sub> (carbon dioxide)
- NH<sub>3</sub> (ammonia)
- Ca<sup>2+</sup> (calcium ion)
- Fe<sup>3+</sup> (iron III ion)

Linked chemical references must produce a single hyperlink, not multiple:

- See [H<sub>2</sub>O specification](https://example.com/water) for details.
- Einstein's [E=mc<sup>2</sup>](https://example.com/relativity) is foundational.
- The [**CO<sub>2</sub> sensor**](https://example.com/sensor) datasheet.

Mixed marks with inline HTML must round-trip exactly:

- *H<sub>2</sub>O* in italic context.
- **E=mc<sup>2</sup>** in bold context.
- ***NH<sub>3</sub>*** in bold italic context.

## 3. Keyboard Shortcuts

The editor supports the following shortcuts. Use **<kbd>Ctrl</kbd>+<kbd>S</kbd>**
to save at any time.

| Action | Shortcut | Notes |
| - | - | - |
| Save | <kbd>Ctrl</kbd>+<kbd>S</kbd> | Autosave also runs every 30 s |
| Open | <kbd>Ctrl</kbd>+<kbd>O</kbd> | Opens file picker |
| Find | <kbd>Ctrl</kbd>+<kbd>F</kbd> | Searches current document |
| Undo | <kbd>Ctrl</kbd>+<kbd>Z</kbd> | Up to 100 steps |

Press **<kbd>Ctrl</kbd>+<kbd>Z</kbd>** to undo. Press **<kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>Z</kbd>** to redo.

## 4. Mathematical Requirements

The system shall render inline math $F = ma$ and display math:

$$
x = \frac{-b \pm \sqrt{b^2 - 4ac}}{2a}
$$

Inline math inside a link: [$x^2 + y^2 = r^2$](https://example.com/circle).

## 5. Traceability Table

| ID | Status | Description |
| - | - | - |
| REQ_001 | Draft | Preserve H<sub>2</sub>O notation verbatim in serialized output |
| REQ_002 | Draft | Render Ca<sup>2+</sup> and Fe<sup>3+</sup> without escaping |
| REQ_003 | Draft | Single link node for [H<sub>2</sub>O](https://example.com/water) |
| REQ_004 | Draft | Bold code **`const x`** must preserve both marks |

## 6. Code References

- Retrieve data with [`GET /api/v1/items`](https://example.com/api).
- The function **`parseMarkdownToDoc`** is the entry point.
- Use `` `rawHtmlInline` `` for inline HTML atoms.

## 7. Structural HTML Annotations

<div class="note">
All requirements in this document are normative unless marked informative.
</div>

> **Warning**: Do not modify *H<sub>2</sub>O* notation in headings without
> updating the traceability table.

## 8. Mixed Inline Constructs

Underline with nested sub: <u>formula H<sub>2</sub>O</u>.

Highlight combined with bold: **==critical section==**.

Superscript in a sentence: Area = r^2^π, where r is the radius.

Subscript in a sentence: Water is H~2~O.

<!-- end of specification -->
