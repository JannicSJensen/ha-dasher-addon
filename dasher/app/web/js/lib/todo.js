// todo.* supported_features
export const TODO = { CREATE: 1, DELETE: 2, UPDATE: 4, MOVE: 8, DUE_DATE: 16, DUE_DATETIME: 32, DESCRIPTION: 64 };

/** What a list can do, from its supported_features (everything when the attribute is missing). */
export function listFeatures(entity) {
  const raw = entity?.attributes?.supported_features;
  const has = (flag) => raw == null || (Number(raw) & flag) !== 0;
  return { create: has(TODO.CREATE), remove: has(TODO.DELETE), update: has(TODO.UPDATE), due: has(TODO.DUE_DATE) || has(TODO.DUE_DATETIME), description: has(TODO.DESCRIPTION) };
}

/** Number of open items: the state of a todo entity. */
export function openCount(entity) {
  const n = Number(entity?.state);
  return entity && entity.state !== "unavailable" && entity.state !== "unknown" && Number.isFinite(n) ? n : null;
}

const dateOnly = (due) => /^\d{4}-\d{2}-\d{2}$/.test(String(due));

/** A due value ("2026-10-17" or a date-time) as { label, overdue }. */
export function describeDue(due, { locale, now = new Date() } = {}) {
  if (!due) return null;
  let date;
  if (dateOnly(due)) {
    const [y, m, d] = due.split("-").map(Number);
    date = new Date(y, m - 1, d);
  } else date = new Date(due);
  if (Number.isNaN(date.getTime())) return null;
  const day = new Intl.DateTimeFormat(locale, { weekday: "short", day: "numeric", month: "short" }).format(date);
  const time = dateOnly(due) ? "" : ` ${new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit" }).format(date)}`;
  const overdue = dateOnly(due) ? date < new Date(now.getFullYear(), now.getMonth(), now.getDate()) : date < now;
  return { label: `${day}${time}`, overdue };
}

/** The value of an <input type="date"> for a due value ("" when none). */
export function dueInputValue(due) {
  if (!due) return "";
  if (dateOnly(due)) return due;
  const date = new Date(due);
  if (Number.isNaN(date.getTime())) return "";
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

/** The service data for saving an edited item: only what changed. `edited` = { summary, description, due } (due: "" clears). */
export function updateData(item, edited, features) {
  const data = { item: item.uid };
  const summary = String(edited.summary ?? "").trim();
  if (summary && summary !== item.summary) data.rename = summary;
  if (features.description && String(edited.description ?? "").trim() !== item.description) data.description = String(edited.description ?? "").trim() || null;
  if (features.due && (edited.due ?? "") !== dueInputValue(item.due)) data.due_date = edited.due || null;
  return Object.keys(data).length > 1 ? data : null;
}
