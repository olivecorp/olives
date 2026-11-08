import { getDb } from "./db";
import { newId, nowMs } from "./id";
import { wouldCreateCycle } from "./graph";
import { schedulePush } from "./sync";
import type {
  EventRecord,
  FolderRecord,
  NoteRecord,
  TableName,
  TodoRecord,
} from "./types";

/**
 * The write API for the productivity sections. Every mutation is ONE IndexedDB
 * transaction that writes the record AND its outbox entry atomically, then
 * schedules a background push. Nothing here touches the network — the UI path
 * is always instant.
 */

/** Thrown when a blocker change would create a dependency loop. */
export class CycleError extends Error {
  constructor() {
    super("That blocker would create a loop.");
    this.name = "CycleError";
  }
}

const EMPTY_DOC = { type: "doc", content: [{ type: "paragraph" }] };

/** Queue a record for push (must run inside an open rw transaction). */
async function queue(tx: {
  outbox: OutboxTable;
}, table: TableName, recordId: string): Promise<void> {
  await tx.outbox.put({
    id: `${table}:${recordId}`,
    table,
    recordId,
    queuedAt: nowMs(),
  });
}

// Dexie's Table type for the outbox, named for brevity in helper signatures.
type OutboxTable = ProductivityDbShape["outbox"];
type ProductivityDbShape = ReturnType<typeof getDb>;

// ---------------------------------------------------------------------------
// Todos
// ---------------------------------------------------------------------------

export async function createTodo(
  userId: string,
  input: {
    text: string;
    date?: string | null;
    blockerId?: string | null;
    blockerText?: string | null;
    priority?: "high" | "low" | "external" | null;
  },
): Promise<string> {
  const db = getDb();
  const id = newId();
  const now = nowMs();
  // A brand-new todo has no children, so it can never close a cycle — no
  // cycle check needed here (self-reference is impossible: fresh uuid).
  const record: TodoRecord = {
    id,
    userId,
    text: input.text,
    completed: false,
    completedAt: null,
    date: input.date ?? null,
    blockerId: input.blockerId ?? null,
    blockerText: input.blockerText ?? null,
    priority: input.priority ?? null,
    sortOrder: 0,
    createdAt: now,
    updatedAt: now,
    deleted: false,
  };
  await db.transaction("rw", db.todos, db.outbox, async () => {
    await db.todos.put(record);
    await queue(db, "todos", id);
  });
  schedulePush();
  return id;
}

export type TodoPatch = Partial<
  Pick<
    TodoRecord,
    "text" | "date" | "blockerId" | "blockerText" | "priority" | "sortOrder"
  >
>;

export async function updateTodo(id: string, patch: TodoPatch): Promise<void> {
  const db = getDb();
  await db.transaction("rw", db.todos, db.outbox, async () => {
    const cur = await db.todos.get(id);
    if (!cur || cur.deleted) return;
    // Only a blockerId (a graph edge) can loop; blockerText never can.
    if (patch.blockerId !== undefined && patch.blockerId !== cur.blockerId) {
      const all = await db.todos.where("userId").equals(cur.userId).toArray();
      const byId = new Map(
        all.filter((t) => !t.deleted).map((t) => [t.id, t] as const),
      );
      if (wouldCreateCycle(byId, id, patch.blockerId)) throw new CycleError();
    }
    // A date/priority/blocker change moves the row to a different section,
    // so any manual position (sortOrder) no longer applies — drop it and let
    // the row join its new section by recency. Pure text edits keep position.
    const movesSections =
      patch.date !== undefined ||
      patch.priority !== undefined ||
      patch.blockerId !== undefined ||
      patch.blockerText !== undefined;
    await db.todos.put({
      ...cur,
      ...patch,
      ...(movesSections && patch.sortOrder === undefined ? { sortOrder: 0 } : {}),
      updatedAt: nowMs(),
    });
    await queue(db, "todos", id);
  });
  schedulePush();
}

export async function toggleTodo(id: string): Promise<void> {
  const db = getDb();
  const now = nowMs();
  await db.transaction("rw", db.todos, db.outbox, async () => {
    const cur = await db.todos.get(id);
    if (!cur || cur.deleted) return;
    const completed = !cur.completed;
    await db.todos.put({
      ...cur,
      completed,
      completedAt: completed ? now : null,
      // Completing/uncompleting moves the row between the open and done
      // sections — a manual position doesn't carry over.
      sortOrder: 0,
      updatedAt: now,
    });
    await queue(db, "todos", id);
  });
  schedulePush();
}

/**
 * Soft-delete a todo and, in the same transaction, detach direct children
 * (their blockerId → null) so nothing points at a tombstone.
 */
export async function deleteTodo(id: string): Promise<void> {
  const db = getDb();
  const now = nowMs();
  await db.transaction("rw", db.todos, db.outbox, async () => {
    const cur = await db.todos.get(id);
    if (!cur) return;
    await db.todos.put({ ...cur, deleted: true, updatedAt: now });
    await queue(db, "todos", id);
    const children = await db.todos
      .filter((t) => t.blockerId === id && !t.deleted)
      .toArray();
    for (const c of children) {
      await db.todos.put({ ...c, blockerId: null, updatedAt: now });
      await queue(db, "todos", c.id);
    }
  });
  schedulePush();
}

/**
 * Bulk deleteTodo (the Done section's "Clear"): one transaction tombstones
 * every id, then detaches anything blocked by a deleted todo.
 */
export async function deleteTodos(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const db = getDb();
  const now = nowMs();
  const idSet = new Set(ids);
  await db.transaction("rw", db.todos, db.outbox, async () => {
    for (const cur of await db.todos.bulkGet(ids)) {
      if (!cur) continue;
      await db.todos.put({ ...cur, deleted: true, updatedAt: now });
      await queue(db, "todos", cur.id);
    }
    const children = await db.todos
      .filter(
        (t) => t.blockerId !== null && idSet.has(t.blockerId) && !t.deleted,
      )
      .toArray();
    for (const c of children) {
      await db.todos.put({ ...c, blockerId: null, updatedAt: now });
      await queue(db, "todos", c.id);
    }
  });
  schedulePush();
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

export type EventInput = {
  title: string;
  date: string; // YYYY-MM-DD
  allDay: boolean;
  startMin?: number | null;
  endMin?: number | null;
  location?: string | null;
  description?: string;
};

export async function createEvent(
  userId: string,
  input: EventInput,
): Promise<string> {
  const db = getDb();
  const id = newId();
  const now = nowMs();
  const record: EventRecord = {
    id,
    userId,
    title: input.title,
    description: input.description ?? "",
    date: input.date,
    allDay: input.allDay,
    startMin: input.allDay ? null : (input.startMin ?? null),
    endMin: input.allDay ? null : (input.endMin ?? null),
    location: input.location ?? null,
    source: "manual",
    externalId: null,
    createdAt: now,
    updatedAt: now,
    deleted: false,
  };
  await db.transaction("rw", db.events, db.outbox, async () => {
    await db.events.put(record);
    await queue(db, "events", id);
  });
  schedulePush();
  return id;
}

export type EventPatch = Partial<
  Pick<
    EventRecord,
    "title" | "description" | "date" | "allDay" | "startMin" | "endMin" | "location"
  >
>;

export async function updateEvent(id: string, patch: EventPatch): Promise<void> {
  const db = getDb();
  await db.transaction("rw", db.events, db.outbox, async () => {
    const cur = await db.events.get(id);
    if (!cur || cur.deleted) return;
    await db.events.put({ ...cur, ...patch, updatedAt: nowMs() });
    await queue(db, "events", id);
  });
  schedulePush();
}

export async function deleteEvent(id: string): Promise<void> {
  const db = getDb();
  const now = nowMs();
  await db.transaction("rw", db.events, db.outbox, async () => {
    const cur = await db.events.get(id);
    if (!cur) return;
    await db.events.put({ ...cur, deleted: true, updatedAt: now });
    await queue(db, "events", id);
  });
  schedulePush();
}

/** Copy an event to the next day with a fresh id (the "duplicate" button). */
export async function duplicateEvent(id: string): Promise<string | null> {
  const db = getDb();
  const src = await db.events.get(id);
  if (!src || src.deleted) return null;
  const newId_ = newId();
  const now = nowMs();
  const nextDate = new Date(
    Number(src.date.slice(0, 4)),
    Number(src.date.slice(5, 7)) - 1,
    Number(src.date.slice(8, 10)) + 1,
  );
  const yyyy = nextDate.getFullYear();
  const mm = String(nextDate.getMonth() + 1).padStart(2, "0");
  const dd = String(nextDate.getDate()).padStart(2, "0");
  const copy: EventRecord = {
    ...src,
    id: newId_,
    date: `${yyyy}-${mm}-${dd}`,
    // The duplicate is a user-made event — reset the importer fields. A copy
    // that kept them would collide with the original on
    // events_source_external_idx (same user, source, external id) and fail
    // the entire sync push with a unique violation.
    source: "manual",
    externalId: null,
    createdAt: now,
    updatedAt: now,
    deleted: false,
  };
  await db.transaction("rw", db.events, db.outbox, async () => {
    await db.events.put(copy);
    await queue(db, "events", newId_);
  });
  schedulePush();
  return newId_;
}

// ---------------------------------------------------------------------------
// Folders
// ---------------------------------------------------------------------------

export async function createFolder(
  userId: string,
  name: string,
  parentId: string | null = null,
): Promise<string> {
  const db = getDb();
  const id = newId();
  const now = nowMs();
  const record: FolderRecord = {
    id,
    userId,
    name,
    parentId,
    sortOrder: 0,
    createdAt: now,
    updatedAt: now,
    deleted: false,
  };
  await db.transaction("rw", db.folders, db.outbox, async () => {
    await db.folders.put(record);
    await queue(db, "folders", id);
  });
  schedulePush();
  return id;
}

export async function renameFolder(id: string, name: string): Promise<void> {
  const db = getDb();
  await db.transaction("rw", db.folders, db.outbox, async () => {
    const cur = await db.folders.get(id);
    if (!cur || cur.deleted) return;
    await db.folders.put({ ...cur, name, updatedAt: nowMs() });
    await queue(db, "folders", id);
  });
  schedulePush();
}

export type FolderPatch = Partial<
  Pick<FolderRecord, "name" | "sortOrder">
>;

export async function updateFolder(id: string, patch: FolderPatch): Promise<void> {
  const db = getDb();
  await db.transaction("rw", db.folders, db.outbox, async () => {
    const cur = await db.folders.get(id);
    if (!cur || cur.deleted) return;
    await db.folders.put({ ...cur, ...patch, updatedAt: nowMs() });
    await queue(db, "folders", id);
  });
  schedulePush();
}

/**
 * Soft-delete a folder in one transaction: its notes become unfiled and its
 * subfolders move up to the deleted folder's parent — nothing is lost.
 */
export async function deleteFolder(id: string): Promise<void> {
  const db = getDb();
  const now = nowMs();
  await db.transaction("rw", db.folders, db.notes, db.outbox, async () => {
    const cur = await db.folders.get(id);
    if (!cur) return;
    await db.folders.put({ ...cur, deleted: true, updatedAt: now });
    await queue(db, "folders", id);
    const children = await db.folders
      .filter((f) => f.parentId === id && !f.deleted)
      .toArray();
    for (const c of children) {
      await db.folders.put({ ...c, parentId: cur.parentId, updatedAt: now });
      await queue(db, "folders", c.id);
    }
    const notes = await db.notes
      .filter((n) => n.folderId === id && !n.deleted)
      .toArray();
    for (const n of notes) {
      // Unfiled is a new section — drop any manual position from the folder.
      await db.notes.put({ ...n, folderId: null, sortOrder: 0, updatedAt: now });
      await queue(db, "notes", n.id);
    }
  });
  schedulePush();
}

// ---------------------------------------------------------------------------
// Notes
// ---------------------------------------------------------------------------

export async function createNote(
  userId: string,
  folderId: string | null = null,
): Promise<string> {
  const db = getDb();
  const id = newId();
  const now = nowMs();
  const record: NoteRecord = {
    id,
    userId,
    folderId,
    title: "",
    content: EMPTY_DOC,
    date: null,
    sortOrder: 0,
    createdAt: now,
    updatedAt: now,
    deleted: false,
  };
  await db.transaction("rw", db.notes, db.outbox, async () => {
    await db.notes.put(record);
    await queue(db, "notes", id);
  });
  schedulePush();
  return id;
}

export type NotePatch = Partial<
  Pick<NoteRecord, "title" | "content" | "folderId" | "date" | "sortOrder">
>;

export async function updateNote(id: string, patch: NotePatch): Promise<void> {
  const db = getDb();
  await db.transaction("rw", db.notes, db.outbox, async () => {
    const cur = await db.notes.get(id);
    if (!cur || cur.deleted) return;
    // A folder move changes which section the note belongs to, so any manual
    // position no longer applies — drop it (title/content/date edits and
    // drags within the folder keep it).
    const movesSections = patch.folderId !== undefined;
    await db.notes.put({
      ...cur,
      ...patch,
      ...(movesSections && patch.sortOrder === undefined ? { sortOrder: 0 } : {}),
      updatedAt: nowMs(),
    });
    await queue(db, "notes", id);
  });
  schedulePush();
}

export async function deleteNote(id: string): Promise<void> {
  const db = getDb();
  const now = nowMs();
  await db.transaction("rw", db.notes, db.outbox, async () => {
    const cur = await db.notes.get(id);
    if (!cur) return;
    await db.notes.put({ ...cur, deleted: true, updatedAt: now });
    await queue(db, "notes", id);
  });
  schedulePush();
}

/**
 * Copy a note with a fresh id — same folder, date, and content, title gains
 * a " (copy)" suffix (re-duplicating a copy doesn't stack suffixes). The copy
 * is never placed (sortOrder 0): it surfaces at the top of its section by
 * recency instead of fighting the original for its manual slot.
 */
export async function duplicateNote(id: string): Promise<string | null> {
  const db = getDb();
  const src = await db.notes.get(id);
  if (!src || src.deleted) return null;
  const copyId = newId();
  const now = nowMs();
  const copy: NoteRecord = {
    ...src,
    id: copyId,
    title: src.title ? `${src.title.replace(/ \(copy\)$/, "")} (copy)` : "",
    sortOrder: 0,
    createdAt: now,
    updatedAt: now,
    deleted: false,
  };
  await db.transaction("rw", db.notes, db.outbox, async () => {
    await db.notes.put(copy);
    await queue(db, "notes", copyId);
  });
  schedulePush();
  return copyId;
}
