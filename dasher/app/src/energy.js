import { EventEmitter } from "node:events";
import { energyDate, energyWindow } from "./energy-window.js";

const PREFS_TTL_MS = 60_000;
const DATA_TTL_MS = 5 * 60_000;
const ELECTRICITY_KINDS = ["grid_import", "grid_export", "solar", "battery_charge", "battery_discharge"];
const ENERGY_UNITS = new Set(["Wh", "kWh", "MWh", "GWh", "TWh", "J", "kJ", "MJ", "GJ", "BTU", "kBTU", "MBTU", "cal", "kcal"]);
const VOLUME_UNITS = new Set(["L", "m³", "ft³", "gal", "fl. oz.", "mL", "CCF", "MCF"]);
const number = (value) => typeof value === "number" && Number.isFinite(value) ? value : null;
const sum = (values) => values.some((value) => value == null) ? null : values.reduce((total, value) => total + value, 0);
const error = (message, status = 502) => Object.assign(new Error(message), { status });
const text = (value) => typeof value === "string" && value.trim() ? value.trim() : null;

export function energySources(prefs, info = {}) {
  if (!prefs || !Array.isArray(prefs.energy_sources)) throw error("Home Assistant returned invalid Energy preferences.");
  const sources = [];
  const warnings = [];
  const costs = info.cost_sensors ?? {};
  const add = (source, kind, field, costField, priceField, fixedField) => {
    const id = text(source[field]);
    if (!id) return;
    const cost = text(source[costField]) ?? text(costs[id]);
    sources.push({
      id, kind, name: text(source.name), cost_id: cost,
      cost_configured: Boolean(cost || text(source[priceField]) || number(source[fixedField]) != null),
    });
  };
  for (const source of prefs.energy_sources) {
    if (!source || typeof source !== "object") throw error("Home Assistant returned an invalid Energy source.");
    if (["solar", "battery", "gas", "water"].includes(source.type) && !text(source.stat_energy_from)) throw error("Home Assistant returned an Energy source without a consumption statistic.");
    if (source.type === "battery" && !text(source.stat_energy_to)) throw error("Home Assistant returned a battery without a charging statistic.");
    if (source.type === "grid") {
      if (Array.isArray(source.flow_from) || Array.isArray(source.flow_to)) {
        for (const row of source.flow_from ?? []) add(row, "grid_import", "stat_energy_from", "stat_cost", "entity_energy_price", "number_energy_price");
        for (const row of source.flow_to ?? []) add(row, "grid_export", "stat_energy_to", "stat_compensation", "entity_energy_price", "number_energy_price");
      } else {
        add(source, "grid_import", "stat_energy_from", "stat_cost", "entity_energy_price", "number_energy_price");
        add(source, "grid_export", "stat_energy_to", "stat_compensation", "entity_energy_price_export", "number_energy_price_export");
      }
    } else if (source.type === "solar") add(source, "solar", "stat_energy_from");
    else if (source.type === "battery") {
      add(source, "battery_charge", "stat_energy_to");
      add(source, "battery_discharge", "stat_energy_from");
    } else if (["gas", "water"].includes(source.type)) add(source, source.type, "stat_energy_from", "stat_cost", "entity_energy_price", "number_energy_price");
    else warnings.push({ id: String(source.type ?? "unknown"), code: "unsupported_source" });
  }
  const devices = (key, kind) => {
    if (prefs[key] != null && !Array.isArray(prefs[key])) throw error("Home Assistant returned an invalid Energy device list.");
    return (prefs[key] ?? []).map((device) => {
      const id = text(device?.stat_consumption);
      if (!id) throw error("Home Assistant returned an Energy device without a statistic.");
      return { id, kind, name: text(device.name), parent: text(device.included_in_stat) };
    });
  };
  return { sources, devices: devices("device_consumption", "electricity"), water_devices: devices("device_consumption_water", "water"), warnings };
}

// Infer source-to-home flows per hour; whole-period totals lose charging/export ordering.
function flow(values) {
  if (ELECTRICITY_KINDS.some((kind) => values[kind] == null)) return { home: null, solar_used: null, grid_used: null, battery_used: null };
  let { grid_import: grid, grid_export: exported, solar, battery_charge: charge, battery_discharge: discharge } = values;
  const home = grid + solar + discharge - exported - charge;
  if (home < -0.000001) return { home, solar_used: null, grid_used: null, battery_used: null };
  let demand = Math.max(home, 0);
  const reserved = Math.max(0, Math.min(charge, grid - demand));
  grid -= reserved;
  charge -= reserved;
  const solarCharge = Math.min(solar, charge);
  solar -= solarCharge;
  charge -= solarCharge;
  const solarExport = Math.min(solar, exported);
  solar -= solarExport;
  exported -= solarExport;
  const batteryExport = Math.min(discharge, exported);
  discharge -= batteryExport;
  grid -= Math.min(grid, charge);
  const solarUsed = Math.min(demand, solar);
  demand -= solarUsed;
  const batteryUsed = Math.min(discharge, demand);
  demand -= batteryUsed;
  return { home: Math.max(home, 0), solar_used: solarUsed, grid_used: Math.min(demand, grid), battery_used: batteryUsed };
}

// Recorder converts changes to the requested units, not necessarily the metadata's display units.
function unitOf(meta, kind) {
  const native = meta?.display_unit_of_measurement ?? meta?.unit_of_measurement ?? meta?.statistics_unit_of_measurement;
  const energy = meta?.unit_class === "energy" || ENERGY_UNITS.has(native);
  const volume = meta?.unit_class === "volume" || VOLUME_UNITS.has(native);
  if (ELECTRICITY_KINDS.includes(kind) || kind === "electricity") return energy ? "kWh" : null;
  if (kind === "gas" && energy) return "kWh";
  return volume && text(native) ? "m³" : null;
}

export function buildEnergyOverview({ preferences, metadata, statistics, range, core, index = new Map() }) {
  const meta = new Map(metadata.map((row) => [row.statistic_id, row]));
  const warnings = [...preferences.warnings];
  const warn = (id, code) => {
    if (!warnings.some((item) => item.id === id && item.code === code)) warnings.push({ id, code });
  };
  const rowsById = new Map();
  const start = Date.parse(range.start);
  const end = Date.parse(range.end);
  for (const [id, rows] of Object.entries(statistics)) {
    if (!Array.isArray(rows)) throw error("Home Assistant returned invalid Energy statistics.");
    const valid = new Map();
    for (const row of rows) {
      if (!row || !Number.isFinite(row.start)) throw error("Home Assistant returned an invalid Energy statistic timestamp.");
      if (row.start < start || row.start >= end) continue;
      valid.set(row.start, number(row.change));
    }
    rowsById.set(id, valid);
  }
  const total = (id, { monetary = false } = {}) => {
    if (meta.get(id)?.has_sum !== true) {
      warn(id, monetary ? "cost_unavailable" : "missing_statistics");
      return null;
    }
    const values = [...(rowsById.get(id)?.values() ?? [])];
    if (!values.length || values.some((value) => value == null)) warn(id, monetary ? "cost_unavailable" : "missing_statistics");
    const known = values.filter((value) => value != null);
    if (!monetary && known.some((value) => value < 0)) {
      warn(id, "negative_balance");
      return null;
    }
    return known.length ? known.reduce((value, change) => value + change, 0) : null;
  };
  const label = (row) => row.name ?? index.get(row.id)?.name ?? meta.get(row.id)?.name ?? row.id;
  const sourceRows = preferences.sources.map((source) => {
    const unit = unitOf(meta.get(source.id), source.kind);
    if (!meta.has(source.id) || meta.get(source.id).has_sum !== true) warn(source.id, "missing_statistics");
    else if (!unit) warn(source.id, "unsupported_unit");
    let cost = null;
    if (source.cost_configured) {
      const costUnit = meta.get(source.cost_id)?.display_unit_of_measurement ?? meta.get(source.cost_id)?.unit_of_measurement;
      if (!source.cost_id || costUnit !== core.currency) warn(source.id, "cost_unavailable");
      else cost = total(source.cost_id, { monetary: true });
    }
    return { id: source.id, name: label(source), kind: source.kind, unit, value: unit ? total(source.id) : null, cost, cost_configured: source.cost_configured };
  });
  const deviceRows = (items) => {
    const rows = items.map((device) => {
      const unit = unitOf(meta.get(device.id), device.kind);
      if (!meta.has(device.id) || meta.get(device.id).has_sum !== true) warn(device.id, "missing_statistics");
      else if (!unit) warn(device.id, "unsupported_unit");
      return { id: device.id, name: label(device), unit, value: unit ? total(device.id) : null, parent: device.parent };
    });
    return rows.map((row) => {
      const children = rows.filter((child) => child.parent === row.id);
      const childTotal = sum(children.map((child) => child.value));
      return { ...row, exclusive_value: row.value == null || childTotal == null ? null : Math.max(0, row.value - childTotal) };
    });
  };
  const devices = deviceRows(preferences.devices);
  const waterDevices = deviceRows(preferences.water_devices);
  const byKind = Object.fromEntries(ELECTRICITY_KINDS.map((kind) => [kind, sourceRows.filter((row) => row.kind === kind)]));
  const totals = Object.fromEntries(ELECTRICITY_KINDS.map((kind) => [kind, sum(byKind[kind].map((row) => row.value))]));
  const stamps = [...new Set(preferences.sources.filter((source) => ELECTRICITY_KINDS.includes(source.kind)).flatMap((source) => [...(rowsById.get(source.id)?.keys() ?? [])]))].sort((a, b) => a - b);
  const buckets = stamps.map((stamp) => {
    const values = Object.fromEntries(ELECTRICITY_KINDS.map((kind) => [kind, sum(byKind[kind].map((row) => row.unit ? rowsById.get(row.id)?.get(stamp) ?? null : null))]));
    const inferred = flow(values);
    if (inferred.home == null) warn("electricity", "missing_statistics");
    else if (inferred.home < 0) warn("electricity", "negative_balance");
    return { start: stamp, ...values, ...inferred, home: inferred.home != null && inferred.home >= 0 ? inferred.home : null };
  });
  const balance = flow(totals);
  const hasElectricity = sourceRows.some((source) => ELECTRICITY_KINDS.includes(source.kind));
  totals.home = hasElectricity && balance.home != null && balance.home >= 0 ? balance.home : null;
  if (balance.home != null && balance.home < 0) warn("electricity", "negative_balance");
  totals.solar_used = buckets.length ? sum(buckets.map((bucket) => bucket.solar_used)) : null;
  const gridUsed = buckets.length ? sum(buckets.map((bucket) => bucket.grid_used)) : null;
  const battery = byKind.battery_charge.length || byKind.battery_discharge.length;
  totals.self_consumption = !battery && totals.solar > 0 && totals.solar_used != null ? Math.min(100, totals.solar_used / totals.solar * 100) : null;
  totals.self_sufficiency = totals.home > 0 && gridUsed != null ? Math.max(0, Math.min(100, (totals.home - gridUsed) / totals.home * 100)) : null;
  const costs = sourceRows.filter((source) => ["grid_import", "grid_export"].includes(source.kind));
  totals.net_cost = costs.length && costs.some((row) => row.cost != null) ? sum(costs.map((row) => row.cost == null ? null : row.cost * (row.kind === "grid_export" ? -1 : 1))) : null;
  const grouped = new Map();
  for (const bucket of buckets) {
    const day = energyDate(bucket.start, core.time_zone);
    const key = range.statistic_period === "hour" ? String(bucket.start) : range.statistic_period === "month" ? day.slice(0, 7) : day;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(bucket);
  }
  const series = [...grouped.values()].map((group) => ({
    start: new Date(group[0].start).toISOString(),
    ...Object.fromEntries([...ELECTRICITY_KINDS, "home"].map((kind) => [kind, sum(group.map((bucket) => bucket[kind]))])),
  }));
  return { configured: Boolean(preferences.sources.length || preferences.devices.length || preferences.water_devices.length || preferences.warnings.length), time_zone: core.time_zone, currency: core.currency, range, totals, series, sources: sourceRows, devices, water_devices: waterDevices, warnings };
}

export class EnergyService extends EventEmitter {
  constructor({ ha, logger, now = Date.now }) {
    super();
    this.ha = ha;
    this.log = logger;
    this.now = now;
    this.settings = { enabled: false };
    this.preferences = { sources: [], devices: [], water_devices: [], warnings: [] };
    this.core = null;
    this.loadedAt = null;
    this.generation = 0;
    this.cache = new Map();
    this.state = { enabled: false, configured: false, error: null };
  }

  configure(settings) {
    const next = settings ?? { enabled: false };
    if (JSON.stringify(next) === JSON.stringify(this.settings)) return;
    this.settings = next;
    this.clear();
    this._publish();
    if (this.ha.connected && next.enabled !== false) this.refresh();
  }

  clear() {
    this.loadedAt = null;
    this.generation++;
    this.cache.clear();
    this.loading = null;
  }

  _publish(errorMessage = null) {
    const configured = Boolean(this.preferences.sources.length || this.preferences.devices.length || this.preferences.water_devices.length || this.preferences.warnings.length);
    this.state = {
      enabled: this.settings.enabled !== false && (this.settings.enabled === true || configured || Boolean(errorMessage)),
      configured, title: this.settings.title ?? null, icon: this.settings.icon ?? "lightning-bolt-outline",
      time_zone: this.core?.time_zone ?? null, currency: this.core?.currency ?? null,
      today: this.core ? energyDate(this.now(), this.core.time_zone) : null, error: errorMessage,
    };
    this.emit("change", this.state);
    return this.state;
  }

  payload() { return this.state; }

  async refresh() {
    if (this.settings.enabled === false || !this.ha.connected) return this.state;
    if (this.loading) return this.loading;
    if (this.loadedAt != null && this.now() - this.loadedAt < PREFS_TTL_MS) return this.state;
    const generation = this.generation;
    const load = (async () => {
      try {
        const getPrefs = async () => {
          try { return await this.ha.request({ type: "energy/get_prefs" }); }
          catch (err) {
            if (err.code === "not_found") return { energy_sources: [], device_consumption: [], device_consumption_water: [] };
            throw err;
          }
        };
        const [prefs, core] = await Promise.all([getPrefs(), this.ha.request({ type: "get_config" })]);
        if (!core || !text(core.time_zone)) throw error("Home Assistant did not provide its Energy time zone.");
        energyDate(this.now(), core.time_zone);
        const info = prefs?.energy_sources?.length ? await this.ha.request({ type: "energy/info" }) : {};
        if (!info || typeof info !== "object" || Array.isArray(info)) throw error("Home Assistant returned invalid Energy information.");
        const preferences = energySources(prefs, info);
        if (generation !== this.generation) return this.state;
        const signature = JSON.stringify({ preferences, time_zone: core.time_zone, currency: core.currency });
        if (signature !== this.signature) this.cache.clear();
        this.signature = signature;
        this.preferences = preferences;
        this.core = { time_zone: core.time_zone, currency: text(core.currency) };
        this.loadedAt = this.now();
        return this._publish();
      } catch (err) {
        if (generation !== this.generation) return this.state;
        this.log.warn(`Energy configuration unavailable: ${err.message}`);
        return this._publish(err.message);
      }
    })();
    this.loading = load;
    try { return await load; }
    finally { if (this.loading === load) this.loading = null; }
  }

  async overview({ date, period = "day" } = {}) {
    if (this.settings.enabled === false) throw error("The Energy page is not available.", 404);
    if (!this.ha.connected) throw error("Home Assistant is not connected.", 503);
    await this.refresh();
    if (this.state.error) throw error(this.state.error);
    if (!this.core) throw error("Home Assistant's Energy configuration is still loading.", 503);
    const range = energyWindow({ date, period, timeZone: this.core.time_zone, now: this.now() });
    const key = `${this.signature}|${range.start}|${range.end}|${period}`;
    const cached = this.cache.get(key);
    if (cached && this.now() - cached.at < DATA_TTL_MS) return { ...await cached.promise, today: energyDate(this.now(), this.core.time_zone) };
    const preferences = this.preferences;
    const core = this.core;
    const load = (async () => {
      const ids = [...new Set([...preferences.sources.flatMap((source) => [source.id, source.cost_id]), ...preferences.devices.map((device) => device.id), ...preferences.water_devices.map((device) => device.id)].filter(Boolean))];
      let metadata = [];
      let statistics = {};
      if (ids.length) {
        [metadata, statistics] = await Promise.all([
          this.ha.request({ type: "recorder/get_statistics_metadata", statistic_ids: ids }),
          this.ha.request({
            type: "recorder/statistics_during_period", statistic_ids: ids, period: "hour",
            start_time: range.start, end_time: range.end, units: { energy: "kWh", volume: "m³" }, types: ["change"],
          }, { timeoutMs: 60_000 }),
        ]);
        if (!Array.isArray(metadata) || metadata.some((row) => !row || typeof row.statistic_id !== "string") || !statistics || typeof statistics !== "object" || Array.isArray(statistics)) throw error("Home Assistant returned invalid Energy statistics.");
      }
      return buildEnergyOverview({ preferences, metadata, statistics, range, core, index: this.ha.entityIndex });
    })();
    const entry = { at: this.now(), promise: load };
    this.cache.set(key, entry);
    if (this.cache.size > 16) this.cache.delete(this.cache.keys().next().value);
    try { return { ...await load, today: energyDate(this.now(), core.time_zone) }; }
    catch (err) {
      if (this.cache.get(key) === entry) this.cache.delete(key);
      throw err;
    }
  }
}
