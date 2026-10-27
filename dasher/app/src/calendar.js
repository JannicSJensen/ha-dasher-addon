const MAX_DAYS = 31;
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
