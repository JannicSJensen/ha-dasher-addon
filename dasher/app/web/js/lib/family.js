/** Helpers of the family page and its tile. */

export const initial = (name) => String(name ?? "?").trim().charAt(0).toLocaleUpperCase() || "?";

export const isOverdue = (chore, today) => chore.status === "open" && Boolean(chore.due) && chore.due < today;

/** The chores of a person (id) or of the chore bin (null), by what they need now. */
export function choresFor(chores, personId, today) {
  const mine = chores.filter((c) => (c.assignee ?? null) === personId);
  const sort = (a, b) => Number(isOverdue(b, today)) - Number(isOverdue(a, today)) || (a.due ?? "9999").localeCompare(b.due ?? "9999") || a.title.localeCompare(b.title);
  return {
    open: mine.filter((c) => c.status === "open").sort(sort),
    awaiting: mine.filter((c) => c.status === "awaiting").sort(sort),
    finished: mine.filter((c) => c.status === "done" || c.status === "waiting"),
  };
}

/** How many chores of a person are still to do (open or waiting for approval). */
export const openCount = (chores, personId) => chores.filter((c) => c.assignee === personId && (c.status === "open" || c.status === "awaiting")).length;

/** Whether a person may spend the stars; `missing` is how many are lacking. */
export function afford(balance, reward, allowNegative = false) {
  if (reward.cost == null) return { ok: false, missing: 0 };
  const missing = Math.max(0, reward.cost - balance);
  return { ok: allowNegative || missing === 0, missing };
}

const when = (text) => {
  if (typeof text !== "string") return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  const d = m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : new Date(text);
  return Number.isNaN(d.getTime()) ? null : d;
};

/** From calendar events: what is on now and what comes next today (all-day events count as "now"). */
export function currentEvent(events, now = new Date()) {
  const endOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  let current = null;
  let next = null;
  for (const e of events ?? []) {
    const start = when(e.start);
    const end = when(e.end) ?? start;
    if (!start) continue;
    if (e.allDay) {
      if (start < endOfDay && end > new Date(now.getFullYear(), now.getMonth(), now.getDate())) current ??= { summary: e.summary, allDay: true };
    } else if (start <= now && end > now) current ??= { summary: e.summary, until: end };
    else if (start > now && start < endOfDay && (!next || start < next.start)) next = { summary: e.summary, start };
  }
  return { now: current, next };
}
