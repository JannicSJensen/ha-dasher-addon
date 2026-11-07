import assert from "node:assert/strict";
import { test } from "node:test";
import { energyPrices } from "../src/energy-prices.js";
import { energyWindow } from "../src/energy-window.js";
import { cheapestPriceWindow, normalizeSlots } from "../web/js/lib/price.js";

const core = { time_zone: "Europe/Copenhagen", currency: "DKK" };
const now = Date.parse("2026-11-07T12:30:00Z");
const day = energyWindow({ timeZone: core.time_zone, now });
const start = Date.parse(day.start);
const end = Date.parse(day.end);
const raw = (values) => values.map((price, hour) => ({ hour: new Date(start + hour * 3600_000).toISOString(), price }));
const state = (values, extra = {}) => ({ state: "2", attributes: { raw_today: raw(values), unit_of_measurement: "DKK/kWh", friendly_name: "Daily rates" }, ...extra });
const preferences = { sources: [{ kind: "grid_import", price_entity: "sensor.current_import" }] };

test("discovers actual dated daily rates rather than a current-price-only sensor", () => {
  const prices = energyPrices({
    core, preferences, now,
    states: new Map([["sensor.current_import", { state: "3", attributes: { unit_of_measurement: "DKK/kWh" } }], ["sensor.daily", state(Array(24).fill(2))]]),
  });
  assert.equal(prices.entity_id, "sensor.daily");
  assert.equal(prices.unit, "DKK/kWh");
  assert.equal(prices.date, "2026-11-07");
  assert.equal(prices.current, 2);
  assert.equal(prices.slots.length, 24);
  assert.equal(prices.partial, false);
});

test("prefers the Energy import price source when it has daily rates", () => {
  const prices = energyPrices({ core, preferences, now, states: new Map([["sensor.aaa", state(Array(24).fill(4))], ["sensor.current_import", state(Array(24).fill(2))]]) });
  assert.equal(prices.entity_id, "sensor.current_import");
});

test("stale, unavailable and non-price data cannot produce recommendations", () => {
  for (const invalid of [
    state(Array(24).fill(2), { state: "unavailable" }),
    state(Array(24).fill(2), { attributes: { raw_today: [{ hour: "2026-11-06T13:00:00+01:00", price: 1 }], unit_of_measurement: "DKK/kWh" } }),
    { state: "2", last_updated: "2026-11-06T12:00:00Z", attributes: { today: Array(24).fill(2), unit_of_measurement: "DKK/kWh" } },
    { state: "2", attributes: { today: Array(24).fill(2), unit_of_measurement: "kWh" } },
  ]) {
    assert.equal(energyPrices({ core, preferences, now, states: new Map([["sensor.daily", invalid]]) }).slots.length, 0);
  }
});

test("EV duration is read from HA, including fractional hours, without a fixed-duration fallback", () => {
  for (const [hours, planned, expected, reason] of [[3.5, true, 3.5, null], ["2.25", true, 2.25, null], [0, false, 0, "no_plan"], [null, true, null, "unavailable"]]) {
    const prices = energyPrices({
      core, preferences, now, evInfoEntity: "sensor.ev",
      states: new Map([["sensor.ev", { attributes: { charging_number_of_hours: hours, charging_is_planned: planned } }]]),
    });
    assert.equal(prices.ev.hours, expected);
    assert.equal(prices.ev.reason, reason);
    assert.equal(prices.ev.entity_id, "sensor.ev");
  }
});

test("invalid rates leave real gaps; measured zero and negative prices stay valid", () => {
  const slots = normalizeSlots({ today: [null, 0, -1, Infinity] }, { dayStart: start, dayEnd: end });
  assert.deepEqual(slots.map((slot) => slot.value), [0, -1]);
  const prices = energyPrices({ core, preferences, now, states: new Map([["sensor.daily", state([0, null, -1, Infinity, 4])]]) });
  assert.equal(prices.partial, true);
  assert.deepEqual(prices.slots.map((slot) => slot.value), [0, -1, 4]);
  assert.equal(prices.slots[0].end, start + 3600_000);
});

test("daily timestamped and numeric arrays use HA time zone and actual 23/25-hour DST days", () => {
  for (const [date, count] of [["2026-03-29", 23], ["2026-10-25", 25]]) {
    const range = energyWindow({ date, timeZone: core.time_zone, now: Date.parse(`${date}T12:00:00Z`) });
    const bounds = { dayStart: Date.parse(range.start), dayEnd: Date.parse(range.end) };
    const slots = normalizeSlots({ today: Array(count).fill(2) }, bounds);
    assert.equal(slots.length, count);
    assert.equal(slots[0].start, bounds.dayStart);
    assert.equal(slots.at(-1).end, bounds.dayEnd);
    assert.ok(slots.every((slot) => slot.end - slot.start === 3600_000));
  }
});

const slots = (values) => values.map((value, hour) => ({ start: hour * 3600_000, end: (hour + 1) * 3600_000, value }));

test("recommendations minimize elapsed-time weighted prices and can start or finish within a slot", () => {
  const result = cheapestPriceWindow(slots([1, 10, 0]), 1.5, { now: 0, end: 3 * 3600_000 });
  assert.equal(result.start, 1.5 * 3600_000);
  assert.equal(result.end, 3 * 3600_000);
  assert.ok(Math.abs(result.average - 10 / 3) < 1e-10);
  const current = cheapestPriceWindow(slots([1, 4, 4]), 0.5, { now: 0.25 * 3600_000, end: 3 * 3600_000 });
  assert.equal(current.start, 0.25 * 3600_000);
  assert.equal(current.average, 1);
});

test("recommendations exclude past starts, tomorrow, gaps, overlaps, and runs too long for today", () => {
  assert.equal(cheapestPriceWindow(slots([0, 2, 1]), 1, { now: 3600_000, end: 2 * 3600_000 }).start, 3600_000);
  assert.equal(cheapestPriceWindow(slots([1, 1, 1]), 2, { now: 2 * 3600_000, end: 3 * 3600_000 }), null);
  assert.equal(cheapestPriceWindow([slots([1])[0], slots([1, 1, 1])[2]], 2, { now: 0 }), null);
  assert.equal(cheapestPriceWindow([...slots([1, 1]), { start: 0.5 * 3600_000, end: 1.5 * 3600_000, value: 0 }], 2, { now: 0 }), null);
  assert.equal(cheapestPriceWindow(slots([2, 2]), 1, { now: 0 }).start, 0, "ties use the earliest start");
  assert.equal(cheapestPriceWindow(slots([2]), 0, { now: 0 }), null);
});
