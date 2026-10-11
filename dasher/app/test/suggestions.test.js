import assert from "node:assert/strict";
import { test } from "node:test";
import { PSEUDO_IDS, buildSuggestions } from "../src/suggestions.js";
import { rankCandidates } from "../src/mapping.js";
import { buildSnippet } from "../web/js/lib/suggestions.js";

const index = new Map(
  [
    ["calendar.family", "Family", "calendar"],
    ["weather.forecast_hjem", "Forecast Hjem", "weather"],
    ["sensor.energi_data_service", "Energi Data Service", "sensor", "DKK/kWh"],
    ["sensor.living_room_temperature", "Living room temperature", "sensor", "°C"],
  ].map(([id, name, domain, unit]) => [id, { id, name, domain, unit }]),
);
const config = (tiles) => ({ pages: [{ tiles }] });

test("suggests the calendar tile and the car price when the dashboard lacks them", () => {
  const found = buildSuggestions({ config: config([{ type: "vehicle", entity: "sensor.range" }]), index });
  assert.deepEqual(found.map((s) => s.id), ["calendar", "car_price"]);
  assert.ok(found.flatMap((s) => s.fields).every((f) => PSEUDO_IDS.has(f.for)));
});

test("nothing is suggested once the features are in use, or when there is nothing to pick", () => {
  assert.deepEqual(buildSuggestions({ config: config([{ type: "calendar" }, { type: "vehicle", price: { entity: "sensor.x" } }]), index }), []);
  assert.deepEqual(buildSuggestions({ config: config([{ type: "toggle" }]), index: new Map() }), []);
  // a car tile suggestion needs a car tile
  assert.deepEqual(buildSuggestions({ config: config([{ type: "calendar" }]), index }).map((s) => s.id), []);
});

test("stand-in ids rank the right entities first", () => {
  const price = rankCandidates({ index, registries: null, from: "sensor.electricity_price_pris_energi" });
  assert.equal(price[0].id, "sensor.energi_data_service");
  assert.deepEqual(rankCandidates({ index, registries: null, from: "calendar.calendar" }).map((c) => c.id), ["calendar.family"]);
  assert.deepEqual(rankCandidates({ index, registries: null, from: "weather.forecast_weather" }).map((c) => c.id), ["weather.forecast_hjem"]);
});

test("buildSnippet writes the calendar tile", () => {
  const text = buildSnippet("calendar", { entities: ["calendar.family", "calendar.privat"], weather_entity: "weather.forecast_hjem" });
  assert.match(text, /^- type: calendar/);
  assert.match(text, /^ {2}entities: \[calendar.family, calendar.privat\]$/m);
  assert.match(text, /^ {2}weather_entity: weather.forecast_hjem$/m);
  const bare = buildSnippet("calendar", {});
  assert.doesNotMatch(bare, /^ {2}entities:/m);
  assert.doesNotMatch(bare, /weather_entity/);
});

test("buildSnippet writes the price block, in øre for kroner sensors", () => {
  assert.equal(buildSnippet("car_price", {}), "");
  const dk = buildSnippet("car_price", { entity: "sensor.energi_data_service" }, { "sensor.energi_data_service": "DKK/kWh" });
  assert.match(dk, /multiplier: 100/);
  assert.match(dk, /unit: øre/);
  const other = buildSnippet("car_price", { entity: "sensor.x" }, { "sensor.x": "EUR/kWh" });
  assert.equal(other, "price:\n  entity: sensor.x");
});
