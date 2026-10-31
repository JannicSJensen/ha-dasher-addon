import assert from "node:assert/strict";
import { test } from "node:test";
import { parseConfig } from "../src/config.js";
import { EnergyService, buildEnergyOverview, energySources } from "../src/energy.js";
import { energyWindow } from "../src/energy-window.js";

const base = "pages:\n  - { id: home }\n";

test("Energy configuration defaults to native automatic discovery", () => {
  const { config, errors, entities } = parseConfig(base);
  assert.deepEqual(errors, []);
  assert.deepEqual(config.energy, { enabled: "auto", title: null, icon: "lightning-bolt-outline" });
  assert.deepEqual([...entities], [], "Energy statistics do not add entities to the tablet control allow-list");
  assert.equal(parseConfig(`${base}energy: false\n`).config.energy.enabled, false);
  assert.equal(parseConfig(`${base}energy: true\n`).config.energy.enabled, true);
  assert.equal(parseConfig(`${base}energy:\n  enabled: false\n`).config.energy.enabled, false);
  assert.match(parseConfig(`${base}energy: invalid\n`).errors[0], /energy: use/);
});

test("Energy menu options override display settings without adding entity mappings", () => {
  const { config, errors } = parseConfig(`${base}energy: false\n`, {
    menuItems: [{ id: "energy", visible: true, title: "Electricity", icon: "mdi:solar-power", order: 0 }],
  });
  assert.deepEqual(errors, []);
  assert.deepEqual(config.energy, { enabled: true, title: "Electricity", icon: "mdi:solar-power" });
  const invalid = parseConfig(`${base}energy:\n  enabled: sometimes\n`);
  assert.match(invalid.errors[0], /energy.enabled/);
});

const silent = { warn() {}, info() {}, debug() {}, error() {} };
const now = Date.parse("2026-10-31T12:00:00Z");
const core = { time_zone: "Europe/Copenhagen", currency: "DKK" };
const range = energyWindow({ date: "2026-10-30", timeZone: core.time_zone, now });
const start = Date.parse(range.start);
const meta = (id, unit = "kWh", unitClass = "energy") => ({ statistic_id: id, display_unit_of_measurement: unit, statistics_unit_of_measurement: unit, unit_class: unitClass, has_sum: true });
const stats = (changes, from = start) => changes.map((change, i) => ({ start: from + i * 3600_000, end: from + (i + 1) * 3600_000, change }));
const preferences = {
  energy_sources: [
    { type: "grid", stat_energy_from: "sensor.import", stat_energy_to: "sensor.export", entity_energy_price: "sensor.price", number_energy_price_export: 0.2 },
    { type: "solar", stat_energy_from: "sensor.solar" },
    { type: "battery", stat_energy_from: "sensor.discharge", stat_energy_to: "sensor.charge" },
    { type: "water", stat_energy_from: "integration:water", name: "Water" },
  ],
  device_consumption: [
    { stat_consumption: "sensor.house", name: "House" },
    { stat_consumption: "sensor.car", name: "Car charger", included_in_stat: "sensor.house" },
  ],
  device_consumption_water: [{ stat_consumption: "integration:shower", name: "Shower" }],
};
const info = { cost_sensors: { "sensor.import": "sensor.recorded_cost", "sensor.export": "sensor.recorded_revenue" } };
const metadata = [
  ...["sensor.import", "sensor.export", "sensor.solar", "sensor.charge", "sensor.discharge", "sensor.house", "sensor.car"].map((id) => meta(id)),
  meta("integration:water", "m³", "volume"), meta("integration:shower", "L", "volume"),
  meta("sensor.recorded_cost", "DKK", null), meta("sensor.recorded_revenue", "DKK", null),
];
const statistics = {
  "sensor.import": stats([3, 5]), "sensor.export": stats([1, 2]), "sensor.solar": stats([4, 6]),
  "sensor.charge": stats([2, 1]), "sensor.discharge": stats([1, 0]),
  "sensor.house": stats([5, 8]), "sensor.car": stats([1, 2]),
  "integration:water": stats([0.12, 0.07]), "integration:shower": stats([0.01, 0.02]),
  "sensor.recorded_cost": stats([1, -0.2]), "sensor.recorded_revenue": stats([0.1, 0.3]),
};
const model = (overrides = {}) => buildEnergyOverview({ preferences: energySources(preferences, info), metadata, statistics, range, core, ...overrides });

test("native flat and legacy nested preferences preserve directions, external ids and cost mappings", () => {
  const result = energySources(preferences, info);
  assert.equal(result.sources.find((row) => row.kind === "battery_charge").id, "sensor.charge");
  assert.equal(result.sources.find((row) => row.kind === "battery_discharge").id, "sensor.discharge");
  assert.equal(result.sources[0].cost_id, "sensor.recorded_cost");
  assert.equal(result.sources[1].cost_id, "sensor.recorded_revenue");
  assert.ok(result.sources.some((row) => row.id === "integration:water"));
  const legacy = energySources({ energy_sources: [{ type: "grid", flow_from: [{ stat_energy_from: "sensor.i", stat_cost: "sensor.c" }], flow_to: [{ stat_energy_to: "sensor.e", number_energy_price: 0 }] }] });
  assert.deepEqual(legacy.sources.map((row) => [row.kind, row.id, row.cost_configured]), [["grid_import", "sensor.i", true], ["grid_export", "sensor.e", true]]);
});

test("Energy sums native changes including the first bucket, rather than subtracting returned sums", () => {
  const result = model();
  assert.deepEqual(result.warnings, []);
  assert.deepEqual([result.totals.grid_import, result.totals.grid_export, result.totals.solar, result.totals.battery_charge, result.totals.battery_discharge, result.totals.home], [8, 3, 10, 3, 1, 13]);
  assert.equal(result.totals.solar_used, 4, "solar attribution is calculated per hour, not from daily totals");
  assert.equal(result.totals.self_consumption, null, "battery-aware solar origin is not guessed");
  assert.equal(result.series[0].home, 5);
  assert.equal(result.series[1].home, 8);
  assert.ok(Math.abs(result.totals.net_cost - 0.4) < 1e-9, "negative tariffs and export compensation retain their signs");
});

test("native external volumes use a common unit and device names/overlaps are preserved", () => {
  const result = model();
  const water = result.sources.find((row) => row.kind === "water");
  assert.deepEqual([water.name, water.unit, water.value], ["Water", "m³", 0.19]);
  assert.deepEqual(result.devices.map((row) => [row.name, row.value, row.exclusive_value, row.parent]), [["House", 13, 10, null], ["Car charger", 3, 3, "sensor.house"]]);
  assert.deepEqual([result.water_devices[0].name, result.water_devices[0].unit, result.water_devices[0].value], ["Shower", "m³", 0.03]);
});

test("a grid-only setup derives home consumption without inventing solar or batteries", () => {
  const result = model({
    preferences: energySources({ energy_sources: [{ type: "grid", stat_energy_from: "sensor.import" }], device_consumption: [{ stat_consumption: "sensor.car", name: "Car charger" }] }),
  });
  assert.equal(result.totals.home, 8);
  assert.equal(result.totals.solar, 0);
  assert.deepEqual(result.sources.map((row) => row.kind), ["grid_import"]);
  assert.equal(result.totals.self_consumption, null);
});

test("missing, non-summable and incompatible statistics are never displayed as zero", () => {
  const missing = model({ statistics: { ...statistics, "sensor.import": [] } });
  assert.equal(missing.totals.grid_import, null);
  assert.equal(missing.totals.home, null);
  assert.ok(missing.warnings.some((row) => row.id === "sensor.import" && row.code === "missing_statistics"));
  const incompatible = model({ metadata: metadata.map((row) => row.statistic_id === "sensor.import" ? meta(row.statistic_id, "W", "power") : row) });
  assert.equal(incompatible.totals.grid_import, null);
  assert.ok(incompatible.warnings.some((row) => row.code === "unsupported_unit"));
  const unsummable = model({ metadata: metadata.map((row) => row.statistic_id === "sensor.car" ? { ...row, has_sum: false } : row) });
  assert.equal(unsummable.devices[1].value, null);
});

test("unmatched hourly readings do not fabricate inferred flows or ratios", () => {
  const result = model({ statistics: { ...statistics, "sensor.solar": stats([4, null]) } });
  assert.equal(result.series[1].solar, null);
  assert.equal(result.series[1].home, null);
  assert.equal(result.totals.solar_used, null);
  assert.equal(result.totals.self_sufficiency, null);
  assert.ok(result.warnings.some((row) => row.code === "missing_statistics"));
});

test("negative balance and unknown sources are surfaced explicitly", () => {
  const negative = model({ statistics: { ...statistics, "sensor.export": stats([100, 100]) } });
  assert.equal(negative.totals.home, null);
  assert.ok(negative.warnings.some((row) => row.code === "negative_balance"));
  const unknown = model({ preferences: energySources({ energy_sources: [{ type: "future_source", stat_energy_from: "sensor.x" }] }) });
  assert.ok(unknown.warnings.some((row) => row.code === "unsupported_source"));
  assert.throws(() => energySources({ energy_sources: "bad" }), /invalid Energy preferences/);
});

test("hourly data groups by HA-local date across fall-back without losing either repeated hour", () => {
  const fallRange = energyWindow({ date: "2026-10-25", period: "week", timeZone: core.time_zone, now });
  const result = model({
    preferences: energySources({ energy_sources: [{ type: "grid", stat_energy_from: "sensor.import" }] }),
    range: fallRange, statistics: { "sensor.import": stats([1, 2], Date.parse("2026-10-25T00:00:00Z")) },
  });
  assert.equal(result.series.length, 1);
  assert.equal(result.series[0].grid_import, 3);
  assert.equal(result.series[0].home, 3);
});

function fakeHA({ prefs = preferences, config = core, energyInfo = info, metaRows = metadata, values = statistics, fail } = {}) {
  const calls = [];
  const ha = {
    connected: true, entityIndex: new Map(),
    async request(message, options) {
      calls.push({ ...message, options });
      if (fail) await fail(message);
      if (message.type === "energy/get_prefs") return prefs;
      if (message.type === "get_config") return config;
      if (message.type === "energy/info") return energyInfo;
      if (message.type === "recorder/get_statistics_metadata") return metaRows;
      if (message.type === "recorder/statistics_during_period") return values;
      throw new Error(`Unexpected request: ${message.type}`);
    },
  };
  return { ha, calls };
}

test("EnergyService requests only configured statistics with native changes and kWh conversion", async () => {
  const { ha, calls } = fakeHA();
  const service = new EnergyService({ ha, logger: silent, now: () => now });
  service.configure({ enabled: "auto" });
  const result = await service.overview({ date: "2026-10-30" });
  assert.equal(result.totals.home, 13);
  const query = calls.find((row) => row.type === "recorder/statistics_during_period");
  assert.deepEqual([query.period, query.types, query.units, query.start_time, query.end_time], ["hour", ["change"], { energy: "kWh", volume: "m³" }, range.start, range.end]);
  assert.ok(query.statistic_ids.includes("integration:water"));
  assert.ok(query.statistic_ids.includes("sensor.recorded_cost"));
  assert.ok(!query.statistic_ids.includes("sensor.price"), "a current price is never multiplied by historical consumption");
  const count = calls.length;
  await Promise.all([service.overview({ date: "2026-10-30" }), service.overview({ date: "2026-10-30" })]);
  assert.equal(calls.length, count);
});

test("no Energy prefs is an expected empty state, not an unrestricted statistics request", async () => {
  const { ha, calls } = fakeHA({
    fail: async (message) => { if (message.type === "energy/get_prefs") throw Object.assign(new Error("No prefs"), { code: "not_found" }); },
  });
  const service = new EnergyService({ ha, logger: silent, now: () => now });
  service.configure({ enabled: true });
  const data = await service.overview();
  assert.equal(data.configured, false);
  assert.deepEqual(data.sources, []);
  assert.ok(!calls.some((row) => row.type.startsWith("recorder/")), "empty statistic_ids would query unrestricted metadata");
  assert.equal(service.payload().enabled, true);
});

test("Energy availability follows configured sources and page settings", async () => {
  const { ha } = fakeHA({ prefs: { energy_sources: [], device_consumption: [] } });
  const service = new EnergyService({ ha, logger: silent, now: () => now });
  service.configure({ enabled: "auto", title: "My Energy" });
  await service.refresh();
  assert.equal(service.payload().enabled, false);
  service.configure({ enabled: true });
  await service.refresh();
  assert.equal(service.payload().enabled, true);
  service.configure({ enabled: false });
  assert.equal(service.payload().enabled, false);
  await assert.rejects(service.overview(), (err) => err.status === 404);
});

test("HA errors remain visible and failed statistics requests are not cached", async () => {
  const warnings = [];
  let fail = true;
  const { ha } = fakeHA({ fail: async (message) => { if (fail && message.type === "recorder/statistics_during_period") throw new Error("Recorder unavailable"); } });
  const service = new EnergyService({ ha, logger: { warn: (msg) => warnings.push(msg) }, now: () => now });
  service.configure({ enabled: true });
  await assert.rejects(service.overview({ date: "2026-10-30" }), /Recorder unavailable/);
  fail = false;
  assert.equal((await service.overview({ date: "2026-10-30" })).totals.home, 13);
  ha.request = async () => { throw new Error("Permission denied"); };
  service.clear();
  await service.refresh();
  assert.equal(service.payload().error, "Permission denied");
  assert.ok(warnings.some((msg) => msg.includes("Permission denied")));
  await assert.rejects(service.overview(), /Permission denied/);
  ha.connected = false;
  await assert.rejects(service.overview(), (err) => err.status === 503);
});
