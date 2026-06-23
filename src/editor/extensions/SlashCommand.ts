import { Extension } from "@tiptap/core";
import Suggestion, { type SuggestionKeyDownProps, type SuggestionProps } from "@tiptap/suggestion";
import { createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { SlashCommandMenu } from "../components/SlashCommandMenu";
import { filterSlashCommandItems, type SlashCommandItem } from "../slashCommandItems";

function createSlashCommandRenderer() {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;
  let selectedIndex = 0;
  let latestProps: SuggestionProps<SlashCommandItem> | null = null;

  const renderMenu = () => {
    if (!root || !latestProps) return;
    root.render(
      createElement(SlashCommandMenu, {
        items: latestProps.items,
        selectedIndex,
        onHover: (index: number) => {
          selectedIndex = index;
          renderMenu();
        },
        onSelect: (index: number) => {
          const item = latestProps?.items[index];
          if (item) latestProps?.command(item);
        },
      }),
    );
  };

  const position = () => {
    if (!container) return;
    const rect = latestProps?.clientRect?.();
    if (!rect) return;

    const GAP = 4;
    const MENU_MAX_HEIGHT = 320; // matches max-h-80 on SlashCommandMenu
    const MENU_WIDTH = 288;      // matches w-72 on SlashCommandMenu

    // Clamp left so the menu doesn't overflow the right edge of the viewport.
    const left = Math.min(rect.left, window.innerWidth - MENU_WIDTH - GAP);
    container.style.left = `${Math.max(0, left)}px`;

    // Flip upward when there isn't enough space below the caret.
    const spaceBelow = window.innerHeight - rect.bottom - GAP;
    if (spaceBelow >= MENU_MAX_HEIGHT || spaceBelow >= rect.top - GAP) {
      container.style.top = `${rect.bottom + GAP}px`;
      container.style.bottom = "auto";
    } else {
      container.style.top = "auto";
      container.style.bottom = `${window.innerHeight - rect.top + GAP}px`;
    }
  };

  return {
    onStart: (props: SuggestionProps<SlashCommandItem>) => {
      latestProps = props;
      selectedIndex = 0;
      container = document.createElement("div");
      container.style.position = "fixed";
      container.style.zIndex = "50";
      document.body.appendChild(container);
      root = createRoot(container);
      position();
      renderMenu();
    },
    onUpdate: (props: SuggestionProps<SlashCommandItem>) => {
      latestProps = props;
      selectedIndex = 0;
      position();
      renderMenu();
    },
    onKeyDown: ({ event }: SuggestionKeyDownProps) => {
      const count = latestProps?.items.length ?? 0;
      if (count === 0) return false;
      if (event.key === "ArrowDown") {
        selectedIndex = (selectedIndex + 1) % count;
        renderMenu();
        return true;
      }
      if (event.key === "ArrowUp") {
        selectedIndex = (selectedIndex - 1 + count) % count;
        renderMenu();
        return true;
      }
      if (event.key === "Enter" || event.key === "Tab") {
        const item = latestProps?.items[selectedIndex];
        if (item) latestProps?.command(item);
        return true;
      }
      if (event.key === "Escape") {
        return true;
      }
      return false;
    },
    onExit: () => {
      root?.unmount();
      container?.remove();
      root = null;
      container = null;
      latestProps = null;
    },
  };
}

export const SlashCommand = Extension.create({
  name: "slashCommand",

  addProseMirrorPlugins() {
    return [
      Suggestion<SlashCommandItem>({
        editor: this.editor,
        char: "/",
        startOfLine: false,
        allowSpaces: false,
        items: ({ query }) => filterSlashCommandItems(query),
        command: ({ editor, range, props }) => {
          props.command(editor, range);
        },
        render: createSlashCommandRenderer,
      }),
    ];
  },
});
