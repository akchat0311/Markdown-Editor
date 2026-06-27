import { useCallback, useContext, useEffect, useState } from "react";
import { EditorContext } from "@/editor/EditorContext";
import { useConfigStore } from "@/stores/configStore";
import { CommentDrawer } from "@/layout/CommentDrawer";
import { OverviewTab } from "@/layout/tabs/OverviewTab";
import { RequirementsTab } from "@/layout/tabs/RequirementsTab";
import { ReviewsTab } from "@/layout/tabs/ReviewsTab";
import { InsightsTab } from "@/layout/tabs/InsightsTab";
import { deriveOutline, flattenOutline } from "@/editor/utils/deriveOutline";
import { derivePattern, buildDetectionRegex } from "@/editor/utils/requirementOps";
import type { RequirementRecord } from "@/editor/utils/requirementOps";

// ── Tab configuration ─────────────────────────────────────────────────────────
//
// Add future tabs (Traceability, Metrics, AI Review) here.
// No other files need to change.

export type TabId = "overview" | "requirements" | "reviews" | "insights";

const TABS: readonly { id: TabId; label: string }[] = [
  { id: "overview",      label: "Overview" },
  { id: "requirements",  label: "Requirements" },
  { id: "reviews",       label: "Reviews" },
  { id: "insights",      label: "Insights" },
] as const;

// ── Props ─────────────────────────────────────────────────────────────────────

export interface DashboardProps {
  open: boolean;
  onClose: () => void;
  onLoadReview: () => void;
  onSaveReview: () => void;
  onSaveReviewAs: () => void;
  /** Optional: open the dashboard directly on a specific tab. */
  initialTab?: TabId;
}

// ── Dashboard ─────────────────────────────────────────────────────────────────

export function Dashboard({
  open,
  onClose,
  onLoadReview,
  onSaveReview,
  onSaveReviewAs,
  initialTab,
}: DashboardProps) {
  const editor = useContext(EditorContext);
  const requirementPattern = useConfigStore((s) => s.requirementPattern);

  const [activeTab, setActiveTab] = useState<TabId>(initialTab ?? "overview");
  const [selectedRecord, setSelectedRecord] = useState<RequirementRecord | null>(null);

  // Reset state when dashboard opens
  useEffect(() => {
    if (open) {
      setActiveTab(initialTab ?? "overview");
      setSelectedRecord(null);
    }
  }, [open, initialTab]);

  // Close drawer when switching away from Requirements tab
  useEffect(() => {
    if (activeTab !== "requirements") setSelectedRecord(null);
  }, [activeTab]);

  // Escape key closes the dashboard (not just the drawer)
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (selectedRecord) {
          setSelectedRecord(null);
        } else {
          onClose();
        }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose, selectedRecord]);

  // Navigate to a PM position and close the dashboard
  const handleNavigate = useCallback(
    (pmPos: number) => {
      if (!editor) return;
      editor.chain().focus().setTextSelection(pmPos + 1).scrollIntoView().run();
      onClose();
    },
    [editor, onClose],
  );

  // Navigate to a requirement by targetId (used by Insights tab)
  const handleNavigateByTargetId = useCallback(
    (targetId: string) => {
      if (!editor) return;
      if (!requirementPattern) return;
      const derived = derivePattern(requirementPattern.example);
      if (!derived) return;
      const regex = buildDetectionRegex(derived.prefix);
      const flat = flattenOutline(deriveOutline(editor));
      const target = flat.find((n) => {
        const m = n.label.match(regex);
        return m ? derived.prefix + m[1] === targetId : false;
      });
      if (!target) return;
      editor.chain().focus().setTextSelection(target.pmPos + 1).scrollIntoView().run();
      onClose();
    },
    [editor, onClose, requirementPattern],
  );

  if (!open) return null;

  const hasDrawer = selectedRecord !== null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 pt-[6vh] backdrop-blur-sm"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      aria-modal="true"
      role="dialog"
      aria-label="Dashboard"
    >
      <div
        className={[
          "flex min-h-0 flex-row rounded-xl border border-[var(--color-border)] bg-[var(--color-paper)] shadow-2xl transition-all duration-150",
          hasDrawer ? "w-full max-w-5xl" : "w-full max-w-4xl",
        ].join(" ")}
        style={{ maxHeight: "84vh" }}
      >
        {/* ── Main panel ── */}
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
          {/* Header: title + tab bar + close */}
          <div className="flex shrink-0 items-center justify-between border-b border-[var(--color-border)] px-4 py-0">
            <div className="flex items-center gap-0">
              {/* Tab bar */}
              {TABS.map((tab) => (
                <button
                  key={tab.id}
                  data-testid={`tab-${tab.id}`}
                  onClick={() => setActiveTab(tab.id)}
                  className={[
                    "relative px-4 py-3 text-sm font-medium transition-colors",
                    activeTab === tab.id
                      ? "text-[var(--color-text)] after:absolute after:bottom-0 after:left-0 after:right-0 after:h-0.5 after:bg-[var(--color-accent)]"
                      : "text-[var(--color-muted)] hover:text-[var(--color-text)]",
                  ].join(" ")}
                >
                  {tab.label}
                </button>
              ))}
            </div>
            <button
              onClick={onClose}
              className="ml-4 flex h-6 w-6 shrink-0 items-center justify-center rounded text-[var(--color-muted)] transition-colors hover:bg-[var(--color-border)] hover:text-[var(--color-text)]"
              aria-label="Close Dashboard"
            >
              <svg
                width="10"
                height="10"
                viewBox="0 0 10 10"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
              >
                <path d="M1 1l8 8M9 1L1 9" />
              </svg>
            </button>
          </div>

          {/* Tab content */}
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            {activeTab === "overview" && (
              <OverviewTab onSwitchTab={setActiveTab} />
            )}
            {activeTab === "requirements" && (
              <RequirementsTab
                onNavigate={handleNavigate}
                onLoadReview={onLoadReview}
                onSaveReview={onSaveReview}
                onSaveReviewAs={onSaveReviewAs}
                selectedRecord={selectedRecord}
                onSelectRecord={setSelectedRecord}
              />
            )}
            {activeTab === "reviews" && (
              <ReviewsTab onNavigate={handleNavigate} />
            )}
            {activeTab === "insights" && (
              <InsightsTab onNavigateByTargetId={handleNavigateByTargetId} />
            )}
          </div>
        </div>

        {/* ── Comment drawer (right panel, shared) ── */}
        <CommentDrawer
          record={selectedRecord}
          onClose={() => setSelectedRecord(null)}
        />
      </div>
    </div>
  );
}
