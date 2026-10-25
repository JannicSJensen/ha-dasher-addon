import { addDays } from "./meals.js";

export const MARKER = "Dasher madplan";

const pad = (n) => String(n).padStart(2, "0");

/** "18:00" plus minutes -> "19:15" (not past midnight). */
export function addMinutes(time, minutes) {
  const [h, m] = String(time).split(":").map(Number);
  const total = Math.min(23 * 60 + 59, (Number.isFinite(h) ? h : 18) * 60 + (Number.isFinite(m) ? m : 0) + minutes);
  return `${pad(Math.floor(total / 60))}:${pad(total % 60)}`;
}

/** What goes into the calendar for a day, or null when the day has no event. */
export function eventFor(entry, dinnerTime = "18:00") {
  if (!entry || (entry.kind !== "dinner" && entry.kind !== "leftovers")) return null;
  const minutes = entry.minutes > 0 ? entry.minutes : 60;
  const lines = [MARKER, entry.kind === "leftovers" ? "Rester" : "", entry.description, ...entry.ingredients.filter((i) => !i.basic).map((i) => `- ${[i.amount, i.name].filter(Boolean).join(" ")}`)];
  return {
    summary: `${entry.kind === "leftovers" ? "Rester: " : ""}${entry.title}`,
    description: lines.filter(Boolean).join("\n"),
    start: `${entry.date} ${dinnerTime}:00`,
    end: `${entry.date} ${addMinutes(dinnerTime, minutes)}:00`,
  };
}

/** The same event as a signature, to see whether a day changed. */
export const eventSignature = (entry, dinnerTime) => JSON.stringify(eventFor(entry, dinnerTime));

/**
 * Keeps one calendar event per planned dinner in a Home Assistant calendar (Local Calendar, CalDAV, Google ...).
 * Events made by the app carry a marker in their description; only those are ever replaced or removed.
 */
export class MealsCalendar {
  constructor({ ha, logger }) {
    this.ha = ha;
    this.log = logger;
    this.error = null;
    this._chain = Promise.resolve();
  }

  /** Make the calendar show `entry` (or nothing) for `date`. Calls run one after the other. */
  syncDay(calendarId, date, entry, dinnerTime) {
    const run = this._chain.then(() => this._sync(calendarId, date, entry, dinnerTime)).then(
      () => true,
      (err) => {
        this.error = err.message;
        this.log.warn(`Calendar ${calendarId}: ${err.message}`);
        return false;
      },
    );
    this._chain = run;
    return run; // resolves to true when the calendar is up to date
  }

  async _sync(calendarId, date, entry, dinnerTime) {
    const response = await this.ha.callServiceWithResponse(
      "calendar",
      "get_events",
      { start_date_time: `${date} 00:00:00`, end_date_time: `${addDays(date, 1)} 00:00:00` },
      { entity_id: [calendarId] },
    );
    const existing = (response?.[calendarId]?.events ?? []).filter((e) => String(e.description ?? "").startsWith(MARKER));
    const wanted = eventFor(entry, dinnerTime);
    const same = wanted && existing.length === 1 && existing[0].summary === wanted.summary && String(existing[0].description ?? "") === wanted.description;
    if (same) {
      this.error = null;
      return;
    }
    for (const event of existing) {
      await this.ha.request({ type: "calendar/event/delete", entity_id: calendarId, uid: event.uid, ...(event.recurrence_id ? { recurrence_id: event.recurrence_id } : {}) });
    }
    if (wanted) {
      await this.ha.callService("calendar", "create_event", { summary: wanted.summary, description: wanted.description, start_date_time: wanted.start, end_date_time: wanted.end }, [calendarId]);
    }
    this.error = null;
  }
}
