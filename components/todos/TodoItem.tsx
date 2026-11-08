"use client";

import { Check, Lock } from "lucide-react";
import { cn, formatDDMMYY } from "@/lib/utils";
import { isBlocked } from "@/lib/local/graph";
import { toggleTodo } from "@/lib/local/mutations";
import type { TodoRecord } from "@/lib/local/types";

/**
 * The body of one todo row: a checkbox plus the text with read-only markers
 * (priority tag, date, lock). Tapping the text opens the full editor
 * (TodoEditDialog, via onEdit) — there are no per-row option toggles, so
 * every row stays one clean line. Both inline actions (toggle done, open
 * editor) are local and instant.
 *
 * The tree renders this inside its own plain <li> (TodoItem below); the list
 * views wrap it in a sortable <li> with a drag grip (SortableTodoItem in
 * TodoList).
 */
export function TodoItemContent({
  todo,
  byId,
  today,
  onEdit,
}: {
  todo: TodoRecord;
  byId: Map<string, TodoRecord>;
  today: string;
  onEdit: (id: string) => void;
}) {
  const blocked = isBlocked(todo, byId);
  const overdue = !!todo.date && todo.date < today && !todo.completed;

  return (
    <div className="flex min-w-0 flex-1 items-start gap-2">
      <button
        onClick={() => void toggleTodo(todo.id)}
        aria-label={todo.completed ? "Mark not done" : "Mark done"}
        className={cn(
          "mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded border transition-colors",
          todo.completed
            ? "border-[var(--color-check)] bg-[var(--color-check)] text-white"
            : "border-[var(--border)] hover:border-[var(--color-check)]",
        )}
      >
        {todo.completed && <Check className="h-3.5 w-3.5" />}
      </button>

      <button
        onClick={() => onEdit(todo.id)}
        title="Edit todo"
        className="flex min-w-0 flex-1 items-start gap-2 rounded text-left text-sm"
      >
        <span
          className={cn(
            "min-w-0 flex-1 whitespace-pre-wrap break-words",
            todo.completed && "text-[var(--muted)] line-through",
          )}
        >
          {todo.text || "(untitled)"}
        </span>
        <span
          className={cn(
            "mt-0.5 flex shrink-0 items-center gap-1.5 text-xs text-[var(--muted)]",
            todo.completed && "opacity-50",
          )}
        >
          {todo.priority === "external" && (
            <span className="rounded bg-[var(--color-exempt-soft)] px-1.5 py-0.5 font-medium text-[var(--color-exempt)]">
              External
            </span>
          )}
          {todo.priority === "high" && (
            <span className="rounded bg-[var(--color-nocheck-soft)] px-1.5 py-0.5 font-medium text-[var(--color-nocheck)]">
              High
            </span>
          )}
          {todo.priority === "low" && (
            <span className="rounded bg-black/5 px-1.5 py-0.5 font-medium">Low</span>
          )}
          {blocked && (
            <Lock className="h-3.5 w-3.5" aria-label="Blocked" />
          )}
          {todo.date && (
            <span
              className={cn(
                "rounded px-1.5 py-0.5 tabular-nums",
                overdue &&
                  "bg-[var(--color-nocheck-soft)] font-medium text-[var(--color-nocheck)]",
              )}
            >
              {formatDDMMYY(todo.date)}
            </span>
          )}
        </span>
      </button>
    </div>
  );
}

/** Plain (non-sortable) row, used by the dependency tree. */
export function TodoItem(props: {
  todo: TodoRecord;
  byId: Map<string, TodoRecord>;
  today: string;
  onEdit: (id: string) => void;
}) {
  return (
    <li className="flex items-start gap-2 py-1.5">
      <TodoItemContent {...props} />
    </li>
  );
}
