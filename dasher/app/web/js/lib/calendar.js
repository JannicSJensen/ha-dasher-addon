const pad = (n) => String(n).padStart(2, "0");

export const dayKey = (date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

export const startOfDay = (date, offsetDays = 0) => new Date(date.getFullYear(), date.getMonth(), date.getDate() + offsetDays);

/** All-day dates ("2026-10-10") are local calendar days; date-times carry their own offset. */
export function parseWhen(text) {
  if (typeof text !== "string") return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  const date = m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : new Date(text);
  return Number.isNaN(date.getTime()) ? null : date;
}

export const clock = (date) => `${date.getHours()}:${pad(date.getMinutes())}`;

/**
 * Group events by local day for `days` days from `from`, keeping only days that have something to show.
 * Timed events that already ended are dropped; all-day ones stay for the whole day.
 * Each item: { calendar, summary, allDay, multi, timeLabel, endsToday, endsOn }.
 */
export function buildAgenda(events, { from, days, now = new Date() }) {
  const agenda = [];
  for (let i = 0; i < days; i++) {
    const dayStart = startOfDay(from, i);
    const dayEnd = startOfDay(from, i + 1);
    const items = [];
    for (const event of events) {
      const start = parseWhen(event.start);
      let end = parseWhen(event.end) ?? start;
      if (!start) continue;
      if (event.allDay) {
        // The end of an all-day event is exclusive.
        if (!(start < dayEnd && end > dayStart) && !(start >= dayStart && start < dayEnd)) continue;
        const lastDay = startOfDay(end, -1);
        const multi = lastDay > start;
        const endsToday = dayKey(lastDay) === dayKey(dayStart);
        items.push({ calendar: event.calendar, summary: event.summary, allDay: true, multi, order: -1, endsToday, endsOn: lastDay });
        continue;
      }
      if (end < start) end = start;
      const visible = end > start ? start < dayEnd && end > dayStart : start >= dayStart && start < dayEnd;
      if (!visible || end <= now) continue;
      const startsToday = start >= dayStart;
      const endsHere = end <= dayEnd;
      let label;
      if (startsToday && endsHere) label = end > start ? `${clock(start)} - ${clock(end)}` : clock(start);
      else if (startsToday) label = `${clock(start)} →`;
      else if (endsHere) label = `→ ${clock(end)}`;
      else label = null; // runs through the whole day
      items.push({ calendar: event.calendar, summary: event.summary, allDay: label === null, multi: false, timeLabel: label, order: start.getTime(), endsToday: endsHere, endsOn: null });
    }
    if (!items.length) continue;
    items.sort((a, b) => a.order - b.order || a.summary.localeCompare(b.summary));
    agenda.push({ date: dayStart, key: dayKey(dayStart), items });
  }
  return agenda;
}

const WEATHER_ICONS = {
  "clear-night": "weather-night",
  cloudy: "weather-cloudy",
  exceptional: "alert-circle-outline",
  fog: "weather-fog",
  hail: "weather-hail",
  lightning: "weather-lightning",
  "lightning-rainy": "weather-lightning-rainy",
  partlycloudy: "weather-partly-cloudy",
  pouring: "weather-pouring",
  rainy: "weather-rainy",
  snowy: "weather-snowy",
  "snowy-rainy": "weather-snowy-rainy",
  sunny: "weather-sunny",
  windy: "weather-windy",
  "windy-variant": "weather-windy-variant",
};

export const weatherIcon = (condition) => WEATHER_ICONS[condition] ?? "weather-cloudy";

export const CALENDAR_COLORS = ["#38bdf8", "#fb923c", "#a78bfa", "#f472b6", "#4ade80", "#facc15"];

/** Colour for a calendar: the configured list (by position in `entities`) or the default palette. */
export function calendarColor(entityId, ids, colors) {
  const index = Math.max(0, ids.indexOf(entityId));
  const own = Array.isArray(colors) ? colors[index] : null;
  return typeof own === "string" && /^#[0-9a-f]{3,8}$/i.test(own) ? own : CALENDAR_COLORS[index % CALENDAR_COLORS.length];
}
