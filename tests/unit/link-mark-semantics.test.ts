/**
 * Link mark semantics & mixed-mark round-trip tests
 *
 * Verifies the mark-group serializer introduced to fix the accessibility
 * regression where [H<sub>2</sub>O](url) was split into three separate links.
 *
 * Tests are organized by concern:
 *   A. Link semantics  — single MDAST link node, correct href/title
 *   B. Structural position — atoms OUTSIDE a link must NOT join its group
 *   C. Mixed marks + inline HTML — all exact round-trips
 *   D. Code/link interactions — code mark inside wrapper marks
 *   E. Idempotency — all fixtures stable on second pass
 */

import { describe, it, expect } from "vitest";
import { parseMarkdownToDoc } from "@/markdown/parser";
import { serializeDocToMarkdown } from "@/markdown/serializer";

function roundtrip(md: string): string {
  return serializeDocToMarkdown(parseMarkdownToDoc(md));
}

function expectExact(md: string) {
  const out = roundtrip(md);
  expect(out, `round-trip of: ${JSON.stringify(md)}`).toBe(md);
}

// ── A. Link semantics ─────────────────────────────────────────────────────────

describe("link semantics: single link node preserved", () => {
  it("[H<sub>2</sub>O](url) → one link, not three", () => {
    expectExact("[H<sub>2</sub>O](https://example.com)\n");
  });

  it("[E=mc<sup>2</sup>](url) → single link", () => {
    expectExact("[E=mc<sup>2</sup>](https://example.com)\n");
  });

  it("[Press <kbd>Ctrl</kbd>+C](url) → single link", () => {
    expectExact("[Press <kbd>Ctrl</kbd>+C](https://example.com)\n");
  });

  it("link title attribute is preserved through atom grouping", () => {
    expectExact('[H<sub>2</sub>O](https://example.com "Water")\n');
  });

  it("plain link without inline HTML is unchanged (control)", () => {
    expectExact("[plain link](https://example.com)\n");
  });

  it("link with multiple atom pairs in display text", () => {
    expectExact("[H<sub>2</sub>O and CO<sub>2</sub>](https://example.com)\n");
  });

  it("link grouping does NOT merge links with different URLs", () => {
    // Two links where an atom sits between them at the top level.
    // The atom has no link mark, so it stops the first link group.
    const out = roundtrip(
      "[x](https://url1.com) <sub>z</sub> [y](https://url2.com)\n",
    );
    expect(out).toBe("[x](https://url1.com) <sub>z</sub> [y](https://url2.com)\n");
    // Must have exactly two link groups
    const links = out.match(/\[[^\]]+\]\([^)]+\)/g);
    expect(links).toHaveLength(2);
    expect(links![0]).toContain("url1.com");
    expect(links![1]).toContain("url2.com");
  });

  it("link grouping does NOT merge links with different titles", () => {
    expectExact('[A](https://x.com "Title A") [B](https://x.com "Title B")\n');
  });
});

// ── B. Structural position ─────────────────────────────────────────────────────

describe("structural position: atom context determines grouping", () => {
  it("atom OUTSIDE link (wrapping it) stays outside", () => {
    // <sub>[H](url)</sub>: sub tag is outside the link in MDAST,
    // so it must NOT be pulled into the link bracket.
    const out = roundtrip("<sub>[H](https://example.com)</sub>\n");
    expect(out).toBe("<sub>[H](https://example.com)</sub>\n");
    // <sub> must appear before the [ bracket
    expect(out.indexOf("<sub>")).toBeLessThan(out.indexOf("[H]"));
    // </sub> must appear after the ) closing paren
    expect(out.indexOf("</sub>")).toBeGreaterThan(out.indexOf(")"));
  });

  it("atom between two links with same URL → two separate links", () => {
    // <sub>[H](url)</sub>[2](url): atoms are at the top level between links.
    const out = roundtrip("<sub>[H](https://x.com)</sub>[2](https://x.com)\n");
    expect(out).toBe("<sub>[H](https://x.com)</sub>[2](https://x.com)\n");
    const links = out.match(/\[[^\]]+\]\([^)]+\)/g);
    expect(links).toHaveLength(2);
  });

  it("[A](url) [B](url) separated by space → two separate links", () => {
    // The space text node has no link mark and breaks the group.
    const out = roundtrip("[A](https://example.com) [B](https://example.com)\n");
    expect(out).toBe("[A](https://example.com) [B](https://example.com)\n");
    const links = out.match(/\[[^\]]+\]\([^)]+\)/g);
    expect(links).toHaveLength(2);
  });

  it("plain atom outside any link is not affected", () => {
    expectExact("H<sub>2</sub>O\n");
  });
});

// ── C. Mixed marks + inline HTML ──────────────────────────────────────────────

describe("mixed marks + inline HTML: exact round-trips", () => {
  it("bold wrapping kbd pair: **<kbd>Ctrl</kbd>**", () => {
    expectExact("**<kbd>Ctrl</kbd>**\n");
  });

  it("italic wrapping sub pair: *H<sub>2</sub>O*", () => {
    expectExact("*H<sub>2</sub>O*\n");
  });

  it("bold wrapping sup pair: **E=mc<sup>2</sup>**", () => {
    expectExact("**E=mc<sup>2</sup>**\n");
  });

  it("bold+italic wrapping sub pair: ***H<sub>2</sub>O***", () => {
    expectExact("***H<sub>2</sub>O***\n");
  });

  it("bold link with sub: [**H<sub>2</sub>O**](url)", () => {
    expectExact("[**H<sub>2</sub>O**](https://example.com)\n");
  });

  it("underline containing sub: <u>text <sub>2</sub></u>", () => {
    expectExact("<u>text <sub>2</sub></u>\n");
  });

  it("strike wrapping html tag: ~~<del>text</del>~~", () => {
    expectExact("~~<del>text</del>~~\n");
  });

  it("bold adjacent to inline HTML: **bold** and H<sub>2</sub>O", () => {
    // The inline HTML is outside any mark; bold applies only to its own text.
    expectExact("**bold** and H<sub>2</sub>O\n");
  });

  it("custom subscript (~) inside link: [H~2~O](url)", () => {
    // ~2~ uses the subscript MARK on a text node (not rawHtmlInline atoms).
    // Verifies the text-node path also groups correctly.
    expectExact("[H~2~O](https://example.com)\n");
  });
});

// ── D. Code/link interactions ─────────────────────────────────────────────────

describe("code/link interactions: exclusive marks inside wrapper marks", () => {
  it("[`code`](url) — link wrapping inlineCode", () => {
    // Previously broken: code mark short-circuited before link was applied,
    // dropping the link entirely. Now code is a leaf node inside the link group.
    expectExact("[`code`](https://example.com)\n");
  });

  it("**`code`** — bold wrapping inlineCode", () => {
    // Previously broken: code short-circuited before bold, dropping bold.
    expectExact("**`code`**\n");
  });

  it("[$x^2$](url) — link wrapping inlineMath", () => {
    expectExact("[$x^2$](https://example.com)\n");
  });

  it("`code` adjacent to link — both preserved", () => {
    expectExact("`code` and [link](https://example.com)\n");
  });

  it("code adjacent to inline HTML — both preserved", () => {
    expectExact("`H2O` vs H<sub>2</sub>O\n");
  });
});

// ── E. Idempotency ────────────────────────────────────────────────────────────

describe("idempotency: second round-trip matches first", () => {
  const fixtures = [
    "[H<sub>2</sub>O](https://example.com)\n",
    "[H<sub>2</sub>O](https://example.com \"Water\")\n",
    "[E=mc<sup>2</sup>](https://example.com)\n",
    "[Press <kbd>Ctrl</kbd>+C](https://example.com)\n",
    "<sub>[H](https://example.com)</sub>[2](https://example.com)\n",
    "[A](https://example.com) [B](https://example.com)\n",
    "**<kbd>Ctrl</kbd>**\n",
    "*H<sub>2</sub>O*\n",
    "**E=mc<sup>2</sup>**\n",
    "***H<sub>2</sub>O***\n",
    "[**H<sub>2</sub>O**](https://example.com)\n",
    "<u>text <sub>2</sub></u>\n",
    "[`code`](https://example.com)\n",
    "**`code`**\n",
    "[$x^2$](https://example.com)\n",
    "[H~2~O](https://example.com)\n",
    "H<sub>2</sub>O\n",
    "**bold** and H<sub>2</sub>O\n",
  ];

  for (const input of fixtures) {
    it(`idempotent: ${input.trim()}`, () => {
      const once = roundtrip(input);
      const twice = roundtrip(once);
      expect(twice, `second pass of: ${JSON.stringify(once)}`).toBe(once);
    });
  }
});
