import { Fragment, type Node as PMNode } from "@tiptap/pm/model";
import { TextSelection } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";

/**
 * Paste CSV / TSV text as table content. Spreadsheet and "copy table" from
 * the web usually carries text/html (ProseMirror parses those natively);
 * this covers the plain-text case — CSV files, terminals, plain-text
 * editors: any clipboard with tabs or "rows of commas".
 *
 *   inside a table  → rows inserted after the current row
 *   outside         → a new table, when the grid is at least 2×2
 */

// Beyond this the editor gets sluggish on phones; paste falls back to text.
const MAX_ROWS = 200;
const MAX_COLS = 30;

/**
 * Parse delimiter-separated text into a rectangular grid (rows padded).
 * Handles quoted CSV fields ("" escapes, embedded commas/newlines) and
 * CRLF. Returns null when the text doesn't look like a grid — plain prose
 * containing commas must never be mangled.
 */
export function parseGrid(text: string): string[][] | null {
  const delim = text.includes("\t") ? "\t" : ",";
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        cell += ch;
      }
    } else if (ch === '"' && cell === "") {
      quoted = true;
    } else if (ch === delim) {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      cell = "";
      rows.push(row);
      row = [];
    } else {
      cell += ch;
    }
  }
  row.push(cell);
  rows.push(row);

  // A trailing newline yields one empty row — drop empty trailing rows.
  while (rows.length > 0 && rows[rows.length - 1].every((c) => c.trim() === "")) {
    rows.pop();
  }
  // Same for fully empty leading rows (leading newline).
  while (rows.length > 0 && rows[0].every((c) => c.trim() === "")) {
    rows.shift();
  }
  if (rows.length === 0) return null;

  // Tabs mean spreadsheet/TSV — any rectangular-ish data counts. Comma mode
  // is held to a stricter bar because prose is full of commas: every row
  // must carry the SAME field count (a defining property of real CSV) before
  // the text is read as a grid. Prose line comma-counts vary, so "Hi, all\n
  // quick update" (1 comma, then none) no longer becomes a table.
  const cols = Math.max(...rows.map((r) => r.length));
  if (delim === "\t") {
    if (rows.length < 2 && cols < 2) return null;
  } else {
    if (rows.length < 2 || cols < 2) return null;
    const width = rows[0].length;
    if (rows.some((r) => r.length !== width)) return null;
  }
  if (rows.length > MAX_ROWS || cols > MAX_COLS) return null;

  return rows.map((r) => {
    const out = r.slice(0, MAX_COLS);
    while (out.length < cols) out.push("");
    return out;
  });
}

/** Try to handle a plain-text paste as a table; false = not a grid. */
export function pasteGrid(view: EditorView, text: string): boolean {
  const grid = parseGrid(text);
  if (!grid) return false;

  const schema = view.state.schema;
  const para = (t: string) => {
    const clean = t.replace(/\s*\n\s*/g, " ").trim();
    return schema.nodes.paragraph.createAndFill(
      null,
      clean ? schema.text(clean) : undefined,
    );
  };
  const rowNodes = (grid: string[][], width: number): PMNode[] =>
    grid.map((cells) => {
      const cellNodes: PMNode[] = [];
      for (let i = 0; i < width; i++) {
        cellNodes.push(
          schema.nodes.tableCell.createAndFill(null, para(cells[i] ?? ""))!,
        );
      }
      return schema.nodes.tableRow.createAndFill(null, Fragment.fromArray(cellNodes))!;
    });

  const { $from } = view.state.selection;
  let rowDepth = -1;
  for (let d = $from.depth; d > 0; d--) {
    if ($from.node(d).type.name === "tableRow") {
      rowDepth = d;
      break;
    }
  }

  if (rowDepth > 0) {
    // Inside a table: append the grid as rows right below the cursor's row.
    const width = $from.node(rowDepth).childCount;
    const rows = rowNodes(grid, width);
    const pos = $from.after(rowDepth);
    const tr = view.state.tr.insert(pos, rows);
    tr.setSelection(TextSelection.near(tr.doc.resolve(pos + 2)));
    view.dispatch(tr.scrollIntoView());
    return true;
  }

  // Outside: only auto-create a table for a real 2×2+ grid.
  const width = Math.max(...grid.map((r) => r.length));
  if (grid.length < 2 || width < 2) return false;
  const table = schema.nodes.table.createAndFill(
    null,
    Fragment.fromArray(rowNodes(grid, width)),
  );
  if (!table) return false;

  let tr = view.state.tr.replaceSelectionWith(table);
  const after = tr.selection.to;
  // Paragraph after the table so the cursor can leave it.
  tr = tr.insert(after, schema.nodes.paragraph.create());
  tr = tr.setSelection(TextSelection.create(tr.doc, after + 1));
  view.dispatch(tr.scrollIntoView());
  return true;
}
