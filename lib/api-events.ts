import "server-only";
import { isValidISODate } from "./api-helpers";

/** Fields every events-add API shares (internal /api/v1/events and external
 *  /api/v1/external/events), minus source — the route picks that. */
export interface EventInput {
  title: string;
  description: string;
  date: string;
  allDay: boolean;
  startMin: number | null;
  endMin: number | null;
  location: string | null;
  externalId: string | null;
}

const HH_MM_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
const toMin = (s: string) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3));

/** Validate + normalize the body; every branch returns a caller-ready error. */
export function parseEvent(
  body: Record<string, unknown>,
): { error: string } | { input: EventInput } {
  const title = typeof body.title === "string" ? body.title.trim() : "";
  if (!title || title.length > 500)
    return { error: "title is required (1–500 characters)." };
  if (typeof body.date !== "string" || !isValidISODate(body.date))
    return { error: "date is required and must be a valid YYYY-MM-DD." };

  // description is NOT NULL in the schema — default to "" like the UI does.
  let description = "";
  if (body.description != null) {
    if (typeof body.description !== "string" || body.description.length > 5000)
      return { error: "description must be a string (≤5000 characters)." };
    description = body.description.trim();
  }
  let location: string | null = null;
  if (body.location != null) {
    if (typeof body.location !== "string" || body.location.length > 500)
      return { error: "location must be a string (≤500 characters)." };
    location = body.location.trim();
  }
  let externalId: string | null = null;
  if (body.externalId != null) {
    if (
      typeof body.externalId !== "string" ||
      !body.externalId.trim() ||
      body.externalId.length > 500
    ) {
      return {
        error: "externalId must be a non-empty string (≤500 characters).",
      };
    }
    externalId = body.externalId.trim();
  }
  if (body.allDay != null && typeof body.allDay !== "boolean")
    return { error: "allDay must be a boolean." };

  const hasStart = body.start != null;
  const hasEnd = body.end != null;
  let startMin: number | null = null;
  let endMin: number | null = null;
  if (hasStart) {
    if (typeof body.start !== "string" || !HH_MM_RE.test(body.start))
      return { error: "start must be HH:MM (00:00–23:59)." };
    startMin = toMin(body.start);
  }
  if (hasEnd) {
    if (typeof body.end !== "string" || !HH_MM_RE.test(body.end))
      return { error: "end must be HH:MM (00:00–23:59)." };
    endMin = toMin(body.end);
  }

  // Omitted allDay infers from start's presence: no start → all-day.
  const allDay = body.allDay ?? !hasStart;
  if (allDay && (hasStart || hasEnd))
    return { error: "start/end are not allowed for all-day events." };
  if (!allDay && !hasStart)
    return { error: "start is required for timed events." };
  if (
    hasEnd &&
    startMin !== null &&
    endMin !== null &&
    endMin <= startMin
  ) {
    return {
      error: "end must be after start (events can't cross midnight).",
    };
  }

  return {
    input: {
      title,
      description,
      date: body.date,
      allDay,
      startMin: allDay ? null : startMin,
      endMin: allDay ? null : endMin,
      location,
      externalId,
    },
  };
}
