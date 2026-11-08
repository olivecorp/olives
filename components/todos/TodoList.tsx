"use client";

import { GripVertical } from "lucide-react";
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
import { cn, toISODate } from "@/lib/utils";
import { isBlocked } from "@/lib/local/graph";
import { deleteTodos, updateTodo } from "@/lib/local/mutations";
import type { TodoRecord } from "@/lib/local/types";
import { TodoItemContent } from "./TodoItem";

export type ListView = "current" | "dated" | "blocked" | "low";

/**
 * The four tab views. Every rendered list is one section:
 *  - Current: the working set — unblocked todos that are undated, past due,
 *    or due within a week, bucketed External (API-added, pinned above
 *    everything) / High priority / Overdue / Today / Tomorrow / Next 7
 *    days / No date.
 *  - Dated: everything dated today or later (past-due is Current-only, in
 *    its Overdue bucket).
 *  - Blocked: everything locked by a live blocker.
 *  - Low: the parking lot — every low-priority todo in one flat list. Low
 *    items are excluded from the other three views entirely.
 * Each view ends with its Done section.
 *
 * Within a section, rows that were never dragged order by last modified
 * (newest first); dragging a grip renumbers the whole section 1..n, pinning
 * it in the arranged order. Rows that later move into the section (new, or
 * re-dated/re-prioritized/unblocked — those edits reset sortOrder) surface
 * at the top by recency until you drag them into place.
 */
export function TodoList({
  todos,
  byId,
  variant,
  today,
  weekOut,
  onEdit,
}: {
  todos: TodoRecord[];
  byId: Map<string, TodoRecord>;
  variant: ListView;
  today: string;
  weekOut: string;
  onEdit: (id: string) => void;
}) {
  const tomorrow = toISODate(new Date(Date.now() + 24 * 60 * 60 * 1000));

  const inView = (t: TodoRecord) =>
    variant === "current"
      ? !isBlocked(t, byId) && (!t.date || t.date <= weekOut) && t.priority !== "low"
      : variant === "dated"
        ? // Open past-due todos live in Current's Overdue bucket only; done
          // ones stay (a completed todo is never "overdue").
          !!t.date && (t.completed || t.date >= today) && t.priority !== "low"
        : variant === "blocked"
          ? isBlocked(t, byId) && t.priority !== "low"
          : t.priority === "low";

  const open = todos.filter((t) => !t.completed && inView(t));
  const done = todos.filter((t) => t.completed && inView(t));
  // External and High are pinned in their own buckets (external above
  // high); low is out of this view entirely, so everything else keeps the
  // date buckets.
  const plain = open.filter(
    (t) => t.priority !== "high" && t.priority !== "external",
  );

  const sections: { key: string; label: string | null; items: TodoRecord[] }[] = (
    variant === "current"
      ? [
          {
            key: "external",
            label: "External",
            items: open.filter((t) => t.priority === "external"),
          },
          {
            key: "high",
            label: "High priority",
            items: open.filter((t) => t.priority === "high"),
          },
          {
            key: "overdue",
            label: "Overdue",
            items: plain.filter((t) => t.date && t.date < today),
          },
          { key: "today", label: "Today", items: plain.filter((t) => t.date === today) },
          {
            key: "tomorrow",
            label: "Tomorrow",
            items: plain.filter((t) => t.date === tomorrow),
          },
          {
            key: "week",
            label: "Next 7 days",
            items: plain.filter((t) => t.date && t.date > tomorrow && t.date <= weekOut),
          },
          { key: "nodate", label: "No date", items: plain.filter((t) => !t.date) },
          { key: "done", label: `Done · ${done.length}`, items: done },
        ]
      : [
          { key: "open", label: null, items: open },
          { key: "done", label: `Done · ${done.length}`, items: done },
        ]
  ).filter((s) => s.items.length > 0);

  const sensors = useSensors(
    // A little travel before the drag engages, so a sloppy grip-tap doesn't
    // swallow the tap. Dragging is grip-only; the row itself stays tappable.
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function handleDragEnd({ active, over }: DragEndEvent) {
    if (!over || active.id === over.id) return;
    for (const s of sections) {
      const from = s.items.findIndex((t) => t.id === active.id);
      if (from === -1) continue;
      const to = s.items.findIndex((t) => t.id === over.id);
      if (to === -1) continue; // dropped over another section — not a reorder
      // Renumber the whole section 1..n: any drag makes it fully manual, so
      // what you arranged is exactly what you see. Rows whose number didn't
      // change skip the write (and the sync round-trip).
      arrayMove(s.items, from, to).forEach((t, i) => {
        if (t.sortOrder !== i + 1) void updateTodo(t.id, { sortOrder: i + 1 });
      });
      return;
    }
  }

  const emptyLabel =
    variant === "current"
      ? "Nothing current — everything is blocked, low priority, dated beyond a week, or done."
      : variant === "dated"
        ? "Nothing dated today or later — past-due lives in Current."
        : variant === "blocked"
          ? "Nothing blocked."
          : "No low-priority todos.";

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={handleDragEnd}
    >
      <div className="flex flex-col gap-6">
        {sections.map((s) => (
          <section key={s.key}>
            {s.key === "done" ? (
              <div className="mb-1 flex items-center justify-between">
                <h2 className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
                  {s.label}
                </h2>
                <button
                  onClick={() => {
                    if (
                      window.confirm(
                        `Delete all ${s.items.length} completed todos?`,
                      )
                    ) {
                      void deleteTodos(s.items.map((t) => t.id));
                    }
                  }}
                  className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)] transition-colors hover:text-[var(--color-nocheck)]"
                >
                  Clear
                </button>
              </div>
            ) : (
              s.label && (
                <h2 className="mb-1 text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
                  {s.label}
                </h2>
              )
            )}
            <SortableContext
              items={s.items.map((t) => t.id)}
              strategy={verticalListSortingStrategy}
            >
              <ul className="divide-y divide-[var(--border)]">
                {s.items.map((t) => (
                  <SortableTodoItem
                    key={t.id}
                    todo={t}
                    byId={byId}
                    today={today}
                    onEdit={onEdit}
                  />
                ))}
              </ul>
            </SortableContext>
          </section>
        ))}
        {todos.length === 0 && (
          <p className="text-sm text-[var(--muted)]">
            Nothing here yet — tap + Add to create your first todo.
          </p>
        )}
        {todos.length > 0 && open.length === 0 && (
          <p className="text-sm text-[var(--muted)]">{emptyLabel}</p>
        )}
      </div>
    </DndContext>
  );
}

/** A list row with its drag grip, wired into the enclosing SortableContext. */
function SortableTodoItem(props: {
  todo: TodoRecord;
  byId: Map<string, TodoRecord>;
  today: string;
  onEdit: (id: string) => void;
}) {
  const { todo } = props;
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: todo.id });

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        "flex items-start gap-1 py-1.5",
        isDragging && "relative z-20 bg-[var(--card)] shadow-md",
      )}
    >
      <button
        type="button"
        ref={setActivatorNodeRef}
        {...attributes}
        {...listeners}
        aria-label="Reorder todo"
        title="Drag to reorder"
        // touch-none only on the grip — the drag must own the gesture or the
        // page scrolls out from under it. Everywhere else scrolls normally.
        className="mt-0.5 flex h-5 w-4 shrink-0 cursor-grab touch-none items-center justify-center text-[var(--border)] hover:text-[var(--muted)] active:cursor-grabbing"
      >
        <GripVertical className="h-4 w-4" />
      </button>
      <TodoItemContent {...props} />
    </li>
  );
}
