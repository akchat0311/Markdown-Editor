import {
  useContext,
  useState,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useCallback,
  type KeyboardEvent,
} from "react";
import { useEditorState } from "@tiptap/react";
import type { JSONContent } from "@tiptap/core";
import { EditorContext } from "@/editor/EditorContext";
import {
  deriveOutline,
  flattenOutline,
  findActiveHeadingKey,
} from "@/editor/utils/deriveOutline";
import {
  getNodeSectionRange,
  moveSectionBefore,
  moveSectionAfter,
  duplicateSection,
  deleteSection,
  renameHeading,
  isInsideSection,
  normalizeSelectedRanges,
  deleteMultipleSections,
  duplicateMultipleSections,
} from "@/editor/utils/outlineOps";
import { serializeDocToMarkdown } from "@/markdown/serializer";
import { useToastStore } from "@/stores/toastStore";
import { TextSelection, type Transaction } from "@tiptap/pm/state";
import {
  compileRequirementPattern,
  validateRequirementRegex,
  analyzeRequirements,
  nextAvailableId,
  insertRequirementAfter,
  computeRenumberReplacements,
  type CompiledPattern,
  type RequirementAnalysis,
} from "@/editor/utils/requirementOps";
import { rewriteHeadingId } from "@/editor/utils/requirementHeadingOps";
import { requirementIdMigrationKey } from "@/editor/plugins/requirementIdMigrationPlugin";
import { useConfigStore } from "@/stores/configStore";
import { useReviewCommentsStore } from "@/stores/reviewCommentsStore";
import { useTraceabilityStore } from "@/stores/traceabilityStore";
import { useValidationStore } from "@/stores/validationStore";
import type { OutlineNode } from "@/types/outline";
import type { ValidationIssue } from "@/types/validation";

const DEBOUNCE_MS = 150;
const PATTERN_APPLY_MS = 500;

// ── Types ─────────────────────────────────────────────────────────────────────

interface SearchState {
  query: string;
  matchingKeys: Set<string>;
  ancestorKeys: Set<string>;
}

interface DropTarget {
  key: string;
  position: "before" | "after";
}

interface ContextMenuState {
  node: OutlineNode;
  canMoveUp: boolean;
  canMoveDown: boolean;
  x: number;
  y: number;
  subtreeIds: Set<string>;
  siblingIds: Set<string>;
  childrenIds: Set<string>;
}

// ── Tree traversal helpers ────────────────────────────────────────────────────

function findNodeInTree(
  tree: OutlineNode[],
  sid: string
): OutlineNode | undefined {
  for (const n of tree) {
    if (stableDragId(n) === sid) return n;
    const found = findNodeInTree(n.children, sid);
    if (found) return found;
  }
  return undefined;
}

// Returns the parent node, or null if the node is at root level (or not found).
function findParentInTree(
  tree: OutlineNode[],
  sid: string
): OutlineNode | null {
  for (const n of tree) {
    if (n.children.some((c) => stableDragId(c) === sid)) return n;
    const found = findParentInTree(n.children, sid);
    if (found) return found;
  }
  return null;
}

// Stable drag identifier: survives PM-offset shifts caused by content operations.
// Uses level + label rather than the PM-offset-based node.key so the identity
// remains valid even if the 150 ms outline debounce fires during a drag.
function stableDragId(node: OutlineNode): string {
  return `${node.level ?? 1}::${node.label}`;
}

// ── Search state computation ──────────────────────────────────────────────────

function computeSearchState(
  nodes: OutlineNode[],
  query: string
): SearchState | null {
  const q = query.trim().toLowerCase();
  if (!q) return null;

  const matchingKeys = new Set<string>();
  const ancestorKeys = new Set<string>();

  function visit(node: OutlineNode, ancestors: string[]): boolean {
    const selfMatch = node.label.toLowerCase().includes(q);
    if (selfMatch) {
      matchingKeys.add(node.key);
      ancestors.forEach((k) => ancestorKeys.add(k));
    }
    const childMatch = node.children.some((c) =>
      visit(c, [...ancestors, node.key])
    );
    if (childMatch) {
      ancestorKeys.add(node.key);
      ancestors.forEach((k) => ancestorKeys.add(k));
    }
    return selfMatch || childMatch;
  }

  nodes.forEach((root) => visit(root, []));
  return { query: q, matchingKeys, ancestorKeys };
}

// ── Highlight matched text ────────────────────────────────────────────────────

function Highlighted({ text, query }: { text: string; query: string }) {
  const lq = query.toLowerCase();
  const idx = text.toLowerCase().indexOf(lq);
  if (idx < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, idx)}
      <mark className="rounded-sm bg-yellow-200 text-yellow-900 dark:bg-yellow-700/60 dark:text-yellow-100">
        {text.slice(idx, idx + query.length)}
      </mark>
      {text.slice(idx + query.length)}
    </>
  );
}

// ── Label class by heading level ──────────────────────────────────────────────

function labelClass(level: number, isActive: boolean): string {
  if (isActive) return "text-[var(--color-accent)] font-medium";
  if (level === 1) return "font-medium text-[var(--color-text)]";
  if (level === 2) return "text-[var(--color-text)]";
  if (level <= 4) return "text-[var(--color-muted)]";
  return "text-[var(--color-muted)] opacity-70";
}

// ── TreeItem ──────────────────────────────────────────────────────────────────

interface TreeItemProps {
  node: OutlineNode;
  depth: number;
  activeKey: string | null;
  collapsedKeys: Set<string>;
  searchState: SearchState | null;
  selectedKeys: Set<string>;
  dragKey: string | null;
  validDropTargets: Set<string>;
  dropTarget: DropTarget | null;
  reqCountMap: Map<string, number> | null;
  requirementNodeKeys: Set<string>;
  duplicateNodeKeys: Set<string>;
  renameNodeKey: string | null;
  renameValue: string;
  onNodeClick: (e: React.MouseEvent, node: OutlineNode) => void;
  onSelect: (node: OutlineNode) => void;
  onRename: (node: OutlineNode) => void;
  onToggle: (key: string) => void;
  onDragStart: (node: OutlineNode) => void;
  onDragOver: (e: React.DragEvent, node: OutlineNode) => void;
  onDrop: (node: OutlineNode) => void;
  onDragEnd: () => void;
  onContextMenu: (e: React.MouseEvent, node: OutlineNode) => void;
  onRenameChange: (v: string) => void;
  onRenameConfirm: () => void;
  onRenameCancel: () => void;
}

function TreeItem({
  node,
  depth,
  activeKey,
  collapsedKeys,
  searchState,
  selectedKeys,
  dragKey,
  validDropTargets,
  dropTarget,
  reqCountMap,
  requirementNodeKeys,
  duplicateNodeKeys,
  renameNodeKey,
  renameValue,
  onNodeClick,
  onSelect,
  onRename,
  onToggle,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
  onContextMenu,
  onRenameChange,
  onRenameConfirm,
  onRenameCancel,
}: TreeItemProps) {
  const renameInputRef = useRef<HTMLInputElement>(null);

  // Focus and select the input after rename mode activates.
  // setTimeout defers until after any stray mouseup/click events from the
  // context-menu dismissal have been processed, so focus isn't stolen back.
  useEffect(() => {
    if (renameNodeKey !== node.key) return;
    const id = setTimeout(() => {
      renameInputRef.current?.focus();
      renameInputRef.current?.select();
    }, 0);
    return () => clearTimeout(id);
  }, [renameNodeKey, node.key]);

  if (searchState) {
    const visible =
      searchState.matchingKeys.has(node.key) ||
      searchState.ancestorKeys.has(node.key);
    if (!visible) return null;
  }

  const hasChildren = node.children.length > 0;
  const isActive = node.key === activeKey;
  const level = node.level ?? 1;
  const paddingLeft = 10 + depth * 12;

  const forceExpanded =
    searchState !== null && searchState.ancestorKeys.has(node.key);
  const isCollapsed = !forceExpanded && collapsedKeys.has(node.key);

  const isRenaming = renameNodeKey === node.key;
  const nodeSid = stableDragId(node);
  const isSelected = selectedKeys.has(nodeSid);
  const isDragging = dragKey === nodeSid;
  const isValidDropTarget = validDropTargets.has(nodeSid);
  const isDropBefore =
    isValidDropTarget &&
    dropTarget?.key === nodeSid &&
    dropTarget.position === "before";
  const isDropAfter =
    isValidDropTarget &&
    dropTarget?.key === nodeSid &&
    dropTarget.position === "after";

  const matchQuery =
    searchState?.matchingKeys.has(node.key) ? searchState.query : null;

  const isRequirement = requirementNodeKeys.has(node.key);
  const isDuplicate = duplicateNodeKeys.has(node.key);
  const reqCount = reqCountMap?.get(node.key) ?? 0;
  const showReqCount =
    reqCountMap !== null && reqCount > 0 && (!isRequirement || reqCount > 1);

  const sharedChildProps = {
    depth: depth + 1,
    activeKey,
    collapsedKeys,
    searchState,
    selectedKeys,
    dragKey,
    validDropTargets,
    dropTarget,
    reqCountMap,
    requirementNodeKeys,
    duplicateNodeKeys,
    renameNodeKey,
    renameValue,
    onNodeClick,
    onSelect,
    onRename,
    onToggle,
    onDragStart,
    onDragOver,
    onDrop,
    onDragEnd,
    onContextMenu,
    onRenameChange,
    onRenameConfirm,
    onRenameCancel,
  };

  return (
    <li>
      {isDropBefore && (
        <div
          className="pointer-events-none h-0.5 rounded-full bg-[var(--color-accent)]"
          style={{ marginLeft: `${paddingLeft + 16}px`, marginRight: "8px" }}
        />
      )}

      <div
        role="button"
        tabIndex={0}
        draggable={searchState === null && !isRenaming}
        className={[
          "group flex cursor-pointer select-none items-center gap-1 rounded-sm py-[3px] pr-2 text-xs leading-5 outline-none",
          "hover:bg-[var(--color-border)]",
          isSelected ? "bg-[var(--color-accent)]/10" : "",
          isDragging ? "opacity-40" : "",
        ].join(" ")}
        style={{
          paddingLeft: `${paddingLeft}px`,
          ...(isActive
            ? { boxShadow: "inset 2px 0 0 var(--color-accent)" }
            : {}),
        }}
        onClick={(e) => { if (renameNodeKey === null) onNodeClick(e, node); }}
        onDoubleClick={(e) => { e.stopPropagation(); if (renameNodeKey === null && !node.readonly) onRename(node); }}
        onKeyDown={(e: KeyboardEvent<HTMLDivElement>) => {
          if (renameNodeKey !== null) return;
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onSelect(node);
          }
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          onContextMenu(e, node);
        }}
        onDragStart={(e) => {
          e.dataTransfer.effectAllowed = "move";
          e.dataTransfer.setData("text/plain", node.key);
          onDragStart(node);
        }}
        onDragOver={(e) => {
          if (!isValidDropTarget) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = "move";
          onDragOver(e, node);
        }}
        onDrop={(e) => {
          e.preventDefault();
          if (isValidDropTarget) onDrop(node);
        }}
        onDragEnd={onDragEnd}
      >
        {hasChildren ? (
          <button
            tabIndex={-1}
            aria-label={isCollapsed ? "Expand section" : "Collapse section"}
            className="flex h-4 w-4 shrink-0 items-center justify-center rounded text-[var(--color-muted)] hover:text-[var(--color-text)]"
            onClick={(e) => {
              e.stopPropagation();
              onToggle(node.key);
            }}
          >
            <svg
              width="8"
              height="8"
              viewBox="0 0 8 8"
              fill="currentColor"
              style={{
                transform: isCollapsed ? "rotate(0deg)" : "rotate(90deg)",
                transition: "transform 0.1s ease",
              }}
            >
              <path d="M2 1l4 3-4 3V1z" />
            </svg>
          </button>
        ) : (
          <span className="h-4 w-4 shrink-0" aria-hidden />
        )}

        {isRenaming ? (
          <input
            ref={renameInputRef}
            className="min-w-0 flex-1 rounded border border-[var(--color-accent)] bg-[var(--color-page-bg)] h-5 px-1 py-0 text-xs text-[var(--color-text)] outline-none"
            value={renameValue}
            onChange={(e) => onRenameChange(e.target.value)}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === "Enter") { e.preventDefault(); onRenameConfirm(); }
              if (e.key === "Escape") { e.preventDefault(); onRenameCancel(); }
            }}
            onBlur={onRenameConfirm}
            onClick={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
          />
        ) : (
          <span
            className={`min-w-0 flex-1 truncate ${labelClass(level, isActive)}`}
          >
            {matchQuery ? (
              <Highlighted text={node.label} query={matchQuery} />
            ) : (
              node.label
            )}
          </span>
        )}

        {!isRenaming && showReqCount && (
          <span className="shrink-0 text-[9px] font-medium text-[var(--color-muted)]">
            {reqCount}&nbsp;{reqCount === 1 ? "req" : "reqs"}
          </span>
        )}

        {!isRenaming && isDuplicate && (
          <span
            title="Duplicate requirement ID"
            aria-label="Duplicate requirement ID"
            className="shrink-0 text-[10px] text-amber-500"
          >
            ⚠
          </span>
        )}
      </div>

      {isDropAfter && !hasChildren && (
        <div
          className="pointer-events-none h-0.5 rounded-full bg-[var(--color-accent)]"
          style={{ marginLeft: `${paddingLeft + 16}px`, marginRight: "8px" }}
        />
      )}

      {hasChildren && !isCollapsed && (
        <ul className="list-none">
          {node.children.map((child) => (
            <TreeItem
              key={child.key}
              node={child}
              {...sharedChildProps}
            />
          ))}
        </ul>
      )}

      {isDropAfter && hasChildren && (
        <div
          className="pointer-events-none h-0.5 rounded-full bg-[var(--color-accent)]"
          style={{ marginLeft: `${paddingLeft + 16}px`, marginRight: "8px" }}
        />
      )}
    </li>
  );
}

// ── Pattern config panel ──────────────────────────────────────────────────────

type PatternMode = "simple" | "regex";

interface PatternConfigPanelProps {
  mode: PatternMode;
  onModeChange: (mode: PatternMode) => void;
  patternInput: string;
  onInputChange: (v: string) => void;
  regexSource: string;
  regexFlags: string;
  onRegexSourceChange: (v: string) => void;
  onRegexFlagsChange: (v: string) => void;
  onClear: () => void;
  hasExistingPattern: boolean;
}

function PatternConfigPanel({
  mode,
  onModeChange,
  patternInput,
  onInputChange,
  regexSource,
  regexFlags,
  onRegexSourceChange,
  onRegexFlagsChange,
  onClear,
  hasExistingPattern,
}: PatternConfigPanelProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    inputRef.current?.focus();
  }, [mode]);

  const trimmed = patternInput.trim();
  const compiledSimple = trimmed ? compileRequirementPattern(trimmed) : null;

  const trimmedSource = regexSource.trim();
  const regexValidation = trimmedSource ? validateRequirementRegex(trimmedSource, regexFlags) : null;

  const modeTab = (id: PatternMode, label: string) => (
    <button
      onClick={() => onModeChange(id)}
      className={[
        "flex-1 rounded px-2 py-1 text-[10px] font-medium transition-colors",
        mode === id
          ? "bg-[var(--color-accent)] text-white"
          : "text-[var(--color-muted)] hover:bg-[var(--color-border)]",
      ].join(" ")}
    >
      {label}
    </button>
  );

  return (
    <div className="shrink-0 border-b border-[var(--color-border)] bg-[var(--color-page-bg)] px-3 py-3">
      <p className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-[var(--color-muted)]">
        Requirement Pattern
      </p>

      <div className="mb-2 flex gap-1 rounded border border-[var(--color-border)] bg-[var(--color-paper)] p-0.5">
        {modeTab("simple", "Simple")}
        {modeTab("regex", "Regex")}
      </div>

      {mode === "simple" ? (
        <>
          <input
            ref={inputRef}
            value={patternInput}
            onChange={(e) => onInputChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") (e.target as HTMLInputElement).blur();
            }}
            placeholder="e.g. REQ_001"
            className="w-full rounded border border-[var(--color-border)] bg-[var(--color-paper)] px-2 py-1 text-xs text-[var(--color-text)] outline-none focus:border-[var(--color-accent)]"
            spellCheck={false}
          />

          <div className="mt-1 min-h-[1.1rem] text-[10px] leading-[1.1rem]">
            {trimmed && compiledSimple && compiledSimple.mode === "simple" && (
              <span className="text-green-600 dark:text-green-400">
                ✓ Prefix:&nbsp;
                <span className="font-mono">{compiledSimple.prefix || "(none)"}</span>
                &nbsp;· Digits:&nbsp;{compiledSimple.digits}
              </span>
            )}
            {trimmed && !compiledSimple && (
              <span className="text-amber-500">
                ⚠ Example must end with a number
              </span>
            )}
          </div>

          <p className="mt-1.5 text-[10px] leading-relaxed text-[var(--color-muted)]">
            Enter an example requirement ID. The editor will automatically detect
            the numbering pattern.
          </p>
        </>
      ) : (
        <>
          <input
            ref={inputRef}
            value={regexSource}
            onChange={(e) => onRegexSourceChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") (e.target as HTMLInputElement).blur();
            }}
            placeholder="e.g. ^REQ-(\d+)"
            className="w-full rounded border border-[var(--color-border)] bg-[var(--color-paper)] px-2 py-1 font-mono text-xs text-[var(--color-text)] outline-none focus:border-[var(--color-accent)]"
            spellCheck={false}
          />

          <div className="mt-1.5 flex items-center gap-1.5">
            <span className="text-[10px] text-[var(--color-muted)]">Flags</span>
            <input
              value={regexFlags}
              onChange={(e) => onRegexFlagsChange(e.target.value)}
              placeholder="i"
              className="w-14 rounded border border-[var(--color-border)] bg-[var(--color-paper)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--color-text)] outline-none focus:border-[var(--color-accent)]"
              spellCheck={false}
            />
          </div>

          <div className="mt-1 min-h-[1.1rem] text-[10px] leading-[1.1rem]">
            {trimmedSource && regexValidation?.valid && (
              <span className="text-green-600 dark:text-green-400">✓ Valid pattern</span>
            )}
            {trimmedSource && regexValidation && !regexValidation.valid && (
              <span className="text-amber-500">⚠ {regexValidation.error}</span>
            )}
          </div>

          <p className="mt-1.5 text-[10px] leading-relaxed text-[var(--color-muted)]">
            Enter a regular expression matched against the start of each heading.
            Include a capture group for the ID — a named group{" "}
            <code className="rounded bg-[var(--color-border)] px-1">(?&lt;id&gt;…)</code>{" "}
            is used when present, otherwise the first group. Invalid patterns are
            never applied. Regex mode doesn't support generating new IDs (Insert
            Requirement, Renumber), since a regex matches text — it doesn't define
            how to construct one.
          </p>
        </>
      )}

      {hasExistingPattern && (
        <button
          onClick={onClear}
          className="mt-2 text-[10px] text-[var(--color-muted)] underline transition-colors hover:text-[var(--color-text)]"
        >
          Clear pattern
        </button>
      )}
    </div>
  );
}

// ── Issue summary strip ───────────────────────────────────────────────────────

interface IssueSummaryStripProps {
  analysis: RequirementAnalysis;
  orderIssues: ValidationIssue[];
  issueListOpen: boolean;
  onToggle: () => void;
  onNavigate: (node: OutlineNode) => void;
  /** Undefined in regex mode: renumbering generates new IDs, which requires
   *  a prefix + digit width that only simple-mode patterns have. */
  onRenumber?: () => void;
  /** Same restriction as onRenumber — reassignment also generates an ID. */
  onReassignDuplicate?: (id: string, nodes: OutlineNode[]) => void;
}

function IssueSummaryStrip({
  analysis,
  orderIssues,
  issueListOpen,
  onToggle,
  onNavigate,
  onRenumber,
  onReassignDuplicate,
}: IssueSummaryStripProps) {
  const dupCount = analysis.duplicates.size;
  const missingCount = analysis.missing.length;
  const orderCount = orderIssues.length;
  if (dupCount === 0 && missingCount === 0 && orderCount === 0) return null;

  const parts: string[] = [];
  if (dupCount > 0) parts.push(`${dupCount} duplicate${dupCount > 1 ? "s" : ""}`);
  if (missingCount > 0)
    parts.push(`${missingCount} missing ID${missingCount > 1 ? "s" : ""}`);
  if (orderCount > 0)
    parts.push(`${orderCount} out of order`);

  return (
    <div className="shrink-0 border-b border-[var(--color-border)]">
      {/* Summary row: toggle + renumber button */}
      <div className="flex items-center gap-1 px-3 py-1.5">
        <button
          onClick={onToggle}
          className="flex flex-1 items-center gap-1.5 text-left text-xs text-amber-500"
        >
          <svg
            width="10"
            height="10"
            viewBox="0 0 12 12"
            fill="currentColor"
            className="shrink-0"
          >
            <path d="M6 1 .5 11h11L6 1zm0 2 4 7H2L6 3zM5.5 5v2h1V5h-1zm0 3v1h1V8h-1z" />
          </svg>
          <span className="flex-1 font-medium">{parts.join(" · ")}</span>
          <svg
            width="8"
            height="8"
            viewBox="0 0 8 8"
            fill="currentColor"
            style={{
              transform: issueListOpen ? "rotate(180deg)" : undefined,
              transition: "transform 0.12s ease",
            }}
          >
            <path d="M0 2l4 4 4-4H0z" />
          </svg>
        </button>

        {onRenumber && (dupCount > 0 || missingCount > 0) && (
          <button
            onClick={onRenumber}
            title="Renumber all requirements sequentially"
            className="shrink-0 rounded bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium text-amber-600 transition-colors hover:bg-amber-500/20 dark:text-amber-400"
          >
            Renumber
          </button>
        )}
      </div>

      {/* Issue detail */}
      {issueListOpen && (
        <div className="bg-[var(--color-page-bg)] px-3 pb-3 pt-1">
          {/* Duplicates */}
          {dupCount > 0 && (
            <div className="mb-2">
              <p className="mb-1 text-[9px] font-semibold uppercase tracking-widest text-[var(--color-muted)]">
                Duplicates
              </p>
              {[...analysis.duplicates.entries()].map(([id, nodes]) => (
                <div key={id} className="flex items-center gap-1">
                  <button
                    onClick={() => onNavigate(nodes[0])}
                    title={`Navigate to first occurrence of ${id}`}
                    className="flex flex-1 items-center gap-1.5 rounded-sm px-1 py-0.5 text-left transition-colors hover:bg-amber-50 dark:hover:bg-amber-950/20"
                  >
                    <span className="flex-1 font-mono text-[10px] text-amber-600 dark:text-amber-400">
                      {id}
                    </span>
                    <span className="shrink-0 text-[9px] text-[var(--color-muted)]">
                      {nodes.length}×
                    </span>
                  </button>
                  {onReassignDuplicate && (
                    <button
                      onClick={() => onReassignDuplicate(id, nodes)}
                      title={`Reassign last occurrence of ${id} to next available ID`}
                      className="shrink-0 rounded bg-amber-500/10 px-1.5 py-0.5 text-[9px] font-medium text-amber-600 transition-colors hover:bg-amber-500/20 dark:text-amber-400"
                    >
                      Fix
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Missing */}
          {missingCount > 0 && (
            <div className={orderCount > 0 ? "mb-2" : ""}>
              <p className="mb-1 text-[9px] font-semibold uppercase tracking-widest text-[var(--color-muted)]">
                Missing IDs
              </p>
              <div className="flex flex-wrap gap-1">
                {analysis.missing.map((id) => (
                  <span
                    key={id}
                    className="rounded bg-[var(--color-border)] px-1.5 py-0.5 font-mono text-[9px] text-[var(--color-muted)]"
                  >
                    {id}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Out of order */}
          {orderCount > 0 && (
            <div>
              <p className="mb-1 text-[9px] font-semibold uppercase tracking-widest text-[var(--color-muted)]">
                Out of Order
              </p>
              {orderIssues.map((issue) => {
                const node = issue.targetId
                  ? analysis.requirements.find((r) => r.id === issue.targetId)?.node
                  : undefined;
                return (
                  <button
                    key={issue.id}
                    onClick={() => node && onNavigate(node)}
                    disabled={!node}
                    title={node ? `Navigate to ${issue.targetId}` : issue.message}
                    className="flex w-full items-center gap-1.5 rounded-sm px-1 py-0.5 text-left transition-colors hover:bg-amber-50 disabled:cursor-default disabled:opacity-60 dark:hover:bg-amber-950/20"
                  >
                    <span className="flex-1 font-mono text-[10px] text-amber-600 dark:text-amber-400">
                      {issue.targetId}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Renumber confirmation dialog ──────────────────────────────────────────────

interface RenumberConfirmDialogProps {
  reqCount: number;
  prefix: string;
  digits: number;
  onConfirm: () => void;
  onCancel: () => void;
}

function RenumberConfirmDialog({
  reqCount,
  prefix,
  digits,
  onConfirm,
  onCancel,
}: RenumberConfirmDialogProps) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
      onMouseDown={(e) => e.target === e.currentTarget && onCancel()}
    >
      <div className="w-80 rounded-xl border border-[var(--color-border)] bg-[var(--color-paper)] p-6 shadow-2xl">
        <p className="mb-3 text-sm font-semibold text-[var(--color-text)]">
          Renumber Requirements
        </p>
        <p className="mb-2 text-xs leading-relaxed text-[var(--color-muted)]">
          <span className="font-medium text-[var(--color-text)]">
            {reqCount} requirement heading{reqCount !== 1 ? "s" : ""}
          </span>{" "}
          will be renumbered sequentially using prefix{" "}
          <code className="rounded bg-[var(--color-border)] px-1 font-mono text-[10px]">
            {prefix || "(none)"}
          </code>{" "}
          with {digits}-digit formatting.
        </p>
        <p className="mb-5 text-xs text-[var(--color-muted)]">
          Duplicate IDs and gaps will be resolved. This can be undone with Cmd+Z.
        </p>
        <div className="flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="rounded px-3 py-1.5 text-sm text-[var(--color-muted)] transition-colors hover:bg-[var(--color-border)]"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className="rounded bg-amber-500 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-amber-600"
          >
            Renumber
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Multi-select toolbar ──────────────────────────────────────────────────────

interface MultiSelectToolbarProps {
  count: number;
  onDuplicate: () => void;
  onCopy: () => void;
  onExport: () => void;
  onDelete: () => void;
  onClear: () => void;
}

function MultiSelectToolbar({
  count,
  onDuplicate,
  onCopy,
  onExport,
  onDelete,
  onClear,
}: MultiSelectToolbarProps) {
  const btn = (label: string, action: () => void, danger = false) => (
    <button
      key={label}
      onClick={action}
      className={[
        "rounded px-2 py-0.5 text-[10px] font-medium transition-colors",
        danger
          ? "text-red-500 hover:bg-red-50 dark:hover:bg-red-950/40"
          : "text-[var(--color-text)] hover:bg-[var(--color-border)]",
      ].join(" ")}
    >
      {label}
    </button>
  );

  return (
    <div className="border-b border-[var(--color-border)] bg-[var(--color-accent)]/5 px-3 py-2">
      <div className="mb-1.5 flex items-center justify-between">
        <span className="text-[10px] font-semibold text-[var(--color-accent)]">
          {count} selected
        </span>
        <button
          onClick={onClear}
          title="Clear selection"
          className="flex h-4 w-4 items-center justify-center rounded text-[var(--color-muted)] hover:text-[var(--color-text)]"
        >
          <svg width="8" height="8" viewBox="0 0 8 8" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
            <path d="M1 1l6 6M7 1L1 7" />
          </svg>
        </button>
      </div>
      <div className="flex flex-wrap gap-1">
        {btn("Duplicate", onDuplicate)}
        {btn("Copy MD", onCopy)}
        {btn("Export", onExport)}
        {btn("Delete", onDelete, true)}
      </div>
    </div>
  );
}

// ── Delete-multi confirmation dialog ─────────────────────────────────────────

interface DeleteMultiDialogProps {
  count: number;
  onConfirm: () => void;
  onCancel: () => void;
}

function DeleteMultiDialog({ count, onConfirm, onCancel }: DeleteMultiDialogProps) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
      onMouseDown={(e) => e.target === e.currentTarget && onCancel()}
    >
      <div className="w-80 rounded-xl border border-[var(--color-border)] bg-[var(--color-paper)] p-6 shadow-2xl">
        <p className="mb-2 text-sm font-semibold text-[var(--color-text)]">
          Delete {count} section{count !== 1 ? "s" : ""}?
        </p>
        <p className="mb-5 text-xs text-[var(--color-muted)]">
          Each heading and all content below it will be removed. This action can be undone.
        </p>
        <div className="flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="rounded-md px-3 py-1.5 text-xs text-[var(--color-muted)] hover:bg-[var(--color-border)]"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className="rounded-md bg-red-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-600"
          >
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Context menu ──────────────────────────────────────────────────────────────

interface ContextMenuProps {
  state: ContextMenuState;
  onRename: (node: OutlineNode) => void;
  onDuplicate: (node: OutlineNode) => void;
  onInsertRequirement?: (node: OutlineNode) => void;
  onDelete: (node: OutlineNode) => void;
  onMoveUp: (node: OutlineNode) => void;
  onMoveDown: (node: OutlineNode) => void;
  onSelectOnly: (ids: Set<string>) => void;
  onSelectSubtree: (ids: Set<string>) => void;
  onSelectSiblings: (ids: Set<string>) => void;
  onSelectChildren: (ids: Set<string>) => void;
  onClose: () => void;
}

function ContextMenu({
  state,
  onRename,
  onDuplicate,
  onInsertRequirement,
  onDelete,
  onMoveUp,
  onMoveDown,
  onSelectOnly,
  onSelectSubtree,
  onSelectSiblings,
  onSelectChildren,
  onClose,
}: ContextMenuProps) {
  const { node, canMoveUp, canMoveDown, x, y, subtreeIds, siblingIds, childrenIds } = state;
  const isReadonly = node.readonly === true;
  const menuRef = useRef<HTMLDivElement>(null);

  // Measure actual menu dimensions after first paint and flip position so the
  // menu is never clipped by the viewport edge. Starts hidden to avoid flash.
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  useLayoutEffect(() => {
    if (!menuRef.current) return;
    const { offsetWidth, offsetHeight } = menuRef.current;
    const MARGIN = 6;
    const left = Math.max(MARGIN, Math.min(x, window.innerWidth - offsetWidth - MARGIN));
    const top = Math.max(MARGIN, Math.min(y, window.innerHeight - offsetHeight - MARGIN));
    setPos({ left, top });
  }, [x, y]);

  useEffect(() => {
    const onMouseDown = () => onClose();
    const onKeyDown = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", onMouseDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [onClose]);

  const item = (
    label: string,
    action: () => void,
    disabled = false,
    danger = false
  ) => (
    <button
      key={label}
      className={[
        "w-full px-3 py-1.5 text-left text-xs transition-colors",
        disabled
          ? "cursor-not-allowed text-[var(--color-muted)] opacity-40"
          : danger
            ? "text-red-500 hover:bg-red-50 dark:hover:bg-red-950/40"
            : "text-[var(--color-text)] hover:bg-[var(--color-border)]",
      ].join(" ")}
      disabled={disabled}
      onMouseDown={(e) => {
        e.stopPropagation();
        if (!disabled) {
          action();
          onClose();
        }
      }}
    >
      {label}
    </button>
  );

  return (
    <div
      ref={menuRef}
      className="fixed z-[9999] min-w-[160px] rounded-md border border-[var(--color-border)] bg-[var(--color-paper)] py-1 shadow-xl"
      style={{
        left: pos?.left ?? x,
        top: pos?.top ?? y,
        visibility: pos ? "visible" : "hidden",
      }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {item("Rename", () => onRename(node), isReadonly)}
      {item("Duplicate", () => onDuplicate(node), isReadonly)}
      {onInsertRequirement &&
        item("Insert Requirement After", () => onInsertRequirement(node), isReadonly)}
      <div className="my-1 border-t border-[var(--color-border)]" />
      {item("Move Up", () => onMoveUp(node), !canMoveUp || isReadonly)}
      {item("Move Down", () => onMoveDown(node), !canMoveDown || isReadonly)}
      <div className="my-1 border-t border-[var(--color-border)]" />
      {item("Select", () => onSelectOnly(new Set([stableDragId(node)])))}
      {item("Select Subtree", () => onSelectSubtree(subtreeIds))}
      {item("Select Siblings", () => onSelectSiblings(siblingIds))}
      {childrenIds.size > 0 &&
        item("Select Children", () => onSelectChildren(childrenIds))}
      <div className="my-1 border-t border-[var(--color-border)]" />
      {item("Delete", () => onDelete(node), isReadonly, true)}
    </div>
  );
}

// ── Delete confirmation dialog ────────────────────────────────────────────────

interface DeleteDialogProps {
  node: OutlineNode;
  onConfirm: () => void;
  onCancel: () => void;
}

function DeleteDialog({ node, onConfirm, onCancel }: DeleteDialogProps) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
      onMouseDown={(e) => e.target === e.currentTarget && onCancel()}
    >
      <div className="w-80 rounded-xl border border-[var(--color-border)] bg-[var(--color-paper)] p-6 shadow-2xl">
        <p className="mb-2 text-sm font-semibold text-[var(--color-text)]">
          Delete section?
        </p>
        <p className="mb-1 rounded bg-[var(--color-border)] px-2 py-1 font-mono text-xs text-[var(--color-text)]">
          &ldquo;{node.label}&rdquo;
        </p>
        <p className="mb-5 mt-2 text-xs text-[var(--color-muted)]">
          This removes the heading and all content below it until the next
          same-level heading. This cannot be undone.
        </p>
        <div className="flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="rounded px-3 py-1.5 text-sm text-[var(--color-muted)] transition-colors hover:bg-[var(--color-border)]"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className="rounded bg-red-500 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-red-600"
          >
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Empty state ───────────────────────────────────────────────────────────────

function EmptyState({ children }: { children: React.ReactNode }) {
  return (
    <p className="px-4 py-6 text-center text-xs leading-relaxed text-[var(--color-muted)]">
      {children}
    </p>
  );
}

// ── OutlinePanel ──────────────────────────────────────────────────────────────

interface OutlinePanelProps {
  width: number;
  /** When true, the panel fills its parent instead of setting style.width itself. */
  noWidthStyle?: boolean;
}

export function OutlinePanel({ width, noWidthStyle }: OutlinePanelProps) {
  const editor = useContext(EditorContext);

  // ── Outline state ───────────────────────────────────────────────────────────
  const [outline, setOutline] = useState<OutlineNode[]>([]);
  const [collapsedKeys, setCollapsedKeys] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState("");
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const filterInputRef = useRef<HTMLInputElement>(null);

  // ── Selection state ─────────────────────────────────────────────────────────
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [lastSelectedKey, setLastSelectedKey] = useState<string | null>(null);
  const [deleteMultiOpen, setDeleteMultiOpen] = useState(false);
  const panelRef = useRef<HTMLElement>(null);

  // ── Drag state ──────────────────────────────────────────────────────────────
  const [dragKey, setDragKey] = useState<string | null>(null);
  const [validDropTargets, setValidDropTargets] = useState<Set<string>>(new Set());
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null);

  // ── Dialog / context menu ───────────────────────────────────────────────────
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [renameNode, setRenameNode] = useState<OutlineNode | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [deleteNode, setDeleteNode] = useState<OutlineNode | null>(null);

  // ── Requirement pattern config ──────────────────────────────────────────────
  const { requirementPattern, setRequirementPattern, setRequirementRegexPattern, clearRequirementPattern } =
    useConfigStore();
  const [patternOpen, setPatternOpen] = useState(false);
  const [patternMode, setPatternMode] = useState<PatternMode>(
    requirementPattern?.mode ?? "simple"
  );
  const [patternInput, setPatternInput] = useState(
    requirementPattern?.mode === "simple" ? requirementPattern.example : ""
  );
  const [regexSourceInput, setRegexSourceInput] = useState(
    requirementPattern?.mode === "regex" ? requirementPattern.source : ""
  );
  const [regexFlagsInput, setRegexFlagsInput] = useState(
    requirementPattern?.mode === "regex" ? requirementPattern.flags : ""
  );
  const [issueListOpen, setIssueListOpen] = useState(false);
  const [renumberConfirmOpen, setRenumberConfirmOpen] = useState(false);
  const patternTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Outline rebuild ─────────────────────────────────────────────────────────
  // Subscribes to `transaction` (not `update`) so that tab-switch content swaps,
  // which use setMeta("preventUpdate", true) to avoid writing back to the store,
  // still trigger an outline rebuild. Normal edits are debounced; tab switches
  // (preventUpdate) rebuild immediately so the outline is never stale after switch.
  useEffect(() => {
    if (!editor) return;
    setOutline(deriveOutline(editor));
    const onTransaction = ({ transaction: tr }: { transaction: Transaction }) => {
      if (!tr.docChanged) return;
      if (timerRef.current) clearTimeout(timerRef.current);
      if (tr.getMeta("preventUpdate")) {
        setOutline(deriveOutline(editor));
      } else {
        timerRef.current = setTimeout(() => {
          setOutline(deriveOutline(editor));
        }, DEBOUNCE_MS);
      }
    };
    editor.on("transaction", onTransaction);
    return () => {
      editor.off("transaction", onTransaction);
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [editor]);

  // ── Active heading (per-transaction) ───────────────────────────────────────
  const cursorPos =
    useEditorState({
      editor,
      selector: ({ editor: e }) => e?.state.selection.from ?? 0,
      equalityFn: (a, b) => a === b,
    }) ?? 0;

  const flatOutline = useMemo(() => flattenOutline(outline), [outline]);
  const activeKey = useMemo(
    () => findActiveHeadingKey(flatOutline, cursorPos),
    [flatOutline, cursorPos]
  );

  // ── Search state ────────────────────────────────────────────────────────────
  const searchState = useMemo(
    () => computeSearchState(outline, query),
    [outline, query]
  );
  const isFiltering = searchState !== null;

  // ── Requirement analysis ────────────────────────────────────────────────────
  const compiledPattern: CompiledPattern | null = useMemo(
    () => compileRequirementPattern(requirementPattern),
    [requirementPattern]
  );

  const analysis = useMemo((): RequirementAnalysis | null => {
    if (!editor || !requirementPattern) return null;
    const content: JSONContent[] = editor.getJSON().content ?? [];
    return analyzeRequirements(flatOutline, content, requirementPattern);
  }, [editor, flatOutline, requirementPattern]);

  const requirementNodeKeys = useMemo(() => {
    if (!analysis) return new Set<string>();
    return new Set(analysis.requirements.map((r) => r.node.key));
  }, [analysis]);

  const duplicateNodeKeys = useMemo(() => {
    if (!analysis) return new Set<string>();
    const keys = new Set<string>();
    for (const nodes of analysis.duplicates.values()) {
      nodes.forEach((n) => keys.add(n.key));
    }
    return keys;
  }, [analysis]);

  // ── Structural operation helper ─────────────────────────────────────────────
  // Single PM transaction so every content op is one Cmd+Z step.
  const applyContentOp = useCallback(
    (newContent: JSONContent[]) => {
      if (!editor) return;
      const { state } = editor;
      const savedFrom = state.selection.from;
      const newDocNode = state.schema.nodeFromJSON({
        type: "doc",
        content: newContent,
      });
      const tr = state.tr.replaceWith(0, state.doc.content.size, newDocNode.content);
      const maxPos = Math.max(0, newDocNode.content.size - 1);
      tr.setSelection(
        TextSelection.create(tr.doc, Math.min(savedFrom, maxPos))
      );
      editor.view.dispatch(tr);
    },
    [editor]
  );

  const getDocContent = useCallback(
    (): JSONContent[] => editor?.getJSON().content ?? [],
    [editor]
  );

  // ── Multi-section operations ────────────────────────────────────────────────
  const resolveSelectedNodes = useCallback((): OutlineNode[] => {
    if (!editor) return [];
    const fresh = flattenOutline(deriveOutline(editor));
    return fresh.filter((n) => selectedKeys.has(stableDragId(n)));
  }, [editor, selectedKeys]);

  const handleMultiDuplicate = useCallback(() => {
    const nodes = resolveSelectedNodes();
    if (nodes.length === 0) return;
    const content = getDocContent();
    const ranges = normalizeSelectedRanges(nodes, content);
    applyContentOp(duplicateMultipleSections(content, ranges));
  }, [resolveSelectedNodes, getDocContent, applyContentOp]);

  const handleMultiDelete = useCallback(() => {
    const nodes = resolveSelectedNodes();
    if (nodes.length === 0) return;
    const content = getDocContent();
    const ranges = normalizeSelectedRanges(nodes, content);
    applyContentOp(deleteMultipleSections(content, ranges));
    setSelectedKeys(new Set());
    setDeleteMultiOpen(false);
  }, [resolveSelectedNodes, getDocContent, applyContentOp]);

  const handleCopyMarkdown = useCallback(async () => {
    if (!editor) return;
    const nodes = resolveSelectedNodes();
    if (nodes.length === 0) return;
    const content = getDocContent();
    const ranges = normalizeSelectedRanges(nodes, content);
    const selectedContent = ranges.flatMap(({ from, to }) =>
      content.slice(from, to)
    );
    try {
      const markdown = serializeDocToMarkdown({
        type: "doc",
        content: selectedContent,
      });
      await navigator.clipboard.writeText(markdown);
      useToastStore.getState().show(
        `Copied ${ranges.length} section${ranges.length !== 1 ? "s" : ""}`,
        "success"
      );
    } catch {
      useToastStore.getState().show("Copy failed", "error");
    }
  }, [editor, resolveSelectedNodes, getDocContent]);

  const handleExportSelection = useCallback(async () => {
    if (!editor) return;
    const nodes = resolveSelectedNodes();
    if (nodes.length === 0) return;
    const content = getDocContent();
    const ranges = normalizeSelectedRanges(nodes, content);
    const selectedContent = ranges.flatMap(({ from, to }) =>
      content.slice(from, to)
    );
    try {
      const markdown = serializeDocToMarkdown({
        type: "doc",
        content: selectedContent,
      });
      const blob = new Blob([markdown], { type: "text/markdown" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `export-${ranges.length}-sections.md`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      useToastStore.getState().show("Export failed", "error");
    }
  }, [editor, resolveSelectedNodes, getDocContent]);

  // ── DnD move helper (single undoable PM transaction) ───────────────────────
  // Unlike applyContentOp (two dispatches: setContent + setTextSelection),
  // this folds the content replacement and cursor restoration into one tr so
  // Cmd+Z reverts the entire move in a single undo step.
  // sFrom/sTo = getNodeSectionRange result for the moved section (pre-move indices).
  // insertedAtIndex = block index in newContent where the section heading lands.
  const applyMoveOp = useCallback(
    (
      newContent: JSONContent[],
      sFrom: number,
      sTo: number,
      insertedAtIndex: number
    ) => {
      if (!editor) return;
      const { state } = editor;
      const { doc, selection } = state;
      const sLen = sTo - sFrom;

      // Find cursor block index and intra-block offset in the current doc
      let cursorBlockIdx = -1;
      let cursorBlockStart = 0;
      doc.forEach((node, offset, idx) => {
        if (
          cursorBlockIdx === -1 &&
          offset <= selection.from &&
          selection.from < offset + node.nodeSize
        ) {
          cursorBlockIdx = idx;
          cursorBlockStart = offset;
        }
      });
      const cursorIntraOffset =
        cursorBlockIdx >= 0 ? selection.from - cursorBlockStart : 0;

      // Map cursor block index through the remove-then-insert transformation
      let newCursorBlockIdx: number;
      if (cursorBlockIdx >= sFrom && cursorBlockIdx < sTo) {
        // Cursor was inside the moved section — preserve relative position
        newCursorBlockIdx = insertedAtIndex + (cursorBlockIdx - sFrom);
      } else {
        const afterRemoval =
          cursorBlockIdx >= sTo ? cursorBlockIdx - sLen : cursorBlockIdx;
        newCursorBlockIdx =
          insertedAtIndex <= afterRemoval
            ? afterRemoval + sLen
            : afterRemoval;
      }

      // Replace doc content and set cursor in a single undoable transaction
      const newDocNode = state.schema.nodeFromJSON({
        type: "doc",
        content: newContent,
      });
      const tr = state.tr.replaceWith(0, doc.content.size, newDocNode.content);

      // Find cursor position in the new doc
      let newCursorBlockStart = tr.doc.content.size;
      tr.doc.forEach((_node, offset, idx) => {
        if (idx === newCursorBlockIdx) newCursorBlockStart = offset;
      });
      const targetPos = Math.min(
        newCursorBlockStart + cursorIntraOffset,
        tr.doc.content.size
      );
      tr.setSelection(TextSelection.create(tr.doc, targetPos));

      editor.view.dispatch(tr);
    },
    [editor]
  );

  // ── Navigation ──────────────────────────────────────────────────────────────
  const handleSelect = useCallback(
    (node: OutlineNode) => {
      if (!editor) return;
      editor.chain().focus().setTextSelection(node.pmPos + 1).scrollIntoView().run();
    },
    [editor]
  );

  // ── Ctrl/Cmd+A: select all visible outline nodes ────────────────────────────
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.key !== "a") return;
      if (!panelRef.current?.contains(document.activeElement)) return;
      e.preventDefault();
      setSelectedKeys(new Set(flatOutline.map(stableDragId)));
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [flatOutline]);

  // ── Node click: single / Ctrl / Shift select ───────────────────────────────
  const handleNodeClick = useCallback(
    (e: React.MouseEvent, node: OutlineNode) => {
      const sid = stableDragId(node);
      if (e.metaKey || e.ctrlKey) {
        setSelectedKeys((prev) => {
          const next = new Set(prev);
          if (next.has(sid)) next.delete(sid);
          else next.add(sid);
          return next;
        });
        setLastSelectedKey(sid);
      } else if (e.shiftKey && lastSelectedKey) {
        const ids = flatOutline.map(stableDragId);
        const a = ids.indexOf(lastSelectedKey);
        const b = ids.indexOf(sid);
        if (a !== -1 && b !== -1) {
          const [lo, hi] = a <= b ? [a, b] : [b, a];
          setSelectedKeys(new Set(ids.slice(lo, hi + 1)));
        }
      } else {
        setSelectedKeys(new Set([sid]));
        setLastSelectedKey(sid);
        handleSelect(node);
      }
    },
    [lastSelectedKey, flatOutline, handleSelect]
  );

  // ── Collapse / expand ───────────────────────────────────────────────────────
  const toggleCollapsed = useCallback((key: string) => {
    setCollapsedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const expandAll = useCallback(() => setCollapsedKeys(new Set()), []);
  const collapseAll = useCallback(() => {
    setCollapsedKeys(
      new Set(flatOutline.filter((n) => n.children.length > 0).map((n) => n.key))
    );
  }, [flatOutline]);

  // ── Drag and drop ───────────────────────────────────────────────────────────
  const handleDragStart = useCallback(
    (staleNode: OutlineNode) => {
      if (!editor) return;
      const freshFlat = flattenOutline(deriveOutline(editor));
      const content = getDocContent();
      const level = staleNode.level ?? 1;
      const sid = stableDragId(staleNode);
      const freshSource = freshFlat.find((n) => stableDragId(n) === sid);
      if (!freshSource) return;

      const isMultiDrag = selectedKeys.has(sid) && selectedKeys.size > 1;

      if (isMultiDrag) {
        const selectedNodes = freshFlat.filter((n) =>
          selectedKeys.has(stableDragId(n))
        );
        const ranges = normalizeSelectedRanges(selectedNodes, content);
        // Exclude all selected nodes and anything inside their ranges from targets
        const targets = new Set(
          freshFlat
            .filter((n) => {
              if (selectedKeys.has(stableDragId(n))) return false;
              if ((n.level ?? 1) > level) return false;
              return !ranges.some(
                (r) => n.index > r.from && n.index < r.to
              );
            })
            .map(stableDragId)
        );
        setDragKey(sid);
        setValidDropTargets(targets);
      } else {
        const targets = new Set(
          freshFlat
            .filter(
              (n) =>
                (n.level ?? 1) <= level &&
                stableDragId(n) !== sid &&
                !isInsideSection(content, freshSource.index, level, n.index)
            )
            .map(stableDragId)
        );
        setDragKey(sid);
        setValidDropTargets(targets);
      }
    },
    [editor, getDocContent, selectedKeys]
  );

  const handleDragOver = useCallback(
    (e: React.DragEvent, target: OutlineNode) => {
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      const position =
        e.clientY < rect.top + rect.height / 2 ? "before" : "after";
      const tid = stableDragId(target);
      setDropTarget((prev) =>
        prev?.key === tid && prev.position === position
          ? prev
          : { key: tid, position }
      );
    },
    []
  );

  const handleDrop = useCallback(
    (staleTarget: OutlineNode) => {
      if (!editor || !dragKey || !dropTarget) return;
      const freshFlat = flattenOutline(deriveOutline(editor));
      const content = getDocContent();
      const freshTarget = freshFlat.find(
        (n) => stableDragId(n) === stableDragId(staleTarget)
      );
      if (!freshTarget) return;

      const isMultiDrop = selectedKeys.has(dragKey) && selectedKeys.size > 1;

      if (isMultiDrop) {
        const selectedNodes = freshFlat.filter((n) =>
          selectedKeys.has(stableDragId(n))
        );
        const ranges = normalizeSelectedRanges(selectedNodes, content);
        if (ranges.length === 0) return;
        // Reject drop if target is inside a selected section
        if (ranges.some((r) => freshTarget.index >= r.from && freshTarget.index < r.to)) return;

        const sourceLevel =
          freshFlat.find((n) => stableDragId(n) === dragKey)?.level ?? 1;
        const targetLevel = freshTarget.level ?? 1;

        // Adjust target index for removals
        let adjustedTarget = freshTarget.index;
        for (const { from, to } of [...ranges].reverse()) {
          if (freshTarget.index >= to) adjustedTarget -= to - from;
          else if (freshTarget.index > from) { setDragKey(null); setValidDropTargets(new Set()); setDropTarget(null); return; }
        }

        // Build remaining content
        let remaining = [...content];
        for (const { from, to } of [...ranges].reverse()) {
          remaining = [...remaining.slice(0, from), ...remaining.slice(to)];
        }

        // Compute insert position in remaining
        let insertAt: number;
        if (dropTarget.position === "before") {
          insertAt = adjustedTarget;
        } else if (sourceLevel > targetLevel) {
          insertAt = adjustedTarget + 1;
        } else {
          const [, tTo] = getNodeSectionRange(remaining, adjustedTarget, targetLevel);
          insertAt = tTo;
        }

        const selectedContent = ranges.flatMap(({ from, to }) =>
          content.slice(from, to)
        );
        const newContent = [
          ...remaining.slice(0, insertAt),
          ...selectedContent,
          ...remaining.slice(insertAt),
        ];
        applyContentOp(newContent);
      } else {
        // Single-node drop
        const source = freshFlat.find((n) => stableDragId(n) === dragKey);
        if (!source) return;

        const sourceLevel = source.level ?? 1;
        const targetLevel = freshTarget.level ?? 1;
        const [sFrom, sTo] = getNodeSectionRange(content, source.index, sourceLevel);
        const sLen = sTo - sFrom;

        let newContent: JSONContent[];
        let insertedAtIndex: number;

        if (sourceLevel === targetLevel) {
          if (dropTarget.position === "before") {
            newContent = moveSectionBefore(content, source.index, sourceLevel, freshTarget.index);
            insertedAtIndex = freshTarget.index > sFrom ? freshTarget.index - sLen : freshTarget.index;
          } else {
            const [, tTo] = getNodeSectionRange(content, freshTarget.index, targetLevel);
            newContent = moveSectionAfter(content, source.index, sourceLevel, freshTarget.index, targetLevel);
            insertedAtIndex = tTo > sFrom ? tTo - sLen : tTo;
          }
        } else {
          const insertPos = dropTarget.position === "after" ? freshTarget.index + 1 : freshTarget.index;
          newContent = moveSectionBefore(content, source.index, sourceLevel, insertPos);
          insertedAtIndex = insertPos > sFrom ? insertPos - sLen : insertPos;
        }

        applyMoveOp(newContent, sFrom, sTo, insertedAtIndex);
      }

      setDragKey(null);
      setValidDropTargets(new Set());
      setDropTarget(null);
    },
    [editor, dragKey, dropTarget, getDocContent, applyMoveOp, applyContentOp, selectedKeys]
  );

  const handleDragEnd = useCallback(() => {
    setDragKey(null);
    setValidDropTargets(new Set());
    setDropTarget(null);
  }, []);

  // ── Context menu ────────────────────────────────────────────────────────────
  // Always re-derive from editor.state here (not from `flatOutline` React state)
  // because outline state is debounced 150 ms. A previous move/rename shifts PM
  // offsets immediately; if the user right-clicks again before the debounce fires
  // the React-state node has a stale key AND stale index. We match by label
  // (heading text is unchanged by moves) to find the fresh node with correct index.
  const handleContextMenu = useCallback(
    (e: React.MouseEvent, staleNode: OutlineNode) => {
      if (!editor) return;
      const freshTree = deriveOutline(editor);
      const freshFlat = flattenOutline(freshTree);
      const level = staleNode.level ?? 1;
      const sameLevelInOrder = freshFlat.filter((n) => n.level === level);
      const idx = sameLevelInOrder.findIndex((n) => n.label === staleNode.label);
      const freshNode = idx >= 0 ? sameLevelInOrder[idx] : staleNode;

      // Pre-compute selection key sets for Select Subtree / Siblings / Children
      const freshSid = stableDragId(freshNode);
      const treeNode = findNodeInTree(freshTree, freshSid);
      const subtreeNodes = treeNode ? flattenOutline([treeNode]) : [freshNode];
      const subtreeIds = new Set(subtreeNodes.map(stableDragId));

      const parent = findParentInTree(freshTree, freshSid);
      const siblings = parent ? parent.children : freshTree;
      const siblingIds = new Set(siblings.map(stableDragId));

      const childrenIds = new Set(
        (treeNode?.children ?? []).map(stableDragId)
      );

      setContextMenu({
        node: freshNode,
        canMoveUp: idx > 0,
        canMoveDown: idx >= 0 && idx < sameLevelInOrder.length - 1,
        x: e.clientX,
        y: e.clientY,
        subtreeIds,
        siblingIds,
        childrenIds,
      });
    },
    [editor]
  );

  // ── Context menu actions ────────────────────────────────────────────────────
  // Guards against the Enter-then-blur double-call: first caller wins, all
  // subsequent calls to handleRenameConfirm/Cancel within the same rename
  // session are no-ops.
  const renameHandledRef = useRef(false);

  const handleRename = useCallback((node: OutlineNode) => {
    if (node.readonly) return;
    renameHandledRef.current = false;
    setRenameNode(node);
    setRenameValue(node.label);
  }, []);

  const handleRenameConfirm = useCallback(() => {
    if (renameHandledRef.current) return;
    renameHandledRef.current = true;
    if (!renameNode || !renameValue.trim()) {
      setRenameNode(null);
      setRenameValue("");
      return;
    }
    applyContentOp(renameHeading(getDocContent(), renameNode.index, renameValue));
    setRenameNode(null);
    setRenameValue("");
  }, [renameNode, renameValue, applyContentOp, getDocContent]);

  const handleRenameCancel = useCallback(() => {
    renameHandledRef.current = true;
    setRenameNode(null);
    setRenameValue("");
  }, []);

  const handleDuplicate = useCallback(
    (node: OutlineNode) => {
      if (node.readonly) return;
      applyContentOp(
        duplicateSection(getDocContent(), node.index, node.level ?? 1)
      );
    },
    [applyContentOp, getDocContent]
  );

  const handleDelete = useCallback((node: OutlineNode) => {
    if (node.readonly) return;
    setDeleteNode(node);
  }, []);

  const handleDeleteConfirm = useCallback(() => {
    if (!deleteNode) return;
    applyContentOp(
      deleteSection(getDocContent(), deleteNode.index, deleteNode.level ?? 1)
    );
    setDeleteNode(null);
  }, [deleteNode, applyContentOp, getDocContent]);

  const handleMoveUp = useCallback(
    (node: OutlineNode) => {
      if (!editor) return;
      // Re-derive fresh at click time. node.key is fresh (set by handleContextMenu
      // from a fresh derivation), so findIndex by key is reliable here.
      const freshFlat = flattenOutline(deriveOutline(editor));
      const level = node.level ?? 1;
      const sameLevelInOrder = freshFlat.filter((n) => n.level === level);
      const idx = sameLevelInOrder.findIndex((n) => n.key === node.key);
      if (idx <= 0) return;
      const freshNode = sameLevelInOrder[idx];
      const prev = sameLevelInOrder[idx - 1];
      applyContentOp(
        moveSectionBefore(getDocContent(), freshNode.index, level, prev.index)
      );
    },
    [editor, applyContentOp, getDocContent]
  );

  const handleMoveDown = useCallback(
    (node: OutlineNode) => {
      if (!editor) return;
      const freshFlat = flattenOutline(deriveOutline(editor));
      const level = node.level ?? 1;
      const sameLevelInOrder = freshFlat.filter((n) => n.level === level);
      const idx = sameLevelInOrder.findIndex((n) => n.key === node.key);
      if (idx < 0 || idx >= sameLevelInOrder.length - 1) return;
      const freshNode = sameLevelInOrder[idx];
      const next = sameLevelInOrder[idx + 1];
      applyContentOp(
        moveSectionAfter(getDocContent(), freshNode.index, level, next.index, level)
      );
    },
    [editor, applyContentOp, getDocContent]
  );

  // ── Pattern config ──────────────────────────────────────────────────────────
  const handlePatternModeChange = useCallback(
    (mode: PatternMode) => {
      if (patternTimerRef.current) clearTimeout(patternTimerRef.current);
      setPatternMode(mode);
    },
    []
  );

  const handlePatternInputChange = useCallback(
    (value: string) => {
      setPatternInput(value);
      if (patternTimerRef.current) clearTimeout(patternTimerRef.current);
      const trimmed = value.trim();
      if (!trimmed) {
        patternTimerRef.current = setTimeout(
          () => clearRequirementPattern(),
          PATTERN_APPLY_MS
        );
      } else if (compileRequirementPattern(trimmed)) {
        patternTimerRef.current = setTimeout(
          () => setRequirementPattern(trimmed),
          PATTERN_APPLY_MS
        );
      }
      // Invalid non-empty input: leave the store untouched (matches simple
      // mode's existing debounce-commit behavior — an invalid pattern is
      // never persisted, so it's never used by extraction/validation).
    },
    [clearRequirementPattern, setRequirementPattern]
  );

  const handleRegexInputChange = useCallback(
    (source: string, flags: string) => {
      if (patternTimerRef.current) clearTimeout(patternTimerRef.current);
      const trimmed = source.trim();
      if (!trimmed) {
        patternTimerRef.current = setTimeout(
          () => clearRequirementPattern(),
          PATTERN_APPLY_MS
        );
      } else if (validateRequirementRegex(trimmed, flags).valid) {
        patternTimerRef.current = setTimeout(
          () => setRequirementRegexPattern(trimmed, flags),
          PATTERN_APPLY_MS
        );
      }
      // Invalid regex: never committed to the store — the validator (and
      // every other consumer) can never see an invalid pattern.
    },
    [clearRequirementPattern, setRequirementRegexPattern]
  );

  const handleRegexSourceChange = useCallback(
    (value: string) => {
      setRegexSourceInput(value);
      handleRegexInputChange(value, regexFlagsInput);
    },
    [handleRegexInputChange, regexFlagsInput]
  );

  const handleRegexFlagsChange = useCallback(
    (value: string) => {
      setRegexFlagsInput(value);
      handleRegexInputChange(regexSourceInput, value);
    },
    [handleRegexInputChange, regexSourceInput]
  );

  const handlePatternClear = useCallback(() => {
    if (patternTimerRef.current) clearTimeout(patternTimerRef.current);
    clearRequirementPattern();
    setPatternInput("");
    setRegexSourceInput("");
    setRegexFlagsInput("");
  }, [clearRequirementPattern]);

  // ── M4B: requirement mutation actions ──────────────────────────────────────
  // Insert / Renumber / Reassign all generate new IDs, which only simple-mode
  // patterns support (see CompiledPattern.supportsNumbering) — gated below.

  const handleInsertRequirement = useCallback(
    (node: OutlineNode) => {
      if (!editor || !compiledPattern?.supportsNumbering || !analysis || node.readonly) return;
      const { prefix, digits } = compiledPattern;
      const newId = nextAvailableId(analysis.requirements, prefix, digits);
      const content = getDocContent();
      const [, insertedAtIndex] = getNodeSectionRange(
        content,
        node.index,
        node.level ?? 1
      );
      applyContentOp(
        insertRequirementAfter(content, node.index, node.level ?? 1, newId)
      );
      // Place cursor after the ID text in the newly inserted heading.
      // For blockquote-wrapped headings the inserted node is a blockquote, so
      // we need +2 (blockquote open token + heading open token) instead of +1.
      let targetPmPos = -1;
      editor.state.doc.forEach((_n, offset, idx) => {
        if (idx === insertedAtIndex) targetPmPos = offset;
      });
      if (targetPmPos >= 0) {
        const insertedNode = editor.state.doc.nodeAt(targetPmPos);
        const innerOffset =
          insertedNode?.type.name === "blockquote" ||
          insertedNode?.type.name === "callout"
            ? 2
            : 1;
        editor
          .chain()
          .focus()
          .setTextSelection(targetPmPos + innerOffset + newId.length)
          .scrollIntoView()
          .run();
      }
    },
    [editor, compiledPattern, analysis, getDocContent, applyContentOp]
  );

  const handleRenumber = useCallback(() => {
    if (!editor || !compiledPattern?.supportsNumbering || !analysis) return;
    const { prefix, digits } = compiledPattern;
    const replacements = computeRenumberReplacements(analysis.requirements, prefix, digits);

    const { state } = editor;
    let tr = state.tr;
    // Suppress the migration plugin — we handle comment migration below directly.
    tr.setMeta(requirementIdMigrationKey, { skip: true });

    // Apply in reverse document order (highest pmPos first) so that each
    // replacement doesn't shift the absolute positions used by subsequent steps.
    for (const { pmPos, newId, entry } of [...replacements].reverse()) {
      const node = state.doc.nodeAt(pmPos);
      if (!node || node.type.name !== "heading") continue;
      rewriteHeadingId(tr, pmPos, entry.id, newId);
    }

    editor.view.dispatch(tr);

    // Companion data (review comments + traceability links) migrates as ONE
    // atomic batch each, from the full occurrence-level rename list — NOT a
    // Map collapsed to unique old IDs, and deliberately INCLUDING pairs
    // where newId === entry.id. A requirement duplicated via copy/paste
    // shares one ID across several physical headings; when one occurrence
    // keeps its number while another is renumbered away, that unchanged
    // pair is the ONLY signal the stores have that the ID was shared at
    // all — filtering it out here would make the store think it's a plain
    // 1:1 move and wrongly relocate the unchanged occurrence's data. Both
    // stores already no-op internally on true self-only pairs.
    const renames = replacements.map(({ newId, entry }) => ({ oldId: entry.id, newId }));
    useReviewCommentsStore.getState().renumberComments(renames);
    useTraceabilityStore.getState().remapRequirementIds(renames);

    setRenumberConfirmOpen(false);
  }, [editor, compiledPattern, analysis]);

  const handleReassignDuplicate = useCallback(
    (id: string, nodes: OutlineNode[]) => {
      if (!editor || !compiledPattern?.supportsNumbering || !analysis) return;
      const { prefix, digits } = compiledPattern;
      const target = nodes[nodes.length - 1]; // last occurrence by document order
      const newId = nextAvailableId(analysis.requirements, prefix, digits);

      const { state } = editor;
      const node = state.doc.nodeAt(target.pmPos);
      if (!node || node.type.name !== "heading") return;
      const tr = state.tr;
      // Suppress migration: we handle companion-data duplication explicitly
      // below, occurrence-aware — same philosophy as handleRenumber. The
      // remaining occurrence(s) still bearing `id` are untouched and keep
      // everything they had; the just-reassigned duplicate gets its own
      // COPY of what was shared under the old ID, not a move (its data was
      // never "only" that occurrence's to begin with — it was shared).
      tr.setMeta(requirementIdMigrationKey, { skip: true });
      rewriteHeadingId(tr, target.pmPos, id, newId);
      editor.view.dispatch(tr);

      useReviewCommentsStore.getState().copyRequirementComments(id, newId);
      useTraceabilityStore.getState().copyRequirementLinks(id, newId);
    },
    [editor, compiledPattern, analysis]
  );

  // ── Validation issues (ordering) ────────────────────────────────────────────
  const allValidationIssues = useValidationStore((s) => s.issues);
  const orderIssues = useMemo(
    () => allValidationIssues.filter((i) => i.type === "requirement-order"),
    [allValidationIssues],
  );

  // ── Render ──────────────────────────────────────────────────────────────────
  const hasParentNodes = flatOutline.some((n) => n.children.length > 0);
  const hasIssues =
    analysis !== null &&
    (analysis.duplicates.size > 0 || analysis.missing.length > 0 || orderIssues.length > 0);

  return (
    <>
      <aside
        ref={panelRef}
        tabIndex={-1}
        className={[
          "flex flex-col overflow-hidden border-r border-[var(--color-border)] bg-[var(--color-paper)] outline-none",
          noWidthStyle ? "min-h-0 flex-1" : "shrink-0",
        ].join(" ")}
        style={noWidthStyle ? undefined : { width }}
        aria-label="Document outline"
      >
        {/* ── Header ── */}
        <div className="flex h-9 shrink-0 items-center justify-between border-b border-[var(--color-border)] px-3">
          <span className="text-[10px] font-semibold uppercase tracking-widest text-[var(--color-muted)]">
            Outline
          </span>
          <div className="flex items-center gap-0.5">
            {hasParentNodes && !isFiltering && (
              <>
                <button
                  onClick={expandAll}
                  title="Expand all"
                  className="flex h-5 w-5 items-center justify-center rounded text-[var(--color-muted)] transition-colors hover:bg-[var(--color-border)] hover:text-[var(--color-text)]"
                >
                  <svg
                    width="11"
                    height="11"
                    viewBox="0 0 12 12"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M2 4l4 4 4-4" />
                  </svg>
                </button>
                <button
                  onClick={collapseAll}
                  title="Collapse all"
                  className="flex h-5 w-5 items-center justify-center rounded text-[var(--color-muted)] transition-colors hover:bg-[var(--color-border)] hover:text-[var(--color-text)]"
                >
                  <svg
                    width="11"
                    height="11"
                    viewBox="0 0 12 12"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M2 8l4-4 4 4" />
                  </svg>
                </button>
              </>
            )}

            <button
              onClick={() => setPatternOpen((o) => !o)}
              title={
                patternOpen
                  ? "Close requirement settings"
                  : "Configure requirement pattern"
              }
              className={[
                "flex h-5 w-5 items-center justify-center rounded text-[var(--color-muted)] transition-colors hover:bg-[var(--color-border)] hover:text-[var(--color-text)]",
                patternOpen || requirementPattern
                  ? "text-[var(--color-accent)]"
                  : "",
              ].join(" ")}
            >
              <svg width="11" height="11" viewBox="0 0 16 16" fill="currentColor">
                <path d="M8 10a2 2 0 1 0 0-4 2 2 0 0 0 0 4zm6.32-1.4-.9-.52a5.6 5.6 0 0 0 0-1.16l.9-.52a1 1 0 0 0 .37-1.36l-1-1.73a1 1 0 0 0-1.36-.37l-.9.52A5.54 5.54 0 0 0 9.4 3.1V2a1 1 0 0 0-1-1H6.6a1 1 0 0 0-1 1v1.1a5.54 5.54 0 0 0-1.03.56l-.9-.52a1 1 0 0 0-1.36.37l-1 1.73a1 1 0 0 0 .37 1.36l.9.52a5.6 5.6 0 0 0 0 1.16l-.9.52a1 1 0 0 0-.37 1.36l1 1.73a1 1 0 0 0 1.36.37l.9-.52c.32.21.66.4 1.03.56V14a1 1 0 0 0 1 1h1.8a1 1 0 0 0 1-1v-1.1c.37-.16.71-.35 1.03-.56l.9.52a1 1 0 0 0 1.36-.37l1-1.73a1 1 0 0 0-.37-1.36z" />
              </svg>
            </button>
          </div>
        </div>

        {/* ── Pattern config panel ── */}
        {patternOpen && (
          <PatternConfigPanel
            mode={patternMode}
            onModeChange={handlePatternModeChange}
            patternInput={patternInput}
            onInputChange={handlePatternInputChange}
            regexSource={regexSourceInput}
            regexFlags={regexFlagsInput}
            onRegexSourceChange={handleRegexSourceChange}
            onRegexFlagsChange={handleRegexFlagsChange}
            onClear={handlePatternClear}
            hasExistingPattern={requirementPattern !== null}
          />
        )}

        {/* ── Search input ── */}
        <div className="shrink-0 border-b border-[var(--color-border)] px-2 py-2">
          <div className="flex items-center gap-1.5 rounded border border-[var(--color-border)] bg-[var(--color-page-bg)] px-2 py-1 transition-colors focus-within:border-[var(--color-accent)]">
            <svg
              width="10"
              height="10"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              className="shrink-0 text-[var(--color-muted)]"
            >
              <circle cx="7" cy="7" r="5" />
              <path d="m10.5 10.5 3 3" />
            </svg>
            <input
              ref={filterInputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Escape" && setQuery("")}
              placeholder="Search headings…"
              className="min-w-0 flex-1 bg-transparent text-xs text-[var(--color-text)] outline-none placeholder:text-[var(--color-muted)]"
              aria-label="Search headings"
            />
            {query && (
              <button
                onClick={() => {
                  setQuery("");
                  filterInputRef.current?.focus();
                }}
                aria-label="Clear search"
                className="shrink-0 text-[var(--color-muted)] transition-colors hover:text-[var(--color-text)]"
              >
                <svg
                  width="9"
                  height="9"
                  viewBox="0 0 10 10"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                >
                  <path d="M1 1l8 8M9 1L1 9" />
                </svg>
              </button>
            )}
          </div>
        </div>

        {/* ── Multi-select toolbar ── */}
        {selectedKeys.size > 1 && (
          <MultiSelectToolbar
            count={selectedKeys.size}
            onDuplicate={handleMultiDuplicate}
            onCopy={handleCopyMarkdown}
            onExport={handleExportSelection}
            onDelete={() => setDeleteMultiOpen(true)}
            onClear={() => { setSelectedKeys(new Set()); setLastSelectedKey(null); }}
          />
        )}

        {/* ── Issue summary ── */}
        {hasIssues && (
          <IssueSummaryStrip
            analysis={analysis!}
            orderIssues={orderIssues}
            issueListOpen={issueListOpen}
            onToggle={() => setIssueListOpen((o) => !o)}
            onNavigate={handleSelect}
            onRenumber={
              compiledPattern?.supportsNumbering ? () => setRenumberConfirmOpen(true) : undefined
            }
            onReassignDuplicate={
              compiledPattern?.supportsNumbering ? handleReassignDuplicate : undefined
            }
          />
        )}

        {/* ── Tree content ── */}
        <div className="flex-1 overflow-y-auto py-1" role="tree">
          {!editor && <EmptyState>Loading…</EmptyState>}

          {editor && isFiltering && searchState!.matchingKeys.size === 0 && (
            <EmptyState>No matching headings.</EmptyState>
          )}

          {editor && outline.length === 0 && !isFiltering && (
            <EmptyState>
              Add headings to see the outline here.
              <br />
              Try typing{" "}
              <code className="rounded bg-[var(--color-border)] px-1 font-mono text-[10px]">
                # Heading
              </code>
            </EmptyState>
          )}

          {editor && outline.length > 0 && (
            <ul className="list-none" role="group">
              {outline.map((node) => (
                <TreeItem
                  key={node.key}
                  node={node}
                  depth={0}
                  activeKey={activeKey}
                  collapsedKeys={collapsedKeys}
                  searchState={searchState}
                  selectedKeys={selectedKeys}
                  dragKey={dragKey}
                  validDropTargets={validDropTargets}
                  dropTarget={dropTarget}
                  reqCountMap={analysis?.countsBySection ?? null}
                  requirementNodeKeys={requirementNodeKeys}
                  duplicateNodeKeys={duplicateNodeKeys}
                  renameNodeKey={renameNode?.key ?? null}
                  renameValue={renameValue}
                  onNodeClick={handleNodeClick}
                  onSelect={handleSelect}
                  onRename={handleRename}
                  onToggle={toggleCollapsed}
                  onDragStart={handleDragStart}
                  onDragOver={handleDragOver}
                  onDrop={handleDrop}
                  onDragEnd={handleDragEnd}
                  onContextMenu={handleContextMenu}
                  onRenameChange={setRenameValue}
                  onRenameConfirm={handleRenameConfirm}
                  onRenameCancel={handleRenameCancel}
                />
              ))}
            </ul>
          )}
        </div>
      </aside>

      {/* Context menu */}
      {contextMenu && (
        <ContextMenu
          state={contextMenu}
          onRename={handleRename}
          onDuplicate={handleDuplicate}
          onInsertRequirement={
            compiledPattern?.supportsNumbering ? handleInsertRequirement : undefined
          }
          onDelete={handleDelete}
          onMoveUp={handleMoveUp}
          onMoveDown={handleMoveDown}
          onSelectOnly={(ids) => { setSelectedKeys(ids); setLastSelectedKey([...ids][0] ?? null); }}
          onSelectSubtree={(ids) => { setSelectedKeys(ids); }}
          onSelectSiblings={(ids) => { setSelectedKeys(ids); }}
          onSelectChildren={(ids) => { setSelectedKeys(ids); }}
          onClose={() => setContextMenu(null)}
        />
      )}

      {/* Delete confirmation */}
      {deleteNode && (
        <DeleteDialog
          node={deleteNode}
          onConfirm={handleDeleteConfirm}
          onCancel={() => setDeleteNode(null)}
        />
      )}

      {/* Multi-delete confirmation */}
      {deleteMultiOpen && (
        <DeleteMultiDialog
          count={selectedKeys.size}
          onConfirm={handleMultiDelete}
          onCancel={() => setDeleteMultiOpen(false)}
        />
      )}

      {/* Renumber confirmation */}
      {renumberConfirmOpen && compiledPattern?.supportsNumbering && analysis && (
        <RenumberConfirmDialog
          reqCount={analysis.requirements.length}
          prefix={compiledPattern.prefix}
          digits={compiledPattern.digits}
          onConfirm={handleRenumber}
          onCancel={() => setRenumberConfirmOpen(false)}
        />
      )}
    </>
  );
}
