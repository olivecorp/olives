"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import dynamic from "next/dynamic";
import { CloudOff, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  useFolders,
  useLocalUserId,
  useNotes,
  useStorageAvailable,
} from "@/lib/local/hooks";
import { createNote } from "@/lib/local/mutations";
import { readPref, writePref } from "@/lib/prefs";
import { FolderSidebar } from "./FolderSidebar";
import { buildFolderTree } from "./folderTree";

// The Tiptap editor is by far the heaviest chunk in the app (~276 KB); lazy
// it so tapping the Notes tab loads just the list, and the editor bundle
// downloads on first note open instead.
const NoteEditor = dynamic(() => import("./NoteEditor").then((m) => m.NoteEditor));

// Sticky per-device notes layout: the folder "New note" files into, and
// which tree sections are collapsed (folder ids + the "unfiled" sentinel).
// The collapsed set is the only JSON pref (a string array); corrupt or
// non-array data reads as "nothing collapsed". Ids of deleted folders ride
// along inertly — collapsed.has(id) just never matches a rendered row.
const FOLDER_KEY = "notes-folder-v1";
const COLLAPSED_KEY = "notes-collapsed-v1";

function readFolder(): string | "unfiled" {
  // Any string is a legal folder id; a since-deleted one browses as Unfiled
  // via the `open` fallback. Never healed by an effect write — folders load
  // async, and that would clobber the saved value on mount.
  return readPref(FOLDER_KEY) || "unfiled";
}

function readCollapsed(): Set<string> {
  const raw = readPref(COLLAPSED_KEY);
  if (!raw) return new Set();
  try {
    const arr: unknown = JSON.parse(raw);
    if (!Array.isArray(arr) || arr.some((x) => typeof x !== "string")) {
      return new Set();
    }
    return new Set(arr as string[]);
  } catch {
    return new Set();
  }
}

/**
 * The notes home is one page: the folder tree. Folders expand to show their
 * notes inline, unfiled notes sit at the base level, and the header's "New
 * note" button files into the selected folder — there is no separate flat
 * list view. md+ shows tree + editor side by side; phones swap between tree
 * and the open note's editor. `?id=` deep-links a note (used by the calendar
 * agenda).
 */
export function NotesClient() {
  const userId = useLocalUserId();
  const notes = useNotes(userId);
  const folders = useFolders(userId);
  const storageOk = useStorageAvailable();
  const searchParams = useSearchParams();

  // Where "New note" files; the tree highlights it.
  const [folder, setFolder] = useState<string | "unfiled">(readFolder);
  const paramId = searchParams.get("id");
  const [selectedId, setSelectedId] = useState<string | null>(paramId);
  // Which tree rows are collapsed — held here (not in FolderSidebar) so the
  // header's "New note" can expand the target folder before creating.
  const [collapsed, setCollapsed] = useState<Set<string>>(readCollapsed);

  function toggleCollapsed(id: string) {
    const next = new Set(collapsed);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setCollapsed(next);
    writePref(COLLAPSED_KEY, JSON.stringify([...next]));
  }

  function chooseFolder(f: string | "unfiled") {
    setFolder(f);
    writePref(FOLDER_KEY, f);
  }

  // Open/close a note and mirror it into the URL (?id=): the navbar's back
  // arrow keys off it, alongside the calendar's deep links. replaceState (not
  // push) keeps history clean — device back still leaves Notes as a whole.
  function selectNote(id: string | null) {
    setSelectedId(id);
    window.history.replaceState(
      null,
      "",
      id ? `/notes?id=${encodeURIComponent(id)}` : "/notes",
    );
  }

  // Router-driven URL changes (the navbar back arrow navigates to /notes)
  // follow the URL. Internal opens use replaceState, so this only fires when
  // the router actually moved — and even then it's usually a no-op sync.
  useEffect(() => {
    setSelectedId(paramId ?? null);
  }, [paramId]);

  // New note goes into the selected folder (or Unfiled), which expands so
  // the note is visible in the tree when the editor closes. Files via `open`
  // (the tree-resolved selection), never the raw `folder` — a remembered
  // folder that was since deleted must not file the note into a phantom
  // folder where the tree never shows it.
  async function addNote() {
    if (!userId) return;
    const target = open === "unfiled" ? null : open;
    const next = new Set(collapsed);
    next.delete(open);
    setCollapsed(next);
    writePref(COLLAPSED_KEY, JSON.stringify([...next]));
    const id = await createNote(userId, target);
    if (id) selectNote(id);
  }

  const tree = useMemo(() => buildFolderTree(folders ?? []), [folders]);
  // A deleted (or mid-sync) selection browses Unfiled until re-picked.
  const open =
    folder !== "unfiled" && tree.byId.has(folder) ? folder : ("unfiled" as const);

  const selected = (notes ?? []).find((n) => n.id === selectedId) ?? null;

  return (
    <div className="mx-auto max-w-6xl">
      <header className="mb-4 flex items-center gap-3">
        <h1 className="text-lg font-semibold tracking-tight">Notes</h1>
        <button
          onClick={() => void addNote()}
          className="ml-auto inline-flex h-8 shrink-0 items-center gap-1 rounded-lg bg-[var(--color-check)] px-2.5 text-xs font-semibold text-white"
        >
          <Plus className="h-3.5 w-3.5" />
          New note
        </button>
      </header>

      {!storageOk && (
        <p className="mb-4 flex items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--card)] p-3 text-sm text-[var(--muted)]">
          <CloudOff className="h-4 w-4 shrink-0" />
          Offline storage is unavailable in this browser (private mode?) —
          changes can&apos;t be saved.
        </p>
      )}

      {notes === undefined || folders === undefined || !userId ? (
        <p className="text-sm text-[var(--muted)]">Loading…</p>
      ) : (
        <div className="flex flex-col gap-4 md:grid md:grid-cols-[16rem_1fr] md:items-start">
          <div className={cn("flex flex-col gap-3", selected && "hidden md:flex")}>
            <FolderSidebar
              userId={userId}
              tree={tree}
              notes={notes}
              selected={open}
              onSelect={chooseFolder}
              collapsed={collapsed}
              onToggleCollapsed={toggleCollapsed}
              selectedNoteId={selectedId}
              onOpenNote={selectNote}
            />
          </div>

          <div className={cn("min-w-0", !selected && "hidden md:block")}>
            {selected ? (
              <NoteEditor
                key={selected.id}
                note={selected}
                folderOptions={tree.order}
                onBack={() => selectNote(null)}
                onOpenNote={selectNote}
              />
            ) : (
              <p className="pt-16 text-center text-sm text-[var(--muted)]">
                Pick a note, or create one.
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
