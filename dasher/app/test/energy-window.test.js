import assert from "node:assert/strict";
import { test } from "node:test";
import { energyDate, energyMidnight, energyWindow } from "../src/energy-window.js";

const now = Date.parse("2026-10-31T22:00:00Z");
const window = (date, period = "day", timeZone = "Europe/Copenhagen") => energyWindow({ date, period, timeZone, now });

test("Energy dates use Home Assistant's time zone rather than the server's", () => {
  assert.equal(energyDate(Date.parse("2026-10-31T23:30:00Z"), "Europe/Copenhagen"), "2026-11-01");
  assert.equal(energyDate(Date.parse("2026-10-31T23:30:00Z"), "America/New_York"), "2026-10-31");
  assert.equal(window().date, "2026-10-31");
  assert.equal(energyMidnight("2026-10-31", "Asia/Kolkata").toISOString(), "2026-10-30T18:30:00.000Z");
});

test("Energy days have local-midnight bounds, including 23/25-hour DST days", () => {
  const spring = window("2026-03-29");
  assert.deepEqual([spring.start, spring.end], ["2026-03-28T23:00:00.000Z", "2026-03-29T22:00:00.000Z"]);
  assert.equal((Date.parse(spring.end) - Date.parse(spring.start)) / 3600_000, 23);
  const fall = window("2026-10-25");
  assert.deepEqual([fall.start, fall.end], ["2026-10-24T22:00:00.000Z", "2026-10-25T23:00:00.000Z"]);
  assert.equal((Date.parse(fall.end) - Date.parse(fall.start)) / 3600_000, 25);
});

test("week, month and year requests remain bounded to calendar periods", () => {
  const week = window("2026-10-31", "week");
  assert.deepEqual([week.first, week.last, week.statistic_period], ["2026-10-26", "2026-11-01", "day"]);
  const month = window("2026-02-13", "month");
  assert.deepEqual([month.first, month.last], ["2026-02-01", "2026-02-28"]);
  const leap = window("2024-02-13", "month");
  assert.equal(leap.last, "2024-02-29");
  const year = window("2026-10-31", "year");
  assert.deepEqual([year.first, year.last, year.statistic_period], ["2026-01-01", "2026-12-31", "month"]);
});

test("invalid, future and malformed Energy windows produce explicit input errors", () => {
  for (const value of ["invalid", "2026-02-30", "2026-2-01", "1969-12-31", "2026-11-01"]) {
    assert.throws(() => window(value), (error) => error.status === 400);
  }
  assert.throws(() => window("2026-10-31", "all"), (error) => error.status === 400);
});
