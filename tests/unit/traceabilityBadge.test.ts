/**
 * Tests for the 🧪 traceability badge editor decoration.
 *
 * Renders a real TipTap editor (jsdom) with the TraceabilityBadge extension
 * and asserts on the widget DOM: per-requirement badges, live counts, tooltip
 * contents, and click behaviour (opens the right-workspace panel, never a
 * dialog or the dashboard).
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Editor } from "@tiptap/core";
import Document from "@tiptap/extension-document";
import Paragraph from "@tiptap/extension-paragraph";
import Text from "@tiptap/extension-text";
import Heading from "@tiptap/extension-heading";
import Blockquote from "@tiptap/extension-blockquote";
import type { JSONContent } from "@tiptap/core";
import { TraceabilityBadge } from "@/editor/extensions/TraceabilityBadge";
import { useTraceabilityStore } from "@/stores/traceabilityStore";
import { useTraceabilityPanelStore } from "@/stores/traceabilityPanelStore";
import { useCommentDrawerStore } from "@/stores/commentDrawerStore";
import { useConfigStore } from "@/stores/configStore";

const TCS = [
  { id: "TC_001", title: "Verify Engine Start" },
  { id: "TC_002", title: "Verify Restart" },
];

function docWithHeadings(headings: string[]): JSONContent {
  return {
    type: "doc",
    content: headings.map((text) => ({
      type: "heading",
      attrs: { level: 3 },
      content: [{ type: "text", text }],
    })),
  };
}

function makeEditor(headings: string[]): Editor {
  return new Editor({
    extensions: [Document, Paragraph, Text, Heading, TraceabilityBadge],
    content: docWithHeadings(headings),
  });
}

function badges(editor: Editor): HTMLElement[] {
  return [...editor.view.dom.querySelectorAll<HTMLElement>(".req-trace-badge")];
}

function badgeCount(el: HTMLElement): string {
  return el.querySelector("span:last-child")?.textContent ?? "";
}

let editor: Editor | null = null;

beforeEach(() => {
  useConfigStore.setState({ requirementPattern: { mode: "simple", example: "REQ_001" } });
  useTraceabilityStore.setState({
    testCases: [],
    links: [],
    isDirty: false,
    loaded: false,
    loadError: false,
  });
  useTraceabilityPanelStore.setState({ reqId: null });
  useCommentDrawerStore.setState({ reqId: null, status: "unknown" });
});

afterEach(() => {
  editor?.destroy();
  editor = null;
});

describe("traceability badge decoration", () => {
  it("renders one badge per requirement heading with the linked count", () => {
    useTraceabilityStore.getState().load({
      version: 1,
      testCases: TCS,
      links: [
        { tc: "TC_001", req: "REQ_001" },
        { tc: "TC_002", req: "REQ_001" },
      ],
    });
    editor = makeEditor(["REQ_001 Auth", "REQ_002 Session", "Not a requirement"]);

    const els = badges(editor);
    expect(els).toHaveLength(2); // non-requirement heading gets no badge
    expect(badgeCount(els[0])).toBe("2");
    expect(badgeCount(els[1])).toBe("0");
    expect(els[1].classList.contains("req-trace-badge--empty")).toBe(true);
  });

  it("renders no badges when the requirement pattern is unconfigured", () => {
    useConfigStore.setState({ requirementPattern: null });
    editor = makeEditor(["REQ_001 Auth"]);
    expect(badges(editor)).toHaveLength(0);
  });

  it("updates the count live when links are added and removed", () => {
    useTraceabilityStore.getState().load({ version: 1, testCases: TCS, links: [] });
    editor = makeEditor(["REQ_001 Auth"]);
    expect(badgeCount(badges(editor)[0])).toBe("0");

    useTraceabilityStore.getState().addLink("TC_001", "REQ_001");
    expect(badgeCount(badges(editor)[0])).toBe("1");

    useTraceabilityStore.getState().removeLink("TC_001", "REQ_001");
    expect(badgeCount(badges(editor)[0])).toBe("0");
  });

  it("updates live when a test case is created via the store", () => {
    editor = makeEditor(["REQ_001 Auth"]);
    useTraceabilityStore.getState().addTestCase("TC_009", "New case");
    useTraceabilityStore.getState().addLink("TC_009", "REQ_001");
    expect(badgeCount(badges(editor)[0])).toBe("1");
  });

  it("tooltip lists linked test case IDs and titles", () => {
    useTraceabilityStore.getState().load({
      version: 1,
      testCases: TCS,
      links: [
        { tc: "TC_001", req: "REQ_001" },
        { tc: "TC_002", req: "REQ_001" },
      ],
    });
    editor = makeEditor(["REQ_001 Auth"]);

    const tip = editor.view.dom.querySelector(".req-trace-tooltip")!;
    expect(tip.querySelector(".req-trace-tooltip-header")?.textContent).toBe("Linked Test Cases");
    const rows = [...tip.querySelectorAll(".req-trace-tooltip-row")];
    expect(rows.map((r) => r.querySelector(".req-trace-tooltip-id")?.textContent)).toEqual([
      "TC_001",
      "TC_002",
    ]);
    expect(rows[0].querySelector(".req-trace-tooltip-title")?.textContent).toBe(
      "Verify Engine Start",
    );
  });

  it("tooltip shows only the ID for untitled test cases", () => {
    useTraceabilityStore.getState().load({
      version: 1,
      testCases: [{ id: "TC_100", title: "" }],
      links: [{ tc: "TC_100", req: "REQ_001" }],
    });
    editor = makeEditor(["REQ_001 Auth"]);

    const row = editor.view.dom.querySelector(".req-trace-tooltip-row")!;
    expect(row.querySelector(".req-trace-tooltip-id")?.textContent).toBe("TC_100");
    expect(row.querySelector(".req-trace-tooltip-title")).toBeNull();
  });

  it("tooltip shows 'No linked test cases' when empty", () => {
    editor = makeEditor(["REQ_001 Auth"]);
    const tip = editor.view.dom.querySelector(".req-trace-tooltip")!;
    expect(tip.textContent).toBe("No linked test cases");
    expect(tip.querySelector(".req-trace-tooltip-header")).toBeNull();
  });

  it("tooltip content refreshes when a test case title changes", () => {
    useTraceabilityStore.getState().load({
      version: 1,
      testCases: TCS,
      links: [{ tc: "TC_001", req: "REQ_001" }],
    });
    editor = makeEditor(["REQ_001 Auth"]);

    useTraceabilityStore.getState().updateTestCase("TC_001", { title: "Renamed title" });
    const tip = editor.view.dom.querySelector(".req-trace-tooltip")!;
    expect(tip.querySelector(".req-trace-tooltip-title")?.textContent).toBe("Renamed title");
  });

  it("click opens the right-workspace panel and closes the comment drawer", () => {
    useTraceabilityStore.getState().load({ version: 1, testCases: TCS, links: [] });
    useCommentDrawerStore.getState().open("REQ_001", "draft");
    editor = makeEditor(["REQ_001 Auth", "REQ_002 Session"]);

    badges(editor)[1].dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));

    expect(useTraceabilityPanelStore.getState().reqId).toBe("REQ_002");
    expect(useCommentDrawerStore.getState().reqId).toBeNull();
  });

  it("finds requirements inside blockquotes", () => {
    editor = new Editor({
      extensions: [Document, Paragraph, Text, Heading, Blockquote, TraceabilityBadge],
      content: {
        type: "doc",
        content: [
          {
            type: "blockquote",
            content: [
              {
                type: "heading",
                attrs: { level: 3 },
                content: [{ type: "text", text: "REQ_007 Quoted" }],
              },
            ],
          },
        ],
      },
    });
    expect(badges(editor)).toHaveLength(1);
  });

  it("rebuilds badges when the document changes (new heading typed)", () => {
    editor = makeEditor(["REQ_001 Auth"]);
    expect(badges(editor)).toHaveLength(1);

    editor.commands.insertContentAt(editor.state.doc.content.size, {
      type: "heading",
      attrs: { level: 3 },
      content: [{ type: "text", text: "REQ_002 New" }],
    });
    expect(badges(editor)).toHaveLength(2);
  });
});
