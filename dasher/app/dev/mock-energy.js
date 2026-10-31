export const MOCK_ENERGY_CONFIG = { time_zone: "Europe/Copenhagen", currency: "DKK", unit_system: { length: "km", volume: "L" }, version: "mock" };

export function mockEnergyPreferences(mode = "full") {
  if (mode === "none") return null;
  return {
    energy_sources: [
      {
        type: "grid", stat_energy_from: "sensor.demo_grid_import", name: "Grid",
        stat_energy_to: mode === "full" ? "sensor.demo_grid_export" : null,
        stat_cost: null, entity_energy_price: "sensor.demo_price", number_energy_price: null,
        stat_compensation: null, number_energy_price_export: mode === "full" ? 0.8 : null,
        entity_energy_price_export: null, cost_adjustment_day: 0,
      },
      ...(mode === "full" ? [
        { type: "solar", stat_energy_from: "sensor.demo_solar", name: "Solar panels" },
        { type: "battery", stat_energy_from: "sensor.demo_battery_out", stat_energy_to: "sensor.demo_battery_in", name: "Home battery" },
        { type: "gas", stat_energy_from: "demo:gas", name: "Gas" },
      ] : []),
      { type: "water", stat_energy_from: "demo:water", name: "Water meter" },
    ],
    device_consumption: [
      { stat_consumption: "sensor.demo_car", name: "Car charger" },
      { stat_consumption: "sensor.demo_heat_pump", name: "Heat pump" },
      { stat_consumption: "sensor.demo_dishwasher", name: "Dishwasher" },
    ],
    device_consumption_water: [],
  };
}

export const MOCK_ENERGY_INFO = {
  cost_sensors: { "sensor.demo_grid_import": "sensor.demo_grid_cost", "sensor.demo_grid_export": "sensor.demo_export_revenue" },
  solar_forecast_domains: [],
};

const units = {
  "sensor.demo_grid_import": ["Grid import", "kWh", "energy"],
  "sensor.demo_grid_export": ["Grid export", "kWh", "energy"],
  "sensor.demo_solar": ["Solar panels", "kWh", "energy"],
  "sensor.demo_battery_out": ["Battery discharge", "kWh", "energy"],
  "sensor.demo_battery_in": ["Battery charging", "kWh", "energy"],
  "sensor.demo_grid_cost": ["Grid cost", "DKK", null],
  "sensor.demo_export_revenue": ["Export revenue", "DKK", null],
  "sensor.demo_car": ["Car charger", "kWh", "energy"],
  "sensor.demo_heat_pump": ["Heat pump", "kWh", "energy"],
  "sensor.demo_dishwasher": ["Dishwasher", "kWh", "energy"],
  "demo:water": ["Water meter", "m³", "volume"],
  "demo:gas": ["Gas", "m³", "volume"],
};

export function mockEnergyMetadata(ids) {
  return ids.filter((id) => units[id]).map((id) => ({
    statistic_id: id, name: units[id][0], display_unit_of_measurement: units[id][1],
    statistics_unit_of_measurement: units[id][1], unit_class: units[id][2],
    has_sum: true, has_mean: false, mean_type: 0, source: id.includes(":") ? "demo" : "recorder",
  }));
}

export function mockEnergyStatistics(message, { now = Date.now(), mode = "full" } = {}) {
  const from = Date.parse(message.start_time);
  const to = Math.min(Date.parse(message.end_time), now);
  const response = Object.fromEntries(message.statistic_ids.filter((id) => units[id]).map((id) => [id, []]));
  const hourFormat = new Intl.DateTimeFormat("en-GB", { timeZone: MOCK_ENERGY_CONFIG.time_zone, hour: "numeric", hourCycle: "h23" });
  for (let start = from; start + 3600_000 <= to; start += 3600_000) {
    const hour = Number(hourFormat.format(start));
    const solar = mode === "full" ? Math.max(0, Math.sin((hour - 6) / 12 * Math.PI)) * 2.3 : 0;
    const exported = solar > 1.5 ? (solar - 1.5) * 0.45 : 0;
    const charged = solar > 1 ? 0.25 : 0;
    const discharged = mode === "full" && hour >= 18 && hour < 22 ? 0.4 : 0;
    const car = hour >= 0 && hour < 5 ? 0.7 : 0;
    const heat = 0.3 + (hour >= 17 && hour < 21 ? 0.4 : 0);
    const dishwasher = hour === 20 ? 0.8 : 0;
    const home = 0.45 + car + heat + dishwasher;
    const imported = Math.max(0.1, home - solar + exported + charged - discharged);
    const values = {
      "sensor.demo_grid_import": imported, "sensor.demo_grid_export": exported, "sensor.demo_solar": solar,
      "sensor.demo_battery_in": mode === "full" ? charged : 0, "sensor.demo_battery_out": discharged,
      "sensor.demo_grid_cost": imported * (hour >= 17 && hour < 21 ? 3.2 : 1.7),
      "sensor.demo_export_revenue": exported * 0.8,
      "sensor.demo_car": car, "sensor.demo_heat_pump": heat, "sensor.demo_dishwasher": dishwasher,
      "demo:water": hour >= 6 && hour < 23 ? 0.012 : 0, "demo:gas": 0.018,
    };
    for (const [id, rows] of Object.entries(response)) rows.push({ start, end: start + 3600_000, change: Number(values[id].toFixed(6)) });
  }
  return response;
}
