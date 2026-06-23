import { describe, it, expect } from "vitest";
import { slugify, findHeadingBySlug } from "@/editor/extensions/LinkNavigation";

// ── slugify ───────────────────────────────────────────────────────────────────

describe("slugify", () => {
  it("lowercases the text", () => {
    expect(slugify("Brake Monitoring")).toBe("brake-monitoring");
  });

  it("replaces whitespace runs with a single hyphen", () => {
    expect(slugify("System  Overview")).toBe("system-overview");
    expect(slugify("Auth\tService")).toBe("auth-service");
  });

  it("preserves underscores (word characters)", () => {
    expect(slugify("REQ_001")).toBe("req_001");
  });

  it("preserves existing hyphens (not collapsed — GFM-compatible)", () => {
    expect(slugify("over-view")).toBe("over-view");
    expect(slugify("a--b")).toBe("a--b");
  });

  it("removes punctuation that is not a word char, space, or hyphen", () => {
    expect(slugify("Section 1: Introduction")).toBe("section-1-introduction");
    expect(slugify("Cost (USD)")).toBe("cost-usd");
    expect(slugify("Q&A")).toBe("qa");
  });

  it("removes square brackets from status suffixes", () => {
    expect(slugify("REQ_001 [Draft]")).toBe("req_001-draft");
    expect(slugify("SYS_002 [In Review]")).toBe("sys_002-in-review");
  });

  it("handles leading/trailing whitespace", () => {
    expect(slugify("  Hello World  ")).toBe("hello-world");
  });

  it("returns an empty string for blank input", () => {
    expect(slugify("")).toBe("");
    expect(slugify("   ")).toBe("");
  });

  it("handles numeric headings", () => {
    expect(slugify("3.1 Authentication")).toBe("31-authentication");
  });
});

// ── findHeadingBySlug ─────────────────────────────────────────────────────────
// Uses minimal mock PM Node objects that satisfy the interface expected by
// findHeadingBySlug (type.name, textContent, forEach).

interface MockNode {
  type: { name: string };
  textContent: string;
  forEach(fn: (child: MockNode, offset: number) => void): void;
}

function makeHeading(text: string): MockNode {
  return {
    type: { name: "heading" },
    textContent: text,
    forEach(_fn) {},
  };
}

function makeParagraph(text = "content"): MockNode {
  return {
    type: { name: "paragraph" },
    textContent: text,
    forEach(_fn) {},
  };
}

function makeBlockquote(children: MockNode[]): MockNode {
  return {
    type: { name: "blockquote" },
    textContent: children.map((c) => c.textContent).join(""),
    forEach(fn) {
      let offset = 0;
      for (const child of children) {
        fn(child, offset);
        offset += child.textContent.length + 2;
      }
    },
  };
}

function makeDoc(children: MockNode[]): MockNode {
  let offset = 0;
  const offsets: number[] = children.map((child) => {
    const o = offset;
    offset += child.textContent.length + 2;
    return o;
  });

  return {
    type: { name: "doc" },
    textContent: children.map((c) => c.textContent).join(""),
    forEach(fn) {
      children.forEach((child, i) => fn(child, offsets[i]));
    },
  };
}

describe("findHeadingBySlug", () => {
  it("finds a top-level heading that matches the slug", () => {
    const doc = makeDoc([makeHeading("Brake Monitoring")]);
    expect(findHeadingBySlug(doc as never, "brake-monitoring")).toBe(0);
  });

  it("returns null when no heading matches", () => {
    const doc = makeDoc([makeHeading("Brake Monitoring")]);
    expect(findHeadingBySlug(doc as never, "no-such-heading")).toBeNull();
  });

  it("ignores non-heading top-level nodes", () => {
    const doc = makeDoc([makeParagraph("Some text"), makeHeading("Target")]);
    const pos = findHeadingBySlug(doc as never, "target");
    expect(pos).not.toBeNull();
    expect(pos).toBeGreaterThan(0); // second node, not at offset 0
  });

  // ── Exact slug matching (blockquotes) ───────────────────────────────────────

  it("finds a heading inside a blockquote by exact slug", () => {
    const doc = makeDoc([makeBlockquote([makeHeading("REQ_001 [Draft]")])]);
    // exact GFM slug: slugify("REQ_001 [Draft]") = "req_001-draft"
    expect(findHeadingBySlug(doc as never, "req_001-draft")).not.toBeNull();
  });

  it("returns null when the blockquote contains no matching heading", () => {
    const doc = makeDoc([makeBlockquote([makeHeading("Something Else")])]);
    expect(findHeadingBySlug(doc as never, "req_001")).toBeNull();
  });

  // ── Bracket-stripped fallback (requirement anchors) ───────────────────────
  // Users write [REQ_015](#req_015) as shorthand. The GFM slug of
  // "REQ_015 [Draft]" is "req_015-draft", so exact matching fails.
  // The stripped fallback strips trailing [Status] and re-slugifies.

  it("resolves a requirement anchor via bracket-stripped fallback (top-level)", () => {
    const doc = makeDoc([makeHeading("REQ_015 [Draft]")]);
    // #req_015 does NOT match exact slug "req_015-draft"
    // but DOES match stripped slug slugify("REQ_015") = "req_015"
    expect(findHeadingBySlug(doc as never, "req_015")).toBe(0);
  });

  it("resolves a requirement anchor inside a blockquote via bracket-stripped fallback", () => {
    const doc = makeDoc([makeBlockquote([makeHeading("REQ_015 [Draft]")])]);
    const pos = findHeadingBySlug(doc as never, "req_015");
    expect(pos).not.toBeNull();
  });

  it("resolves requirement anchor in mixed doc (top-level and blockquoted requirements)", () => {
    const doc = makeDoc([
      makeHeading("Brake Monitoring"),              // section heading
      makeBlockquote([makeHeading("REQ_001 [Draft]")]),  // blockquoted requirement
      makeHeading("REQ_002 [Approved]"),            // top-level requirement
    ]);
    // Section heading — exact slug match
    expect(findHeadingBySlug(doc as never, "brake-monitoring")).toBe(0);
    // Blockquoted requirement — stripped fallback
    expect(findHeadingBySlug(doc as never, "req_001")).not.toBeNull();
    // Top-level requirement — stripped fallback
    expect(findHeadingBySlug(doc as never, "req_002")).not.toBeNull();
  });

  it("prefers exact slug match over stripped match when both exist", () => {
    // "REQ_015" (exact) appears after "REQ_015 [Draft]" (stripped) in document
    const doc = makeDoc([
      makeHeading("REQ_015 [Draft]"), // pos 0 — stripped match
      makeHeading("REQ_015"),         // pos N — exact match
    ]);
    const pos = findHeadingBySlug(doc as never, "req_015");
    // Should return the EXACT match (second heading), not the stripped match (first)
    expect(pos).toBeGreaterThan(0);
  });

  it("bracket-stripped fallback handles multi-word status brackets", () => {
    const doc = makeDoc([makeHeading("SYS_003 [In Review]")]);
    // stripped: slugify("SYS_003") = "sys_003"
    expect(findHeadingBySlug(doc as never, "sys_003")).toBe(0);
    // exact: slugify("SYS_003 [In Review]") = "sys_003-in-review"
    expect(findHeadingBySlug(doc as never, "sys_003-in-review")).toBe(0);
  });

  it("finds the first matching heading in document order", () => {
    const doc = makeDoc([
      makeHeading("Section A"),
      makeHeading("Target"),
      makeHeading("Target"), // duplicate
    ]);
    const first = findHeadingBySlug(doc as never, "target");
    const second = findHeadingBySlug(
      makeDoc([makeHeading("Target"), makeHeading("Target")]) as never,
      "target",
    );
    // first occurrence should have a smaller offset than second in the larger doc
    expect(first).not.toBeNull();
    expect(second).toBe(0); // first node in its doc
    expect(first).toBeGreaterThan(second!);
  });

  it("slug-matches case-insensitively", () => {
    const doc = makeDoc([makeHeading("System Overview")]);
    // slugify("System Overview") === "system-overview"
    expect(findHeadingBySlug(doc as never, "system-overview")).toBe(0);
  });

  it("handles a mixed doc with blockquote and top-level headings", () => {
    const topHeading = makeHeading("Authentication");
    const quotedHeading = makeHeading("REQ_002 [Approved]");
    const doc = makeDoc([
      topHeading,
      makeBlockquote([quotedHeading]),
      makeHeading("Reporting"),
    ]);
    // Top-level heading
    expect(findHeadingBySlug(doc as never, "authentication")).toBe(0);
    // Inside blockquote
    expect(findHeadingBySlug(doc as never, "req_002-approved")).not.toBeNull();
    // Second top-level heading
    expect(findHeadingBySlug(doc as never, "reporting")).not.toBeNull();
  });

  it("returns null for empty document", () => {
    const doc = makeDoc([]);
    expect(findHeadingBySlug(doc as never, "anything")).toBeNull();
  });
});
