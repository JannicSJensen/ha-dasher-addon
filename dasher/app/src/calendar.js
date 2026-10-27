const MAX_DAYS = 45;
const MAX_CALENDARS = 20;
const EVENTS_TTL_MS = 60_000;
const FORECAST_TTL_MS = 15 * 60_000;

/** "2026-10-10" (all-day) or a date-time, from either the REST shape ({date}/{dateTime}) or a plain string. */
function whenOf(value) {
  const raw = value && typeof value === "object" ? (value.dateTime ?? value.date) : value;
  return typeof raw === "string" && raw ? raw : null;
}

export function normalizeEvent(raw, calendar) {
  const start = whenOf(raw?.start);
  const end = whenOf(raw?.end) ?? start;
  if (!start) return null;
  const allDay = !start.includes("T");
  return {
    calendar,
    summary: String(raw.summary ?? "").trim() || "(no title)",
    start,
    end,
    allDay,
    ...(raw.location ? { location: String(raw.location) } : {}),
  };
}

/** What a calendar supports, from its `supported_features` attribute. */
export const CALENDAR_FEATURE = { create: 1, delete: 2, update: 4 };
export const calendarCaps = (features) => ({ create: Boolean(Number(features) & 1), delete: Boolean(Number(features) & 2), update: Boolean(Number(features) & 4) });

/** An event with what is needed to change it: its id, the id of the occurrence of a repeating event, and the text. */
export function normalizeDetailedEvent(raw, calendar) {
  const base = normalizeEvent(raw, calendar);
  if (!base) return null;
  const text = (v, max) => (typeof v === "string" && v ? v.slice(0, max) : undefined);
  return {
    ...base,
    ...(text(raw.uid, 200) ? { uid: text(raw.uid, 200) } : {}),
    ...(text(raw.recurrence_id, 100) ? { recurrence_id: text(raw.recurrence_id, 100) } : {}),
    ...(text(raw.rrule, 200) ? { rrule: text(raw.rrule, 200) } : {}),
    ...(text(raw.description, 2000) ? { description: text(raw.description, 2000) } : {}),
  };
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DATETIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/;
const FREQ = { daily: "DAILY", weekly: "WEEKLY", monthly: "MONTHLY", yearly: "YEARLY" };
const badRequest = (message) => Object.assign(new Error(message), { status: 400 });
const nextDay = (date) => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
};

/**
 * The event fields for Home Assistant (`calendar/event/create` and `update`) from what a tablet sends:
 * { summary, all_day, start, end, location, description, repeat }. An all-day event ends on its last day (Home
 * Assistant wants the day after); timed events are local times without a zone, which Home Assistant reads as its own.
 */
export function buildEventInput(input) {
  const summary = String(input?.summary ?? "").replace(/\s+/g, " ").trim().slice(0, 120);
  if (!summary) throw badRequest("The event needs a title.");
  const event = { summary };
  if (input?.all_day) {
    const start = String(input.start ?? "").slice(0, 10);
    const end = String(input.end ?? input.start ?? "").slice(0, 10);
    if (!DATE_RE.test(start) || !DATE_RE.test(end) || end < start) throw badRequest("Choose valid days.");
    event.dtstart = start;
    event.dtend = nextDay(end);
  } else {
    const start = String(input?.start ?? "");
    const end = String(input?.end ?? "");
    if (!DATETIME_RE.test(start) || !DATETIME_RE.test(end)) throw badRequest("Choose valid times.");
    const full = (v) => (v.length === 16 ? `${v}:00` : v);
    if (full(end) <= full(start)) throw badRequest("The event must end after it starts.");
    event.dtstart = full(start);
    event.dtend = full(end);
  }
  const location = String(input?.location ?? "").trim().slice(0, 200);
  const description = String(input?.description ?? "").trim().slice(0, 2000);
  if (location) event.location = location;
  if (description) event.description = description;
  const repeat = input?.repeat;
  if (repeat && repeat !== "none") {
    if (!FREQ[repeat]) throw badRequest("Unknown repeat.");
    event.rrule = `FREQ=${FREQ[repeat]}`;
  }
  return event;
}

/** The part of a forecast date-time that names the day, as Home Assistant reports it. */
export const forecastDay = (datetime) => (typeof datetime === "string" ? datetime.slice(0, 10) : null);

/** Validate the requested window; returns { start, end } as Dates or null. */
export function parseWindow(startText, endText) {
  const start = new Date(startText);
  const end = new Date(endText);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) return null;
  if (end - start > MAX_DAYS * 24 * 3600 * 1000) return null;
  return { start, end };
}

/** Reads calendar events and daily forecasts from Home Assistant (with a short cache). */
export class CalendarService {
  constructor({ ha, logger, now = Date.now }) {
    this.ha = ha;
    this.log = logger;
    this.now = now;
    this.cache = new Map();
  }

  async _cached(key, ttl, load) {
    const hit = this.cache.get(key);
    if (hit && this.now() - hit.at < ttl) return hit.value;
    const value = await load();
    this.cache.set(key, { at: this.now(), value });
    if (this.cache.size > 64) this.cache.delete(this.cache.keys().next().value);
    return value;
  }

  async events(entityIds, { start, end }) {
    const ids = [...new Set(entityIds)].slice(0, MAX_CALENDARS);
    if (!ids.length) return [];
    const key = `events:${ids.join(",")}:${start.toISOString()}:${end.toISOString()}`;
    return this._cached(key, EVENTS_TTL_MS, async () => {
      const response = await this.ha.callServiceWithResponse(
        "calendar",
        "get_events",
        { start_date_time: start.toISOString(), end_date_time: end.toISOString() },
        { entity_id: ids },
      );
      const events = [];
      for (const id of ids) {
        for (const raw of Array.isArray(response?.[id]?.events) ? response[id].events : []) {
          const event = normalizeEvent(raw, id);
          if (event) events.push(event);
        }
      }
      return events;
    });
  }

  /**
   * The events of calendars with the details needed to change them, read through Home Assistant's calendar REST
   * interface (`rest(method, path)`), which names each event (uid) and the occurrence of a repeating one.
   * Calendars that cannot be read are listed in `failed`.
   */
  async detailed(entityIds, { start, end }, rest) {
    const ids = [...new Set(entityIds)].slice(0, MAX_CALENDARS);
    const events = [];
    const failed = [];
    await Promise.all(
      ids.map(async (id) => {
        try {
          const list = await rest("GET", `/api/calendars/${encodeURIComponent(id)}?start=${encodeURIComponent(start.toISOString())}&end=${encodeURIComponent(end.toISOString())}`);
          for (const raw of Array.isArray(list) ? list : []) {
            const event = normalizeDetailedEvent(raw, id);
            if (event) events.push(event);
          }
        } catch (err) {
          this.log.warn(`Calendar ${id}: ${err.message}`);
          failed.push(id);
        }
      }),
    );
    return { events, failed };
  }

  /** Forget what was read, after an event was changed. */
  clear() {
    this.cache.clear();
  }

  /** { "2026-10-11": { temperature, condition } } from the daily forecast; {} when unsupported. */
  async forecast(entityId) {
    return this._cached(`forecast:${entityId}`, FORECAST_TTL_MS, async () => {
      try {
        const response = await this.ha.callServiceWithResponse("weather", "get_forecasts", { type: "daily" }, { entity_id: entityId });
        const days = {};
        for (const item of Array.isArray(response?.[entityId]?.forecast) ? response[entityId].forecast : []) {
          const day = forecastDay(item.datetime);
          if (day && !(day in days)) days[day] = { temperature: item.temperature ?? null, condition: item.condition ?? null };
        }
        return days;
      } catch (err) {
        this.log.warn(`Calendar: no daily forecast from ${entityId}: ${err.message}`);
        return {};
      }
    });
  }
}

/**
 * Which calendars and weather entities the calendar tiles of a config may read.
 * A tile without `entities` (or with `entities: all`) reads every calendar Home Assistant has.
 */
export function calendarScope(config, knownIds = []) {
  const calendars = new Set();
  const weather = new Set();
  for (const page of Array.isArray(config?.pages) ? config.pages : []) {
    for (const tile of Array.isArray(page?.tiles) ? page.tiles : []) {
      if (tile?.type !== "calendar") continue;
      if (Array.isArray(tile.entities) && tile.entities.length) {
        for (const id of tile.entities) if (typeof id === "string" && id.startsWith("calendar.")) calendars.add(id);
      } else {
        for (const id of knownIds) if (id.startsWith("calendar.")) calendars.add(id);
      }
      if (typeof tile.weather_entity === "string" && tile.weather_entity.startsWith("weather.")) weather.add(tile.weather_entity);
    }
  }
  for (const person of Array.isArray(config?.family?.people) ? config.family.people : []) if (typeof person?.calendar === "string") calendars.add(person.calendar);
  return { calendars, weather };
}
