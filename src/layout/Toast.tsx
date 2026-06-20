import { useToastStore } from "@/stores/toastStore";

export function Toaster() {
  const toasts = useToastStore((s) => s.toasts);
  const dismiss = useToastStore((s) => s.dismiss);

  if (!toasts.length) return null;

  return (
    <div className="fixed bottom-6 right-6 z-50 flex flex-col gap-2 pointer-events-none">
      {toasts.map((t) => (
        <div
          key={t.id}
          role="alert"
          className={[
            "flex items-center gap-3 rounded-lg border px-4 py-2.5 text-sm shadow-lg pointer-events-auto",
            t.type === "error"
              ? "border-red-200 bg-red-50 text-red-800 dark:border-red-800/60 dark:bg-red-950 dark:text-red-200"
              : t.type === "success"
                ? "border-green-200 bg-green-50 text-green-800 dark:border-green-800/60 dark:bg-green-950 dark:text-green-200"
                : "border-[var(--color-border)] bg-[var(--color-paper)] text-[var(--color-text)]",
          ].join(" ")}
        >
          <span>{t.message}</span>
          <button
            onClick={() => dismiss(t.id)}
            aria-label="Dismiss"
            className="ml-1 opacity-50 hover:opacity-100 transition-opacity"
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
              <path d="M1 1l10 10M11 1L1 11" />
            </svg>
          </button>
        </div>
      ))}
    </div>
  );
}
