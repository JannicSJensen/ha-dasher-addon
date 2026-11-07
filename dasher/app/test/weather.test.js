import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { ConfigStore, parseConfig } from "../src/config.js";
import { resolveWeatherBackgrounds } from "../src/weather.js";
import { weatherPresentation } from "../web/js/lib/weather.js";
import { makeTranslator } from "../web/js/lib/i18n.js";
import { createHeroTile } from "../web/js/tiles/hero.js";

const source = `
pages:
  - id: home
    tiles:
      - { type: hero, image: lounge.jpg }
      - { type: calendar, weather_entity: weather.home }
  - id: garden
    tiles:
      - { type: hero }
`;
const index = new Map(["weather.z", "weather.a", "sun.sun", "sensor.temperature"].map((id) => [id, { id }]));
const conditions = ["sunny", "clear-night", "partlycloudy", "cloudy", "fog", "rainy", "pouring", "snowy", "snowy-rainy", "hail", "lightning", "lightning-rainy", "windy", "windy-variant", "exceptional"];

test("only front-page heroes default to weather; explicit opt-in/out and the app switch are respected", () => {
  const config = parseConfig(source).config;
  assert.equal(config.pages[0].tiles[0].weather_background, true);
  assert.equal(config.pages[1].tiles[0].weather_background, false);
  assert.equal(config.pages[0].tiles[0].image, "lounge.jpg");
  const opted = parseConfig(source.replace("image: lounge.jpg", "weather_background: false").replace("{ type: hero }", "{ type: hero, weather_background: true }")).config;
  assert.equal(opted.pages[0].tiles[0].weather_background, false);
  assert.equal(opted.pages[1].tiles[0].weather_background, true);
  const off = parseConfig(source.replace("image: lounge.jpg", "weather_background: true"), { weatherBackground: false }).config;
  assert.ok(off.pages.every((p) => p.tiles.every((t) => !t.weather_background)));
  assert.equal(resolveWeatherBackgrounds(off, index).entities.size, 0);
});

test("weather selection uses explicit, same-page calendar, other calendar, then deterministic discovery", () => {
  const original = parseConfig(source).config;
  const resolved = resolveWeatherBackgrounds(original, index);
  assert.equal(resolved.config.pages[0].tiles[0].weather_entity, "weather.home");
  assert.equal(resolved.config.pages[0].tiles[0].sun_entity, "sun.sun");
  assert.deepEqual([...resolved.entities].sort(), ["sun.sun", "weather.home"]);
  assert.equal(original.pages[0].tiles[0].weather_entity, undefined, "saved config is not mutated");
  const explicit = parseConfig(source.replace("image: lounge.jpg", "weather_entity: weather.custom, sun_entity: sun.custom")).config;
  assert.equal(resolveWeatherBackgrounds(explicit, index).config.pages[0].tiles[0].weather_entity, "weather.custom");
  assert.deepEqual([...resolveWeatherBackgrounds(explicit, index).entities].sort(), ["sun.custom", "weather.custom"]);
  const shared = parseConfig(source.replace("{ type: hero }", "{ type: hero, weather_background: true }")).config;
  assert.equal(resolveWeatherBackgrounds(shared, index).config.pages[1].tiles[0].weather_entity, "weather.home");
  const discovery = parseConfig("pages: [{ tiles: [{ type: hero }] }]").config;
  assert.equal(resolveWeatherBackgrounds(discovery, index).config.pages[0].tiles[0].weather_entity, "weather.a");
  assert.equal(resolveWeatherBackgrounds(discovery).config.pages[0].tiles[0].weather_entity, null);
  assert.equal(resolveWeatherBackgrounds(discovery).config.pages[0].tiles[0].sun_entity, null);
  assert.deepEqual(resolveWeatherBackgrounds(null, index), { config: null, entities: new Set() });
});

test("configured weather is mapped before resolution and still tracked with no calendar tile", () => {
  const parsed = parseConfig("pages: [{ tiles: [{ type: hero, weather_entity: weather.old, sun_entity: sun.custom }] }]", { entityMap: { "weather.old": "weather.new" } });
  assert.ok(parsed.entities.has("weather.new") && parsed.entities.has("sun.custom"));
  assert.ok(parsed.rawEntities.has("weather.old"));
  assert.equal(resolveWeatherBackgrounds(parsed.config, index).config.pages[0].tiles[0].weather_entity, "weather.new");
  const calendar = parseConfig(source, { entityMap: { "weather.home": "weather.mapped" } });
  assert.equal(resolveWeatherBackgrounds(calendar.config, index).config.pages[0].tiles[0].weather_entity, "weather.mapped");
});

test("invalid weather settings produce configuration errors, without watching another entity domain", () => {
  const parsed = parseConfig("pages: [{ tiles: [{ type: hero, weather_background: sometimes, weather_entity: sensor.temperature, sun_entity: light.lamp }] }]");
  assert.equal(parsed.errors.length, 3);
  assert.equal(parsed.entities.size, 0);
  assert.equal(parsed.config.pages[0].tiles[0].weather_entity, undefined);
});

test("ConfigStore keeps the HA weather switch across reloads without rewriting the dashboard", (context) => {
  const dir = mkdtempSync(path.join(tmpdir(), "dasher-weather-"));
  context.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, "dashboard.yaml");
  writeFileSync(file, source);
  const store = new ConfigStore({ dir, logger: { warn() {} }, weatherBackgroundOption: false });
  assert.equal(store.load().config.pages[0].tiles[0].weather_background, false);
  assert.equal(store.load().config.pages[0].tiles[0].weather_background, false);
  assert.equal(readFileSync(file, "utf8"), source);
});

test("all HA conditions are recognized and translated; sun state controls night independently of weather", () => {
  for (const condition of conditions) {
    for (const state of ["above_horizon", "below_horizon"]) {
      const model = weatherPresentation({ state: condition }, { state });
      assert.equal(model.condition, condition);
      assert.ok(model.scene);
      assert.equal(model.night, state === "below_horizon");
    }
    for (const language of ["en", "da"]) {
      const key = `weather_${condition.replaceAll("-", "_")}`;
      assert.notEqual(makeTranslator(language)(key), key);
      assert.notEqual(makeTranslator(language)("hero_weather_unavailable"), "hero_weather_unavailable");
    }
  }
  assert.equal(weatherPresentation({ state: "clear-night" }).night, true);
  assert.equal(weatherPresentation({ state: "clear-night" }, { state: "unavailable" }).night, true);
  assert.equal(weatherPresentation({ state: "sunny" }, { state: "below_horizon" }).night, true);
});

test("missing/unknown conditions never fabricate sunny weather and missing temperature is not zero", () => {
  for (const state of [undefined, "unknown", "unavailable", "new-condition", "constructor"]) {
    const model = weatherPresentation({ state, attributes: { temperature: null } });
    assert.equal(model.scene, null);
    assert.equal(model.condition, null);
    assert.equal(model.temperature, null);
  }
  for (const temperature of [null, undefined, "10", "", NaN, Infinity]) assert.equal(weatherPresentation({ attributes: { temperature } }).temperature, null);
  assert.equal(weatherPresentation({ state: "snowy", attributes: { temperature: 0, temperature_unit: "°C" } }).temperature, 0);
  assert.equal(weatherPresentation({ state: "sunny", attributes: { temperature: 72, temperature_unit: "°F" } }).unit, "°F");
});

class TestNode {
  constructor(tag = "", text = "") {
    this.tag = tag;
    this.text = text;
    this.children = [];
    this.attributes = {};
    this.dataset = {};
    this.style = { setProperty() {} };
    this.className = "";
    const change = (name, enabled) => {
      const names = new Set(this.className.split(" ").filter(Boolean));
      if (enabled) names.add(name); else names.delete(name);
      this.className = [...names].join(" ");
    };
    this.classList = { add: (name) => change(name, true), remove: (name) => change(name, false), toggle: change };
  }
  append(...nodes) { this.children.push(...nodes); }
  replaceChildren(...nodes) { this.text = ""; this.children = [...nodes]; }
  setAttribute(key, value) { this.attributes[key] = String(value); }
  addEventListener() {}
  get textContent() { return this.text + this.children.map((n) => n.textContent).join(""); }
  set textContent(value) { this.text = String(value); this.children = []; }
}
const find = (node, className) => [node, ...node.children.flatMap((child) => find(child, className))].filter((n) => n.className.split(" ").includes(className));
const withDOM = (context) => {
  const original = { document: globalThis.document, Node: globalThis.Node, fetch: globalThis.fetch };
  const listeners = new Map();
  const timers = new Set();
  let next = 0;
  context.mock.method(globalThis, "setTimeout", () => { timers.add(++next); return next; });
  context.mock.method(globalThis, "setInterval", () => { timers.add(++next); return next; });
  context.mock.method(globalThis, "clearTimeout", (id) => timers.delete(id));
  context.mock.method(globalThis, "clearInterval", (id) => timers.delete(id));
  globalThis.Node = TestNode;
  globalThis.document = {
    hidden: false,
    createElement: (tag) => new TestNode(tag),
    createElementNS: (_, tag) => new TestNode(tag),
    createTextNode: (text) => new TestNode("", text),
    addEventListener: (event, listener) => listeners.set(event, listener),
    removeEventListener: (event) => listeners.delete(event),
  };
  globalThis.fetch = async () => ({ ok: false, text: async () => "" });
  context.after(() => { for (const [key, value] of Object.entries(original)) { if (value === undefined) delete globalThis[key]; else globalThis[key] = value; } });
  return { listeners, timers };
};

test("hero updates scenes without replacing controls, falls back visibly and cleans up when unmounted", async (context) => {
  let tile;
  context.after(() => tile?.destroy());
  const { listeners, timers } = withDOM(context);
  const weather = { state: "rainy", attributes: { temperature: 11, temperature_unit: "°C" } };
  const sun = { state: "above_horizon" };
  const ctx = { t: makeTranslator("en"), locale: "en", getState: (id) => id === "weather.home" ? weather : id === "sun.sun" ? sun : undefined };
  tile = createHeroTile({ weather_background: true, weather_entity: "weather.home", sun_entity: "sun.sun", image: "lounge.jpg", buttons: [{ icon: "power", entity: "light.demo", name: "Lights" }] }, ctx);
  tile.update();
  const scene = find(tile.el, "weather-scene")[0];
  const buttons = find(tile.el, "button-row")[0];
  const label = find(tile.el, "hero__weather")[0];
  assert.equal(scene.dataset.weather, "rain");
  assert.equal(scene.attributes["aria-hidden"], "true");
  assert.equal(label.textContent, "Rain · 11.0°C");
  for (const state of conditions) {
    weather.state = state;
    tile.update();
    assert.equal(find(tile.el, "weather-scene")[0], scene);
    assert.equal(find(tile.el, "button-row")[0], buttons);
  }
  sun.state = "below_horizon";
  tile.update();
  assert.ok(scene.className.includes("is-night"));
  weather.state = "unavailable";
  tile.update();
  assert.equal(scene.hidden, true);
  assert.equal(label.textContent, "Weather unavailable");
  assert.ok(!tile.el.className.includes("has-weather"));
  assert.ok(find(tile.el, "hero__img").some((n) => n.style.backgroundImage?.includes("lounge.jpg")));
  document.hidden = true;
  listeners.get("visibilitychange")();
  assert.ok(scene.className.includes("is-paused"));
  document.hidden = false;
  listeners.get("visibilitychange")();
  assert.ok(!scene.className.includes("is-paused"));
  assert.equal(timers.size, 2, "only the existing clock and reminder timers are active");
  tile.destroy();
  assert.equal(listeners.size, 0);
  assert.equal(timers.size, 0);
  await new Promise((resolve) => setImmediate(resolve));
});

test("opted-out heroes contain no weather layer; hiding the clock still leaves weather status visible", async (context) => {
  let off;
  let noClock;
  context.after(() => { off?.destroy(); noClock?.destroy(); });
  withDOM(context);
  const ctx = { t: makeTranslator("da"), locale: "da", getState: () => undefined };
  off = createHeroTile({ weather_background: false }, ctx);
  noClock = createHeroTile({ weather_background: true, show_clock: false }, ctx);
  assert.equal(find(off.el, "weather-scene").length, 0);
  noClock.update();
  assert.equal(find(noClock.el, "hero__top").length, 0);
  assert.equal(find(noClock.el, "hero__weather-status")[0].textContent, "Vejret er utilgængeligt");
  await new Promise((resolve) => setImmediate(resolve));
});
