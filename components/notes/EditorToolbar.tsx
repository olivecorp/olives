"use client";

import { useEffect, useRef, useState } from "react";
import type { Editor } from "@tiptap/react";
import {
  Bold,
  ChevronDown,
  Heading2,
  Heading3,
  Italic,
  List,
  ListOrdered,
  Quote,
  Redo2,
  Table as TableIcon,
  Undo2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { moveColumnBy, moveRowBy } from "./tableMoves";
import {
  selectColumn,
  selectRow,
  selectWholeTable,
  toggleHeadingSelection,
} from "./tableCommands";

/**
 * Toolbar for the note editor: basic formatting plus table operations in a
 * controlled dropdown (closes on outside click, Escape, or after running a
 * command). All commands are chained with .focus() so typing resumes
 * immediately.
 */
export function EditorToolbar({ editor }: { editor: Editor | null }) {
  const [tableMenuOpen, setTableMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!tableMenuOpen) return;
    const onPointerDown = (e: PointerEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setTableMenuOpen(false);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setTableMenuOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [tableMenuOpen]);

  if (!editor) return null;

  const btn = (
    active: boolean,
    label: string,
    title: string,
    icon: React.ReactNode,
    onClick: () => void,
    disabled = false,
  ) => (
    <button
      type="button"
      title={title}
      aria-label={title}
      disabled={disabled}
      // Keep editor selection: pointerdown covers touch (iOS dismisses the
      // selection when a tap moves focus), mousedown covers mouse.
      onPointerDown={(e) => e.preventDefault()}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className={cn(
        "inline-flex h-8 w-8 items-center justify-center rounded-md transition-colors",
        active
          ? "bg-[var(--color-check-soft)] text-[var(--color-check)]"
          : "text-[var(--muted)] hover:bg-black/5 hover:text-[var(--foreground)]",
        disabled && "opacity-30",
      )}
    >
      {icon}
    </button>
  );

  const chain = () => editor.chain().focus();

  // Menu items close the dropdown after running.
  const act = (run: () => void) => () => {
    run();
    setTableMenuOpen(false);
  };

  return (
    <div className="flex flex-wrap items-center gap-0.5 rounded-lg border border-[var(--border)] bg-[var(--card)] p-1">
      {btn(editor.isActive("bold"), "b", "Bold", <Bold className="h-4 w-4" />, () =>
        chain().toggleBold().run(),
      )}
      {btn(editor.isActive("italic"), "i", "Italic", <Italic className="h-4 w-4" />, () =>
        chain().toggleItalic().run(),
      )}
      {btn(editor.isActive("heading", { level: 2 }), "h2", "Heading 2", <Heading2 className="h-4 w-4" />, () =>
        toggleHeadingSelection(editor, 2),
      )}
      {btn(editor.isActive("heading", { level: 3 }), "h3", "Heading 3", <Heading3 className="h-4 w-4" />, () =>
        toggleHeadingSelection(editor, 3),
      )}
      {btn(editor.isActive("bulletList"), "ul", "Bullet list", <List className="h-4 w-4" />, () =>
        chain().toggleBulletList().run(),
      )}
      {btn(editor.isActive("orderedList"), "ol", "Numbered list", <ListOrdered className="h-4 w-4" />, () =>
        chain().toggleOrderedList().run(),
      )}
      {btn(editor.isActive("blockquote"), "q", "Quote", <Quote className="h-4 w-4" />, () =>
        chain().toggleBlockquote().run(),
      )}

      <span className="mx-1 h-5 w-px bg-[var(--border)]" />

      <div className="relative" ref={menuRef}>
        <button
          type="button"
          aria-haspopup="menu"
          aria-expanded={tableMenuOpen}
          onPointerDown={(e) => e.preventDefault()} // keep editor selection on touch
          onMouseDown={(e) => e.preventDefault()} // keep editor selection
          onClick={() => setTableMenuOpen((v) => !v)}
          className={cn(
            "flex h-8 cursor-pointer items-center gap-1 rounded-md px-2 text-xs font-medium text-[var(--muted)] transition-colors hover:bg-black/5 hover:text-[var(--foreground)]",
            (tableMenuOpen || editor.isActive("table")) &&
              "bg-[var(--color-check-soft)] text-[var(--color-check)]",
          )}
        >
          <TableIcon className="h-4 w-4" />
          Table
          <ChevronDown
            className={cn(
              "h-3 w-3 transition-transform",
              tableMenuOpen && "rotate-180",
            )}
          />
        </button>

        {tableMenuOpen && (
          <div
            role="menu"
            className="absolute left-0 top-9 z-20 flex w-48 flex-col rounded-lg border border-[var(--border)] bg-[var(--card)] p-1 shadow-lg"
          >
            <MenuBtn
              label="Select row"
              disabled={!editor.isActive("table")}
              onClick={act(() => selectRow(editor))}
            />
            <MenuBtn
              label="Select column"
              disabled={!editor.isActive("table")}
              onClick={act(() => selectColumn(editor))}
            />
            <MenuBtn
              label="Select table"
              disabled={!editor.isActive("table")}
              onClick={act(() => selectWholeTable(editor))}
            />
            <span className="my-1 h-px bg-[var(--border)]" />
            <MenuBtn
              label="Insert 3×3 table"
              disabled={editor.isActive("table")}
              onClick={act(() =>
                chain().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(),
              )}
            />
            <MenuBtn
              label="Add row above"
              disabled={!editor.isActive("table")}
              onClick={act(() => chain().addRowBefore().run())}
            />
            <MenuBtn
              label="Add row below"
              disabled={!editor.isActive("table")}
              onClick={act(() => chain().addRowAfter().run())}
            />
            <MenuBtn
              label="Move row up"
              disabled={!editor.isActive("table")}
              onClick={act(() => moveRowBy(editor, -1))}
            />
            <MenuBtn
              label="Move row down"
              disabled={!editor.isActive("table")}
              onClick={act(() => moveRowBy(editor, 1))}
            />
            <MenuBtn
              label="Delete row"
              disabled={!editor.isActive("table")}
              onClick={act(() => chain().deleteRow().run())}
            />
            <MenuBtn
              label="Add column left"
              disabled={!editor.isActive("table")}
              onClick={act(() => chain().addColumnBefore().run())}
            />
            <MenuBtn
              label="Add column right"
              disabled={!editor.isActive("table")}
              onClick={act(() => chain().addColumnAfter().run())}
            />
            <MenuBtn
              label="Move column left"
              disabled={!editor.isActive("table")}
              onClick={act(() => moveColumnBy(editor, -1))}
            />
            <MenuBtn
              label="Move column right"
              disabled={!editor.isActive("table")}
              onClick={act(() => moveColumnBy(editor, 1))}
            />
            <MenuBtn
              label="Delete column"
              disabled={!editor.isActive("table")}
              onClick={act(() => chain().deleteColumn().run())}
            />
            <MenuBtn
              label="Toggle header row"
              disabled={!editor.isActive("table")}
              onClick={act(() => chain().toggleHeaderRow().run())}
            />
            <MenuBtn
              label="Delete table"
              disabled={!editor.isActive("table")}
              onClick={act(() => chain().deleteTable().run())}
            />
          </div>
        )}
      </div>

      <span className="mx-1 h-5 w-px bg-[var(--border)]" />

      {btn(false, "u", "Undo", <Undo2 className="h-4 w-4" />, () =>
        chain().undo().run(),
        !editor.can().undo(),
      )}
      {btn(false, "r", "Redo", <Redo2 className="h-4 w-4" />, () =>
        chain().redo().run(),
        !editor.can().redo(),
      )}
    </div>
  );
}

/** Small labelled row for the table menu. */
function MenuBtn({
  label,
  onClick,
  disabled,
}: {
  label: string;
  onClick: () => void;
  disabled: boolean;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onPointerDown={(e) => e.preventDefault()} // keep editor selection on touch
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "rounded-md px-2 py-1.5 text-left text-sm text-[var(--muted)] hover:bg-black/5 hover:text-[var(--foreground)]",
        disabled && "opacity-30",
      )}
    >
      {label}
    </button>
  );
}
