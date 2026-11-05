import { Extension, type Editor } from "@tiptap/core";
import { Plugin, PluginKey, TextSelection } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { Node as PMNode } from "@tiptap/pm/model";
import type { EditorView } from "@tiptap/pm/view";
import {
  findTable,
  moveTableColumn,
  moveTableRow,
  TableMap,
} from "@tiptap/pm/tables";

/**
 * Drag-to-reorder for note tables. Adds a grip to the left edge of every
 * row and the top edge of every column as widget decorations; dragging a
 * grip onto another row/column moves it via prosemirror-tables'
 * moveTableRow / moveTableColumn commands (merged cells handled there).
 *
 * Grips are styled in globals.css (.tbl-grip): invisible until the table
 * is hovered with a mouse (touch devices keep them hidden — see the
 * comment there), rendered into the .tableWrapper padding so overflow-x
 * doesn't clip them.
 */

const dragKey = new PluginKey("noteTableDrag");

type DragKind = "row" | "col";

interface DragSession {
  kind: DragKind;
  index: number;
  tablePos: number; // doc position of the source table
}

// Module-scoped drag state: only one editor mounts this at a time.
let dragSession: DragSession | null = null;

// --- indicator ------------------------------------------------------------
// Transient DOM highlighting of the drop target — short-lived enough that
// direct class toggling beats a decoration round-trip.

let indicatedEls: HTMLElement[] = [];
let indicatedKey = "";

function clearIndicator(): void {
  for (const el of indicatedEls) el.classList.remove("tbl-drop-target");
  indicatedEls = [];
  indicatedKey = "";
}

function showIndicator(
  view: EditorView,
  session: DragSession,
  targetIndex: number,
): void {
  const key = `${session.tablePos}:${session.kind}:${targetIndex}`;
  if (key === indicatedKey) return;
  clearIndicator();
  const tableEl = view.nodeDOM(session.tablePos) as HTMLElement | null;
  if (!tableEl) return;
  const rows = Array.from(tableEl.querySelectorAll("tr"));
  if (session.kind === "row") {
    const tr = rows[targetIndex];
    if (tr) {
      tr.classList.add("tbl-drop-target");
      indicatedEls = [tr];
    }
  } else {
    for (const row of rows) {
      const cell = row.children[targetIndex];
      if (cell) {
        cell.classList.add("tbl-drop-target");
        indicatedEls.push(cell as HTMLElement);
      }
    }
  }
  indicatedKey = key;
}

// --- grips -----------------------------------------------------------------

const GRIP_SVG =
  '<svg viewBox="0 0 10 16" width="10" height="16" aria-hidden="true">' +
  Array.from({ length: 9 }, (_, i) => {
    const x = 1.5 + (i % 3) * 3.5;
    const y = 3 + Math.floor(i / 3) * 5;
    return `<circle cx="${x}" cy="${y}" r="1.4" fill="currentColor"/>`;
  }).join("") +
  "</svg>";

function makeGrip(kind: DragKind, index: number, editor: Editor): HTMLSpanElement {
  const el = document.createElement("span");
  el.contentEditable = "false";
  el.draggable = true;
  el.className = `tbl-grip tbl-grip-${kind}`;
  el.title =
    kind === "row" ? "Drag to move this row" : "Drag to move this column";
  el.innerHTML = GRIP_SVG;
  el.addEventListener("dragstart", (event) => {
    if (!event.dataTransfer) return;
    const view = editor.view;
    const tableEl = el.closest("table");
    if (!view || !tableEl) return;
    const table = findTable(view.state.doc.resolve(view.posAtDOM(tableEl, 0)));
    if (!table) return;
    dragSession = { kind, index, tablePos: table.pos };
    event.dataTransfer.effectAllowed = "move";
    // Custom mimetype only — a foreign drop must not be read as text by PM.
    event.dataTransfer.setData("application/x-note-table-drag", `${kind}:${index}`);
    const rows = tableEl.querySelectorAll("tr");
    const ghost = kind === "row" ? rows[index] : rows[0]?.children[index];
    if (ghost) event.dataTransfer.setDragImage(ghost, 12, 12);
    event.stopPropagation();
  });
  return el;
}

function gripDecorations(table: PMNode, tablePos: number, editor: Editor): Decoration[] {
  const map = TableMap.get(table);
  const out: Decoration[] = [];
  const gripRows = map.height > 1;
  const gripCols = map.width > 1;
  if (!gripRows && !gripCols) return out;

  let rowOffset = 0;
  let rowIndex = 0;
  table.forEach((row) => {
    if (gripRows) {
      // The widget's toDOM runs later (at render), so the loop counters must
      // be captured per iteration — a closure over `rowIndex` itself would
      // hand every grip the final value after the loop, and every row grip
      // would claim to be the last row.
      const ri = rowIndex;
      // Position: inside the row's first cell, before its content.
      out.push(
        Decoration.widget(
          tablePos + rowOffset + 3,
          () => makeGrip("row", ri, editor),
          {
            side: -1,
            ignoreSelection: true,
            stopEvent: () => true,
            key: `tbl-grip-row-${tablePos}-${ri}`,
          },
        ),
      );
    }
    if (rowIndex === 0 && gripCols) {
      let cellOffset = 0;
      let colIndex = 0;
      row.forEach((cell) => {
        const ci = colIndex;
        out.push(
          Decoration.widget(
            tablePos + cellOffset + 3,
            () => makeGrip("col", ci, editor),
            {
              side: -1,
              ignoreSelection: true,
              stopEvent: () => true,
              key: `tbl-grip-col-${tablePos}-${ci}`,
            },
          ),
        );
        colIndex += (cell.attrs.colspan as number | undefined) ?? 1;
        cellOffset += cell.nodeSize;
      });
    }
    rowOffset += row.nodeSize;
    rowIndex++;
  });
  return out;
}

// Decoration sets are rebuilt on every doc change; memoize per doc node.
const decoCache = new WeakMap<PMNode, DecorationSet>();

function buildDecorations(doc: PMNode, editor: Editor): DecorationSet {
  const cached = decoCache.get(doc);
  if (cached) return cached;
  const decos: Decoration[] = [];
  doc.descendants((node, pos) => {
    if (node.type.name !== "table") return true;
    decos.push(...gripDecorations(node, pos, editor));
    return false; // we walk the table's rows ourselves
  });
  const set = DecorationSet.create(doc, decos);
  decoCache.set(doc, set);
  return set;
}

// --- drag targets -----------------------------------------------------------

function locateTarget(
  view: EditorView,
  event: DragEvent,
  kind: DragKind,
): { tablePos: number; index: number } | null {
  const el = event.target as HTMLElement | null;
  if (!el?.closest) return null;
  const tableEl = el.closest("table");
  if (!tableEl) return null;
  const table = findTable(view.state.doc.resolve(view.posAtDOM(tableEl, 0)));
  if (!table) return null;

  // The kind comes in as a parameter: the drop handler clears dragSession
  // before resolving its target, so branching on the module global there
  // would send row drops down the column path (cellIndex of the hover cell).
  if (kind === "row") {
    const tr = el.closest("tr");
    if (!tr) return null;
    const index = Array.from(tableEl.querySelectorAll("tr")).indexOf(tr);
    return index < 0 ? null : { tablePos: table.pos, index };
  }
  const cell = el.closest("td,th") as HTMLTableCellElement | null;
  if (!cell) return null;
  return { tablePos: table.pos, index: cell.cellIndex };
}

function runMove(view: EditorView, session: DragSession, targetIndex: number): void {
  // moveTableRow/moveTableColumn resolve rows/columns through tr.selection,
  // so park a selection inside this table first. The park must be its own
  // dispatch: building a side state with view.state.apply(tr) also runs the
  // table plugins' appendTransaction there (column-resize / table fixes),
  // yielding a doc the view doesn't share — dispatching the move built on it
  // against the view then throws "Applying a mismatched transaction". Two
  // dispatches, each built from the state it is applied to.
  const anchor = session.tablePos + 2; // inside the table's first cell
  view.dispatch(
    view.state.tr.setSelection(
      TextSelection.near(view.state.doc.resolve(anchor)),
    ),
  );
  const cmd =
    session.kind === "row"
      ? moveTableRow({ from: session.index, to: targetIndex, pos: anchor })
      : moveTableColumn({ from: session.index, to: targetIndex, pos: anchor });
  cmd(view.state, (tr) => view.dispatch(tr.scrollIntoView()));
}

// --- menu/keyboard moves ----------------------------------------------------
// HTML5 drag never fires on touch, so the Table menu offers the same moves
// one step at a time (EditorToolbar wires these up).

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

// --- extension --------------------------------------------------------------

export const TableDrag = Extension.create({
  name: "noteTableDrag",

  addProseMirrorPlugins() {
    const editor = this.editor;
    return [
      new Plugin({
        key: dragKey,
        state: {
          // Build from the initial doc too — the editor mounts with content
          // and no transaction may follow, and grips must exist before any
          // edit (makeGrip only touches editor.view at drag time, so this is
          // safe to run before the view exists).
          init: (_, state) => buildDecorations(state.doc, editor),
          apply: (tr, value) =>
            tr.docChanged ? buildDecorations(tr.doc, editor) : value,
        },
        props: {
          decorations: (state) => dragKey.getState(state),
          handleDOMEvents: {
            dragover: (view, event) => {
              if (!dragSession) return false;
              const target = locateTarget(view, event, dragSession.kind);
              if (!target || target.tablePos !== dragSession.tablePos) {
                clearIndicator();
                return false;
              }
              event.preventDefault();
              if (event.dataTransfer) {
                event.dataTransfer.dropEffect = "move";
              }
              showIndicator(view, dragSession, target.index);
              return true;
            },
            drop: (view, event) => {
              if (!dragSession) return false;
              event.preventDefault();
              const session = dragSession;
              dragSession = null;
              const target = locateTarget(view, event, session.kind);
              clearIndicator();
              if (
                target &&
                target.tablePos === session.tablePos &&
                target.index !== session.index
              ) {
                runMove(view, session, target.index);
              }
              return true;
            },
            dragend: () => {
              dragSession = null;
              clearIndicator();
              return false;
            },
          },
        },
      }),
    ];
  },
});
