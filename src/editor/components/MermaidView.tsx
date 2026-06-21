import { useEffect, useRef, useState } from "react";
import { NodeViewContent, NodeViewWrapper, useEditorState } from "@tiptap/react";
import type { NodeViewProps } from "@tiptap/react";
import { ensureKatex, katexRenderToString } from "@/editor/utils/katexLoader";

// ── Mermaid singleton ─────────────────────────────────────────────────────────

type MermaidAPI = typeof import("mermaid").default;
let mermaidPromise: Promise<MermaidAPI> | null = null;

function getMermaid(): Promise<MermaidAPI> {
  if (!mermaidPromise) {
    mermaidPromise = import("mermaid").then((m) => {
      m.default.initialize({ startOnLoad: false, securityLevel: "loose" });
      return m.default;
    });
  }
  return mermaidPromise;
}

let renderCounter = 0;

async function renderDiagram(
  code: string,
  dark: boolean
): Promise<{ svg: string } | { error: string }> {
  if (!code.trim()) return { error: "" };
  try {
    const mermaid = await getMermaid();
    mermaid.initialize({ startOnLoad: false, securityLevel: "loose", theme: dark ? "dark" : "neutral" });
    const id = `mermaid-${++renderCounter}`;
    const { svg } = await mermaid.render(id, code);
    return { svg };
  } catch (e: unknown) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

// ── Shared source/preview header ──────────────────────────────────────────────

function BlockLabel({ label, hint, loading }: { label: string; hint?: string; loading?: boolean }) {
  return (
    <div className="mermaid-label">
      <span>{label}</span>
      {hint && <span className="mermaid-hint">{hint}</span>}
      {loading && <span className="mermaid-hint">Rendering…</span>}
    </div>
  );
}

// ── Component ─────────────────────────────────────────────────────────────────

export function MermaidView({ node, editor, getPos }: NodeViewProps) {
  const language = node.attrs.language as string | null;
  const isMermaid = language === "mermaid";
  const isBlockMath = language === "$$";
  const isSpecial = isMermaid || isBlockMath;

  // ── Typora-style toggle: cursor inside block = source mode ────────────────
  const isActive = useEditorState({
    editor,
    selector: ({ editor: e }) => {
      if (!isSpecial) return true; // regular code blocks always in edit mode
      const pos = getPos();
      if (pos === undefined) return false;
      const { from, to } = e.state.selection;
      // pos is the position *before* the block; pos+nodeSize is *after* it.
      // Both boundaries are outside, so use strict inequalities.
      return from > pos && to < pos + node.nodeSize;
    },
  });

  const code = node.textContent;

  // ── Mermaid render state ──────────────────────────────────────────────────
  const [svg, setSvg] = useState<string | null>(null);
  const [mermaidError, setMermaidError] = useState<string | null>(null);
  const [mermaidRendering, setMermaidRendering] = useState(false);
  const mermaidCodeRef = useRef<string>("");
  const mermaidCancelRef = useRef<boolean>(false);

  useEffect(() => {
    if (!isMermaid || isActive) return;
    if (code === mermaidCodeRef.current) return;

    const dark = document.documentElement.classList.contains("dark");
    mermaidCancelRef.current = false;
    setMermaidRendering(true);

    renderDiagram(code, dark).then((result) => {
      if (mermaidCancelRef.current) return;
      setMermaidRendering(false);
      mermaidCodeRef.current = code;
      if ("svg" in result) {
        setSvg(result.svg || null);
        setMermaidError(null);
      } else {
        setSvg(null);
        setMermaidError(result.error || null);
      }
    });

    return () => { mermaidCancelRef.current = true; };
  }, [code, isMermaid, isActive]);

  // ── Block math render state ───────────────────────────────────────────────
  const [mathHtml, setMathHtml] = useState<string | null>(null);
  const [mathError, setMathError] = useState<string | null>(null);
  const [katexTick, setKatexTick] = useState(0);
  const mathCodeRef = useRef<string>("");

  useEffect(() => {
    if (!isBlockMath || isActive) return;
    if (code === mathCodeRef.current && mathHtml !== null) return;

    const rendered = katexRenderToString(code, true);
    if (rendered === code) {
      // KaTeX not loaded yet — lazy-load and force a re-render tick when ready
      ensureKatex().then(() => {
        mathCodeRef.current = ""; // invalidate cache
        setKatexTick((t) => t + 1);
      });
      return;
    }

    // Check for error sentinel from katexLoader
    if (rendered.includes("math-error-inline")) {
      setMathError(rendered);
      setMathHtml(null);
    } else {
      setMathHtml(rendered);
      setMathError(null);
    }
    mathCodeRef.current = code;
  }, [code, isBlockMath, isActive, katexTick, mathHtml]);

  // ── Helpers: click to focus ───────────────────────────────────────────────
  const focusIntoBlock = () => {
    const pos = getPos();
    if (pos === undefined) return;
    editor.chain().focus().setTextSelection(pos + 1).run();
  };

  // ── Regular code blocks ───────────────────────────────────────────────────
  if (!isSpecial) {
    return (
      <NodeViewWrapper as="div">
        <pre>
          <NodeViewContent
            as={"code" as "div"}
            className={language ? `language-${language}` : undefined}
          />
        </pre>
      </NodeViewWrapper>
    );
  }

  // ── Source-edit mode (cursor inside block) ────────────────────────────────
  if (isActive) {
    const label = isBlockMath ? "math" : "mermaid";
    return (
      <NodeViewWrapper as="div" className="mermaid-block mermaid-source">
        <BlockLabel label={label} hint="Click outside to preview" />
        <pre>
          <NodeViewContent as={"code" as "div"} />
        </pre>
      </NodeViewWrapper>
    );
  }

  // ── Mermaid preview mode ──────────────────────────────────────────────────
  if (isMermaid) {
    return (
      <NodeViewWrapper as="div" className="mermaid-block mermaid-preview" onClick={focusIntoBlock}>
        <BlockLabel label="mermaid" loading={mermaidRendering} />

        {svg && !mermaidError && (
          // eslint-disable-next-line react/no-danger
          <div className="mermaid-svg-wrap" dangerouslySetInnerHTML={{ __html: svg }} />
        )}
        {mermaidError && (
          <div className="mermaid-error">
            <span className="mermaid-error-label">Diagram error</span>
            <pre className="mermaid-error-msg">{mermaidError}</pre>
          </div>
        )}
        {!mermaidRendering && !svg && !mermaidError && (
          <div className="mermaid-empty">Click to add diagram source</div>
        )}

        <div aria-hidden className="mermaid-content-hidden">
          <NodeViewContent as={"code" as "div"} />
        </div>
      </NodeViewWrapper>
    );
  }

  // ── Block math preview mode ───────────────────────────────────────────────
  return (
    <NodeViewWrapper as="div" className="mermaid-block math-block-preview" onClick={focusIntoBlock}>
      <BlockLabel label="math" />

      {mathHtml && !mathError && (
        // eslint-disable-next-line react/no-danger
        <div className="math-block-rendered" dangerouslySetInnerHTML={{ __html: mathHtml }} />
      )}
      {mathError && (
        <div className="mermaid-error">
          <span className="mermaid-error-label">Math render error</span>
          {/* eslint-disable-next-line react/no-danger */}
          <div className="mermaid-error-msg" dangerouslySetInnerHTML={{ __html: mathError }} />
        </div>
      )}
      {!mathHtml && !mathError && (
        <div className="mermaid-empty">Click to add math source</div>
      )}

      <div aria-hidden className="mermaid-content-hidden">
        <NodeViewContent as={"code" as "div"} />
      </div>
    </NodeViewWrapper>
  );
}
