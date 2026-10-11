import assert from "node:assert/strict";
import { test } from "node:test";
import { discoverClimate, resolveClimate } from "../src/climate.js";
import { parseConfig } from "../src/config.js";
import { climateStatus, climateSummary, niceName, powerCall, stepTarget } from "../web/js/lib/climate.js";

const row = (ei, pl, extra = {}) => ({ ei, pl, ...extra });
const registries = {
  entities: [
    row("climate.stue", "climate_group_helper"),
    row("climate.kontor", "climate_group_helper"),
    row("climate.hall", "generic_thermostat"),
    row("climate.hidden_group", "climate_group_helper", { hb: true }),
    row("climate.climate_stue_01", "zwave_js"),
    row("climate.heater_stuen", "esphome"),
    row("sensor.not_climate", "climate_group_helper"),
  ],
};
const index = new Map(
  ["climate.stue", "climate.kontor", "climate.hall", "climate.hidden_group", "climate.climate_stue_01", "climate.heater_stuen", "climate.ghost_only"].map((id) => [id, { id, name: id.split(".")[1].replace(/_/g, " "), domain: "climate" }]),
);
const settings = (over = {}) => ({ enabled: "auto", source: "helpers", entities: [], exclude: [], platforms: [], ...over });

test("only climate helpers are listed by default, sorted by name", () => {
  assert.deepEqual(discoverClimate({ settings: settings(), registries, index }), ["climate.hall", "climate.kontor", "climate.stue"]);
});

test("source all, explicit entities, exclude and extra platforms", () => {
  assert.equal(discoverClimate({ settings: settings({ source: "all" }), registries, index }).length, 6);
  assert.deepEqual(discoverClimate({ settings: settings({ entities: ["climate.heater_stuen", "climate.stue"] }), registries, index }), ["climate.heater_stuen", "climate.stue"]);
  assert.deepEqual(discoverClimate({ settings: settings({ exclude: ["climate.hall"] }), registries, index }), ["climate.kontor", "climate.stue"]);
  assert.ok(discoverClimate({ settings: settings({ platforms: ["esphome"] }), registries, index }).includes("climate.heater_stuen"));
});

test("entities Home Assistant does not know are left out", () => {
  const small = new Map([["climate.stue", { id: "climate.stue", name: "stue", domain: "climate" }]]);
  assert.deepEqual(discoverClimate({ settings: settings(), registries, index: small }), ["climate.stue"]);
});

test("resolveClimate: auto needs entities, false disables, true forces the page", () => {
  assert.equal(resolveClimate({ settings: settings(), registries, index }).enabled, true);
  assert.equal(resolveClimate({ settings: settings(), registries: { entities: [] }, index }).enabled, false);
  assert.equal(resolveClimate({ settings: settings({ enabled: true }), registries: { entities: [] }, index }).enabled, true);
  assert.equal(resolveClimate({ settings: settings({ enabled: false }), registries, index }).enabled, false);
  assert.equal(resolveClimate({ settings: null, registries, index }).enabled, false);
});

test("the climate: section is parsed and its entities are tracked", () => {
  const { config, errors, entities, rawEntities } = parseConfig(
    "pages:\n  - id: a\n    tiles: []\nclimate:\n  title: Varme\n  source: all\n  entities: [climate.stue, light.nope]\n  exclude: [climate.bad]\n",
  );
  assert.equal(config.climate.title, "Varme");
  assert.equal(config.climate.source, "all");
  assert.deepEqual(config.climate.entities, ["climate.stue"]);
  assert.ok(errors.some((e) => e.includes("light.nope")));
  assert.ok(entities.has("climate.stue") && rawEntities.has("climate.stue"));
  const none = parseConfig("pages:\n  - id: a\n    tiles: []\n").config.climate;
  assert.deepEqual([none.enabled, none.source, none.entities], ["auto", "helpers", []]);
});

test("climateStatus, niceName, stepTarget, powerCall and summary", () => {
  assert.equal(climateStatus({ state: "heat", attributes: { hvac_action: "idle" } }), "idle");
  assert.equal(climateStatus({ state: "heat", attributes: {} }), "heating");
  assert.equal(climateStatus({ state: "off", attributes: { hvac_action: "heating" } }), "off");
  assert.equal(climateStatus({ state: "unavailable", attributes: {} }), "unavailable");
  assert.equal(niceName("stue"), "Stue");
  assert.equal(stepTarget(20, 1, { step: 0.5, min: 5, max: 30 }), 20.5);
  assert.equal(stepTarget(30, 1, { step: 0.5, min: 5, max: 30 }), 30);
  assert.equal(stepTarget(null, -1, { step: 1, min: 5, max: 30 }), 5);
  assert.deepEqual(powerCall({ state: "heat", attributes: { hvac_modes: ["off", "heat"] } }), { service: "set_hvac_mode", data: { hvac_mode: "off" } });
  assert.deepEqual(powerCall({ state: "heat", attributes: { hvac_modes: ["heat"] } }), { service: "turn_off" });
  assert.deepEqual(powerCall({ state: "off", attributes: { hvac_modes: ["off", "heat"] } }), { service: "set_hvac_mode", data: { hvac_mode: "heat" } });
  assert.deepEqual(powerCall({ state: "off", attributes: { hvac_modes: ["off"] } }), { service: "turn_on" });
  const s = climateSummary([
    { state: "heat", attributes: { current_temperature: 20 } },
    { state: "off", attributes: { current_temperature: 22 } },
    { state: "unavailable", attributes: {} },
  ]);
  assert.deepEqual([s.total, s.on, s.average], [3, 1, 21]);
});
