import { useState, useRef, useEffect } from "react";

interface UserNameFormProps {
  initialName?: string;
  onSave: (name: string) => void;
  onCancel?: () => void;
}

export function UserNameForm({ initialName = "", onSave, onCancel }: UserNameFormProps) {
  const [name, setName] = useState(initialName);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const trimmed = name.trim();
  const valid = trimmed.length >= 2;

  return (
    <div className="flex flex-col gap-2">
      <label className="text-[10px] font-semibold uppercase tracking-wide text-[var(--color-muted)]">
        User Name
      </label>
      <input
        ref={inputRef}
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && valid) {
            e.preventDefault();
            onSave(trimmed);
          }
          if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            onCancel?.();
          }
        }}
        placeholder="e.g. Alice Smith"
        maxLength={80}
        className="rounded border border-[var(--color-border)] bg-[var(--color-paper)] px-2.5 py-1.5 text-xs text-[var(--color-text)] outline-none focus:border-[var(--color-accent)]"
      />
      {trimmed.length > 0 && trimmed.length < 2 && (
        <p className="text-[10px] text-red-500">Minimum 2 characters</p>
      )}
      <div className="flex justify-end gap-2 pt-1">
        {onCancel && (
          <button
            onClick={onCancel}
            className="rounded px-2.5 py-1 text-xs text-[var(--color-muted)] hover:bg-[var(--color-border)] transition-colors"
          >
            Cancel
          </button>
        )}
        <button
          onClick={() => {
            if (valid) onSave(trimmed);
          }}
          disabled={!valid}
          className="rounded bg-[var(--color-accent)] px-2.5 py-1 text-xs font-medium text-white disabled:opacity-40 hover:opacity-90 transition-opacity"
        >
          Save
        </button>
      </div>
    </div>
  );
}
