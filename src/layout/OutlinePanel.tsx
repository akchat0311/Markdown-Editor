import {
  useContext,
  useState,
  useEffect,
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
  getSectionRange,
  moveSectionBefore,
  moveSectionAfter,
  duplicateSection,
  deleteSection,
  renameHeading,
  isInsideSection,
} from "@/editor/utils/outlineOps";
import { TextSelection } from "@tiptap/pm/state";
import {
  derivePattern,
  analyzeRequirements,
  nextAvailableId,
  insertRequirementAfter,
  renumberRequirements,
  reassignRequirementId,
  type DerivedPattern,
  type RequirementAnalysis,
} from "@/editor/utils/requirementOps";
import { useConfigStore } from "@/stores/configStore";
import type { OutlineNode } from "@/types/outline";

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
  siblings: OutlineNode[];
  x: number;
  y: number;
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
  siblings: OutlineNode[];
  depth: number;
  activeKey: string | null;
  collapsedKeys: Set<string>;
  searchState: SearchState | null;
  dragKey: string | null;
  validDropTargets: Set<string>;
  dropTarget: DropTarget | null;
  reqCountMap: Map<string, number> | null;
  requirementNodeKeys: Set<string>;
  duplicateNodeKeys: Set<string>;
  renameNodeKey: string | null;
  renameValue: string;
  onSelect: (node: OutlineNode) => void;
  onRename: (node: OutlineNode) => void;
  onToggle: (key: string) => void;
  onDragStart: (node: OutlineNode) => void;
  onDragOver: (e: React.DragEvent, node: OutlineNode) => void;
  onDrop: (node: OutlineNode) => void;
  onDragEnd: () => void;
  onContextMenu: (
    e: React.MouseEvent,
    node: OutlineNode,
    siblings: OutlineNode[]
  ) => void;
  onRenameChange: (v: string) => void;
  onRenameConfirm: () => void;
  onRenameCancel: () => void;
}

function TreeItem({
  node,
  siblings,
  depth,
  activeKey,
  collapsedKeys,
  searchState,
  dragKey,
  validDropTargets,
  dropTarget,
  reqCountMap,
  requirementNodeKeys,
  duplicateNodeKeys,
  renameNodeKey,
  renameValue,
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
  const isDragging = dragKey === node.key;
  const isValidDropTarget = validDropTargets.has(node.key);
  const isDropBefore =
    isValidDropTarget &&
    dropTarget?.key === node.key &&
    dropTarget.position === "before";
  const isDropAfter =
    isValidDropTarget &&
    dropTarget?.key === node.key &&
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
    dragKey,
    validDropTargets,
    dropTarget,
    reqCountMap,
    requirementNodeKeys,
    duplicateNodeKeys,
    renameNodeKey,
    renameValue,
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
          isDragging ? "opacity-40" : "",
        ].join(" ")}
        style={{
          paddingLeft: `${paddingLeft}px`,
          ...(isActive
            ? { boxShadow: "inset 2px 0 0 var(--color-accent)" }
            : {}),
        }}
        onClick={() => { if (renameNodeKey === null) onSelect(node); }}
        onDoubleClick={(e) => { e.stopPropagation(); if (renameNodeKey === null) onRename(node); }}
        onKeyDown={(e: KeyboardEvent<HTMLDivElement>) => {
          if (renameNodeKey !== null) return;
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onSelect(node);
          }
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          onContextMenu(e, node, siblings);
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
              siblings={node.children}
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

interface PatternConfigPanelProps {
  patternInput: string;
  onInputChange: (v: string) => void;
  onClear: () => void;
  hasExistingPattern: boolean;
}

function PatternConfigPanel({
  patternInput,
  onInputChange,
  onClear,
  hasExistingPattern,
}: PatternConfigPanelProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const trimmed = patternInput.trim();
  const derived: DerivedPattern | null = trimmed ? derivePattern(trimmed) : null;

  return (
    <div className="shrink-0 border-b border-[var(--color-border)] bg-[var(--color-page-bg)] px-3 py-3">
      <p className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-[var(--color-muted)]">
        Requirement Pattern
      </p>

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
        {trimmed && derived && (
          <span className="text-green-600 dark:text-green-400">
            ✓ Prefix:&nbsp;
            <span className="font-mono">{derived.prefix || "(none)"}</span>
            &nbsp;· Digits:&nbsp;{derived.digits}
          </span>
        )}
        {trimmed && !derived && (
          <span className="text-amber-500">
            ⚠ Example must end with a number
          </span>
        )}
      </div>

      <p className="mt-1.5 text-[10px] leading-relaxed text-[var(--color-muted)]">
        Enter an example requirement ID. The editor will automatically detect
        the numbering pattern.
      </p>

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
  issueListOpen: boolean;
  onToggle: () => void;
  onNavigate: (node: OutlineNode) => void;
  onRenumber: () => void;
  onReassignDuplicate: (id: string, nodes: OutlineNode[]) => void;
}

function IssueSummaryStrip({
  analysis,
  issueListOpen,
  onToggle,
  onNavigate,
  onRenumber,
  onReassignDuplicate,
}: IssueSummaryStripProps) {
  const dupCount = analysis.duplicates.size;
  const missingCount = analysis.missing.length;
  if (dupCount === 0 && missingCount === 0) return null;

  const parts: string[] = [];
  if (dupCount > 0) parts.push(`${dupCount} duplicate${dupCount > 1 ? "s" : ""}`);
  if (missingCount > 0)
    parts.push(`${missingCount} missing ID${missingCount > 1 ? "s" : ""}`);

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

        <button
          onClick={onRenumber}
          title="Renumber all requirements sequentially"
          className="shrink-0 rounded bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium text-amber-600 transition-colors hover:bg-amber-500/20 dark:text-amber-400"
        >
          Renumber
        </button>
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
                  <button
                    onClick={() => onReassignDuplicate(id, nodes)}
                    title={`Reassign last occurrence of ${id} to next available ID`}
                    className="shrink-0 rounded bg-amber-500/10 px-1.5 py-0.5 text-[9px] font-medium text-amber-600 transition-colors hover:bg-amber-500/20 dark:text-amber-400"
                  >
                    Fix
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Missing */}
          {missingCount > 0 && (
            <div>
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
        <p className="mb-4 text-xs text-[var(--color-muted)]">
          Duplicate IDs and gaps will be resolved.
        </p>
        <p className="mb-5 flex items-center gap-1.5 text-[10px] text-amber-500">
          <svg width="10" height="10" viewBox="0 0 12 12" fill="currentColor">
            <path d="M6 1 .5 11h11L6 1zm0 2 4 7H2L6 3zM5.5 5v2h1V5h-1zm0 3v1h1V8h-1z" />
          </svg>
          This replaces undo history.
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

// ── Context menu ──────────────────────────────────────────────────────────────

interface ContextMenuProps {
  state: ContextMenuState;
  onRename: (node: OutlineNode) => void;
  onDuplicate: (node: OutlineNode) => void;
  onInsertRequirement?: (node: OutlineNode) => void;
  onDelete: (node: OutlineNode) => void;
  onMoveUp: (node: OutlineNode, siblings: OutlineNode[]) => void;
  onMoveDown: (node: OutlineNode, siblings: OutlineNode[]) => void;
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
  onClose,
}: ContextMenuProps) {
  const { node, siblings, x, y } = state;
  const sibIdx = siblings.indexOf(node);
  const canMoveUp = sibIdx > 0;
  const canMoveDown = sibIdx < siblings.length - 1;

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

  const safeX = Math.min(x, window.innerWidth - 172);
  const safeY = Math.min(y, window.innerHeight - 220);

  return (
    <div
      className="fixed z-[9999] min-w-[160px] rounded-md border border-[var(--color-border)] bg-[var(--color-paper)] py-1 shadow-xl"
      style={{ left: safeX, top: safeY }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {item("Rename", () => onRename(node))}
      {item("Duplicate", () => onDuplicate(node))}
      {onInsertRequirement &&
        item("Insert Requirement After", () => onInsertRequirement(node))}
      <div className="my-1 border-t border-[var(--color-border)]" />
      {item("Move Up", () => onMoveUp(node, siblings), !canMoveUp)}
      {item("Move Down", () => onMoveDown(node, siblings), !canMoveDown)}
      <div className="my-1 border-t border-[var(--color-border)]" />
      {item("Delete", () => onDelete(node), false, true)}
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
}

export function OutlinePanel({ width }: OutlinePanelProps) {
  const editor = useContext(EditorContext);

  // ── Outline state ───────────────────────────────────────────────────────────
  const [outline, setOutline] = useState<OutlineNode[]>([]);
  const [collapsedKeys, setCollapsedKeys] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState("");
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const filterInputRef = useRef<HTMLInputElement>(null);

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
  const { requirementPattern, setRequirementPattern, clearRequirementPattern } =
    useConfigStore();
  const [patternOpen, setPatternOpen] = useState(false);
  const [patternInput, setPatternInput] = useState(
    requirementPattern?.example ?? ""
  );
  const [issueListOpen, setIssueListOpen] = useState(false);
  const [renumberConfirmOpen, setRenumberConfirmOpen] = useState(false);
  const patternTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Outline rebuild (debounced) ─────────────────────────────────────────────
  useEffect(() => {
    if (!editor) return;
    setOutline(deriveOutline(editor));
    const onUpdate = () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        setOutline(deriveOutline(editor));
      }, DEBOUNCE_MS);
    };
    editor.on("update", onUpdate);
    return () => {
      editor.off("update", onUpdate);
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
  const derivedPattern = useMemo(
    () =>
      requirementPattern ? derivePattern(requirementPattern.example) : null,
    [requirementPattern]
  );

  const analysis = useMemo((): RequirementAnalysis | null => {
    if (!editor || !requirementPattern) return null;
    const content: JSONContent[] = editor.getJSON().content ?? [];
    return analyzeRequirements(flatOutline, content, requirementPattern.example);
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
  const applyContentOp = useCallback(
    (newContent: JSONContent[]) => {
      if (!editor) return;
      const savedFrom = editor.state.selection.from;
      editor.commands.setContent({ type: "doc", content: newContent });
      const maxPos = editor.state.doc.content.size - 1;
      if (maxPos >= 0) {
        editor.commands.setTextSelection(Math.min(savedFrom, maxPos));
      }
    },
    [editor]
  );

  const getDocContent = useCallback(
    (): JSONContent[] => editor?.getJSON().content ?? [],
    [editor]
  );

  // ── DnD move helper (single undoable PM transaction) ───────────────────────
  // Unlike applyContentOp (two dispatches: setContent + setTextSelection),
  // this folds the content replacement and cursor restoration into one tr so
  // Cmd+Z reverts the entire move in a single undo step.
  // sFrom/sTo = getSectionRange result for the moved section (pre-move indices).
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
    (node: OutlineNode) => {
      const content = getDocContent();
      const level = node.level ?? 1;
      const targets = new Set(
        flatOutline
          .filter(
            (n) =>
              n.level === level &&
              n.key !== node.key &&
              !isInsideSection(content, node.index, level, n.index)
          )
          .map((n) => n.key)
      );
      setDragKey(node.key);
      setValidDropTargets(targets);
    },
    [flatOutline, getDocContent]
  );

  const handleDragOver = useCallback(
    (e: React.DragEvent, target: OutlineNode) => {
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      const position =
        e.clientY < rect.top + rect.height / 2 ? "before" : "after";
      setDropTarget((prev) =>
        prev?.key === target.key && prev.position === position
          ? prev
          : { key: target.key, position }
      );
    },
    []
  );

  const handleDrop = useCallback(
    (target: OutlineNode) => {
      if (!dragKey || !dropTarget) return;
      const content = getDocContent();
      const source = flatOutline.find((n) => n.key === dragKey);
      if (!source) return;

      const sourceLevel = source.level ?? 1;
      const [sFrom, sTo] = getSectionRange(content, source.index, sourceLevel);
      const sLen = sTo - sFrom;

      let newContent: JSONContent[];
      let insertedAtIndex: number;

      if (dropTarget.position === "before") {
        newContent = moveSectionBefore(
          content,
          source.index,
          sourceLevel,
          target.index
        );
        // Mirror moveSectionBefore's insertAt arithmetic
        insertedAtIndex =
          target.index > sFrom ? target.index - sLen : target.index;
      } else {
        const [, tTo] = getSectionRange(
          content,
          target.index,
          target.level ?? 1
        );
        newContent = moveSectionAfter(
          content,
          source.index,
          sourceLevel,
          target.index,
          target.level ?? 1
        );
        // Mirror moveSectionAfter's insertAt arithmetic
        insertedAtIndex = tTo > sFrom ? tTo - sLen : tTo;
      }

      applyMoveOp(newContent, sFrom, sTo, insertedAtIndex);
      setDragKey(null);
      setValidDropTargets(new Set());
      setDropTarget(null);
    },
    [dragKey, dropTarget, flatOutline, getDocContent, applyMoveOp]
  );

  const handleDragEnd = useCallback(() => {
    setDragKey(null);
    setValidDropTargets(new Set());
    setDropTarget(null);
  }, []);

  // ── Context menu ────────────────────────────────────────────────────────────
  const handleContextMenu = useCallback(
    (e: React.MouseEvent, node: OutlineNode, siblings: OutlineNode[]) => {
      setContextMenu({ node, siblings, x: e.clientX, y: e.clientY });
    },
    []
  );

  // ── Context menu actions ────────────────────────────────────────────────────
  // Guards against the Enter-then-blur double-call: first caller wins, all
  // subsequent calls to handleRenameConfirm/Cancel within the same rename
  // session are no-ops.
  const renameHandledRef = useRef(false);

  const handleRename = useCallback((node: OutlineNode) => {
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
      applyContentOp(
        duplicateSection(getDocContent(), node.index, node.level ?? 1)
      );
    },
    [applyContentOp, getDocContent]
  );

  const handleDelete = useCallback((node: OutlineNode) => {
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
    (node: OutlineNode, siblings: OutlineNode[]) => {
      const idx = siblings.indexOf(node);
      if (idx <= 0) return;
      const prev = siblings[idx - 1];
      applyContentOp(
        moveSectionBefore(getDocContent(), node.index, node.level ?? 1, prev.index)
      );
    },
    [applyContentOp, getDocContent]
  );

  const handleMoveDown = useCallback(
    (node: OutlineNode, siblings: OutlineNode[]) => {
      const idx = siblings.indexOf(node);
      if (idx < 0 || idx >= siblings.length - 1) return;
      const next = siblings[idx + 1];
      applyContentOp(
        moveSectionAfter(
          getDocContent(),
          node.index,
          node.level ?? 1,
          next.index,
          next.level ?? 1
        )
      );
    },
    [applyContentOp, getDocContent]
  );

  // ── Pattern config ──────────────────────────────────────────────────────────
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
      } else if (derivePattern(trimmed)) {
        patternTimerRef.current = setTimeout(
          () => setRequirementPattern(trimmed),
          PATTERN_APPLY_MS
        );
      }
    },
    [clearRequirementPattern, setRequirementPattern]
  );

  const handlePatternClear = useCallback(() => {
    if (patternTimerRef.current) clearTimeout(patternTimerRef.current);
    clearRequirementPattern();
    setPatternInput("");
  }, [clearRequirementPattern]);

  // ── M4B: requirement mutation actions ──────────────────────────────────────

  const handleInsertRequirement = useCallback(
    (node: OutlineNode) => {
      if (!editor || !derivedPattern || !analysis) return;
      const { prefix, digits } = derivedPattern;
      const newId = nextAvailableId(analysis.requirements, prefix, digits);
      const content = getDocContent();
      const [, insertedAtIndex] = getSectionRange(
        content,
        node.index,
        node.level ?? 1
      );
      applyContentOp(
        insertRequirementAfter(content, node.index, node.level ?? 1, newId)
      );
      // Place cursor after the ID text in the newly inserted heading
      let targetPmPos = -1;
      editor.state.doc.forEach((_n, offset, idx) => {
        if (idx === insertedAtIndex) targetPmPos = offset;
      });
      if (targetPmPos >= 0) {
        editor
          .chain()
          .focus()
          .setTextSelection(targetPmPos + 1 + newId.length)
          .scrollIntoView()
          .run();
      }
    },
    [editor, derivedPattern, analysis, getDocContent, applyContentOp]
  );

  const handleRenumber = useCallback(() => {
    if (!derivedPattern || !analysis) return;
    const { prefix, digits } = derivedPattern;
    applyContentOp(
      renumberRequirements(getDocContent(), analysis.requirements, prefix, digits)
    );
    setRenumberConfirmOpen(false);
  }, [derivedPattern, analysis, applyContentOp, getDocContent]);

  const handleReassignDuplicate = useCallback(
    (id: string, nodes: OutlineNode[]) => {
      if (!derivedPattern || !analysis) return;
      const { prefix, digits } = derivedPattern;
      const target = nodes[nodes.length - 1]; // last occurrence by document order
      const newId = nextAvailableId(analysis.requirements, prefix, digits);
      applyContentOp(
        reassignRequirementId(
          getDocContent(),
          target.index,
          target.label,
          id,
          newId
        )
      );
    },
    [derivedPattern, analysis, applyContentOp, getDocContent]
  );

  // ── Render ──────────────────────────────────────────────────────────────────
  const hasParentNodes = flatOutline.some((n) => n.children.length > 0);
  const hasIssues =
    analysis !== null &&
    (analysis.duplicates.size > 0 || analysis.missing.length > 0);

  return (
    <>
      <aside
        className="flex shrink-0 flex-col overflow-hidden border-r border-[var(--color-border)] bg-[var(--color-paper)]"
        style={{ width }}
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
            patternInput={patternInput}
            onInputChange={handlePatternInputChange}
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

        {/* ── Issue summary ── */}
        {hasIssues && (
          <IssueSummaryStrip
            analysis={analysis!}
            issueListOpen={issueListOpen}
            onToggle={() => setIssueListOpen((o) => !o)}
            onNavigate={handleSelect}
            onRenumber={() => setRenumberConfirmOpen(true)}
            onReassignDuplicate={handleReassignDuplicate}
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
                  siblings={outline}
                  depth={0}
                  activeKey={activeKey}
                  collapsedKeys={collapsedKeys}
                  searchState={searchState}
                  dragKey={dragKey}
                  validDropTargets={validDropTargets}
                  dropTarget={dropTarget}
                  reqCountMap={analysis?.countsBySection ?? null}
                  requirementNodeKeys={requirementNodeKeys}
                  duplicateNodeKeys={duplicateNodeKeys}
                  renameNodeKey={renameNode?.key ?? null}
                  renameValue={renameValue}
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
            derivedPattern !== null ? handleInsertRequirement : undefined
          }
          onDelete={handleDelete}
          onMoveUp={handleMoveUp}
          onMoveDown={handleMoveDown}
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

      {/* Renumber confirmation */}
      {renumberConfirmOpen && derivedPattern && analysis && (
        <RenumberConfirmDialog
          reqCount={analysis.requirements.length}
          prefix={derivedPattern.prefix}
          digits={derivedPattern.digits}
          onConfirm={handleRenumber}
          onCancel={() => setRenumberConfirmOpen(false)}
        />
      )}
    </>
  );
}
