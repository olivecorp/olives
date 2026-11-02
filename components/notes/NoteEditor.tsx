"use client";

import { useEffect, useRef, useState } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import { StarterKit } from "@tiptap/starter-kit";
import {
  Table,
  TableCell,
  TableHeader,
  TableRow,
} from "@tiptap/extension-table";
import { format, parseISO } from "date-fns";
import { CalendarDays, Copy, Folder, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  deleteNote,
  duplicateNote,
  updateNote,
  type NotePatch,
} from "@/lib/local/mutations";
import type { NoteRecord } from "@/lib/local/types";
import { EditorToolbar } from "./EditorToolbar";
import { pasteGrid } from "./pasteGrid";
import { TableDrag } from "./tableDrag";
import type { FolderTreeNode } from "./folderTree";

const EMPTY_DOC = { type: "doc", content: [{ type: "paragraph" }] };
const AUTOSAVE_MS = 500;

// Editor font-size preference, per device. The -v2 suffix retires the old
// key: values saved before phones defaulted to "sm" kept overriding the new
// default, so the text stayed big no matter what. One clean reset.
const FONT_KEY = "note-font-size-v2";
type FontSize = "sm" | "base" | "lg";
const FONT_SIZES: { key: FontSize; label: string; px: string }[] = [
  { key: "sm", label: "Small text", px: "0.875rem" },
  { key: "base", label: "Medium text", px: "1rem" },
  { key: "lg", label: "Large text", px: "1.125rem" },
];

/**
 * Tiptap rich-text editor with tables. Title and content autosave (debounced
 * 500ms, one write) via the local mutation API — the title edits fully
 * locally so the cursor never jumps, and nothing touches the network on the
 * typing path. The font-size control is a per-device preference.
 *
 * Header stays minimal: title + icon buttons. Folder and date hide behind
 * icons (the full select/date panels were clutter), and the formatting
 * toolbar only appears while the text itself is focused — toolbar buttons
 * all preventDefault on pointerdown, so clicking them never blurs the editor
 * and the toolbar stays up while formatting. Back lives in the navbar.
 */
export function NoteEditor({
  note,
  folderOptions,
  onBack,
  onOpenNote,
}: {
  note: NoteRecord;
  folderOptions: FolderTreeNode[];
  onBack: () => void;
  onOpenNote: (id: string) => void;
}) {
  const noteIdRef = useRef(note.id);
  noteIdRef.current = note.id;

  // The title edits locally (instant cursor) and autosaves with the content.
  // Keyed per note id, so it re-initializes on note switches.
  const [title, setTitle] = useState(note.title);

  const [font, setFont] = useState<FontSize>(() => {
    if (typeof window === "undefined") return "base";
    const v = window.localStorage.getItem(FONT_KEY);
    if (v === "sm" || v === "base" || v === "lg") return v;
    // First visit on this device: phones start one step smaller — the base
    // size matches the rest of the app's text-sm UI and reads far better on
    // a narrow screen. A saved preference always wins.
    return window.matchMedia("(max-width: 767px)").matches ? "sm" : "base";
  });

  function chooseFont(next: FontSize) {
    setFont(next);
    try {
      window.localStorage.setItem(FONT_KEY, next);
    } catch {
      // Private mode etc. — the toggle still works for this visit.
    }
  }

  // Pending autosave patch ({ title } / { content }) captured on edit,
  // flushed by the timer — one IndexedDB write per debounce window.
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // True while the editor text has focus — gates the formatting toolbar.
  const [editingText, setEditingText] = useState(false);
  const pendingPatch = useRef<NotePatch>({});

  function queuePatch(patch: NotePatch) {
    pendingPatch.current = { ...pendingPatch.current, ...patch };
    if (saveTimer.current !== null) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => void flushSave(), AUTOSAVE_MS);
  }

  async function flushSave(): Promise<void> {
    if (saveTimer.current !== null) {
      clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
    const patch = pendingPatch.current;
    if (patch.title === undefined && patch.content === undefined) return;
    pendingPatch.current = {};
    await updateNote(noteIdRef.current, patch);
  }

  const editor = useEditor({
    extensions: [
      StarterKit,
      Table.configure({ resizable: true }),
      TableRow,
      TableCell,
      TableHeader,
      TableDrag,
    ],
    content: (note.content as object) ?? EMPTY_DOC,
    immediatelyRender: false, // required under Next SSR
    // The formatting toolbar shows only while the text is being edited; the
    // toolbar's own buttons keep focus (preventDefault), so it never closes
    // mid-format.
    onFocus: () => setEditingText(true),
    onBlur: () => setEditingText(false),
    editorProps: {
      attributes: {
        class: "prose-note outline-none min-h-[50vh] px-1",
      },
      // CSV / TSV text pastes become table rows (components/notes/pasteGrid).
      // Clipboard HTML that already contains a table is left to PM's parser.
      handlePaste: (view, event) => {
        const dt = event.clipboardData;
        if (!dt) return false;
        if (/<table[\s>]/i.test(dt.getData("text/html"))) return false;
        const text = dt.getData("text/plain");
        if (!text) return false;
        return pasteGrid(view, text);
      },
    },
    onUpdate: ({ editor }) => {
      queuePatch({ content: editor.getJSON() });
    },
  });

  // Switching notes: flush the old note's pending save, then swap content
  // without emitting an update.
  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    void flushSave();
    editor.commands.setContent(
      (note.content as object) ?? EMPTY_DOC,
      { emitUpdate: false },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [note.id, editor]);

  // Flush on unmount too (navigating away mid-debounce).
  useEffect(() => () => void flushSave(), []);

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={title}
          onChange={(e) => {
            setTitle(e.target.value);
            queuePatch({ title: e.target.value });
          }}
          placeholder="Title"
          className="h-9 min-w-[8rem] flex-1 rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 text-sm font-semibold outline-none focus:border-[var(--color-check)]"
        />
        <FolderPicker
          value={note.folderId}
          options={folderOptions}
          onPick={(folderId) => void updateNote(note.id, { folderId })}
        />
        <label
          className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--card)] px-2.5 text-[var(--muted)] transition-colors hover:bg-black/5"
          title={
            note.date
              ? `Date: ${format(parseISO(note.date), "d MMM yyyy")} (shows this note on the calendar)`
              : "Date (shows this note on the calendar)"
          }
        >
          <CalendarDays
            className={cn("h-4 w-4", note.date && "text-[var(--color-check)]")}
          />
          {note.date && (
            <span className="text-xs tabular-nums">
              {format(parseISO(note.date), "d MMM")}
            </span>
          )}
          <input
            type="date"
            value={note.date ?? ""}
            onChange={(e) =>
              void updateNote(note.id, { date: e.target.value || null })
            }
            onClick={(e) => {
              // The label forwards its click here; open the native picker
              // outright (focus alone doesn't open it on desktops).
              try {
                e.currentTarget.showPicker();
              } catch {
                // Unsupported — the label's focus opens it on touch devices.
              }
            }}
            className="sr-only"
          />
        </label>
        <button
          onClick={async () => {
            // Flush the debounce first so the copy includes the latest edits.
            await flushSave();
            const id = await duplicateNote(note.id);
            if (id) onOpenNote(id);
          }}
          title="Duplicate note"
          aria-label="Duplicate note"
          className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-[var(--border)] text-[var(--muted)] hover:bg-black/5"
        >
          <Copy className="h-4 w-4" />
        </button>
        <button
          onClick={() => {
            if (window.confirm("Delete this note?")) void deleteNote(note.id);
            onBack();
          }}
          title="Delete note"
          aria-label="Delete note"
          className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-[var(--border)] text-[var(--muted)] hover:text-[var(--color-nocheck)]"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {editingText && <EditorToolbar editor={editor} />}
        <div
          role="group"
          aria-label="Font size"
          title="Font size"
          className="flex rounded-lg border border-[var(--border)] bg-[var(--card)] p-0.5"
        >
          {FONT_SIZES.map((f, i) => (
            <button
              key={f.key}
              onClick={() => chooseFont(f.key)}
              title={f.label}
              aria-label={f.label}
              className={cn(
                "rounded-md px-2 py-1 font-semibold transition-colors",
                i === 0 && "text-xs",
                i === 1 && "text-sm",
                i === 2 && "text-base",
                font === f.key
                  ? "bg-[var(--color-check-soft)] text-[var(--color-check)]"
                  : "text-[var(--muted)] hover:bg-black/5",
              )}
            >
              A
            </button>
          ))}
        </div>
      </div>

      <div
        className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-3"
        style={{ fontSize: FONT_SIZES.find((f) => f.key === font)?.px }}
      >
        <EditorContent editor={editor} />
      </div>
    </div>
  );
}

/** Folder chooser behind a single icon — the full <select> panel was visual
 *  clutter in the editor header. The icon turns green when filed; the current
 *  folder shows in the tooltip. Dropdown closes on outside click or Escape. */
function FolderPicker({
  value,
  options,
  onPick,
}: {
  value: string | null;
  options: FolderTreeNode[];
  onPick: (folderId: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const current = options.find((o) => o.folder.id === value);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title={`Folder: ${current ? current.folder.name || "(folder)" : "No folder"}`}
        aria-label="Choose folder"
        aria-haspopup="menu"
        aria-expanded={open}
        className={cn(
          "inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--card)] transition-colors hover:bg-black/5",
          value
            ? "text-[var(--color-check)]"
            : "text-[var(--muted)]",
        )}
      >
        <Folder className="h-4 w-4" />
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full z-20 mt-1 flex max-h-64 w-56 flex-col overflow-auto rounded-lg border border-[var(--border)] bg-[var(--card)] p-1 shadow-lg"
        >
          <FolderRow
            label="No folder"
            active={!value}
            onClick={() => {
              onPick(null);
              setOpen(false);
            }}
          />
          {options.map(({ folder, depth }) => (
            <FolderRow
              key={folder.id}
              label={folder.name || "(folder)"}
              indent={depth}
              active={folder.id === value}
              onClick={() => {
                onPick(folder.id);
                setOpen(false);
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/** One folder option inside the FolderPicker menu (indented by depth). */
function FolderRow({
  label,
  active,
  indent = 0,
  onClick,
}: {
  label: string;
  active: boolean;
  indent?: number;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      style={{ paddingLeft: 8 + indent * 14 }}
      className={cn(
        "truncate rounded-md py-1.5 pr-2 text-left text-sm transition-colors",
        active
          ? "bg-[var(--color-check-soft)] font-medium text-[var(--color-check)]"
          : "text-[var(--muted)] hover:bg-black/5 hover:text-[var(--foreground)]",
      )}
    >
      {label}
    </button>
  );
}
