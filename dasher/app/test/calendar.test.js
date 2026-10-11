import assert from "node:assert/strict";
import { test } from "node:test";
import { CalendarService, calendarScope, forecastDay, normalizeEvent, parseWindow } from "../src/calendar.js";
import { buildAgenda, calendarColor, weatherIcon } from "../web/js/lib/calendar.js";
import { parseConfig } from "../src/config.js";

const silent = { warn() {}, info() {}, debug() {}, error() {} };

test("normalizeEvent accepts the REST and the service response shapes", () => {
  assert.deepEqual(normalizeEvent({ summary: "A", start: { dateTime: "2026-10-12T09:45:00+02:00" }, end: { dateTime: "2026-10-12T16:00:00+02:00" } }, "calendar.x"), {
    calendar: "calendar.x",
    summary: "A",
    start: "2026-10-12T09:45:00+02:00",
    end: "2026-10-12T16:00:00+02:00",
    allDay: false,
  });
  const allDay = normalizeEvent({ summary: "B", start: "2026-10-10", end: "2026-10-12", location: "Home" }, "calendar.x");
  assert.equal(allDay.allDay, true);
  assert.equal(allDay.location, "Home");
  assert.equal(normalizeEvent({ summary: "no start" }, "calendar.x"), null);
});

test("parseWindow rejects bad and oversized windows", () => {
  assert.ok(parseWindow("2026-10-11T00:00:00Z", "2026-10-18T00:00:00Z"));
  assert.equal(parseWindow("nope", "2026-10-18T00:00:00Z"), null);
  assert.equal(parseWindow("2026-10-18T00:00:00Z", "2026-10-11T00:00:00Z"), null);
  assert.equal(parseWindow("2026-01-01T00:00:00Z", "2026-06-01T00:00:00Z"), null);
});

test("forecastDay uses the date part as Home Assistant reports it", () => {
  assert.equal(forecastDay("2026-10-11T00:00:00+02:00"), "2026-10-11");
  assert.equal(forecastDay(null), null);
});

test("calendarScope: explicit lists, 'every calendar' and weather", () => {
  const config = {
    pages: [
      { tiles: [{ type: "calendar", entities: ["calendar.family"], weather_entity: "weather.home" }, { type: "toggle", entity: "light.a" }] },
      { tiles: [{ type: "calendar" }] },
    ],
  };
  const scope = calendarScope(config, ["calendar.family", "calendar.privat", "light.a"]);
  assert.deepEqual([...scope.calendars].sort(), ["calendar.family", "calendar.privat"]);
  assert.deepEqual([...scope.weather], ["weather.home"]);
  const only = calendarScope({ pages: [{ tiles: [{ type: "calendar", entities: ["calendar.family", "light.x"] }] }] }, ["calendar.privat"]);
  assert.deepEqual([...only.calendars], ["calendar.family"]);
  assert.equal(calendarScope({ pages: [{ tiles: [{ type: "toggle" }] }] }, ["calendar.family"]).calendars.size, 0);
});

test("the calendar tile is a known tile type and its entities are collected", () => {
  const { config, errors, entities } = parseConfig(
    "pages:\n  - id: a\n    tiles:\n      - { type: calendar, entities: [calendar.family], weather_entity: weather.home }\n",
  );
  assert.deepEqual(errors, []);
  assert.equal(config.pages[0].tiles[0].type, "calendar");
  assert.deepEqual([...entities].sort(), ["calendar.family", "weather.home"]);
});

test("CalendarService asks for events once per window and caches", async () => {
  const calls = [];
  const ha = {
    async callServiceWithResponse(domain, service, data, target) {
      calls.push({ domain, service, data, target });
      if (domain === "weather") return { "weather.home": { forecast: [{ datetime: "2026-10-11T00:00:00+02:00", temperature: 11, condition: "cloudy" }, { datetime: "2026-10-12T00:00:00+02:00", temperature: 13, condition: "sunny" }] } };
      return { "calendar.family": { events: [{ summary: "Work", start: "2026-10-12T09:45:00+02:00", end: "2026-10-12T16:00:00+02:00" }] }, "calendar.privat": { events: [] } };
    },
  };
  let now = 0;
  const service = new CalendarService({ ha, logger: silent, now: () => now });
  const window = { start: new Date("2026-10-10T22:00:00Z"), end: new Date("2026-10-17T22:00:00Z") };
  const events = await service.events(["calendar.family", "calendar.privat"], window);
  assert.equal(events.length, 1);
  assert.deepEqual(calls[0].target, { entity_id: ["calendar.family", "calendar.privat"] });
  assert.equal(calls[0].data.start_date_time, "2026-10-10T22:00:00.000Z");
  await service.events(["calendar.family", "calendar.privat"], window);
  assert.equal(calls.length, 1);
  now = 61_000;
  await service.events(["calendar.family", "calendar.privat"], window);
  assert.equal(calls.length, 2);
  assert.deepEqual(await service.forecast("weather.home"), {
    "2026-10-11": { temperature: 11, condition: "cloudy" },
    "2026-10-12": { temperature: 13, condition: "sunny" },
  });
});

test("a weather entity without daily forecasts gives no forecast", async () => {
  const ha = { async callServiceWithResponse() { throw new Error("not supported"); } };
  assert.deepEqual(await new CalendarService({ ha, logger: silent }).forecast("weather.x"), {});
});

// ---- agenda ----

const at = (day, h, m = 0) => new Date(2026, 9, day, h, m).toISOString();
const timed = (summary, day, [h1, m1], [h2, m2], calendar = "calendar.family") => ({ calendar, summary, allDay: false, start: at(day, h1, m1), end: at(day, h2, m2) });

test("buildAgenda groups by day, hides finished events and days without events", () => {
  const events = [
    { calendar: "calendar.family", summary: "Weekend away", allDay: true, start: "2026-10-10", end: "2026-10-12" },
    timed("Over", 11, [9, 30], [16, 15]),
    timed("Arbejdstid", 12, [9, 45], [16, 0]),
    timed("Late", 13, [18, 0], [19, 0]),
    timed("Early", 13, [9, 0], [10, 0]),
  ];
  const agenda = buildAgenda(events, { from: new Date(2026, 9, 11), days: 7, now: new Date(2026, 9, 11, 16, 44) });
  assert.deepEqual(agenda.map((d) => d.key), ["2026-10-11", "2026-10-12", "2026-10-13"]);
  assert.deepEqual(agenda[0].items.map((i) => i.summary), ["Weekend away"]);
  assert.equal(agenda[0].items[0].multi, true);
  assert.equal(agenda[0].items[0].endsToday, true);
  assert.equal(agenda[1].items[0].timeLabel, "9:45 - 16:00");
  assert.deepEqual(agenda[2].items.map((i) => i.summary), ["Early", "Late"]);
});

test("buildAgenda: a running all-day event carries on, single all-day events do not say 'ends today'", () => {
  const events = [
    { calendar: "c", summary: "Trip", allDay: true, start: "2026-10-11", end: "2026-10-14" },
    { calendar: "c", summary: "Birthday", allDay: true, start: "2026-10-12", end: "2026-10-13" },
  ];
  const agenda = buildAgenda(events, { from: new Date(2026, 9, 11), days: 4, now: new Date(2026, 9, 11, 8) });
  assert.deepEqual(agenda.map((d) => d.items.map((i) => i.summary)), [["Trip"], ["Birthday", "Trip"], ["Trip"]]);
  const trip = agenda[0].items[0];
  assert.equal(trip.endsToday, false);
  assert.equal(trip.endsOn.getDate(), 13);
  assert.equal(agenda[1].items[0].multi, false);
  assert.equal(agenda[2].items[0].endsToday, true);
});

test("buildAgenda: events across midnight", () => {
  const events = [{ calendar: "c", summary: "Night", allDay: false, start: at(11, 22), end: at(12, 2) }];
  const agenda = buildAgenda(events, { from: new Date(2026, 9, 11), days: 2, now: new Date(2026, 9, 11, 8) });
  assert.equal(agenda[0].items[0].timeLabel, "22:00 →");
  assert.equal(agenda[1].items[0].timeLabel, "→ 2:00");
});

test("weatherIcon and calendarColor", () => {
  assert.equal(weatherIcon("partlycloudy"), "weather-partly-cloudy");
  assert.equal(weatherIcon("something-new"), "weather-cloudy");
  const ids = ["calendar.a", "calendar.b"];
  assert.equal(calendarColor("calendar.b", ids, ["#111111", "#abcdef"]), "#abcdef");
  assert.equal(calendarColor("calendar.b", ids, ["#111111", "red; x"]), calendarColor("calendar.b", ids));
  assert.notEqual(calendarColor("calendar.a", ids), calendarColor("calendar.b", ids));
});
