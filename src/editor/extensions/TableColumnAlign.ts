import { Extension } from "@tiptap/core";
import { TableMap, selectionCell, isInTable, CellSelection } from "prosemirror-tables";
import type { Command } from "@tiptap/pm/state";

type Align = "left" | "center" | "right" | null;

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    tableColumnAlign: {
      setColumnAlign(align: Align): ReturnType;
    };
  }
}

// Applies GFM column-level alignment to every cell in the current column.
//
// GFM alignment is per-column (encoded in the separator row), so changing
// alignment for a single cell without updating the others produces a state
// that does not survive save/reopen — the serializer reads alignment from the
// header row and applies it back to all cells on parse.
//
// For TextSelection: aligns the column that contains the cursor cell.
// For CellSelection: aligns the column of the anchor cell (the cell where
//   the selection was started), consistent with user intent when dragging
//   across columns.
//
// Coordinate arithmetic follows prosemirror-tables convention:
//   TableMap offsets are relative to tableStart (the position of the opening
//   tag of the table node). The absolute document position of a cell node is
//   tableStart + offset, as used throughout prosemirror-tables internals
//   (e.g. toggleHeader, deprecated_toggleHeader).
function setColumnAlignCommand(align: Align): Command {
  return (state, dispatch) => {
    if (!isInTable(state)) return false;

    // Derive the anchor cell: for CellSelection use $anchorCell explicitly so
    // that dragging across columns always aligns the column where the drag
    // started, not the leftmost selected column (which selectedRect.left gives).
    const $cell =
      state.selection instanceof CellSelection
        ? state.selection.$anchorCell
        : selectionCell(state);

    const table = $cell.node(-1);
    const tableStart = $cell.start(-1);
    const map = TableMap.get(table);

    // colCount returns the column index of the cell at the given relative pos.
    const col = map.colCount($cell.pos - tableStart);

    const columnCells = map.cellsInRect({
      left: col,
      top: 0,
      right: col + 1,
      bottom: map.height,
    });

    if (dispatch) {
      const tr = state.tr;
      for (const offset of columnCells) {
        const cell = table.nodeAt(offset);
        if (cell && cell.attrs.align !== align) {
          // tableStart + offset is the position of the cell node's opening tag,
          // which is exactly what setNodeMarkup expects (same as $cell.pos for
          // a resolved position pointing at the cell).
          tr.setNodeMarkup(tableStart + offset, null, { ...cell.attrs, align });
        }
      }
      if (tr.steps.length) dispatch(tr);
    }
    return true;
  };
}

export const TableColumnAlign = Extension.create({
  name: "tableColumnAlign",

  addCommands() {
    return {
      setColumnAlign:
        (align: Align) =>
        ({ state, dispatch }) =>
          setColumnAlignCommand(align)(state, dispatch),
    };
  },
});
