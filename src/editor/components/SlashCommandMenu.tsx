import type { SlashCommandItem } from "../slashCommandItems";

interface SlashCommandMenuProps {
  items: SlashCommandItem[];
  selectedIndex: number;
  onSelect: (index: number) => void;
  onHover: (index: number) => void;
}

export function SlashCommandMenu({ items, selectedIndex, onSelect, onHover }: SlashCommandMenuProps) {
  if (items.length === 0) {
    return (
      <div className="w-64 rounded-md border border-[var(--color-border)] bg-[var(--color-paper)] px-3 py-2 text-sm text-[var(--color-muted)] shadow-lg">
        No matching commands
      </div>
    );
  }

  return (
    <div
      role="listbox"
      aria-label="Slash commands"
      className="max-h-80 w-72 overflow-y-auto rounded-md border border-[var(--color-border)] bg-[var(--color-paper)] py-1 shadow-lg"
    >
      {items.map((item, index) => (
        <button
          key={item.id}
          type="button"
          role="option"
          aria-selected={index === selectedIndex}
          onMouseEnter={() => onHover(index)}
          onClick={() => onSelect(index)}
          className={`flex w-full items-center gap-3 px-3 py-1.5 text-left text-sm ${
            index === selectedIndex
              ? "bg-blue-50 dark:bg-blue-900/40"
              : "hover:bg-black/5 dark:hover:bg-white/5"
          }`}
        >
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded bg-black/5 text-xs font-semibold dark:bg-white/10">
            {item.icon}
          </span>
          <span className="flex flex-col">
            <span className="font-medium text-[var(--color-text)]">{item.label}</span>
            <span className="text-xs text-[var(--color-muted)]">{item.description}</span>
          </span>
        </button>
      ))}
    </div>
  );
}
