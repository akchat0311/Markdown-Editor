import { useState, useContext, useMemo } from "react";
import { useValidationStore } from "@/stores/validationStore";
import { EditorContext } from "@/editor/EditorContext";
import { useConfigStore } from "@/stores/configStore";
import { useRequirementIndex } from "@/editor/utils/useRequirementIndex";
import qualityRules from "@/config/quality-rules.json";
import type { ValidationIssue, ValidationCategory } from "@/types/validation";

// ── Type → Rule ID ────────────────────────────────────────────────────────────

const TYPE_TO_RULE_ID: Record<string, string> = {
  "requirement-order":          "requirementOrder",
  "duplicate-requirement-id":   "duplicateId",
  "missing-requirement-status": "missingStatus",
  "empty-requirement":          "emptyBody",
  "weak-modal":                 "weakModal",
  "ambiguous-word":             "ambiguousWords",
  "forbidden-term":             "forbiddenTerms",
  "word-count":                 "wordCount",
  "multiple-shall":             "multipleShall",
  "vague-quantifier":           "vagueQuantifiers",
  "escape-clause":              "escapeClauses",
  "multiple-sentences":         "multipleSentences",
  "undefined-acronym":          "undefinedAcronyms",
};

const CATEGORY_ORDER: ValidationCategory[] = [
  "structure", "language", "completeness", "consistency", "traceability",
];

const CATEGORY_LABELS: Record<ValidationCategory, string> = {
  structure:    "Structure",
  language:     "Language",
  completeness: "Completeness",
  consistency:  "Consistency",
  traceability: "Traceability",
};

// ── Data shapes ───────────────────────────────────────────────────────────────

interface ReqInfo { id: string; message: string; navigable: boolean }

interface RuleGroup {
  ruleId: string;
  title: string;
  description: string;
  severity: "error" | "warning";
  category: ValidationCategory;
  requirements: ReqInfo[];
}

interface CategoryGroup {
  category: ValidationCategory;
  label: string;
  rules: RuleGroup[];
  totalAffected: number;
}

// ── Grouping helpers ──────────────────────────────────────────────────────────

function numericKey(id: string): number {
  const m = id.match(/(\d+)$/);
  return m ? parseInt(m[1], 10) : Infinity;
}

function trimIdPrefix(message: string, targetId: string): string {
  const prefix = `${targetId}: `;
  return message.startsWith(prefix) ? message.slice(prefix.length) : message;
}

function getRuleCfg(ruleId: string): Record<string, unknown> {
  return (qualityRules.rules as Record<string, Record<string, unknown>>)[ruleId] ?? {};
}

function buildRuleGroups(issues: ValidationIssue[]): RuleGroup[] {
  const buckets = new Map<string, ValidationIssue[]>();
  for (const issue of issues) {
    const ruleId = TYPE_TO_RULE_ID[issue.type] ?? issue.type;
    const arr = buckets.get(ruleId) ?? [];
    arr.push(issue);
    buckets.set(ruleId, arr);
  }

  const groups: RuleGroup[] = [];
  for (const [ruleId, ruleIssues] of buckets) {
    const cfg = getRuleCfg(ruleId);
    const category = (
      ruleIssues[0]?.category ??
      (cfg["category"] as string | undefined) ??
      "structure"
    ) as ValidationCategory;
    const severity: "error" | "warning" =
      ruleIssues.some((i) => i.severity === "error") ? "error" : "warning";

    const seen = new Set<string>();
    const requirements: ReqInfo[] = [];
    for (const issue of ruleIssues) {
      if (issue.targetId) {
        if (seen.has(issue.targetId)) continue;
        seen.add(issue.targetId);
        requirements.push({
          id: issue.targetId,
          message: trimIdPrefix(issue.message, issue.targetId),
          navigable: true,
        });
      } else if (issue.documentIndex !== undefined) {
        // Each document-level issue (keyed by its own id) gets a separate "Document" row.
        if (seen.has(issue.id)) continue;
        seen.add(issue.id);
        requirements.push({
          id: "Document",
          message: issue.message,
          navigable: false,
        });
      }
    }
    requirements.sort((a, b) => numericKey(a.id) - numericKey(b.id));

    groups.push({
      ruleId,
      title:       (cfg["title"]       as string | undefined) ?? ruleId,
      description: (cfg["description"] as string | undefined) ?? "",
      severity,
      category,
      requirements,
    });
  }

  groups.sort((a, b) => {
    if (a.severity !== b.severity) return a.severity === "error" ? -1 : 1;
    if (a.requirements.length !== b.requirements.length)
      return b.requirements.length - a.requirements.length;
    return a.title.localeCompare(b.title);
  });

  return groups;
}

function buildCategoryGroups(ruleGroups: RuleGroup[]): CategoryGroup[] {
  const map = new Map<ValidationCategory, RuleGroup[]>();
  for (const rule of ruleGroups) {
    const arr = map.get(rule.category) ?? [];
    arr.push(rule);
    map.set(rule.category, arr);
  }
  return CATEGORY_ORDER.flatMap((cat) => {
    const rules = map.get(cat);
    if (!rules || rules.length === 0) return [];
    return [{
      category: cat,
      label: CATEGORY_LABELS[cat],
      rules,
      totalAffected: rules.reduce((s, r) => s + r.requirements.length, 0),
    }];
  });
}

// ── SVG icons ─────────────────────────────────────────────────────────────────

function IconDoc({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="16" y1="13" x2="8" y2="13" />
      <line x1="16" y1="17" x2="8" y2="17" />
      <line x1="10" y1="9" x2="8" y2="9" />
    </svg>
  );
}

function IconAlertCircle({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="8" x2="12" y2="12" />
      <line x1="12" y1="16" x2="12.01" y2="16" />
    </svg>
  );
}

function IconList({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <line x1="8" y1="6" x2="21" y2="6" />
      <line x1="8" y1="12" x2="21" y2="12" />
      <line x1="8" y1="18" x2="21" y2="18" />
      <line x1="3" y1="6" x2="3.01" y2="6" />
      <line x1="3" y1="12" x2="3.01" y2="12" />
      <line x1="3" y1="18" x2="3.01" y2="18" />
    </svg>
  );
}

function IconShieldAlert({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
      <line x1="12" y1="8" x2="12" y2="12" />
      <line x1="12" y1="16" x2="12.01" y2="16" />
    </svg>
  );
}

function IconChevronRight({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <polyline points="9 18 15 12 9 6" />
    </svg>
  );
}

function IconChevronDown({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}

// ── Category-specific icons ───────────────────────────────────────────────────

function CategoryIcon({ category }: { category: ValidationCategory }) {
  if (category === "language") {
    return (
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-blue-100 dark:bg-blue-900/30">
        <svg viewBox="0 0 16 16" fill="currentColor" className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400">
          <rect x="1" y="1" width="6" height="6" rx="1.5" />
          <rect x="9" y="1" width="6" height="6" rx="1.5" />
          <rect x="1" y="9" width="6" height="6" rx="1.5" />
          <rect x="9" y="9" width="6" height="6" rx="1.5" />
        </svg>
      </span>
    );
  }
  if (category === "completeness") {
    return (
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-green-100 dark:bg-green-900/30">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5 text-green-600 dark:text-green-400">
          <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
          <polyline points="9 12 11 14 15 10" />
        </svg>
      </span>
    );
  }
  if (category === "consistency") {
    return (
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-purple-100 dark:bg-purple-900/30">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5 text-purple-600 dark:text-purple-400">
          <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
          <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
        </svg>
      </span>
    );
  }
  if (category === "structure") {
    return (
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-slate-100 dark:bg-slate-800">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5 text-slate-600 dark:text-slate-400">
          <rect x="3" y="3" width="7" height="7" rx="1" />
          <rect x="14" y="3" width="7" height="7" rx="1" />
          <rect x="3" y="14" width="7" height="7" rx="1" />
          <rect x="14" y="14" width="7" height="7" rx="1" />
        </svg>
      </span>
    );
  }
  // traceability
  return (
    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-teal-100 dark:bg-teal-900/30">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5 text-teal-600 dark:text-teal-400">
        <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
      </svg>
    </span>
  );
}

// ── Severity circle (filled, for rule rows) ───────────────────────────────────

function SeverityCircle({ severity }: { severity: "error" | "warning" }) {
  const bg = severity === "error" ? "bg-red-500" : "bg-amber-500";
  return (
    <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${bg}`}>
      <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
        <line x1="12" y1="8" x2="12" y2="13" />
        <line x1="12" y1="17" x2="12.01" y2="17" />
      </svg>
    </span>
  );
}

// ── Stat cards ────────────────────────────────────────────────────────────────

interface StatCardProps {
  icon: React.ReactNode;
  iconBg: string;
  value: number;
  label: string;
  testid?: string;
}

function StatCard({ icon, iconBg, value, label, testid }: StatCardProps) {
  return (
    <div className="flex items-center gap-4 rounded-2xl border border-[var(--color-border)] bg-[var(--color-paper)] p-5">
      <span className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-xl ${iconBg}`}>
        {icon}
      </span>
      <div>
        <div
          data-testid={testid}
          className="text-4xl font-bold leading-none text-[var(--color-text)]"
        >
          {value}
        </div>
        <div className="mt-1 text-sm text-[var(--color-muted)]">{label}</div>
      </div>
    </div>
  );
}

// ── Requirement row (inside expanded rule) ────────────────────────────────────

function RequirementRow({ req, onNavigate }: { req: ReqInfo; onNavigate: (id: string) => void }) {
  if (!req.navigable) {
    return (
      <div
        data-testid="req-row"
        className="flex w-full items-start gap-3 px-5 py-3 text-left"
      >
        <div className="min-w-0 flex-1">
          <div className="font-mono text-xs font-semibold text-[var(--color-text)]">{req.id}</div>
          {req.message && (
            <div className="mt-0.5 truncate text-xs text-[var(--color-muted)]">{req.message}</div>
          )}
        </div>
      </div>
    );
  }
  return (
    <button
      data-testid="req-row"
      onClick={() => onNavigate(req.id)}
      className="flex w-full items-start gap-3 px-5 py-3 text-left transition-colors hover:bg-[var(--color-border)]/60"
    >
      <div className="min-w-0 flex-1">
        <div className="font-mono text-xs font-semibold text-[var(--color-text)]">{req.id}</div>
        {req.message && (
          <div className="mt-0.5 truncate text-xs text-[var(--color-muted)]">{req.message}</div>
        )}
      </div>
      <IconChevronRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--color-muted)]" />
    </button>
  );
}

// ── Rule row (in Needs Attention) ─────────────────────────────────────────────

function RuleRow({
  group,
  expanded,
  onToggle,
  onNavigate,
}: {
  group: RuleGroup;
  expanded: boolean;
  onToggle: () => void;
  onNavigate: (id: string) => void;
}) {
  const count = group.requirements.length;
  const badgeCls =
    group.severity === "error"
      ? "bg-red-50 text-red-600 dark:bg-red-900/20 dark:text-red-400"
      : "bg-amber-50 text-amber-700 dark:bg-amber-900/20 dark:text-amber-400";

  return (
    <div data-testid="rule-section">
      <button
        data-testid="rule-toggle"
        className="flex w-full items-start gap-4 px-5 py-4 text-left transition-colors hover:bg-[var(--color-border)]/40 focus-visible:outline-none"
        onClick={onToggle}
      >
        <SeverityCircle severity={group.severity} />
        <div className="min-w-0 flex-1 pt-0.5">
          <div className="font-semibold text-[var(--color-text)]">{group.title}</div>
          {group.description && (
            <div className="mt-0.5 line-clamp-2 text-sm text-[var(--color-muted)]">
              {group.description}
            </div>
          )}
        </div>
        <span className={`mt-0.5 shrink-0 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium ${badgeCls}`}>
          {count}&nbsp;{count === 1 ? "issue" : "issues"}
        </span>
        {expanded
          ? <IconChevronDown className="mt-1 h-4 w-4 shrink-0 text-[var(--color-muted)]" />
          : <IconChevronRight className="mt-1 h-4 w-4 shrink-0 text-[var(--color-muted)]" />
        }
      </button>

      {expanded && group.requirements.length > 0 && (
        <div className="border-t border-[var(--color-border)] bg-[var(--color-border)]/20">
          {group.requirements.map((req) => (
            <div key={req.id} className="border-b border-[var(--color-border)] last:border-b-0">
              <RequirementRow req={req} onNavigate={onNavigate} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Browse by Category ────────────────────────────────────────────────────────

function BrowseByCategory({ categoryGroups }: { categoryGroups: CategoryGroup[] }) {
  // Start all categories expanded so category-section elements are in the DOM on mount
  const [collapsedCats, setCollapsedCats] = useState(new Set<string>());

  const toggleCat = (cat: string) => {
    setCollapsedCats((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      return next;
    });
  };

  if (categoryGroups.length === 0) return null;

  return (
    <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-paper)]">
      <div className="px-5 pb-3 pt-5">
        <h2 className="text-sm font-bold uppercase tracking-wider text-[var(--color-text)]">
          Browse by Category
        </h2>
        <p className="mt-0.5 text-xs text-[var(--color-muted)]">
          Explore issues grouped by quality category
        </p>
      </div>

      <div className="divide-y divide-[var(--color-border)]">
        {categoryGroups.map((cat) => {
          const isOpen = !collapsedCats.has(cat.category);
          const count = cat.totalAffected;
          return (
            <div key={cat.category} data-testid="category-section">
              <button
                className="flex w-full items-center gap-3 px-5 py-3.5 text-left transition-colors hover:bg-[var(--color-border)]/40 focus-visible:outline-none"
                onClick={() => toggleCat(cat.category)}
              >
                {isOpen
                  ? <IconChevronDown className="h-4 w-4 shrink-0 text-[var(--color-muted)]" />
                  : <IconChevronRight className="h-4 w-4 shrink-0 text-[var(--color-muted)]" />
                }
                <CategoryIcon category={cat.category} />
                <span className="flex-1 text-sm font-semibold text-[var(--color-text)]">
                  {cat.label}
                </span>
                <span className="text-sm text-[var(--color-muted)]">
                  {count}&nbsp;{count === 1 ? "issue" : "issues"}
                </span>
                <IconChevronRight className="h-4 w-4 shrink-0 text-[var(--color-muted)]" />
              </button>

              {isOpen && (
                <div className="border-t border-[var(--color-border)] bg-[var(--color-border)]/20 px-5 py-2">
                  {cat.rules.map((rule) => (
                    <div key={rule.ruleId} className="flex items-center gap-2 py-1.5">
                      <SeverityCircle severity={rule.severity} />
                      <span className="flex-1 text-sm text-[var(--color-text)]">
                        {rule.title}
                      </span>
                      <span className="text-xs text-[var(--color-muted)]">
                        {rule.requirements.length}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── InsightsTab ───────────────────────────────────────────────────────────────

export interface InsightsTabProps {
  onNavigateByTargetId: (targetId: string) => void;
}

export function InsightsTab({ onNavigateByTargetId }: InsightsTabProps) {
  const issues = useValidationStore((s) => s.issues);
  const editor = useContext(EditorContext);
  const requirementPattern = useConfigStore((s) => s.requirementPattern);
  const index = useRequirementIndex(editor, requirementPattern?.example ?? null);

  const total = issues.length;
  const errorCount = useMemo(() => issues.filter((i) => i.severity === "error").length, [issues]);
  const ruleGroups = useMemo(() => buildRuleGroups(issues), [issues]);
  const categoryGroups = useMemo(() => buildCategoryGroups(ruleGroups), [ruleGroups]);
  const requirementCount = index?.total ?? 0;

  // Rules start COLLAPSED. Absent from set = collapsed; present = expanded.
  const [expandedRules, setExpandedRules] = useState(new Set<string>());
  const toggleRule = (ruleId: string) => {
    setExpandedRules((prev) => {
      const next = new Set(prev);
      if (next.has(ruleId)) next.delete(ruleId);
      else next.add(ruleId);
      return next;
    });
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="min-h-0 flex-1 overflow-y-auto" data-testid="insights-content">
        {total === 0 ? (
          /* ── Empty state ──────────────────────────────────────────────────── */
          <div
            data-testid="empty-state"
            className="flex flex-col items-center justify-center px-6 py-20 text-center"
          >
            <div className="mb-5 flex h-16 w-16 items-center justify-center rounded-full bg-green-100 dark:bg-green-900/30">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="h-8 w-8 text-green-600 dark:text-green-400">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            </div>
            <p className="mb-1.5 text-base font-semibold text-[var(--color-text)]">
              No quality issues found
            </p>
            <p className="text-sm text-[var(--color-muted)]">
              All configured quality checks passed.
            </p>
          </div>
        ) : (
          <div className="space-y-5 p-5">
            {/* ── Stat cards ──────────────────────────────────────────────── */}
            <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
              <StatCard
                icon={<IconDoc className="h-6 w-6 text-blue-600 dark:text-blue-400" />}
                iconBg="bg-blue-100 dark:bg-blue-900/30"
                value={requirementCount}
                label="Requirements"
              />
              <StatCard
                icon={<IconAlertCircle className="h-6 w-6 text-amber-600 dark:text-amber-400" />}
                iconBg="bg-amber-100 dark:bg-amber-900/30"
                value={total}
                label="Issues"
                testid="issue-count-badge"
              />
              <StatCard
                icon={<IconList className="h-6 w-6 text-violet-600 dark:text-violet-400" />}
                iconBg="bg-violet-100 dark:bg-violet-900/30"
                value={ruleGroups.length}
                label="Rules Triggered"
              />
              <StatCard
                icon={<IconShieldAlert className="h-6 w-6 text-red-600 dark:text-red-400" />}
                iconBg="bg-red-100 dark:bg-red-900/30"
                value={errorCount}
                label="Errors"
              />
            </div>

            {/* ── Needs Attention ─────────────────────────────────────────── */}
            <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-paper)]">
              {/* Section header */}
              <div className="flex items-start justify-between px-5 pb-3 pt-5">
                <div>
                  <div className="flex items-center gap-2.5">
                    <h2 className="text-sm font-bold uppercase tracking-wider text-[var(--color-text)]">
                      Needs Attention
                    </h2>
                    <span className="rounded-full bg-[var(--color-border)] px-2 py-0.5 text-[11px] font-semibold tabular-nums text-[var(--color-muted)]">
                      {total}&nbsp;{total === 1 ? "issue" : "issues"}
                    </span>
                  </div>
                  <p className="mt-0.5 text-xs text-[var(--color-muted)]">
                    Priority sorted by severity and impact
                  </p>
                </div>
                <span className="rounded-lg border border-[var(--color-border)] px-2.5 py-1 text-xs text-[var(--color-muted)]">
                  Sort: Priority
                </span>
              </div>

              {/* Rule rows */}
              <div className="divide-y divide-[var(--color-border)] border-t border-[var(--color-border)]">
                {ruleGroups.map((rule) => (
                  <RuleRow
                    key={rule.ruleId}
                    group={rule}
                    expanded={expandedRules.has(rule.ruleId)}
                    onToggle={() => toggleRule(rule.ruleId)}
                    onNavigate={onNavigateByTargetId}
                  />
                ))}
              </div>
            </div>

            {/* ── Browse by Category ──────────────────────────────────────── */}
            <BrowseByCategory categoryGroups={categoryGroups} />
          </div>
        )}
      </div>
    </div>
  );
}
