import assert from "node:assert/strict";
import { test } from "node:test";
import { blankForm, dateTimeValue, eventsOnDay, monthGrid, repeatOf, timeText, toForm, weekDays, weekStartOf } from "../web/js/lib/calview.js";

const d = (y, m, day, h = 0, min = 0) => new Date(y, m - 1, day, h, min);
const key = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

test("weeks start on Monday or Sunday", () => {
  assert.equal(key(weekStartOf(d(2026, 10, 27))), "2026-10-26"); // a Tuesday
  assert.equal(key(weekStartOf(d(2026, 10, 25))), "2026-10-19", "a Sunday belongs to the week before");
  assert.equal(key(weekStartOf(d(2026, 10, 25), "sun")), "2026-10-25");
  assert.deepEqual(weekDays(d(2026, 10, 27)).map(key), ["2026-10-26", "2026-10-27", "2026-10-28", "2026-10-29", "2026-10-30", "2026-10-31", "2026-11-01"]);
});

test("the month grid has six weeks and marks the days of the month", () => {
  const grid = monthGrid(d(2026, 10, 27));
  assert.equal(grid.length, 42);
  assert.equal(key(grid[0].date), "2026-09-28");
  assert.deepEqual([grid[0].inMonth, grid[3].inMonth, grid[33].inMonth, grid[41].inMonth], [false, true, true, false]);
  assert.equal(key(monthGrid(d(2026, 10, 27), "sun")[0].date), "2026-09-27");
});

test("eventsOnDay: multi-day events on each day, all-day first, then by time", () => {
  const events = [
    { summary: "Late", start: d(2026, 10, 27, 18).toISOString(), end: d(2026, 10, 27, 19).toISOString(), allDay: false },
    { summary: "Early", start: d(2026, 10, 27, 8).toISOString(), end: d(2026, 10, 27, 9).toISOString(), allDay: false },
    { summary: "Trip", start: "2026-10-26", end: "2026-10-29", allDay: true },
    { summary: "Other day", start: d(2026, 10, 28, 8).toISOString(), end: d(2026, 10, 28, 9).toISOString(), allDay: false },
    { summary: "Ends at midnight", start: d(2026, 10, 26, 22).toISOString(), end: d(2026, 10, 27, 0).toISOString(), allDay: false },
  ];
  assert.deepEqual(eventsOnDay(events, d(2026, 10, 27)).map((e) => e.summary), ["Trip", "Early", "Late"]);
  assert.deepEqual(eventsOnDay(events, d(2026, 10, 29)).map((e) => e.summary), [], "the end of an all-day event is the day after");
  assert.deepEqual(eventsOnDay(events, d(2026, 10, 26)).map((e) => e.summary), ["Trip", "Ends at midnight"]);
});

test("form values: all-day events end on their last day", () => {
  assert.deepEqual(toForm({ allDay: true, start: "2026-10-30", end: "2026-11-01" }), { all_day: true, start: "2026-10-30", end: "2026-10-31" });
  assert.deepEqual(toForm({ allDay: true, start: "2026-10-30", end: "2026-10-31" }), { all_day: true, start: "2026-10-30", end: "2026-10-30" });
  assert.deepEqual(toForm({ allDay: false, start: d(2026, 10, 27, 9, 5).toISOString(), end: d(2026, 10, 27, 10).toISOString() }), { all_day: false, start: "2026-10-27T09:05", end: "2026-10-27T10:00" });
  assert.deepEqual(blankForm(d(2026, 10, 27), { hour: 13 }), { all_day: false, start: "2026-10-27T13:00", end: "2026-10-27T14:00" });
  assert.deepEqual(blankForm(d(2026, 10, 27), { allDay: true }), { all_day: true, start: "2026-10-27", end: "2026-10-27" });
  assert.equal(dateTimeValue(d(2026, 1, 2, 3, 4)), "2026-01-02T03:04");
});

test("repeat and time text", () => {
  assert.deepEqual([repeatOf(undefined), repeatOf("FREQ=WEEKLY"), repeatOf("RRULE:FREQ=YEARLY"), repeatOf("FREQ=WEEKLY;BYDAY=MO")], ["none", "weekly", "yearly", null]);
  assert.equal(timeText({ allDay: true }, { allDay: "Hele dagen" }), "Hele dagen");
  assert.match(timeText({ allDay: false, start: d(2026, 10, 27, 9).toISOString(), end: d(2026, 10, 27, 10, 30).toISOString() }, { locale: "en" }), /9:00.*–.*10:30/);
});
