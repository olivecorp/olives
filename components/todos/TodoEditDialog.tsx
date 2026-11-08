"use client";

import { useEffect, useRef, useState } from "react";
import { Trash2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  CycleError,
  createTodo,
  deleteTodo,
  updateTodo,
} from "@/lib/local/mutations";
import type { TodoRecord } from "@/lib/local/types";
import { BlockerPicker, type BlockerSelection } from "./BlockerPicker";

const PRIORITIES = [
  { value: null, label: "None" },
  { value: "high", label: "High" },
  { value: "external", label: "External" },
  { value: "low", label: "Low" },
] as const;

/** Fields of a not-yet-existing todo (create mode holds everything locally —
 *  there's no row to write through to until close()). */
interface Draft {
  date: string;
  priority: "high" | "low" | "external" | null;
  blockerId: string | null;
  blockerText: string | null;
}

/**
 * The full editor for one todo, opened by tapping its row (edit mode) or the
 * header's "+ Add" (create mode). In edit mode the discrete fields (date,
 * priority, blocker) write through the instant they change — house style, no
 * Save button; the text is a draft committed on close (Done, ✕, Escape, or
 * the overlay), like the inline edit it replaces. It lives in TodosClient
 * (which holds the state) so it stays open even when a change moves the todo
 * out of the view it was opened from — set a far date from Current and the
 * sheet keeps the todo in hand.
 */
export function TodoEditDialog({
  userId,
  todo,
  todos,
  onClose,
}: {
  userId: string;
  /** Omitted = create mode: every field edits the draft, and close() creates
   *  the todo in one shot. */
  todo?: TodoRecord;
  todos: TodoRecord[];
  onClose: () => void;
}) {
  const [text, setText] = useState(todo?.text ?? "");
  const [draft, setDraft] = useState<Draft>({
    date: "",
    priority: null,
    blockerId: null,
    blockerText: null,
  });
  const [error, setError] = useState<string | null>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);

  // Auto-grow to the text; only pointer-precise devices get focus + the
  // caret at the end. On a phone the on-screen keyboard would immediately
  // cover half the sheet — there it stays down until the text is tapped.
  useEffect(() => {
    const el = textRef.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${el.scrollHeight}px`;
    if (!window.matchMedia("(pointer: coarse)").matches) {
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
    }
  }, []);

  // Freeze the page behind the sheet. Without this, the keyboard appearing
  // or dismissing scrolls (and snap-restores) the document under the fixed
  // overlay, so the whole sheet looks like it jumps whenever focus moves.
  useEffect(() => {
    const { body } = document;
    const prevOverflow = body.style.overflow;
    const prevPaddingRight = body.style.paddingRight;
    body.style.overflow = "hidden";
    // Desktop: pay for the scrollbar the freeze just removed.
    const scrollbar = window.innerWidth - document.documentElement.clientWidth;
    if (scrollbar > 0) body.style.paddingRight = `${scrollbar}px`;
    return () => {
      body.style.overflow = prevOverflow;
      body.style.paddingRight = prevPaddingRight;
    };
  }, []);

  // No dependency array on purpose: re-bind each render so `close` is fresh.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") close();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const date = todo ? todo.date : draft.date || null;
  const priority = todo ? (todo.priority ?? null) : draft.priority;
  const blocker: BlockerSelection = todo
    ? { blockerId: todo.blockerId, blockerText: todo.blockerText ?? null }
    : { blockerId: draft.blockerId, blockerText: draft.blockerText };

  function setDate(next: string) {
    if (todo) void updateTodo(todo.id, { date: next || null });
    else setDraft((d) => ({ ...d, date: next }));
  }

  function setPriority(next: "high" | "low" | "external" | null) {
    if (todo) void updateTodo(todo.id, { priority: next });
    else setDraft((d) => ({ ...d, priority: next }));
  }

  function changeBlocker(next: BlockerSelection) {
    if (todo) {
      setError(null);
      updateTodo(todo.id, next).catch((e) => {
        if (e instanceof CycleError) setError(e.message);
      });
    } else {
      // A brand-new todo has no children, so no blocker choice can loop.
      setDraft((d) => ({
        ...d,
        blockerId: next.blockerId,
        blockerText: next.blockerText,
      }));
    }
  }

  function close() {
    const trimmed = text.trim(); // outer only — inner newlines are content
    if (todo) {
      if (trimmed && trimmed !== todo.text) void updateTodo(todo.id, { text: trimmed });
    } else if (trimmed) {
      void createTodo(userId, {
        text: trimmed,
        date: draft.date || null,
        priority: draft.priority,
        blockerId: draft.blockerId,
        blockerText: draft.blockerText,
      });
    }
    onClose();
  }

  function remove() {
    if (!todo) return;
    if (window.confirm("Delete this todo? Anything waiting on it will unblock.")) {
      onClose();
      void deleteTodo(todo.id);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-label={todo ? "Edit todo" : "New todo"}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div className="max-h-[90dvh] w-full max-w-lg overflow-y-auto overscroll-contain rounded-t-2xl border border-[var(--border)] bg-[var(--card)] p-4 shadow-xl sm:rounded-2xl">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
            {todo ? "Edit todo" : "New todo"}
          </h2>
          <button
            onClick={close}
            aria-label="Close"
            title="Close"
            className="text-[var(--muted)] hover:text-[var(--color-nocheck)]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <textarea
          ref={textRef}
          value={text}
          rows={1}
          onChange={(e) => {
            setText(e.target.value);
            const el = e.currentTarget;
            el.style.height = "0px";
            el.style.height = `${el.scrollHeight}px`;
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) close();
          }}
          placeholder="Todo text…"
          className="min-h-9 w-full resize-none rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-sm outline-none focus:border-[var(--color-check)]"
        />

        <div className="mt-3 flex flex-col gap-3">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
              Date
            </span>
            <div className="flex items-center gap-0.5">
              <input
                type="date"
                value={date ?? ""}
                onChange={(e) => setDate(e.target.value)}
                title="Date (optional)"
                className="h-8 rounded-lg border border-[var(--border)] bg-[var(--card)] px-2 text-sm text-[var(--muted)]"
              />
              {date && (
                <button
                  onClick={() => setDate("")}
                  aria-label="Clear date"
                  title="Clear date"
                  className="flex h-8 w-7 items-center justify-center text-[var(--muted)] hover:text-[var(--color-nocheck)]"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          </div>

          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
              Priority
            </span>
            <div
              className="flex rounded-lg border border-[var(--border)] p-0.5 text-xs"
              role="radiogroup"
              aria-label="Priority"
            >
              {PRIORITIES.map((p) => {
                const active = priority === p.value;
                return (
                  <button
                    key={p.label}
                    role="radio"
                    aria-checked={active}
                    onClick={() => setPriority(p.value)}
                    className={cn(
                      "rounded-md px-2.5 py-1 transition-colors",
                      active
                        ? p.value === "high"
                          ? "bg-[var(--color-nocheck-soft)] font-semibold text-[var(--color-nocheck)]"
                          : p.value === "external"
                            ? "bg-[var(--color-exempt-soft)] font-semibold text-[var(--color-exempt)]"
                            : "bg-black/5 font-semibold"
                        : "text-[var(--muted)] hover:bg-black/5",
                    )}
                  >
                    {p.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
              Waiting on
            </span>
            <BlockerPicker
              todos={todos}
              selfId={todo?.id}
              value={blocker}
              onChange={changeBlocker}
              className="h-8 w-56 max-w-full rounded-lg border border-[var(--border)] bg-[var(--card)] px-2 text-sm text-[var(--muted)] outline-none focus:border-[var(--color-check)]"
            />
          </div>
          {error && (
            <p className="text-right text-xs text-[var(--color-nocheck)]" role="alert">
              {error}
            </p>
          )}
        </div>

        <div className="mt-4 flex items-center justify-between">
          {todo ? (
            <button
              onClick={remove}
              className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-sm text-[var(--muted)] hover:bg-black/5 hover:text-[var(--color-nocheck)]"
            >
              <Trash2 className="h-4 w-4" />
              Delete
            </button>
          ) : (
            <span /> // keeps the primary button right-aligned
          )}
          <button
            onClick={close}
            disabled={!todo && !text.trim()}
            className="h-9 rounded-lg bg-[var(--color-check)] px-4 text-sm font-semibold text-white transition-opacity disabled:opacity-40"
          >
            {todo ? "Done" : "Add"}
          </button>
        </div>
      </div>
    </div>
  );
}
