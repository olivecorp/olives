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
import { FolderSidebar } from "./FolderSidebar";
import { buildFolderTree } from "./folderTree";

// The Tiptap editor is by far the heaviest chunk in the app (~276 KB); lazy
// it so tapping the Notes tab loads just the list, and the editor bundle
// downloads on first note open instead.
const NoteEditor = dynamic(() => import("./NoteEditor").then((m) => m.NoteEditor));

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
  const [folder, setFolder] = useState<string | "unfiled">("unfiled");
  const paramId = searchParams.get("id");
  const [selectedId, setSelectedId] = useState<string | null>(paramId);
  // Which tree rows are collapsed — held here (not in FolderSidebar) so the
  // header's "New note" can expand the target folder before creating.
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  function toggleCollapsed(id: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
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
  // the note is visible in the tree when the editor closes.
  async function addNote() {
    if (!userId) return;
    const target = folder === "unfiled" ? null : folder;
    setCollapsed((prev) => {
      const next = new Set(prev);
      next.delete(folder);
      return next;
    });
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
              onSelect={setFolder}
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
