/**
 * Stress benchmarks for traceability at scale (Phase 5):
 * 1000 requirements, 1000 test cases, 5000 links.
 *
 * Assertions are deliberately generous ceilings — they exist to catch
 * pathological regressions (accidental O(n²)), not to enforce jsdom timings.
 * Actual measurements are logged for the audit report. jsdom numbers are an
 * upper bound: real-browser DOM and PM view code are faster.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Editor } from "@tiptap/core";
import Document from "@tiptap/extension-document";
import Paragraph from "@tiptap/extension-paragraph";
import Text from "@tiptap/extension-text";
import Heading from "@tiptap/extension-heading";
import { TraceabilityBadge } from "@/editor/extensions/TraceabilityBadge";
import { traceabilityBadgeKey } from "@/editor/plugins/traceabilityBadgePlugin";
import { useTraceabilityStore } from "@/stores/traceabilityStore";
import { useConfigStore } from "@/stores/configStore";
import {
  buildTraceabilityRows,
  filterTraceabilityRows,
  summarizeTraceability,
  findBrokenLinks,
} from "@/layout/tabs/traceabilityRows";
import {
  collectTraceabilityCsvRows,
  generateTraceabilityCsv,
} from "@/services/traceabilityExportService";
import type { TestCase, TraceLink } from "@/types/traceability";

const REQ_COUNT = 1000;
const TC_COUNT = 1000;
const LINK_COUNT = 5000;

const REQ_IDS = Array.from({ length: REQ_COUNT }, (_, i) => `REQ_${String(i + 1).padStart(4, "0")}`);
const TCS: TestCase[] = Array.from({ length: TC_COUNT }, (_, i) => ({
  id: `TC_${String(i + 1).padStart(4, "0")}`,
  title: `Verify behaviour number ${i + 1} of the system under test`,
}));
// 5000 links spread deterministically across requirements and test cases.
const LINKS: TraceLink[] = Array.from({ length: LINK_COUNT }, (_, i) => ({
  tc: TCS[(i * 7) % TC_COUNT].id,
  req: REQ_IDS[(i * 13) % REQ_COUNT],
}));

function time(label: string, fn: () => void): number {
  const start = performance.now();
  fn();
  const ms = performance.now() - start;
  console.log(`[stress] ${label}: ${ms.toFixed(1)} ms`);
  return ms;
}

beforeEach(() => {
  useConfigStore.setState({ requirementPattern: { mode: "simple", example: "REQ_0001" } });
  useTraceabilityStore.setState({
    testCases: TCS,
    links: LINKS,
    isDirty: false,
    loaded: true,
    loadError: false,
  });
});

describe("traceability stress — projections & dashboard row model", () => {
  it("builds rows, filter, summary and broken detection within bounds", () => {
    let rows!: ReturnType<typeof buildTraceabilityRows>;
    const tRows = time("buildTraceabilityRows (1000 req / 5000 links)", () => {
      rows = buildTraceabilityRows(REQ_IDS, TCS, LINKS);
    });
    expect(rows).toHaveLength(REQ_COUNT);
    expect(tRows).toBeLessThan(200);

    const tFilter = time("filterTraceabilityRows (query over titles)", () => {
      filterTraceabilityRows(rows, "behaviour number 4999");
    });
    expect(tFilter).toBeLessThan(200);

    const tSummary = time("summarize + findBrokenLinks", () => {
      const broken = findBrokenLinks(REQ_IDS, TCS, LINKS);
      summarizeTraceability(rows, TCS, LINKS, broken);
    });
    expect(tSummary).toBeLessThan(200);
  });
});

describe("traceability stress — atomic remap", () => {
  it("remaps 1000 requirement IDs over 5000 links in one update", () => {
    // Full renumber: every requirement gets a new ID (shifted by one — an
    // overlapping mapping, the worst case for chain-safety bookkeeping).
    const mapping = new Map<string, string>();
    for (let i = 0; i < REQ_COUNT; i++) {
      mapping.set(REQ_IDS[i], REQ_IDS[(i + 1) % REQ_COUNT]);
    }
    const t = time("remapRequirementIds (1000 renames / 5000 links)", () => {
      useTraceabilityStore.getState().remapRequirementIds(mapping);
    });
    expect(useTraceabilityStore.getState().links.length).toBeGreaterThan(0);
    expect(t).toBeLessThan(200);
  });
});

describe("traceability stress — CSV export", () => {
  it("collects and generates the full CSV within bounds", () => {
    let rows!: string[][];
    const tCollect = time("collectTraceabilityCsvRows", () => {
      rows = collectTraceabilityCsvRows(REQ_IDS, TCS, LINKS);
    });
    // Aggregated format: exactly one row per requirement (all links are valid
    // here, so no broken rows follow); every link's TC ID appears in a cell.
    expect(rows).toHaveLength(REQ_COUNT);
    expect(rows.reduce((n, r) => n + (r[1] ? r[1].split("\n").length : 0), 0)).toBe(LINK_COUNT);
    expect(tCollect).toBeLessThan(300);

    let csv = "";
    const tGenerate = time("generateTraceabilityCsv", () => {
      csv = generateTraceabilityCsv(rows);
    });
    expect(csv.length).toBeGreaterThan(LINK_COUNT * 10);
    expect(tGenerate).toBeLessThan(300);
  });
});

describe("traceability stress — badge decoration rebuild", () => {
  let editor: Editor | null = null;
  afterEach(() => {
    editor?.destroy();
    editor = null;
  });

  it("rebuilds 1000 heading badges within bounds (jsdom upper bound)", () => {
    const content = {
      type: "doc",
      content: REQ_IDS.map((id) => ({
        type: "heading",
        attrs: { level: 3 },
        content: [{ type: "text", text: `${id} Requirement title text` }],
      })),
    };

    const tCreate = time("editor creation (1000 requirement headings)", () => {
      editor = new Editor({
        extensions: [Document, Paragraph, Text, Heading, TraceabilityBadge],
        content,
      });
    });
    expect(editor!.view.dom.querySelectorAll(".req-trace-badge").length).toBe(REQ_COUNT);
    console.log(`[stress] (editor creation includes initial decoration build: ${tCreate.toFixed(1)} ms)`);

    // Store-triggered refresh — the exact path taken when a link is added:
    // buildDecorations scan + shared projection + widget diffing.
    const tRefresh = time("badge decoration refresh (store change)", () => {
      editor!.view.dispatch(
        editor!.state.tr.setMeta(traceabilityBadgeKey, { refresh: true }),
      );
    });
    expect(tRefresh).toBeLessThan(2000);

    // Doc-changed rebuild — the per-keystroke path. Position-independent
    // widget keys keep this at scan cost (PM reuses all widget DOM); a bound
    // this tight fails immediately if node positions ever re-enter the key.
    const tKeystroke = time("badge rebuild on doc change (keystroke path)", () => {
      editor!.commands.insertContentAt(1, "x");
    });
    expect(tKeystroke).toBeLessThan(200);
  });
});
