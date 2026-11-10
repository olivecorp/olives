import type { Editor } from "@tiptap/core";
import { moveTableColumn, moveTableRow } from "@tiptap/pm/tables";

/**
 * One-step row/column moves for note tables, used by the Table menu in
 * EditorToolbar. (Tables once also had drag-to-reorder grips on the
 * row/column edges, but they never worked reliably on mouse or touch and
 * were removed — these menu moves are the only reorder path.)
 */

interface CellInfo {
  rowIndex: number;
  colIndex: number;
  rowCount: number;
  colCount: number;
}

function cellInfo(editor: Editor): CellInfo | null {
  const { $from } = editor.state.selection;
  for (let d = $from.depth; d >= 2; d--) {
    const name = $from.node(d).type.name;
    if (name === "tableCell" || name === "tableHeader") {
      return {
        // index(depth) = child index at depth+1 within the node at depth.
        rowIndex: $from.index(d - 2),
        colIndex: $from.index(d - 1),
        rowCount: $from.node(d - 2).childCount,
        colCount: $from.node(d - 1).childCount,
      };
    }
  }
  return null;
}

/** Move the cursor's row one step (used by the Table menu). */
export function moveRowBy(editor: Editor, dir: -1 | 1): void {
  const info = cellInfo(editor);
  if (!info) return;
  const to = info.rowIndex + dir;
  if (to < 0 || to >= info.rowCount) return;
  moveTableRow({
    from: info.rowIndex,
    to,
    pos: editor.state.selection.from,
  })(editor.state, (tr) => editor.view.dispatch(tr.scrollIntoView()));
}

/** Move the cursor's column one step (used by the Table menu). */
export function moveColumnBy(editor: Editor, dir: -1 | 1): void {
  const info = cellInfo(editor);
  if (!info) return;
  const to = info.colIndex + dir;
  if (to < 0 || to >= info.colCount) return;
  moveTableColumn({
    from: info.colIndex,
    to,
    pos: editor.state.selection.from,
  })(editor.state, (tr) => editor.view.dispatch(tr.scrollIntoView()));
}
