"use client";

import { useState } from "react";
import {
  ChevronRight,
  FileText,
  Folder,
  FolderPlus,
  GripVertical,
  Inbox,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { cn } from "@/lib/utils";
import {
  createFolder,
  deleteFolder,
  renameFolder,
  updateFolder,
  updateNote,
} from "@/lib/local/mutations";
import type { NoteRecord } from "@/lib/local/types";
import type { FolderTree, FolderTreeNode } from "./folderTree";

/**
 * The notes home page — one tree, no separate list view. Unfiled notes sit
 * at the base level under an expandable "Unfiled" row; expanding a folder
 * reveals its contents inline (subfolders first, then the notes directly
 * inside it). Clicking a folder's name selects it — that's where the
 * header's "New note" button files the note — and opens it if it was
 * collapsed. Row counts roll up the whole subtree. Deleting a folder keeps
 * its notes (they become unfiled) and moves its subfolders up one level.
 *
 * Every section (Unfiled, each folder) is drag-reorderable: never-dragged
 * rows order by last modified (newest first), and one drag renumbers the
 * whole section 1..n, pinning it in the arranged order — the same semantics
 * as the todo lists. Folder rows drag the same way within their sibling
 * group: never-dragged folders order alphabetically on top of the group,
 * and one drag renumbers the siblings 1..n (dropping over a note or a
 * folder from another level does nothing — nesting is built with the +
 * button, not drags).
 */
export function FolderSidebar({
  userId,
  tree,
  notes,
  selected,
  onSelect,
  collapsed,
  onToggleCollapsed,
  selectedNoteId,
  onOpenNote,
}: {
  userId: string;
  tree: FolderTree;
  notes: NoteRecord[];
  selected: string | "unfiled";
  onSelect: (folderId: string | "unfiled") => void;
  collapsed: Set<string>;
  onToggleCollapsed: (id: string) => void;
  selectedNoteId: string | null;
  onOpenNote: (id: string) => void;
}) {
  // null = not adding; "root" or a folder id = where the new folder goes.
  const [addingAt, setAddingAt] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");

  // Direct notes per folder, ordered (what expansion reveals / drags reorder).
  const byFolder = new Map<string, NoteRecord[]>();
  for (const n of notes) {
    if (!n.folderId) continue;
    const list = byFolder.get(n.folderId);
    if (list) list.push(n);
    else byFolder.set(n.folderId, [n]);
  }
  for (const [id, list] of byFolder) byFolder.set(id, orderNotes(list));
  const totals = new Map<string, number>();
  const rollUp = (node: FolderTreeNode): number => {
    let count = (byFolder.get(node.folder.id) ?? []).length;
    for (const child of node.children) count += rollUp(child);
    totals.set(node.folder.id, count);
    return count;
  };
  tree.roots.forEach(rollUp);
  const unfiledNotes = orderNotes(notes.filter((n) => !n.folderId));
  const unfiledOpen = !collapsed.has("unfiled");

  const sensors = useSensors(
    // A little travel before the drag engages, so a sloppy grip-tap doesn't
    // swallow the tap. Dragging is grip-only; the row itself stays tappable.
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function handleDragEnd({ active, over }: DragEndEvent) {
    if (!over || active.id === over.id) return;
    const activeId = String(active.id);

    // Folder grips reorder within the sibling group (same parent), with the
    // same renumber rule as notes: the whole group goes 1..n, pinned in the
    // arranged order, and rows whose number didn't change skip the write.
    const node = tree.byId.get(activeId);
    if (node) {
      const parent = node.folder.parentId
        ? tree.byId.get(node.folder.parentId)
        : null;
      // Whichever list actually holds the node — a folder is in its parent's
      // children, or a root (no parent, unknown parent, or an LWW cycle).
      const siblings =
        parent && parent.children.includes(node) ? parent.children : tree.roots;
      const to = siblings.findIndex((n) => n.folder.id === over.id);
      if (to !== -1) {
        arrayMove(siblings, siblings.indexOf(node), to).forEach((n, i) => {
          if (n.folder.sortOrder !== i + 1)
            void updateFolder(n.folder.id, { sortOrder: i + 1 });
        });
      }
      return;
    }

    const groups = [unfiledNotes, ...byFolder.values()];
    for (const items of groups) {
      const from = items.findIndex((n) => n.id === active.id);
      if (from === -1) continue;
      const to = items.findIndex((n) => n.id === over.id);
      if (to === -1) continue; // dropped over another section — not a reorder
      // Renumber the whole section 1..n: any drag makes it fully manual, so
      // what you arranged is exactly what you see. Rows whose number didn't
      // change skip the write (and the sync round-trip).
      arrayMove(items, from, to).forEach((n, i) => {
        if (n.sortOrder !== i + 1) void updateNote(n.id, { sortOrder: i + 1 });
      });
      return;
    }
  }

  function commitAdd(parentId: string | null) {
    const name = newName.trim();
    setNewName("");
    setAddingAt(null);
    if (name) void createFolder(userId, name, parentId);
  }

  function renderNote(note: NoteRecord, depth: number): React.ReactNode {
    return (
      <SortableNote
        key={note.id}
        note={note}
        depth={depth}
        selectedNoteId={selectedNoteId}
        onOpenNote={onOpenNote}
      />
    );
  }

  function renderNode(node: FolderTreeNode): React.ReactNode {
    const f = node.folder;
    const directNotes = byFolder.get(f.id) ?? [];
    const expandable = node.children.length > 0 || directNotes.length > 0;
    const isCollapsed = collapsed.has(f.id);
    const renaming = renamingId === f.id;
    const depth = node.depth;

    return (
      <div key={f.id}>
        <SortableFolderRow id={f.id} depth={depth}>
          <div className="group relative flex min-w-0 flex-1 items-center gap-0.5">
              <button
                onClick={() => expandable && onToggleCollapsed(f.id)}
              title={
                expandable ? (isCollapsed ? "Expand" : "Collapse") : undefined
              }
              className={cn(
                "flex h-5 w-4 shrink-0 items-center justify-center text-[var(--muted)]",
                !expandable && "invisible",
              )}
            >
              <ChevronRight
                className={cn(
                  "h-3 w-3 transition-transform",
                  expandable && !isCollapsed && "rotate-90",
                )}
              />
            </button>

            {renaming ? (
              <input
                value={renameValue}
                onChange={(e) => setRenameValue(e.target.value)}
                onBlur={() => {
                  const v = renameValue.trim();
                  if (v && v !== f.name) void renameFolder(f.id, v);
                  setRenamingId(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") e.currentTarget.blur();
                  if (e.key === "Escape") setRenamingId(null);
                }}
                autoFocus
                className="my-0.5 h-8 min-w-0 flex-1 rounded border border-[var(--border)] bg-[var(--card)] px-2 text-sm"
              />
            ) : (
              <button
                onClick={() => {
                  onSelect(f.id);
                  if (isCollapsed) onToggleCollapsed(f.id);
                }}
                onDoubleClick={() => {
                  setRenamingId(f.id);
                  setRenameValue(f.name);
                }}
                title={`${f.name || "(folder)"} (double-click to rename)`}
                className={cn(
                  "flex min-w-0 flex-1 items-center gap-1.5 rounded-lg px-2 py-1.5 text-left text-sm transition-colors",
                  selected === f.id
                    ? "bg-[var(--color-check-soft)] font-semibold text-[var(--color-check)]"
                    : "text-[var(--muted)] hover:bg-black/5",
                )}
              >
                <Folder className="h-3.5 w-3.5 shrink-0" />
                <span className="min-w-0 truncate">{f.name || "(folder)"}</span>
                <span className="ml-auto text-xs tabular-nums transition-opacity group-hover:opacity-0">
                  {totals.get(f.id) ?? 0}
                </span>
              </button>
            )}

            {/* Floated over the row's right edge, out of flow: occupying inline
                space here reserved ~60px at the end of every folder row, so
                folder counts lined up left of Unfiled's (which has no actions).
                The count fades out on hover to make room. */}
            {!renaming && (
            <span className="absolute right-0 top-1/2 flex -translate-y-1/2 items-center rounded-md bg-[var(--card)] pl-1 shadow-sm opacity-0 transition-opacity group-hover:opacity-100">
              <button
                onClick={() => {
                  setRenamingId(f.id);
                  setRenameValue(f.name);
                }}
                title="Rename folder"
                className="p-1 text-[var(--muted)] hover:text-[var(--foreground)]"
              >
                <Pencil className="h-3 w-3" />
              </button>
              <button
                onClick={() => {
                  setAddingAt(f.id);
                  setNewName("");
                }}
                title="New subfolder"
                className="p-1 text-[var(--muted)] hover:text-[var(--foreground)]"
              >
                <Plus className="h-3 w-3" />
              </button>
              <button
                onClick={() => {
                  if (
                    window.confirm(
                      `Delete folder "${f.name}"? Its notes become unfiled and its subfolders move up one level.`,
                    )
                  )
                    void deleteFolder(f.id);
                }}
                title="Delete folder"
                className="p-1 text-[var(--muted)] hover:text-[var(--color-nocheck)]"
              >
                <Trash2 className="h-3 w-3" />
              </button>
            </span>
            )}
          </div>
        </SortableFolderRow>

        {addingAt === f.id && (
          <NewFolderInput
            value={newName}
            onChange={setNewName}
            onCommit={() => commitAdd(f.id)}
            onCancel={() => setAddingAt(null)}
            indent={depth * 14 + 36}
          />
        )}

        {expandable && !isCollapsed && (
          <div>
            <SortableContext
              items={node.children.map((c) => c.folder.id)}
              strategy={verticalListSortingStrategy}
            >
              {node.children.map(renderNode)}
            </SortableContext>
            <SortableContext
              items={directNotes.map((n) => n.id)}
              strategy={verticalListSortingStrategy}
            >
              {directNotes.map((n) => renderNote(n, depth + 1))}
            </SortableContext>
          </div>
        )}
      </div>
    );
  }

  return (
    <aside className="flex w-full flex-col gap-0.5 md:w-64">
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleDragEnd}
      >
        <div>
          <div className="flex items-center gap-0.5">
            {/* Folder rows carry a drag grip in this column; an empty spacer
                keeps Unfiled's chevron aligned with the folders' chevrons. */}
            <span className="h-5 w-4 shrink-0" aria-hidden="true" />
            <button
              onClick={() =>
                unfiledNotes.length > 0 && onToggleCollapsed("unfiled")
              }
              title={unfiledOpen ? "Collapse" : "Expand"}
              className={cn(
                "flex h-5 w-4 shrink-0 items-center justify-center text-[var(--muted)]",
                unfiledNotes.length === 0 && "invisible",
              )}
            >
              <ChevronRight
                className={cn(
                  "h-3 w-3 transition-transform",
                  unfiledNotes.length > 0 && unfiledOpen && "rotate-90",
                )}
              />
            </button>
            <button
              onClick={() => {
                onSelect("unfiled");
                if (!unfiledOpen && unfiledNotes.length > 0)
                  onToggleCollapsed("unfiled");
              }}
              className={cn(
                "flex min-w-0 flex-1 items-center gap-1.5 rounded-lg px-2 py-1.5 text-left text-sm transition-colors",
                selected === "unfiled"
                  ? "bg-[var(--color-check-soft)] font-semibold text-[var(--color-check)]"
                  : "text-[var(--muted)] hover:bg-black/5",
              )}
            >
              <Inbox className="h-3.5 w-3.5 shrink-0" />
              <span className="min-w-0 truncate">Unfiled</span>
              <span className="ml-auto text-xs tabular-nums">
                {unfiledNotes.length}
              </span>
            </button>
          </div>
          {unfiledOpen && (
            <SortableContext
              items={unfiledNotes.map((n) => n.id)}
              strategy={verticalListSortingStrategy}
            >
              {unfiledNotes.map((n) => renderNote(n, 0))}
            </SortableContext>
          )}
        </div>

        <SortableContext
          items={tree.roots.map((n) => n.folder.id)}
          strategy={verticalListSortingStrategy}
        >
          {tree.roots.map(renderNode)}
        </SortableContext>

        {addingAt === "root" ? (
          <NewFolderInput
            value={newName}
            onChange={setNewName}
            onCommit={() => commitAdd(null)}
            onCancel={() => setAddingAt(null)}
            indent={0}
          />
        ) : (
          <button
            onClick={() => {
              setAddingAt("root");
              setNewName("");
            }}
            className="mt-1 flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm text-[var(--muted)] hover:bg-black/5"
          >
            <FolderPlus className="h-3.5 w-3.5" />
            New folder
          </button>
        )}
      </DndContext>
    </aside>
  );
}

/** Same section ordering as the todo lists: rows never manually placed
 *  (sortOrder 0) by last modified (newest first), then manually placed rows
 *  in their pinned order. A drag renumbers the whole section, so a section
 *  is either recency-ordered or fully manual. */
function orderNotes(notes: NoteRecord[]): NoteRecord[] {
  return [...notes].sort((a, b) => {
    const pinnedA = a.sortOrder > 0;
    const pinnedB = b.sortOrder > 0;
    if (pinnedA !== pinnedB) return pinnedA ? 1 : -1;
    if (pinnedA && a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
    return b.updatedAt - a.updatedAt;
  });
}

/** A note row with its drag grip, wired into the enclosing SortableContext. */
function SortableNote({
  note,
  depth,
  selectedNoteId,
  onOpenNote,
}: {
  note: NoteRecord;
  depth: number;
  selectedNoteId: string | null;
  onOpenNote: (id: string) => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: note.id });

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        "flex items-center gap-0.5",
        isDragging && "relative z-20 bg-[var(--card)] shadow-md",
      )}
    >
      <button
        type="button"
        ref={setActivatorNodeRef}
        {...attributes}
        {...listeners}
        aria-label="Reorder note"
        title="Drag to reorder"
        style={{ marginLeft: depth * 14 }}
        // touch-none only on the grip — the drag must own the gesture or the
        // page scrolls out from under it. Everywhere else scrolls normally.
        className="flex h-5 w-4 shrink-0 cursor-grab touch-none items-center justify-center text-[var(--border)] hover:text-[var(--muted)] active:cursor-grabbing"
      >
        <GripVertical className="h-3 w-3" />
      </button>
      <button
        onClick={() => onOpenNote(note.id)}
        title={note.title || "(untitled)"}
        className={cn(
          "flex min-w-0 flex-1 items-center gap-1.5 rounded-lg py-1 pr-2 text-left text-[13px] transition-colors",
          selectedNoteId === note.id
            ? "bg-[var(--color-check-soft)] font-medium text-[var(--color-check)]"
            : "text-[var(--muted)] hover:bg-black/5",
        )}
        style={{ paddingLeft: depth * 14 }}
      >
        <FileText className="h-3 w-3 shrink-0 opacity-70" />
        <span className="min-w-0 truncate">{note.title || "(untitled)"}</span>
      </button>
    </div>
  );
}

/** A folder row with its drag grip, wired into the enclosing sibling group's
 *  SortableContext — same shape as SortableNote: the grip is the only drag
 *  activator, the row itself stays tappable. Children are the row's content
 *  (chevron, name, hover actions) so renderNode keeps its closures. */
function SortableFolderRow({
  id,
  depth,
  children,
}: {
  id: string;
  depth: number;
  children: React.ReactNode;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        "flex items-center gap-0.5",
        isDragging && "relative z-20 bg-[var(--card)] shadow-md",
      )}
    >
      <button
        type="button"
        ref={setActivatorNodeRef}
        {...attributes}
        {...listeners}
        aria-label="Reorder folder"
        title="Drag to reorder"
        style={{ marginLeft: depth * 14 }}
        // touch-none only on the grip — the drag must own the gesture or the
        // page scrolls out from under it. Everywhere else scrolls normally.
        className="flex h-5 w-4 shrink-0 cursor-grab touch-none items-center justify-center text-[var(--border)] hover:text-[var(--muted)] active:cursor-grabbing"
      >
        <GripVertical className="h-3 w-3" />
      </button>
      {children}
    </div>
  );
}

function NewFolderInput({
  value,
  onChange,
  onCommit,
  onCancel,
  indent,
}: {
  value: string;
  onChange: (v: string) => void;
  onCommit: () => void;
  onCancel: () => void;
  indent: number;
}) {
  return (
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onBlur={onCommit}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
        if (e.key === "Escape") onCancel();
      }}
      placeholder="Folder name…"
      autoFocus
      style={{ marginLeft: indent }}
      className="mt-1 h-8 rounded-lg border border-[var(--border)] bg-[var(--card)] px-2 text-sm"
    />
  );
}
