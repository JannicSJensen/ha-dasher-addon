import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import {
  ENERGY_REFRESH_MS, clampEnergyDate, createEnergyClient, energyBar, energyBucketText, energyCanNext, energyChart,
  energyDate, energyDeviceValue, energyFieldsForSources, energyHasStatistics, energyNumber, energyQuery, energyRange, energyRangeText,
  energySourceCostVisible, energyValue, energyWarnings, shiftEnergyDate,
} from "../web/js/lib/energy.js";
import { makeTranslator } from "../web/js/lib/i18n.js";
import { createEnergyPage } from "../web/js/pages/energy.js";

const response = (overrides = {}) => ({
  configured: true, time_zone: "Europe/Copenhagen", currency: "DKK", today: "2026-10-31",
  range: { date: "2026-10-31", period: "day", first: "2026-10-31", last: "2026-10-31", start: "2026-10-30T23:00:00Z", end: "2026-10-31T23:00:00Z", statistic_period: "hour" },
  totals: { grid_import: 12, grid_export: 3, solar: 8, home: 17, battery_charge: null, battery_discharge: null, self_consumption: 62.5, self_sufficiency: null, solar_used: 5, net_cost: 22.75 },
  series: [{ start: "2026-10-31T00:00:00+01:00", grid_import: 1, grid_export: 0, solar: null, home: 1 }],
  sources: [{ id: "grid", name: "Electricity meter", kind: "grid_import", unit: "kWh", value: 12, cost: 22.75 }],
  devices: [], warnings: [], ...overrides,
});
const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const fakeClock = () => {
  const callbacks = new Map();
  let id = 0;
  return {
    callbacks,
    setInterval(callback, ms) { assert.equal(ms, ENERGY_REFRESH_MS); callbacks.set(++id, callback); return id; },
    clearInterval(key) { callbacks.delete(key); },
    tick() { for (const callback of callbacks.values()) callback(); },
  };
};
const flush = () => new Promise((resolve) => setImmediate(resolve));

test("nullable statistics stay missing; measured zero, negative and Danish decimal values remain exact", () => {
  for (const value of [null, undefined, "", "0", NaN, Infinity, -Infinity, false]) {
    assert.equal(energyNumber(value), null);
    assert.equal(energyValue(value), "—");
  }
  assert.equal(energyValue(null, { missing: "Not available" }), "Not available");
  assert.equal(energyValue(0), "0 kWh");
  assert.equal(energyValue(-1.5), "-1.5 kWh");
  assert.equal(energyValue(12.345, { locale: "da" }), "12,35 kWh");
  assert.equal(energyValue(5, { unit: "m³" }), "5 m³");
  assert.equal(energyValue(62.5, { unit: "%" }), "62.5 %");
  assert.match(energyValue(22.75, { locale: "da", unit: "DKK", currency: true }), /22,75.*kr/);
  assert.equal(energyValue(2, { unit: "credits", currency: true }), "2 credits");
});

test("calendar dates are validated, with leap years and no tablet-timezone conversion", () => {
  for (const bad of [null, "2026-2-01", "2026-02-29", "2026-04-31", "2026-10-31T00:00:00Z", "bad"]) assert.equal(energyDate(bad), null);
  assert.equal(energyDate("2028-02-29"), "2028-02-29");
  assert.deepEqual(energyRange("2026-11-01", "week"), { first: "2026-10-26", last: "2026-11-01", end: "2026-11-02" });
  assert.deepEqual(energyRange("2028-02-29", "month"), { first: "2028-02-01", last: "2028-02-29", end: "2028-03-01" });
  assert.deepEqual(energyRange("2026-12-31", "year"), { first: "2026-01-01", last: "2026-12-31", end: "2027-01-01" });
  assert.equal(energyRange("bad", "day"), null);
  assert.equal(energyRange("2026-10-31", "hour"), null);
});

test("period navigation normalizes month/year boundaries and crosses DST without losing dates", () => {
  assert.equal(shiftEnergyDate("2026-03-29", "day", 1), "2026-03-30");
  assert.equal(shiftEnergyDate("2026-10-25", "day", -1), "2026-10-24");
  assert.equal(shiftEnergyDate("2026-01-31", "month", 1), "2026-02-01");
  assert.equal(shiftEnergyDate("2026-12-31", "month", 1), "2027-01-01");
  assert.equal(shiftEnergyDate("2028-02-29", "year", -1), "2027-01-01");
  assert.equal(shiftEnergyDate("2026-11-01", "week", 1), "2026-11-02");
  assert.equal(shiftEnergyDate(null, "day", 1), null);
  assert.equal(energyCanNext("2026-10-30", "day", "2026-10-31"), true);
  assert.equal(energyCanNext("2026-10-26", "week", "2026-10-31"), false);
  assert.equal(energyCanNext("2026-09-30", "month", "2026-10-31"), true);
  assert.equal(energyCanNext("2026-01-01", "year", "2026-10-31"), false);
  assert.equal(energyCanNext("2027-01-01", "day", "2026-10-31"), false);
  assert.equal(energyCanNext(null, "day", null), false);
});

test("date labels are localized and hourly statistics follow HA's time zone, including repeated DST hours", () => {
  assert.match(energyRangeText("2026-10-31", "month", "en"), /October 2026/);
  assert.match(energyRangeText("2026-10-31", "month", "da"), /oktober 2026/);
  assert.match(energyRangeText("2026-10-31", "week", "en"), /26.*2026.*–.*1.*2026/);
  assert.equal(energyRangeText(null, "day"), "");
  const options = { locale: "da", timeZone: "Europe/Copenhagen", full: true };
  const summer = energyBucketText("2026-10-25T00:00:00Z", "day", options);
  const winter = energyBucketText("2026-10-25T01:00:00Z", "day", options);
  assert.match(summer, /02[.:]00.*GMT\+2/);
  assert.match(winter, /02[.:]00.*GMT\+1/);
  assert.match(energyBucketText("2026-11-01T00:00:00Z", "day", { locale: "da", timeZone: "Europe/Copenhagen" }), /01[.:]00/);
  assert.match(energyBucketText("2026-11-01", "month", { locale: "da", timeZone: "America/Los_Angeles" }), /1\. nov/);
  assert.equal(energyBucketText(null, "day"), "—");
  assert.equal(energyBucketText("bad", "day"), "—");
  assert.doesNotThrow(() => energyBucketText("2026-10-31T00:00:00Z", "day", { timeZone: "bad-zone" }));
});

test("API query omits unknown dates so HA chooses today; period input cannot inject paths", () => {
  assert.equal(energyQuery(null), "api/energy?period=day");
  assert.equal(energyQuery("invalid", "week"), "api/energy?period=week");
  assert.equal(energyQuery("2026-10-31", "year"), "api/energy?period=year&date=2026-10-31");
  assert.equal(energyQuery("2026-10-31", "&date=bad"), "api/energy?period=day&date=2026-10-31");
});

test("future anchors clamp to HA today, while unknown today and invalid dates are not invented", () => {
  assert.equal(clampEnergyDate("2026-11-01", "2026-10-31"), "2026-10-31");
  assert.equal(clampEnergyDate("2026-10-30", "2026-10-31"), "2026-10-30");
  assert.equal(clampEnergyDate("2026-11-01", null), "2026-11-01");
  assert.equal(clampEnergyDate(null, "2026-10-31"), null);
  assert.equal(clampEnergyDate("2026-02-30", "2026-10-31"), null);
});

test("range labels use inclusive backend dates, never UTC-midnight start/end dates", () => {
  assert.match(energyRangeText("2026-10-31", "week", "en", {
    first: "2026-10-26", last: "2026-11-01",
    start: "2026-10-25T23:00:00Z", end: "2026-11-01T23:00:00Z",
  }), /Oct.*26.*–.*Nov.*1/);
  assert.match(energyRangeText("2026-10-31", "day", "en", response().range), /31.*Oct|Oct.*31/);
  assert.equal(energyValue(2, { currency: true, unit: null }), "2");
});

test("loader clamps initial, selected and refreshed anchors when HA today moves backwards", async () => {
  let today = "2026-10-31";
  const calls = [];
  const client = createEnergyClient({
    date: "2026-11-01", clock: fakeClock(), getToday: () => today,
    load: async (path) => {
      calls.push(path);
      const query = new URLSearchParams(path.split("?")[1]);
      return response({ today, range: { date: query.get("date"), period: query.get("period") } });
    },
  });
  await client.start();
  assert.match(calls[0], /date=2026-10-31/);
  await client.select("2027-01-01", "year");
  assert.match(calls.at(-1), /period=year&date=2026-10-31/);
  today = "2026-10-30";
  await client.refresh();
  assert.match(calls.at(-1), /date=2026-10-30/);
  assert.equal(client.getState().date, today);
  client.destroy();
});

test("chart scaling distinguishes measured zero from missing values and preserves negative magnitudes", () => {
  const chart = energyChart([{ home: null, solar: 0, grid_import: 4 }, { home: null, solar: 2, grid_import: -8 }]);
  assert.deepEqual(chart, { fields: ["grid_import", "solar"], max: 8, empty: false });
  assert.equal(energyBar(null, 8), null);
  assert.equal(energyBar(0, 8), 0);
  assert.equal(energyBar(2, 8), 25);
  assert.equal(energyBar(-4, 8), 50);
  assert.equal(energyBar(20, 8), 100);
  assert.deepEqual(energyChart([{ home: null }]), { fields: [], max: 0, empty: true });
  assert.deepEqual(energyChart([{ home: 0 }]), { fields: ["home"], max: 0, empty: false });
});

test("configured source kinds, not default zero totals, determine optional electricity fields", () => {
  assert.deepEqual(energyFieldsForSources([{ kind: "grid_import" }, { kind: "water" }]), ["grid_import", "home"]);
  assert.deepEqual(energyFieldsForSources([{ kind: "solar" }, { kind: "battery_charge" }, { kind: "grid_export" }]), ["grid_export", "solar", "home", "battery_charge"]);
  assert.deepEqual(energyFieldsForSources([]), ["home"]);
  assert.deepEqual(energyChart([{ grid_import: 5, grid_export: 0, solar: 0, home: 5, battery_charge: 0 }], ["grid_import", "home"]),
    { fields: ["grid_import", "home"], max: 5, empty: false });
});

test("device graph values use supplied exclusive consumption without recomputing or summing overlaps", () => {
  assert.equal(energyDeviceValue({ value: 12, exclusive_value: 5 }), 5);
  assert.equal(energyDeviceValue({ value: 12, exclusive_value: 0 }), 0);
  assert.equal(energyDeviceValue({ value: 12, exclusive_value: null }), null);
  assert.equal(energyDeviceValue({ value: 12 }), 12);
  assert.equal(energyDeviceValue({ value: null }), null);
  assert.equal(energyDeviceValue(null), null);
  const data = response({ totals: {}, series: [], sources: [], devices: [], water_devices: [{ value: 12, exclusive_value: 8, unit: "L" }] });
  assert.equal(energyHasStatistics(data), true);
  assert.deepEqual(energyWarnings(data), []);
  assert.equal(energyWarnings({ ...data, water_devices: [{ value: 12, exclusive_value: null }] })[0].code, "missing_statistics");
});

test("source cost configuration distinguishes no monetary source from unavailable configured costs and preserves legacy DTO behavior", () => {
  const available = { cost: 2.5 };
  assert.equal(energySourceCostVisible({ cost_configured: false, cost: null }, [available]), false);
  assert.equal(energySourceCostVisible({ cost_configured: false, cost: 2.5 }), false);
  assert.equal(energySourceCostVisible({ cost_configured: true, cost: null }), true);
  assert.equal(energySourceCostVisible({ cost_configured: true, cost: 0 }), true);
  assert.equal(energySourceCostVisible({ cost: null }), false);
  assert.equal(energySourceCostVisible({ cost: null }, [available]), true);
  assert.equal(energySourceCostVisible({ cost: 0 }), true);
  assert.equal(energySourceCostVisible({ cost: null }, [{ cost_configured: true, cost: null }]), false);
});

test("missing statistics are explained even without a server warning, but absent optional sources are not invented", () => {
  const missing = response({ totals: { home: null }, series: [], sources: [], devices: [] });
  assert.equal(energyHasStatistics(missing), false);
  assert.deepEqual(energyWarnings(missing).map((item) => item.code), ["missing_statistics"]);
  assert.equal(energyHasStatistics(response({ totals: { home: 0 }, series: [], sources: [] })), true);
  assert.deepEqual(energyWarnings(response()), []);
  assert.deepEqual(energyWarnings({ configured: false }), []);
  const warned = response({ warnings: [{ id: "a", code: "missing_statistics", message: "Meter unavailable" }], sources: [{ value: null }] });
  assert.equal(energyWarnings(warned).length, 1);
  assert.equal(energyWarnings(warned)[0].message, "Meter unavailable");
  assert.equal(energyWarnings(response({ devices: [{ value: null }] }))[0].code, "missing_statistics");
  assert.equal(energyWarnings(response({ sources: [{ kind: "water", value: null }] }))[0].code, "missing_statistics");
  assert.equal(energyWarnings(response({ series: [{ home: 1 }, { home: null }] }))[0].code, "missing_statistics");
  assert.equal(energyWarnings(response({ totals: { home: -1 } }))[0].code, "negative_balance");
});

test("successful initial load adopts server date/period for refresh and stops its clock on destroy", async () => {
  const calls = [];
  const clock = fakeClock();
  const changes = [];
  const client = createEnergyClient({ clock, load: async (path) => { calls.push(path); return response(); }, onChange: (state) => changes.push(state) });
  await client.start();
  assert.equal(calls[0], "api/energy?period=day");
  assert.equal(client.getState().date, "2026-10-31");
  assert.equal(changes[0].loading, true);
  assert.equal(changes.at(-1).loading, false);
  await client.refresh();
  assert.match(calls[1], /date=2026-10-31/);
  assert.equal(clock.callbacks.size, 1);
  client.destroy();
  assert.equal(clock.callbacks.size, 0);
  await client.refresh();
  assert.equal(calls.length, 2);
});

test("navigation aborts the previous load and ignores late successes from a loader that does not honor abort", async () => {
  const calls = [];
  const load = (path, { signal }) => {
    const request = deferred();
    calls.push({ ...request, path, signal });
    return request.promise;
  };
  const client = createEnergyClient({ load, clock: fakeClock() });
  const first = client.start();
  const second = client.select("2026-10-30", "week");
  assert.equal(calls[0].signal.aborted, true);
  assert.equal(client.getState().data, null);
  calls[1].resolve(response({ range: { date: "2026-10-26", period: "week" } }));
  await second;
  calls[0].resolve(response());
  await first;
  assert.equal(client.getState().period, "week");
  assert.equal(client.getState().date, "2026-10-26");
  assert.equal(client.getState().error, null);
  client.destroy();
});

test("reload failure preserves data with an explicit stale error; navigation failure never reuses another period", async () => {
  let fail = false;
  const client = createEnergyClient({ clock: fakeClock(), load: async () => { if (fail) throw new Error("HA offline"); return response(); } });
  await client.start();
  const original = client.getState().data;
  fail = true;
  await client.refresh();
  assert.equal(client.getState().data, original);
  assert.equal(client.getState().stale, true);
  assert.equal(client.getState().error, "HA offline");
  await client.select("2026-10-30");
  assert.equal(client.getState().data, null);
  assert.equal(client.getState().stale, false);
  fail = false;
  await client.refresh();
  assert.equal(client.getState().error, null);
  assert.equal(client.getState().stale, false);
  client.destroy();
});

test("unexpected AbortError is shown, intentional cancellation and obsolete errors are ignored", async () => {
  const abort = () => Object.assign(new Error("Unexpected abort"), { name: "AbortError" });
  const client = createEnergyClient({ clock: fakeClock(), load: async () => { throw abort(); } });
  await client.start();
  assert.equal(client.getState().error, "Unexpected abort");
  client.destroy();
  const old = deferred();
  let call = 0;
  const changes = [];
  const next = createEnergyClient({ clock: fakeClock(), load: () => ++call === 1 ? old.promise : Promise.resolve(response()), onChange: (state) => changes.push(state) });
  const first = next.start();
  await next.select("2026-10-31");
  old.reject(abort());
  await first;
  assert.equal(next.getState().error, null);
  assert.equal(changes.at(-1).data.configured, true);
  next.destroy();
});

test("destroy aborts work and prevents callbacks and state replacement, even after late resolution", async () => {
  const pending = deferred();
  let signal;
  let count = 0;
  const clock = fakeClock();
  const client = createEnergyClient({ clock, load: (_, options) => { signal = options.signal; return pending.promise; }, onChange: () => count++ });
  const work = client.start();
  client.destroy();
  assert.equal(signal.aborted, true);
  pending.resolve(response());
  await work;
  assert.equal(count, 1);
  assert.equal(client.getState().data, null);
  assert.equal(clock.callbacks.size, 0);
});

test("five-minute refresh only loads while mounted and does not overlap a slow load", async () => {
  const clock = fakeClock();
  let mounted = false;
  let calls = 0;
  const slow = deferred();
  const client = createEnergyClient({ clock, isMounted: () => mounted, load: () => ++calls === 1 ? Promise.resolve(response()) : slow.promise });
  await client.start();
  clock.tick();
  assert.equal(calls, 1);
  mounted = true;
  clock.tick();
  assert.equal(calls, 2);
  clock.tick();
  assert.equal(calls, 2);
  slow.resolve(response());
  await flush();
  client.stop();
  assert.equal(clock.callbacks.size, 0);
  client.destroy();
});

test("invalid successful HTTP responses become visible errors rather than a false empty/zero state", async () => {
  for (const bad of [{}, null, { configured: true }, response({ series: null }), response({ water_devices: {} }), response({ prices: { slots: [] } }), response({ range: { date: "bad", period: "day" } }), { error: "Statistics failed" }]) {
    const client = createEnergyClient({ clock: fakeClock(), load: async () => bad });
    await client.start();
    assert.ok(client.getState().error);
    assert.equal(client.getState().data, null);
    client.destroy();
  }
  const client = createEnergyClient({ clock: fakeClock(), load: async () => ({ configured: false, today: "2026-10-31" }) });
  await client.start();
  assert.equal(client.getState().data.configured, false);
  assert.equal(client.getState().error, null);
  client.destroy();
});

test("all energy copy is translated in English and Danish with matching keys", async () => {
  const source = await readFile(new URL("../web/js/lib/i18n.js", import.meta.url), "utf8");
  const [en, da] = source.split("  da: {");
  const keys = (text) => [...text.matchAll(/^\s+(energy_\w+):/gm)].map((match) => match[1]).sort();
  assert.deepEqual(keys(en), keys(da));
  assert.ok(keys(en).length > 60);
  for (const language of ["en", "da"]) {
    const t = makeTranslator(language);
    for (const key of keys(en)) assert.notEqual(t(key), key);
  }
});

// Minimal DOM for page composition/lifecycle tests, not a browser or a new dependency.
class TestNode {
  constructor(tag = "", text = "") {
    this.tag = tag;
    this.text = text;
    this.children = [];
    this.attributes = {};
    this.dataset = {};
    this.events = new Map();
    this.className = "";
    this.style = { setProperty() {} };
    this.isConnected = true;
    this.classList = {
      add: (...names) => { this.className = [...new Set([...this.className.split(" ").filter(Boolean), ...names])].join(" "); },
      toggle: (name, enabled) => {
        const names = new Set(this.className.split(" ").filter(Boolean));
        if (enabled) names.add(name); else names.delete(name);
        this.className = [...names].join(" ");
      },
    };
  }
  append(...nodes) { this.children.push(...nodes); }
  replaceChildren(...nodes) { this.text = ""; this.children = [...nodes]; }
  setAttribute(key, value) { this.attributes[key] = String(value); }
  removeAttribute(key) { delete this.attributes[key]; }
  addEventListener(event, handler) { this.events.set(event, handler); }
  focus() { this.focused = true; }
  get textContent() { return this.text + this.children.map((node) => node.textContent).join(""); }
  set textContent(value) { this.text = String(value); this.children = []; }
}
const find = (node, predicate) => [node, ...node.children.flatMap((child) => find(child, predicate))].filter(predicate);
const withDOM = (context) => {
  const original = { document: globalThis.document, Node: globalThis.Node, fetch: globalThis.fetch };
  globalThis.Node = TestNode;
  globalThis.document = {
    createElement: (tag) => new TestNode(tag),
    createTextNode: (text) => new TestNode("", text),
    createElementNS: (namespaceURI, tag) => Object.assign(new TestNode(tag), { namespaceURI }),
  };
  globalThis.fetch = async () => ({ ok: false, text: async () => "" });
  context.after(() => {
    for (const [key, value] of Object.entries(original)) {
      if (value === undefined) delete globalThis[key]; else globalThis[key] = value;
    }
  });
};

test("page renders flows, accessible chart values, named sources, devices, gas/water and available costs only", async (context) => {
  withDOM(context);
  const clock = fakeClock();
  const page = createEnergyPage({ enabled: true, configured: true, title: "House energy" }, {
    t: makeTranslator("en"), locale: "en", energyClock: clock,
    loadEnergy: async () => response({
      series: [
        { start: "2026-10-31T00:00:00+01:00", grid_import: 1, grid_export: 0, solar: null, home: 1 },
        { start: "2026-10-31T01:00:00+01:00", grid_import: 0, grid_export: 0, solar: 2, home: 2 },
      ],
      sources: [...response().sources,
        { id: "example-export", name: "Export meter", kind: "grid_export", unit: "kWh", value: 3, cost: null },
        { id: "example-solar", name: "Solar panels", kind: "solar", unit: "kWh", value: 8, cost: null },
        { id: "example-battery-charge", name: "Battery input", kind: "battery_charge", unit: "kWh", value: null, cost: null },
        { id: "example-battery-discharge", name: "Battery output", kind: "battery_discharge", unit: "kWh", value: null, cost: null },
        { id: "gas", name: "Gas meter", kind: "gas", unit: "m³", value: 5, cost: null },
        { id: "water", name: "Water meter", kind: "water", unit: "m³", value: null, cost: null }],
      devices: [{ id: "kitchen", name: "Kitchen", unit: "kWh", value: 4, parent: null }, { id: "oven", name: "Oven", unit: "kWh", value: 2, parent: "kitchen" }],
    }),
  });
  context.after(() => page.destroy());
  await flush();
  assert.deepEqual(page.entities, []);
  for (const text of ["House energy", "Electricity flow", "Battery", "12 kWh", "Electricity meter", "Kitchen", "Oven", "Part of Kitchen", "Gas meter", "Water meter", "Net electricity cost", "Direct solar to home", "Not available", "Home Assistant → Energy"]) {
    assert.ok(page.el.textContent.includes(text), text);
  }
  assert.ok(!page.el.textContent.includes("Self-sufficiency"), "null percentage is omitted");
  assert.ok(!find(page.el, (node) => node.tag === "dt").some((node) => node.textContent === "Solar self-consumption"), "battery self-consumption is not inferred from aggregates");
  const table = find(page.el, (node) => node.tag === "table")[0];
  assert.ok(table.textContent.includes("0 kWh"), "measured zero is textually accessible");
  assert.equal(find(page.el, (node) => node.className.includes("energy-node--")).length, 4);
  const details = find(page.el, (node) => node.tag === "details")[0];
  page.update();
  assert.equal(find(page.el, (node) => node.tag === "details")[0], details, "state updates do not close chart values");
  page.setModel({ enabled: true, configured: true, title: "New title" });
  assert.ok(page.el.textContent.includes("New title"));
  assert.equal(clock.callbacks.size, 1);
  page.destroy();
  assert.equal(clock.callbacks.size, 0);
});

test("daily prices and recommendations are read-only, localized, refreshed and preserve chart details", async (context) => {
  withDOM(context);
  const start = Date.parse("2026-10-30T23:00:00Z");
  const end = start + 24 * 3600_000;
  let now = start + 14 * 3600_000;
  let tick;
  let stopped = false;
  const priceClock = {
    setInterval(callback, ms) { assert.equal(ms, 60_000); tick = callback; return 1; },
    clearInterval(id) { assert.equal(id, 1); stopped = true; },
  };
  const prices = {
    date: "2026-10-31", start, end, name: "Daily rates", entity_id: "sensor.daily", unit: "DKK/kWh",
    slots: Array.from({ length: 24 }, (_, hour) => ({ start: start + hour * 3600_000, end: start + (hour + 1) * 3600_000, value: hour === 0 ? -1 : hour === 1 ? 0 : hour >= 22 ? 1 : 3 })),
    ev: { hours: 4.5, reason: null },
  };
  const page = createEnergyPage({ enabled: true }, {
    t: makeTranslator("da"), locale: "da", energyClock: fakeClock(), priceClock, priceNow: () => now,
    loadEnergy: async () => response({ prices }),
  });
  context.after(() => page.destroy());
  await flush();
  assert.deepEqual(page.entities, []);
  for (const text of ["Dagens elpriser", "Billigste start i dag", "sensor.daily", "4,5 t", "2 t", "Tørretumbler", "Vaskemaskine", "Opvaskemaskine", "DKK/kWh"]) {
    assert.ok(page.el.textContent.includes(text), text);
  }
  assert.equal(find(page.el, (node) => node.className.includes("energy-price-slot ")).length, 24);
  const bars = find(page.el, (node) => node.className === "energy-price-bar");
  assert.equal(bars[0].style.top, "75%", "negative price is below the zero baseline");
  assert.equal(bars[0].style.height, "25%");
  assert.equal(bars[1].style.height, "0%", "a measured zero is not a missing rate");
  const graph = find(page.el, (node) => node.className === "energy-card energy-prices-card")[0];
  const details = find(graph, (node) => node.tag === "details")[0];
  details.open = true;
  now = end - 3600_000;
  tick();
  assert.equal(find(page.el, (node) => node.className === "energy-card energy-prices-card")[0], graph);
  assert.equal(find(graph, (node) => node.tag === "details")[0], details);
  assert.equal(details.open, true);
  assert.ok(page.el.textContent.includes("Der er ikke nok sammenhængende"));
  page.destroy();
  assert.equal(stopped, true);
});

test("page supports keyboard tabs, navigates dates, displays reload errors and clears stale values on navigation", async (context) => {
  withDOM(context);
  const calls = [];
  let failure = false;
  const page = createEnergyPage({ enabled: true, today: "2026-10-31" }, {
    t: makeTranslator("en"), energyClock: fakeClock(),
    loadEnergy: async (path) => {
      calls.push(path);
      if (failure) throw new Error("HA connection failed");
      const query = new URLSearchParams(path.split("?")[1]);
      return response({ range: { date: query.get("date") || "2026-10-31", period: query.get("period") } });
    },
  });
  context.after(() => page.destroy());
  await flush();
  const next = find(page.el, (node) => node.attributes["aria-label"] === "Next period")[0];
  assert.equal(next.disabled, true);
  const previous = find(page.el, (node) => node.attributes["aria-label"] === "Previous period")[0];
  previous.events.get("click")();
  await flush();
  assert.match(calls.at(-1), /date=2026-10-30/);
  assert.equal(next.disabled, false);
  const tabs = find(page.el, (node) => node.attributes.role === "tab");
  tabs[0].events.get("keydown")({ key: "ArrowRight", preventDefault() {} });
  await flush();
  assert.equal(tabs[1].attributes["aria-selected"], "true");
  assert.equal(tabs[1].focused, true);
  assert.match(calls.at(-1), /period=week/);
  failure = true;
  find(page.el, (node) => node.attributes["aria-label"] === "Refresh energy")[0].events.get("click")();
  await flush();
  assert.ok(page.el.textContent.includes("HA connection failed"));
  assert.ok(page.el.textContent.includes("last successful load"));
  assert.ok(page.el.textContent.includes("12 kWh"));
  const date = find(page.el, (node) => node.tag === "input")[0];
  date.value = "2026-09-01";
  date.events.get("change")();
  await flush();
  assert.ok(!page.el.textContent.includes("12 kWh"), "failed different range has no old values");
});

test("Danish page explains empty configuration; disabled models cancel requests and stop refresh", async (context) => {
  withDOM(context);
  const clock = fakeClock();
  let calls = 0;
  const page = createEnergyPage({ enabled: true, configured: false }, {
    t: makeTranslator("da"), locale: "da", energyClock: clock,
    loadEnergy: async () => { calls++; return { configured: false, time_zone: "Europe/Copenhagen", today: "2026-10-31" }; },
  });
  context.after(() => page.destroy());
  await flush();
  assert.ok(page.el.textContent.includes("Opsæt energi i Home Assistant"));
  assert.ok(page.el.textContent.includes("langtidsstatistik"));
  assert.ok(!page.el.textContent.includes("0 kWh"));
  assert.equal(calls, 1);
  page.setModel({ enabled: false });
  assert.ok(page.el.textContent.includes("Energioverblikket er slået fra"));
  assert.equal(clock.callbacks.size, 0);
  page.setModel({ enabled: true, configured: false });
  await flush();
  assert.equal(calls, 2);
  assert.equal(clock.callbacks.size, 1);
});

test("page clamps typed future dates, blocks future Next and uses new SSE today instead of stale response metadata", async (context) => {
  withDOM(context);
  let haToday = "2026-10-31";
  let zone = "Europe/Copenhagen";
  const calls = [];
  const page = createEnergyPage({ enabled: true, today: haToday, time_zone: zone, currency: "DKK" }, {
    t: makeTranslator("en"), energyClock: fakeClock(),
    loadEnergy: async (path) => {
      calls.push(path);
      const query = new URLSearchParams(path.split("?")[1]);
      const date = query.get("date");
      assert.ok(date <= haToday, "the strict backend must never receive a future anchor");
      return response({ today: haToday, time_zone: zone, currency: null, range: { date, period: query.get("period") } });
    },
  });
  context.after(() => page.destroy());
  await flush();
  const date = find(page.el, (node) => node.tag === "input")[0];
  assert.equal(date.max, haToday);
  date.value = "2026-11-01";
  date.events.get("change")();
  await flush();
  assert.match(calls.at(-1), /date=2026-10-31/);
  assert.equal(date.value, haToday);
  assert.ok(!page.el.textContent.includes("DKK"), "an explicit null response currency does not inherit stale model currency");
  const next = find(page.el, (node) => node.attributes["aria-label"] === "Next period")[0];
  assert.equal(next.disabled, true);
  const previousCount = calls.length;
  next.events.get("click")();
  assert.equal(calls.length, previousCount);
  haToday = "2026-11-01";
  page.setModel({ enabled: true, today: haToday, time_zone: zone });
  find(page.el, (node) => node.attributes["aria-label"] === "Today")[0].events.get("click")();
  await flush();
  assert.match(calls.at(-1), /date=2026-11-01/);
  assert.equal(date.max, haToday);
  zone = "America/Los_Angeles";
  haToday = "2026-10-31";
  page.setModel({ enabled: true, today: haToday, time_zone: zone });
  await flush();
  assert.match(calls.at(-1), /date=2026-10-31/);
  assert.equal(date.value, haToday);
});

test("grid-import-only overview omits phantom solar/export/battery while retaining external water and a named vehicle charger", async (context) => {
  withDOM(context);
  const page = createEnergyPage({ enabled: true, today: "2026-10-31" }, {
    t: makeTranslator("en"), energyClock: fakeClock(),
    loadEnergy: async () => response({
      totals: { grid_import: 12, grid_export: 0, solar: 0, battery_charge: 0, battery_discharge: 0, home: 12, solar_used: 0, self_consumption: 0, self_sufficiency: 0, net_cost: 22.75 },
      series: [{ start: "2026-10-31T00:00:00+01:00", grid_import: 2, grid_export: 0, solar: 0, battery_charge: 0, battery_discharge: 0, home: 2 }],
      sources: [...response().sources,
        { id: "example-external:water", name: "Example water meter", kind: "water", unit: "m³", value: 0.42, cost: null }],
      devices: [{ id: "example-vehicle-charger", name: "Example vehicle charger", unit: "kWh", value: 5.25, parent: null }],
    }),
  });
  context.after(() => page.destroy());
  await flush();
  const nodes = find(page.el, (node) => node.className.includes("energy-node--"));
  assert.equal(nodes.length, 2);
  assert.ok(nodes.some((node) => node.className.includes("energy-node--grid")));
  assert.ok(nodes.some((node) => node.className.includes("energy-node--home")));
  const kpis = find(page.el, (node) => node.className.split(" ").includes("energy-kpi"));
  assert.equal(kpis.length, 2);
  for (const text of ["Solar", "Battery", "To grid", "Exported", "Self-sufficiency"]) {
    assert.ok(!page.el.textContent.includes(text), `${text} is not configured`);
  }
  for (const text of ["Water", "Example water meter", "0.42 m³", "Example vehicle charger", "5.25 kWh", "12 kWh", "Net electricity cost"]) {
    assert.ok(page.el.textContent.includes(text), text);
  }
  const table = find(page.el, (node) => node.tag === "table")[0];
  assert.equal(find(table, (node) => node.tag === "thead")[0].children[0].children.length, 3, "chart has time, import and home only");
});

test("exclusive device bars and water-device volumes remain separate, with parents resolved inside each breakdown", async (context) => {
  withDOM(context);
  const unsafeMessage = '<img src=x onerror="alert(1)"> Unsupported source';
  const page = createEnergyPage({ enabled: true, today: "2026-10-31" }, {
    t: makeTranslator("en"), energyClock: fakeClock(),
    loadEnergy: async () => response({
      devices: [
        { id: "example-parent", name: "Example electrical circuit", unit: "kWh", value: 10, exclusive_value: 6, parent: null },
        { id: "example-power-child", name: "Example vehicle charger", unit: "kWh", value: 4, exclusive_value: 4, parent: "example-parent" },
      ],
      water_devices: [
        { id: "example-parent", name: "Example water branch", unit: "L", value: 100, exclusive_value: 80, parent: null },
        { id: "example-water-child", name: "Example tap", unit: "L", value: 20, exclusive_value: 20, parent: "example-parent" },
        { id: "example-water-volume", name: "Example cubic-metre device", unit: "m³", value: 1, exclusive_value: 1, parent: null },
      ],
      warnings: [{ id: "example-unsupported", code: "unsupported_source", message: unsafeMessage }],
    }),
  });
  context.after(() => page.destroy());
  await flush();
  const section = (title) => find(page.el, (node) => node.tag === "section" && node.children[0]?.textContent === title)[0];
  const electric = section("Individual devices");
  const water = section("Individual water devices");
  assert.ok(electric.textContent.includes("10 kWh"));
  assert.ok(electric.textContent.includes("Own consumption excluding direct subdevices: 6 kWh"));
  assert.ok(electric.textContent.includes("Part of Example electrical circuit"));
  assert.ok(water.textContent.includes("100 L"));
  assert.ok(water.textContent.includes("Own consumption excluding direct subdevices: 80 L"));
  assert.ok(water.textContent.includes("Part of Example water branch"));
  assert.ok(!water.textContent.includes("Part of Example electrical circuit"));
  assert.ok(!water.textContent.includes("kWh"));
  const rows = (node) => find(node, (item) => item.className.split(" ").includes("energy-source"));
  const width = (row) => parseFloat(find(row, (node) => node.className.split(" ").includes("energy-source-fill"))[0].style.width);
  assert.equal(width(rows(electric)[0]), 100);
  assert.ok(Math.abs(width(rows(electric)[1]) - 100 * 4 / 6) < 0.01);
  assert.equal(width(rows(water)[0]), 100);
  assert.equal(width(rows(water)[1]), 25);
  assert.equal(width(rows(water)[2]), 100, "different volume units have independent scales");
  assert.ok(page.el.textContent.includes("Home Assistant reported a problem with these statistics."));
  assert.ok(page.el.textContent.includes(unsafeMessage), "warning details are rendered as text");
  assert.equal(find(page.el, (node) => node.tag === "img").length, 0);
});

test("battery overview shows hourly-inferred direct solar, not a fabricated self-consumption ratio", async (context) => {
  withDOM(context);
  const page = createEnergyPage({ enabled: true }, {
    t: makeTranslator("da"), locale: "da", energyClock: fakeClock(),
    loadEnergy: async () => response({
      totals: { ...response().totals, self_consumption: null, solar_used: 4.25 },
      sources: [...response().sources,
        { id: "example-solar", name: "Example solar", kind: "solar", unit: "kWh", value: 8, cost: null },
        { id: "example-battery", name: "Example battery", kind: "battery_charge", unit: "kWh", value: 1, cost: null }],
    }),
  });
  context.after(() => page.destroy());
  await flush();
  const definitions = find(page.el, (node) => node.tag === "dt");
  assert.ok(definitions.some((node) => node.textContent === "Direkte solenergi til hjemmet"));
  assert.ok(!definitions.some((node) => node.textContent === "Egetforbrug af solenergi"));
  assert.ok(page.el.textContent.includes("4,25 kWh"));
  assert.ok(page.el.textContent.includes("energistatistik pr. time"));
  assert.ok(page.el.textContent.includes("oprindelsen af lagret energi"));
});

test("source rows omit unconfigured solar/battery costs, retain configured missing costs and label export compensation", async (context) => {
  withDOM(context);
  let missing = false;
  const page = createEnergyPage({ enabled: true }, {
    t: makeTranslator("en"), energyClock: fakeClock(),
    loadEnergy: async () => response({
      sources: [
        { id: "example-grid", name: "Example grid meter", kind: "grid_import", unit: "kWh", value: 12, cost_configured: true, cost: missing ? null : 22.75 },
        { id: "example-export", name: "Example export meter", kind: "grid_export", unit: "kWh", value: 3, cost_configured: true, cost: missing ? null : 2.5 },
        { id: "example-solar", name: "Example solar", kind: "solar", unit: "kWh", value: 8, cost_configured: false, cost: null },
        { id: "example-battery", name: "Example battery", kind: "battery_charge", unit: "kWh", value: 1, cost_configured: false, cost: null },
        { id: "example-legacy", name: "Example legacy solar", kind: "solar", unit: "kWh", value: 1, cost: null },
      ],
    }),
  });
  context.after(() => page.destroy());
  await flush();
  const rows = () => find(page.el, (node) => node.className.split(" ").includes("energy-source"));
  const row = (name) => rows().find((node) => node.children[0].textContent.startsWith(name));
  const monetary = (node) => find(node, (item) => item.className === "energy-source-cost");
  assert.equal(monetary(row("Example solar")).length, 0);
  assert.equal(monetary(row("Example battery")).length, 0);
  assert.ok(monetary(row("Example grid meter"))[0].textContent.startsWith("Cost: "));
  assert.ok(monetary(row("Example export meter"))[0].textContent.startsWith("Export compensation: "));
  assert.equal(monetary(row("Example legacy solar"))[0].textContent, "Cost: Not available");
  missing = true;
  find(page.el, (node) => node.attributes["aria-label"] === "Refresh energy")[0].events.get("click")();
  await flush();
  assert.equal(monetary(row("Example grid meter"))[0].textContent, "Cost: Not available");
  assert.equal(monetary(row("Example export meter"))[0].textContent, "Export compensation: Not available");
  assert.equal(monetary(row("Example solar")).length, 0);
  assert.equal(monetary(row("Example battery")).length, 0);
  assert.equal(monetary(row("Example legacy solar")).length, 0, "omitted flag retains the old all-costs-missing behavior");
  assert.equal(makeTranslator("da")("energy_export_compensation"), "Eksportbetaling");
});
