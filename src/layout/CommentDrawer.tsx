import { useState, useRef, useEffect, useCallback } from "react";
import { useReviewCommentsStore } from "@/stores/reviewCommentsStore";
import { useUserSettingsStore } from "@/stores/userSettingsStore";
import { useStatusConfigStore } from "@/stores/statusConfigStore";
import { UserNameForm } from "@/layout/UserNameForm";
import type { CommentStatus, ReviewComment } from "@/types/reviewComment";
import type { RequirementRecord } from "@/editor/utils/requirementOps";
import { isSectionReviewTarget, sectionNumberFromReviewId } from "@/editor/utils/sectionReviewOps";

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

// ── Comment status chip ───────────────────────────────────────────────────────

const STATUS_CHIP: Record<CommentStatus, { label: string; cls: string }> = {
  open: {
    label: "Open",
    cls: "bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-400",
  },
  responded: {
    label: "Responded",
    cls: "bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400",
  },
  closed: {
    label: "Closed",
    cls: "bg-green-100 text-green-700 dark:bg-green-950/40 dark:text-green-400",
  },
};

function CommentStatusChip({ status }: { status: CommentStatus }) {
  const { label, cls } = STATUS_CHIP[status];
  return (
    <span className={`rounded-full px-2 py-px text-[10px] font-semibold ${cls}`}>
      {label}
    </span>
  );
}

// ── Generic action button ─────────────────────────────────────────────────────

function ActionBtn({
  children,
  onClick,
  danger,
}: {
  children: React.ReactNode;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={`rounded px-2 py-0.5 text-[10px] font-medium transition-colors ${
        danger
          ? "text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40"
          : "text-[var(--color-muted)] hover:bg-[var(--color-border)] hover:text-[var(--color-text)]"
      }`}
    >
      {children}
    </button>
  );
}

// ── Add / Edit original comment form ─────────────────────────────────────────

interface CommentFormProps {
  initialText?: string;
  onSave: (text: string) => void;
  onCancel: () => void;
}

function CommentForm({ initialText = "", onSave, onCancel }: CommentFormProps) {
  const [text, setText] = useState(initialText);
  const textRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    textRef.current?.focus();
  }, []);

  const handleSubmit = useCallback(() => {
    const t = text.trim();
    if (!t) return;
    onSave(t);
  }, [text, onSave]);

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      onCancel();
    }
  };

  return (
    <div
      className="flex flex-col gap-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-page-bg)] p-3"
      onKeyDown={onKey}
    >
      <label className="text-[10px] font-semibold uppercase tracking-wide text-[var(--color-muted)]">
        Comment
      </label>
      <textarea
        ref={textRef}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Leave a comment…"
        rows={3}
        className="resize-none rounded border border-[var(--color-border)] bg-[var(--color-paper)] px-2 py-1.5 text-xs text-[var(--color-text)] outline-none focus:border-[var(--color-accent)]"
      />
      <div className="flex justify-end gap-2">
        <button
          onClick={onCancel}
          className="rounded px-2.5 py-1 text-xs text-[var(--color-muted)] hover:bg-[var(--color-border)] transition-colors"
        >
          Cancel
        </button>
        <button
          onClick={handleSubmit}
          disabled={!text.trim()}
          className="rounded bg-[var(--color-accent)] px-2.5 py-1 text-xs font-medium text-white disabled:opacity-40 hover:opacity-90 transition-opacity"
        >
          Save
        </button>
      </div>
    </div>
  );
}

// ── Response form (add or edit a response) ────────────────────────────────────

interface ResponseFormProps {
  initialResponse?: string;
  isEdit?: boolean;
  onSave: (response: string) => void;
  onCancel: () => void;
}

function ResponseForm({ initialResponse = "", isEdit, onSave, onCancel }: ResponseFormProps) {
  const [response, setResponse] = useState(initialResponse);
  const textRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    textRef.current?.focus();
  }, []);

  const stopEsc = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      onCancel();
    }
  };

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-page-bg)] p-3">
      <label className="text-[10px] font-semibold uppercase tracking-wide text-[var(--color-muted)]">
        Response
      </label>
      <textarea
        ref={textRef}
        value={response}
        onChange={(e) => setResponse(e.target.value)}
        placeholder="Describe how this was addressed…"
        rows={3}
        onKeyDown={stopEsc}
        className="resize-none rounded border border-[var(--color-border)] bg-[var(--color-paper)] px-2 py-1.5 text-xs text-[var(--color-text)] outline-none focus:border-[var(--color-accent)]"
      />
      <div className="flex justify-end gap-2">
        <button
          onClick={onCancel}
          className="rounded px-2.5 py-1 text-xs text-[var(--color-muted)] hover:bg-[var(--color-border)] transition-colors"
        >
          Cancel
        </button>
        <button
          onClick={() => {
            const r = response.trim();
            if (!r) return;
            onSave(r);
          }}
          disabled={!response.trim()}
          className="rounded bg-[var(--color-accent)] px-2.5 py-1 text-xs font-medium text-white disabled:opacity-40 hover:opacity-90 transition-opacity"
        >
          {isEdit ? "Update Response" : "Submit Response"}
        </button>
      </div>
    </div>
  );
}

// ── Delete confirm ────────────────────────────────────────────────────────────

interface DeleteConfirmProps {
  onConfirm: () => void;
  onCancel: () => void;
}

function DeleteConfirm({ onConfirm, onCancel }: DeleteConfirmProps) {
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-red-300 bg-red-50 p-3 text-xs dark:border-red-700 dark:bg-red-950/40">
      <p className="font-medium text-red-700 dark:text-red-400">Delete this comment?</p>
      <div className="flex gap-2">
        <button
          onClick={onConfirm}
          className="rounded bg-red-600 px-2.5 py-1 font-medium text-white hover:bg-red-700 transition-colors"
        >
          Delete
        </button>
        <button
          onClick={onCancel}
          className="rounded px-2.5 py-1 text-[var(--color-muted)] hover:bg-[var(--color-border)] transition-colors"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

// ── User name setup prompt (shown inside drawer when name not yet configured) ──

function UserNameSetup({
  onSave,
  onCancel,
}: {
  onSave: (name: string) => void;
  onCancel: () => void;
}) {
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-page-bg)] p-4">
      <div>
        <p className="text-xs font-semibold text-[var(--color-text)]">User Name Required</p>
        <p className="mt-0.5 text-[11px] text-[var(--color-muted)]">
          Enter your name to continue. Saved locally and used for all review actions.
        </p>
      </div>
      <UserNameForm onSave={onSave} onCancel={onCancel} />
    </div>
  );
}

// ── Single comment card ───────────────────────────────────────────────────────

type CardMode = "view" | "edit" | "delete" | "respond";

interface CommentCardProps {
  comment: ReviewComment;
  reqId: string;
  onGate: (fn: () => void) => void;
}

function CommentCard({ comment, reqId, onGate }: CommentCardProps) {
  const updateComment = useReviewCommentsStore((s) => s.updateComment);
  const deleteComment = useReviewCommentsStore((s) => s.deleteComment);
  const respondToComment = useReviewCommentsStore((s) => s.respondToComment);
  const closeComment = useReviewCommentsStore((s) => s.closeComment);
  const reopenComment = useReviewCommentsStore((s) => s.reopenComment);

  const [mode, setMode] = useState<CardMode>("view");

  // Reset mode if comment status changes externally
  useEffect(() => {
    setMode("view");
  }, [comment.status]);

  const { status } = comment;

  if (mode === "edit") {
    return (
      <CommentForm
        initialText={comment.text}
        onSave={(text) => {
          updateComment(reqId, comment.id, { text });
          setMode("view");
        }}
        onCancel={() => setMode("view")}
      />
    );
  }

  if (mode === "delete") {
    return (
      <DeleteConfirm
        onConfirm={() => deleteComment(reqId, comment.id)}
        onCancel={() => setMode("view")}
      />
    );
  }

  return (
    <div
      className={`flex flex-col gap-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-paper)] p-3 ${
        status === "closed" ? "opacity-65" : ""
      }`}
    >
      {/* Status chip + author + date */}
      <div className="flex flex-wrap items-center gap-1.5">
        <CommentStatusChip status={status} />
        <span className="text-xs font-semibold text-[var(--color-text)]">{comment.author}</span>
        <span className="text-[10px] text-[var(--color-muted)]">·</span>
        <span className="text-[10px] text-[var(--color-muted)]">{formatDate(comment.createdAt)}</span>
      </div>

      {/* Original comment text */}
      <p className="whitespace-pre-wrap text-xs text-[var(--color-text)]">{comment.text}</p>

      {/* Response (responded / closed) */}
      {(status === "responded" || status === "closed") && comment.response && mode !== "respond" && (
        <div className="mt-0.5 rounded border-l-2 border-[var(--color-accent)] py-1 pl-2.5">
          <div className="mb-1 flex flex-wrap items-center gap-1.5">
            <span className="text-[10px] font-semibold text-[var(--color-accent)]">
              ↩ {comment.respondedBy ?? "Response"}
            </span>
            {comment.respondedAt && (
              <>
                <span className="text-[10px] text-[var(--color-muted)]">·</span>
                <span className="text-[10px] text-[var(--color-muted)]">
                  {formatDate(comment.respondedAt)}
                </span>
              </>
            )}
          </div>
          <p className="whitespace-pre-wrap text-xs text-[var(--color-text)]">{comment.response}</p>
        </div>
      )}

      {/* Inline response form */}
      {mode === "respond" && (
        <ResponseForm
          initialResponse={comment.response}
          isEdit={status === "responded"}
          onSave={(response) => {
            respondToComment(
              reqId,
              comment.id,
              response,
              useUserSettingsStore.getState().userName,
            );
            setMode("view");
          }}
          onCancel={() => setMode("view")}
        />
      )}

      {/* Closed-by attribution */}
      {status === "closed" && comment.closedBy && (
        <p className="text-[10px] text-[var(--color-muted)]">
          Closed by {comment.closedBy}
          {comment.closedAt && ` · ${formatDate(comment.closedAt)}`}
        </p>
      )}

      {/* Actions row */}
      {mode === "view" && (
        <div className="flex flex-wrap items-center gap-1 border-t border-[var(--color-border)] pt-1.5">
          {status === "open" && (
            <>
              <ActionBtn onClick={() => onGate(() => setMode("respond"))}>↩ Respond</ActionBtn>
              <ActionBtn onClick={() => setMode("edit")}>Edit</ActionBtn>
              <ActionBtn
                onClick={() =>
                  onGate(() =>
                    closeComment(reqId, comment.id, useUserSettingsStore.getState().userName),
                  )
                }
              >
                ✓ Close
              </ActionBtn>
              <ActionBtn danger onClick={() => setMode("delete")}>
                Delete
              </ActionBtn>
            </>
          )}
          {status === "responded" && (
            <>
              <ActionBtn
                onClick={() =>
                  onGate(() =>
                    closeComment(reqId, comment.id, useUserSettingsStore.getState().userName),
                  )
                }
              >
                ✓ Close
              </ActionBtn>
              <ActionBtn onClick={() => reopenComment(reqId, comment.id)}>↺ Reopen</ActionBtn>
              <ActionBtn onClick={() => onGate(() => setMode("respond"))}>
                Edit Response
              </ActionBtn>
            </>
          )}
          {status === "closed" && (
            <ActionBtn onClick={() => reopenComment(reqId, comment.id)}>↺ Reopen</ActionBtn>
          )}
        </div>
      )}
    </div>
  );
}

// ── Requirement status chip (drawer header) ───────────────────────────────────

function ReqStatusChip({ status }: { status: string }) {
  const statuses = useStatusConfigStore((s) => s.statuses);
  const label =
    status === "unknown"
      ? "Unknown"
      : (statuses.find((s) => s.id === status)?.label ?? status);
  return (
    <span className="rounded px-1.5 py-px text-[10px] font-semibold uppercase tracking-wide bg-[var(--color-border)] text-[var(--color-muted)]">
      {label}
    </span>
  );
}

// ── Filter tab strip ──────────────────────────────────────────────────────────

type FilterTab = "all" | CommentStatus;

function FilterTabStrip({
  active,
  counts,
  onChange,
}: {
  active: FilterTab;
  counts: Record<FilterTab, number>;
  onChange: (t: FilterTab) => void;
}) {
  const tabs: { id: FilterTab; label: string }[] = [
    { id: "all", label: "All" },
    { id: "open", label: "Open" },
    { id: "responded", label: "Responded" },
    { id: "closed", label: "Closed" },
  ];

  return (
    <div className="flex items-center gap-0.5 border-b border-[var(--color-border)] px-3 py-1.5">
      {tabs.map(({ id, label }) => {
        const count = counts[id];
        const isActive = active === id;
        return (
          <button
            key={id}
            onClick={() => onChange(id)}
            className={`rounded px-2 py-0.5 text-[10px] font-medium transition-colors ${
              isActive
                ? "bg-[var(--color-border)] text-[var(--color-text)]"
                : "text-[var(--color-muted)] hover:text-[var(--color-text)]"
            }`}
          >
            {label}
            {count > 0 && (
              <span className="ml-1 rounded-full bg-[var(--color-page-bg)] px-1 text-[9px]">
                {count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

// ── Drawer ────────────────────────────────────────────────────────────────────

// Stable empty array — returned by the selector when a requirement has no
// comments. Must NOT be a new `[]` literal inside the selector, because
// useSyncExternalStore calls getSnapshot repeatedly and a new reference on
// every call triggers an infinite React update loop.
const NO_COMMENTS: ReviewComment[] = [];

export interface CommentDrawerProps {
  record: RequirementRecord | null;
  onClose: () => void;
}

export function CommentDrawer({ record, onClose }: CommentDrawerProps) {
  const reqId = record?.id ?? null;

  // Subscribe directly to the comment array so any status transition triggers a re-render.
  const comments = useReviewCommentsStore(
    useCallback(
      (s) => {
        if (!reqId) return NO_COMMENTS;
        return (s.comments[reqId] as ReviewComment[] | undefined) ?? NO_COMMENTS;
      },
      [reqId],
    ),
  );
  const addComment = useReviewCommentsStore((s) => s.addComment);

  const { configured, save } = useUserSettingsStore();

  const [adding, setAdding] = useState(false);
  const [filterTab, setFilterTab] = useState<FilterTab>("all");
  const [showSetup, setShowSetup] = useState(false);
  // Stores the action to run after the user saves their name.
  const pendingFnRef = useRef<(() => void) | null>(null);

  // Reset form and filter when the selected requirement changes.
  useEffect(() => {
    setAdding(false);
    setFilterTab("all");
    setShowSetup(false);
    pendingFnRef.current = null;
  }, [reqId]);

  // Safety net: if name gets configured via the Header menu while setup is
  // showing, execute the pending action automatically.
  useEffect(() => {
    if (configured && showSetup) {
      setShowSetup(false);
      const fn = pendingFnRef.current;
      pendingFnRef.current = null;
      fn?.();
    }
  }, [configured, showSetup]);

  // Close on Escape (when not in add mode or setup mode).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !adding && !showSetup) onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [adding, showSetup, onClose]);

  // Gate for actions that require a user name.
  const gate = useCallback(
    (fn: () => void) => {
      if (configured) {
        fn();
      } else {
        pendingFnRef.current = fn;
        setShowSetup(true);
      }
    },
    [configured],
  );

  const handleSetupSave = useCallback(
    (name: string) => {
      save(name);
      // Clear ref before state updates to prevent double-execution in the effect.
      const fn = pendingFnRef.current;
      pendingFnRef.current = null;
      setShowSetup(false);
      fn?.();
    },
    [save],
  );

  const handleSetupCancel = useCallback(() => {
    setShowSetup(false);
    pendingFnRef.current = null;
  }, []);

  if (!record || !reqId) return null;

  const isSectionTarget = isSectionReviewTarget(reqId);
  const displayId = isSectionTarget
    ? `§${sectionNumberFromReviewId(reqId) ?? reqId}`
    : reqId;

  const openCount = comments.filter((c) => c.status === "open").length;
  const respondedCount = comments.filter((c) => c.status === "responded").length;
  const closedCount = comments.filter((c) => c.status === "closed").length;

  const tabCounts: Record<FilterTab, number> = {
    all: comments.length,
    open: openCount,
    responded: respondedCount,
    closed: closedCount,
  };

  const filteredComments =
    filterTab === "all" ? comments : comments.filter((c) => c.status === filterTab);

  return (
    <div className="flex w-80 shrink-0 flex-col border-l border-[var(--color-border)]">
      {/* Header: req ID / section number + status chip (req only) + close button */}
      <div className="flex items-start justify-between border-b border-[var(--color-border)] px-4 py-3">
        <div className="flex flex-col gap-1">
          <span className="font-mono text-sm font-semibold text-[var(--color-text)]">{displayId}</span>
          {!isSectionTarget && <ReqStatusChip status={record.status} />}
          {comments.length > 0 && (
            <p className="text-[10px] text-[var(--color-muted)]">
              {comments.length} comment{comments.length !== 1 ? "s" : ""}
              {openCount > 0 && (
                <span className="ml-1 font-medium text-red-600 dark:text-red-400">
                  · {openCount} open
                </span>
              )}
              {respondedCount > 0 && openCount === 0 && (
                <span className="ml-1 font-medium text-amber-600 dark:text-amber-400">
                  · {respondedCount} responded
                </span>
              )}
              {openCount === 0 && respondedCount === 0 && closedCount > 0 && (
                <span className="ml-1 font-medium text-green-600 dark:text-green-400">
                  · all closed
                </span>
              )}
            </p>
          )}
        </div>
        <button
          onMouseDown={onClose}
          className="flex h-6 w-6 items-center justify-center rounded text-[var(--color-muted)] hover:bg-[var(--color-border)] hover:text-[var(--color-text)]"
          aria-label="Close comments"
        >
          <svg
            width="10"
            height="10"
            viewBox="0 0 10 10"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
          >
            <path d="M1 1l8 8M9 1L1 9" />
          </svg>
        </button>
      </div>

      {/* Add button */}
      <div className="flex items-center justify-between border-b border-[var(--color-border)] px-4 py-2">
        <span className="text-xs font-semibold text-[var(--color-text)]">Comments</span>
        {!adding && !showSetup && (
          <button
            onClick={() => gate(() => setAdding(true))}
            className="rounded border border-[var(--color-border)] px-2.5 py-1 text-[11px] text-[var(--color-text)] hover:bg-[var(--color-border)] transition-colors"
          >
            + Add
          </button>
        )}
      </div>

      {/* Filter tabs (only when there are comments and not in setup mode) */}
      {comments.length > 0 && !showSetup && (
        <FilterTabStrip active={filterTab} counts={tabCounts} onChange={setFilterTab} />
      )}

      {/* Body */}
      <div className="flex flex-1 flex-col gap-2 overflow-y-auto p-3">
        {/* User name setup prompt — shown instead of normal body */}
        {showSetup ? (
          <UserNameSetup onSave={handleSetupSave} onCancel={handleSetupCancel} />
        ) : (
          <>
            {adding && (
              <CommentForm
                onSave={(text) => {
                  addComment(reqId, useUserSettingsStore.getState().userName, text);
                  setAdding(false);
                }}
                onCancel={() => setAdding(false)}
              />
            )}

            {comments.length === 0 && !adding ? (
              <div className="flex flex-1 flex-col items-center justify-center gap-1 text-center text-xs text-[var(--color-muted)]">
                <p>No comments yet.</p>
                <p className="opacity-60">Click &ldquo;Add&rdquo; to leave a note.</p>
              </div>
            ) : filteredComments.length === 0 ? (
              <p className="py-4 text-center text-xs text-[var(--color-muted)]">
                No {filterTab} comments.
              </p>
            ) : (
              filteredComments.map((c) => (
                <CommentCard key={c.id} comment={c} reqId={reqId} onGate={gate} />
              ))
            )}
          </>
        )}
      </div>
    </div>
  );
}
