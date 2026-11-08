import "server-only";
import { isValidISODate } from "./api-helpers";

/** Fields every todos-add API shares (internal /api/v1/todos and external
 *  /api/v1/external/todos): text, optional date, optional completed flag.
 *  Priority is route-specific — the internal API takes it from the body,
 *  the external API pins "external" — so it stays in the routes. */
export interface TodoFields {
  text: string;
  date: string | null;
  completed: boolean;
}

/** Validate + normalize the shared fields; the error is caller-ready. */
export function parseTodoFields(
  body: Record<string, unknown>,
): { error: string } | { input: TodoFields } {
  const text = typeof body.text === "string" ? body.text.trim() : "";
  if (!text || text.length > 2000) {
    return { error: "text is required (1–2000 characters)." };
  }

  let date: string | null = null;
  if (body.date !== undefined && body.date !== null) {
    if (typeof body.date !== "string" || !isValidISODate(body.date)) {
      return { error: "date must be a valid YYYY-MM-DD." };
    }
    date = body.date;
  }

  let completed = false;
  if (body.completed != null) {
    if (typeof body.completed !== "boolean") {
      return { error: "completed must be a boolean." };
    }
    completed = body.completed;
  }

  return { input: { text, date, completed } };
}
