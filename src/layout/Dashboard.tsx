import { useCallback, useContext, useEffect, useState } from "react";
import { EditorContext } from "@/editor/EditorContext";
import { useConfigStore } from "@/stores/configStore";
import { CommentDrawer } from "@/layout/CommentDrawer";
import { OverviewTab } from "@/layout/tabs/OverviewTab";
import { RequirementsTab } from "@/layout/tabs/RequirementsTab";
import { ReviewsTab } from "@/layout/tabs/ReviewsTab";
import { TraceabilityTab } from "@/layout/tabs/TraceabilityTab";
import { InsightsTab } from "@/layout/tabs/InsightsTab";
import { deriveOutline, flattenOutline } from "@/editor/utils/deriveOutline";
import { compileRequirementPattern, matchRequirementId } from "@/editor/utils/requirementOps";
import type { RequirementRecord } from "@/editor/utils/requirementOps";

// ── Tab configuration ─────────────────────────────────────────────────────────
//
// Add future tabs (Traceability, Metrics, AI Review) here.
// No other files need to change.

export type TabId = "overview" | "requirements" | "reviews" | "traceability" | "quality";

const TABS: readonly { id: TabId; label: string }[] = [
  { id: "overview",      label: "Overview" },
  { id: "requirements",  label: "Requirements" },
  { id: "reviews",       label: "Reviews" },
  { id: "traceability",  label: "Traceability" },
  { id: "quality",       label: "Quality" },
] as const;

// ── Props ─────────────────────────────────────────────────────────────────────

export interface DashboardProps {
  /** Called when user navigates to a position — switches workspace to editor and scrolls. */
  onNavigateToEditor: (pmPos: number) => void;
  onLoadReview: () => void;
  onSaveReview: () => void;
  onSaveReviewAs: () => void;
  onLoadTraceability: () => void;
  onSaveTraceability: () => void;
  onSaveTraceabilityAs: () => void;
  /** Optional: open the dashboard directly on a specific tab. */
  initialTab?: TabId;
}

// ── Dashboard ─────────────────────────────────────────────────────────────────

export function Dashboard({
  onNavigateToEditor,
  onLoadReview,
  onSaveReview,
  onSaveReviewAs,
  onLoadTraceability,
  onSaveTraceability,
  onSaveTraceabilityAs,
  initialTab,
}: DashboardProps) {
  const editor = useContext(EditorContext);
  const requirementPattern = useConfigStore((s) => s.requirementPattern);

  const [activeTab, setActiveTab] = useState<TabId>(initialTab ?? "overview");
  const [selectedRecord, setSelectedRecord] = useState<RequirementRecord | null>(null);

  // Close drawer when switching away from Requirements tab
  useEffect(() => {
    if (activeTab !== "requirements") setSelectedRecord(null);
  }, [activeTab]);

  // Navigate to a PM position and switch to editor workspace
  const handleNavigate = useCallback(
    (pmPos: number) => {
      onNavigateToEditor(pmPos);
    },
    [onNavigateToEditor],
  );

  // Navigate to a requirement by targetId (used by Insights tab)
  const handleNavigateByTargetId = useCallback(
    (targetId: string) => {
      if (!editor) return;
      const compiled = compileRequirementPattern(requirementPattern);
      if (!compiled) return;
      const flat = flattenOutline(deriveOutline(editor));
      const target = flat.find((n) => matchRequirementId(n.label, compiled)?.id === targetId);
      if (!target) return;
      onNavigateToEditor(target.pmPos);
    },
    [editor, onNavigateToEditor, requirementPattern],
  );

  return (
    <div
      className="flex min-h-0 flex-1 flex-col bg-[var(--color-page-bg)]"
      role="main"
      aria-label="Dashboard"
    >
      {/* Tab bar */}
      <div className="flex shrink-0 items-center gap-0 border-b border-[var(--color-border)] px-4">
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

      {/* Content area: tab content + optional comment drawer side panel */}
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          {activeTab === "overview" && (
            <OverviewTab onSwitchTab={(tabId) => setActiveTab(tabId as TabId)} />
          )}
          {activeTab === "requirements" && (
            <RequirementsTab
              onNavigate={handleNavigate}
              selectedRecord={selectedRecord}
              onSelectRecord={setSelectedRecord}
            />
          )}
          {activeTab === "reviews" && (
            <ReviewsTab
              onNavigate={handleNavigate}
              onLoadReview={onLoadReview}
              onSaveReview={onSaveReview}
              onSaveReviewAs={onSaveReviewAs}
            />
          )}
          {activeTab === "traceability" && (
            <TraceabilityTab
              onLoadTraceability={onLoadTraceability}
              onSaveTraceability={onSaveTraceability}
              onSaveTraceabilityAs={onSaveTraceabilityAs}
            />
          )}
          {activeTab === "quality" && (
            <InsightsTab onNavigateByTargetId={handleNavigateByTargetId} />
          )}
        </div>

        {/* CommentDrawer as right panel — no fixed positioning */}
        <CommentDrawer
          record={selectedRecord}
          onClose={() => setSelectedRecord(null)}
        />
      </div>
    </div>
  );
}
