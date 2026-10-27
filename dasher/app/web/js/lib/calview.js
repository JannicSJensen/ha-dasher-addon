import { dayKey, parseWhen, startOfDay } from "./calendar.js";

/** The first day of the week (Monday, or Sunday with `weekStart: "sun"`) that contains `date`. */
export function weekStartOf(date, weekStart = "mon") {
  const offset = weekStart === "sun" ? date.getDay() : (date.getDay() + 6) % 7;
  return startOfDay(date, -offset);
}

/** Seven days from the start of the week of `date`. */
export const weekDays = (date, weekStart = "mon") => Array.from({ length: 7 }, (_, i) => startOfDay(weekStartOf(date, weekStart), i));

/** The six weeks of the month of `date` as 42 days: [{ date, inMonth }]. */
export function monthGrid(date, weekStart = "mon") {
  const first = new Date(date.getFullYear(), date.getMonth(), 1);
  const from = weekStartOf(first, weekStart);
  return Array.from({ length: 42 }, (_, i) => {
    const d = startOfDay(from, i);
    return { date: d, inMonth: d.getMonth() === date.getMonth() };
  });
}

/** The events that are on a day (multi-day ones on each of their days): all-day first, then by start time. */
export function eventsOnDay(events, day) {
  const start = startOfDay(day);
  const end = startOfDay(day, 1);
  return events
    .map((event) => ({ event, from: parseWhen(event.start), to: parseWhen(event.end) }))
    .filter(({ from, to }) => from && ((from < end && (to ?? from) > start) || (from >= start && from < end)))
    .sort((a, b) => Number(b.event.allDay) - Number(a.event.allDay) || a.from - b.from || a.event.summary.localeCompare(b.event.summary))
    .map(({ event }) => event);
}

const pad = (n) => String(n).padStart(2, "0");
/** A local date-time as a form value: "2026-10-27T09:00". */
export const dateTimeValue = (date) => `${dayKey(date)}T${pad(date.getHours())}:${pad(date.getMinutes())}`;

/** The fields of the editor for an event: an all-day event ends on its last day (the calendar stores the day after). */
export function toForm(event) {
  const from = parseWhen(event.start);
  const to = parseWhen(event.end) ?? from;
  if (event.allDay) return { all_day: true, start: dayKey(from), end: dayKey(startOfDay(to, to > from ? -1 : 0)) };
  return { all_day: false, start: dateTimeValue(from), end: dateTimeValue(to) };
}

/** A new event on a day: all day, or one hour from `hour`. */
export function blankForm(day, { allDay = false, hour = 9 } = {}) {
  if (allDay) return { all_day: true, start: dayKey(day), end: dayKey(day) };
  const start = new Date(day.getFullYear(), day.getMonth(), day.getDate(), hour, 0);
  return { all_day: false, start: dateTimeValue(start), end: dateTimeValue(new Date(start.getTime() + 3600_000)) };
}

/** The repeat of an event as the editor knows it ("none" and the four plain ones), or null for any other rule. */
export function repeatOf(rrule) {
  if (!rrule) return "none";
  const m = /^(?:RRULE:)?FREQ=(DAILY|WEEKLY|MONTHLY|YEARLY)$/.exec(String(rrule));
  return m ? m[1].toLowerCase() : null;
}

/** "9:00 – 10:30", "All day" or "" for the line of an event. */
export function timeText(event, { locale = "da", allDay = "All day" } = {}) {
  if (event.allDay) return allDay;
  const fmt = new Intl.DateTimeFormat(locale, { hour: "numeric", minute: "2-digit" });
  const from = parseWhen(event.start);
  const to = parseWhen(event.end);
  return to && to > from ? `${fmt.format(from)} – ${fmt.format(to)}` : fmt.format(from);
}
