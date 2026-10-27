import assert from "node:assert/strict";
import { test } from "node:test";
import { CalendarService, buildEventInput, calendarCaps, normalizeDetailedEvent } from "../src/calendar.js";
import { parseConfig } from "../src/config.js";

const silent = { warn() {}, info() {}, debug() {}, error() {} };

test("calendar capabilities come from supported_features", () => {
  assert.deepEqual(calendarCaps(7), { create: true, delete: true, update: true });
  assert.deepEqual(calendarCaps(0), { create: false, delete: false, update: false });
  assert.deepEqual(calendarCaps("5"), { create: true, delete: false, update: true });
  assert.deepEqual(calendarCaps(undefined), { create: false, delete: false, update: false });
});

test("detailed events carry what is needed to change them", () => {
  const e = normalizeDetailedEvent({ start: { dateTime: "2026-10-27T09:00:00+01:00" }, end: { dateTime: "2026-10-27T10:00:00+01:00" }, summary: "Tandlæge", uid: "abc", recurrence_id: "20261027", rrule: "FREQ=WEEKLY", description: "Husk kortet", location: "By" }, "calendar.privat");
  assert.deepEqual([e.calendar, e.summary, e.uid, e.recurrence_id, e.rrule, e.description, e.location, e.allDay], ["calendar.privat", "Tandlæge", "abc", "20261027", "FREQ=WEEKLY", "Husk kortet", "By", false]);
  const day = normalizeDetailedEvent({ start: { date: "2026-10-27" }, end: { date: "2026-10-28" }, summary: "Fri" }, "calendar.x");
  assert.deepEqual([day.allDay, day.uid, day.rrule], [true, undefined, undefined]);
  assert.equal(normalizeDetailedEvent({ summary: "no start" }, "calendar.x"), null);
});

test("buildEventInput: timed, all-day (inclusive end), repeat and bad input", () => {
  assert.deepEqual(buildEventInput({ summary: "  Møde  ", all_day: false, start: "2026-10-27T09:00", end: "2026-10-27T10:30", location: " Kontoret ", description: "", repeat: "weekly" }), {
    summary: "Møde", dtstart: "2026-10-27T09:00:00", dtend: "2026-10-27T10:30:00", location: "Kontoret", rrule: "FREQ=WEEKLY",
  });
  assert.deepEqual(buildEventInput({ summary: "Ferie", all_day: true, start: "2026-10-30", end: "2026-10-31" }), { summary: "Ferie", dtstart: "2026-10-30", dtend: "2026-11-01" });
  assert.equal(buildEventInput({ summary: "En dag", all_day: true, start: "2026-12-31" }).dtend, "2027-01-01");
  for (const bad of [{ summary: "" }, { summary: "x", start: "no", end: "no" }, { summary: "x", start: "2026-10-27T10:00", end: "2026-10-27T10:00" }, { summary: "x", all_day: true, start: "2026-10-30", end: "2026-10-29" }, { summary: "x", start: "2026-10-27T09:00", end: "2026-10-27T10:00", repeat: "hourly" }]) {
    assert.throws(() => buildEventInput(bad), (err) => err.status === 400, JSON.stringify(bad));
  }
  assert.equal(buildEventInput({ summary: "x".repeat(300), start: "2026-10-27T09:00", end: "2026-10-27T10:00" }).summary.length, 120);
});

test("CalendarService.detailed reads each calendar through REST and reports the ones that fail", async () => {
  const calls = [];
  const rest = async (method, path) => {
    calls.push([method, decodeURIComponent(path)]);
    if (path.includes("calendar.bad")) throw new Error("HTTP 500");
    return [{ start: { date: "2026-10-27" }, end: { date: "2026-10-28" }, summary: "Fri", uid: "u1" }];
  };
  const service = new CalendarService({ ha: {}, logger: silent });
  const { events, failed } = await service.detailed(["calendar.a", "calendar.bad"], { start: new Date("2026-10-01T00:00:00Z"), end: new Date("2026-11-01T00:00:00Z") }, rest);
  assert.deepEqual([events.length, events[0].uid, events[0].calendar, failed], [1, "u1", "calendar.a", ["calendar.bad"]]);
  assert.match(calls[0][1], /^\/api\/calendars\/calendar\.a\?start=2026-10-01T00:00:00\.000Z&end=2026-11-01T00:00:00\.000Z$/);
});

test("the calendar: section: off by default, switched on by the option, checked", () => {
  const base = "pages:\n  - id: a\n    tiles: []\n";
  assert.equal(parseConfig(base).config.calendar.enabled, false);
  assert.deepEqual([parseConfig(base, { calendarPage: true }).config.calendar.enabled, parseConfig(`${base}calendar: false\n`, { calendarPage: true }).config.calendar.enabled], [true, false]);
  const r = parseConfig(`${base}calendar:\n  title: Kalender\n  week_start: sun\n  view: planner\n  entities: [calendar.family, light.x]\n  names: { calendar.family: Familien }\n  colors: { calendar.family: "#38bdf8", calendar.privat: red }\n`);
  const c = r.config.calendar;
  assert.deepEqual([c.title, c.week_start, c.view, c.entities, c.names, c.colors], ["Kalender", "sun", "planner", ["calendar.family"], { "calendar.family": "Familien" }, { "calendar.family": "#38bdf8" }]);
  assert.equal(r.errors.length, 2);
  assert.ok(r.entities.has("calendar.family"));
});
