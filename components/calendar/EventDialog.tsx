"use client";

import { useEffect, useState } from "react";
import { Copy, Trash2 } from "lucide-react";
import {
  createEvent,
  deleteEvent,
  duplicateEvent,
  updateEvent,
} from "@/lib/local/mutations";
import type { EventRecord } from "@/lib/local/types";

/** What the parent opens the dialog with. */
export interface DialogState {
  eventId?: string; // editing an existing event
  date: string; // prefilled day
  startMin?: number | null; // prefilled slot (week-view click)
}

function minToHHMM(min: number | null): string {
  if (min === null || min < 0) return "";
  return `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
}

function hhmmToMin(v: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(v);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

/** Create/edit event overlay: title, date, all-day or start/end, location. */
export function EventDialog({
  state,
  event,
  userId,
  onClose,
}: {
  state: DialogState;
  event: EventRecord | undefined; // resolved when state.eventId is set
  userId: string;
  onClose: () => void;
}) {
  const editing = !!state.eventId;
  const [title, setTitle] = useState(event?.title ?? "");
  const [date, setDate] = useState(event?.date ?? state.date);
  const [allDay, setAllDay] = useState(
    event?.allDay ?? (state.startMin === null || state.startMin === undefined),
  );
  const [start, setStart] = useState(
    minToHHMM(event?.startMin ?? state.startMin ?? null) || "09:00",
  );
  const [end, setEnd] = useState(
    minToHHMM(
      event?.endMin ??
        (state.startMin != null ? state.startMin + 60 : null),
    ) || "10:00",
  );
  const [location, setLocation] = useState(event?.location ?? "");

  // Escape closes.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  function save() {
    const startMin = allDay ? null : hhmmToMin(start);
    let endMin = allDay ? null : hhmmToMin(end);
    if (startMin !== null && (endMin === null || endMin <= startMin)) {
      endMin = startMin + 60;
    }
    if (editing) {
      void updateEvent(state.eventId!, {
        title: title.trim(),
        date,
        allDay,
        startMin,
        endMin,
        location: location.trim() || null,
      });
    } else {
      void createEvent(userId, {
        title: title.trim() || "(untitled event)",
        date,
        allDay,
        startMin,
        endMin,
        location: location.trim() || null,
      });
    }
    onClose(); // instant — the write is local
  }

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/30 p-4"
      onClick={onClose}
    >
      <div
        className="w-[min(28rem,94vw)] rounded-xl border border-[var(--border)] bg-[var(--card)] p-4 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--muted)]">
            {editing ? "Edit event" : "New event"}
          </h2>
          {editing && event && event.source !== "manual" && (
            <span className="rounded bg-[var(--color-exempt-soft)] px-1.5 py-0.5 text-xs font-medium text-[var(--color-exempt)]">
              External · added via API
            </span>
          )}
        </div>
        <div className="flex flex-col gap-2">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Title"
            autoFocus
            className="h-9 rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 text-sm outline-none focus:border-[var(--color-check)]"
          />
          <div className="flex items-center gap-2">
            <input
              type="date"
              value={date}
              onChange={(e) => e.target.value && setDate(e.target.value)}
              className="h-9 flex-1 rounded-lg border border-[var(--border)] bg-[var(--background)] px-2 text-sm"
            />
            <label className="flex h-9 items-center gap-1.5 rounded-lg border border-[var(--border)] px-2 text-sm text-[var(--muted)]">
              <input
                type="checkbox"
                checked={allDay}
                onChange={(e) => setAllDay(e.target.checked)}
              />
              All day
            </label>
          </div>
          {!allDay && (
            <div className="flex items-center gap-2 text-sm">
              <input
                type="time"
                value={start}
                onChange={(e) => setStart(e.target.value)}
                className="h-9 flex-1 rounded-lg border border-[var(--border)] bg-[var(--background)] px-2"
              />
              <span className="text-[var(--muted)]">→</span>
              <input
                type="time"
                value={end}
                onChange={(e) => setEnd(e.target.value)}
                className="h-9 flex-1 rounded-lg border border-[var(--border)] bg-[var(--background)] px-2"
              />
            </div>
          )}
          <input
            value={location ?? ""}
            onChange={(e) => setLocation(e.target.value)}
            placeholder="Location (optional)"
            className="h-9 rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 text-sm outline-none focus:border-[var(--color-check)]"
          />
          <div className="mt-2 flex items-center gap-2">
            <button
              onClick={save}
              className="h-9 flex-1 rounded-lg bg-[var(--color-check)] text-sm font-semibold text-white"
            >
              Save
            </button>
            {editing && (
              <>
                <button
                  onClick={() => {
                    void duplicateEvent(state.eventId!);
                    onClose();
                  }}
                  title="Duplicate to next day"
                  className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-[var(--border)] text-[var(--muted)] hover:bg-black/5"
                >
                  <Copy className="h-4 w-4" />
                </button>
                <button
                  onClick={() => {
                    void deleteEvent(state.eventId!);
                    onClose();
                  }}
                  title="Delete"
                  className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-[var(--border)] text-[var(--muted)] hover:text-[var(--color-nocheck)]"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
