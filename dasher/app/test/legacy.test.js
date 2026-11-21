import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { test } from "node:test";
import { parse } from "acorn";

const script = fs.readFileSync(new URL("../web/legacy/legacy.js", import.meta.url), "utf8");

test("legacy script uses ES5 grammar", () => {
  assert.doesNotThrow(() => parse(script, { ecmaVersion: 5 }));
});

function harness() {
  class Element {
    constructor(tag) { this.tag = tag; this.children = []; this._text = ""; }
    set textContent(value) { this._text = String(value); this.children = []; }
    get textContent() { return this._text + this.children.map((child) => child.textContent).join(""); }
    appendChild(child) { this.children.push(child); return child; }
  }
  const elements = Object.fromEntries(["notice", "content", "menu", "title", "connection"].map((id) => [id, new Element("div")]));
  const document = { getElementById: (id) => elements[id], createElement: (tag) => new Element(tag) };
  const listeners = {};
  const location = { hash: "" };
  const window = { location, addEventListener: (type, fn) => { listeners[type] = fn; } };
  const requests = [];
  class Xhr {
    open(method, url) { this.method = method; this.url = url; }
    setRequestHeader() {}
    send(body) { this.body = body && JSON.parse(body); requests.push(this); }
    respond(data, status = 200) { this.status = status; this.responseText = JSON.stringify(data); this.onload(); }
  }
  let source;
  class Source {
    static CLOSED = 2;
    constructor(url) { this.url = url; this.listeners = {}; source = this; }
    addEventListener(type, fn) { this.listeners[type] = fn; }
    emit(type, data) { this.listeners[type]({ data: JSON.stringify(data) }); }
    close() {}
  }
  let timerId = 0;
  const timers = new Map();
  vm.runInNewContext(script, {
    document, window, EventSource: Source, XMLHttpRequest: Xhr,
    setTimeout: (fn) => { timers.set(++timerId, fn); return timerId; },
    clearTimeout: (id) => timers.delete(id), setInterval() {}, Date, JSON, Math, Array,
    encodeURIComponent, isFinite,
  });
  const all = (root) => [root, ...root.children.flatMap(all)];
  function find(text) {
    const node = all(elements.content).find((item) => item.tag === "button" && item.textContent === text);
    assert.ok(node, `Missing button: ${text}; content: ${elements.content.textContent}`);
    return node;
  }
  const route = (id) => { location.hash = "#/" + id; listeners.hashchange(); };
  const flush = () => { const callbacks = [...timers.values()]; timers.clear(); callbacks.forEach((fn) => fn()); };
  return { elements, source, requests, find, route, flush };
}

const config = {
  title: "Test", language: "en", pages: [{ id: "home", title: "Home", tiles: [
    { type: "hero", buttons: [{ name: "Lights", entity: "light.lamp" }] },
    { type: "calendar", entities: ["calendar.home"], days: 7 },
    { type: "buttons", title: "Shortcuts", buttons: [{ name: "Scene", entity: "scene.evening" }] },
  ] }], menu_items: [{ id: "areas", visible: false }],
  climate: {}, areas: {}, music: {}, plex: {}, ev: {}, energy: {}, calendar: { enabled: true },
};
const entity = (id, state, attributes = {}) => ({ entity_id: id, state, attributes });
function setup(h) {
  h.source.emit("status", { ha: true, readOnly: false });
  h.source.emit("config", { config, errors: [] });
  h.source.emit("climate", { enabled: true, entities: ["climate.room"] });
  h.source.emit("areas", { enabled: true, areas: [{ name: "Room", entities: ["light.lamp"], hidden_entities: ["light.hidden"] }] });
  h.source.emit("music", { enabled: true, players: ["media_player.speaker"] });
  h.source.emit("plex", { enabled: true, players: ["media_player.tv"] });
  h.source.emit("ev", { enabled: true, roles: { charge_switch_entity: "switch.charger", remote_start_entity: "switch.remote" } });
  h.source.emit("energy", { enabled: true, today: "2026-01-02" });
  h.source.emit("snapshot", {
    "light.lamp": entity("light.lamp", "on", { friendly_name: "Lamp" }),
    "scene.evening": entity("scene.evening", "unknown", {}),
    "climate.room": entity("climate.room", "heat", { temperature: 20, current_temperature: 19, min_temp: 5, max_temp: 30, hvac_modes: ["off", "heat"] }),
    "media_player.speaker": entity("media_player.speaker", "playing", {}),
    "media_player.tv": entity("media_player.tv", "idle", {}),
    "switch.charger": entity("switch.charger", "off", {}),
    "switch.remote": entity("switch.remote", "off", {}),
  });
}

test("legacy home honors hidden menu items, configured actions, ingress-relative URLs and read-only", () => {
  const h = harness();
  setup(h);
  assert.equal(h.source.url, "../api/events");
  assert.ok(!h.elements.menu.textContent.includes("Areas"));
  const agenda = h.requests.find((r) => r.url.startsWith("../api/calendar?"));
  assert.match(agenda.url, /entities=calendar.home/);
  agenda.respond({ events: [{ start: "2099-01-02", end: "2099-01-03", allDay: true, summary: "Appointment" }] });
  assert.match(h.elements.content.textContent, /Appointment/);
  h.find("Lights · on").onclick();
  assert.deepEqual(h.requests.at(-1).body, { domain: "light", service: "toggle", entity_id: "light.lamp", data: {} });
  assert.equal(h.find("Scene · Unknown").disabled, false);
  h.find("Scene · Unknown").onclick();
  assert.equal(h.requests.at(-1).body.service, "turn_on");
  h.source.emit("status", { ha: true, readOnly: true });
  assert.equal(h.find("Lights · on").disabled, true);
});

test("legacy climate batches half-degree changes and preserves thermostat power modes", () => {
  const h = harness(); setup(h); h.route("climate");
  h.find("+ 0.5°").onclick();
  h.find("+ 0.5°").onclick();
  h.flush();
  assert.deepEqual(h.requests.at(-1).body, { domain: "climate", service: "set_temperature", entity_id: "climate.room", data: { temperature: 21 } });
  h.requests.at(-1).respond({ ok: true });
  h.find("Power").onclick();
  assert.deepEqual(h.requests.at(-1).body.data, { hvac_mode: "off" });
});

test("legacy controls use existing services and report server errors", () => {
  const h = harness(); setup(h); h.route("music");
  h.find("Next track").onclick();
  assert.equal(h.requests.at(-1).body.service, "media_next_track");
  h.requests.at(-1).respond({ error: "Denied" }, 400);
  assert.equal(h.elements.notice.textContent, "Denied");
  h.route("ev");
  h.find("Start charging").onclick();
  assert.deepEqual(h.requests.at(-1).body, { domain: "switch", service: "turn_on", entity_id: "switch.charger", data: {} });
  h.source.emit("state", entity("switch.charger", "on", {}));
  h.find("Stop charging").onclick();
  assert.equal(h.requests.at(-1).body.service, "turn_off");
  h.find("Remote climate · off").onclick();
  assert.equal(h.requests.at(-1).body.entity_id, "switch.remote");
});

test("legacy areas omit hidden devices and stateless charging buttons are usable", () => {
  const h = harness(); setup(h);
  h.source.emit("config", { config: { ...config, menu_items: [] }, errors: [] });
  h.route("areas");
  assert.match(h.elements.content.textContent, /Lamp/);
  assert.doesNotMatch(h.elements.content.textContent, /light.hidden/);
  h.source.emit("snapshot", {
    "sensor.charging": entity("sensor.charging", "off"),
    "button.start": entity("button.start", "unknown"),
  });
  h.source.emit("ev", { enabled: true, roles: { smart_info_entity: "sensor.charging", start_entity: "button.start" } });
  h.route("ev");
  const start = h.find("Start charging");
  assert.equal(start.disabled, false);
  start.onclick();
  assert.equal(h.requests.at(-1).body.service, "press");
});

test("legacy energy retains missing values and calendar shows partial failures", () => {
  const h = harness(); setup(h); h.route("energy");
  const energy = h.requests.at(-1);
  assert.equal(energy.url, "../api/energy?period=day");
  energy.respond({ configured: true, today: "2026-01-02", totals: { home: null, solar: 0 }, sources: [{ name: "Gas", value: 3, unit: "m³" }], warnings: [] });
  assert.match(h.elements.content.textContent, /Home: Unavailable/);
  assert.match(h.elements.content.textContent, /Solar: 0 kWh/);
  assert.match(h.elements.content.textContent, /Gas: 3 m³/);
  h.find("Previous").onclick();
  assert.match(h.requests.at(-1).url, /date=2026-01-01/);
  h.route("calendar");
  const calendar = h.requests.at(-1);
  assert.match(calendar.url, /^\.\.\/api\/calendar\/view\?/);
  calendar.respond({ events: [
    { start: "2099-01-02", end: "2099-01-03", allDay: true, summary: "Meeting" },
    { start: "2001-01-02T09:00:00Z", end: "2001-01-02T10:00:00Z", summary: "Past event" },
  ], failed: ["calendar.work"] });
  assert.match(h.elements.content.textContent, /Meeting/);
  assert.doesNotMatch(h.elements.content.textContent, /Past event/);
  assert.match(h.elements.content.textContent, /calendar.work/);
});

test("legacy ignores out-of-order energy responses and respects period boundaries", () => {
  const h = harness(); setup(h); h.route("energy");
  const initial = h.requests.at(-1);
  h.find("Month").onclick();
  const monthly = h.requests.at(-1);
  monthly.respond({ configured: true, today: "2026-01-15", totals: { home: 3 } });
  initial.respond({ configured: true, today: "2026-01-15", totals: { home: 99 } });
  assert.match(h.elements.content.textContent, /Home: 3 kWh/);
  assert.doesNotMatch(h.elements.content.textContent, /Home: 99 kWh/);
  assert.equal(h.find("Next").disabled, true);
  h.find("Previous").onclick();
  assert.match(h.requests.at(-1).url, /date=2025-12-01/);
});

test("legacy discards calendar responses from an old configuration", () => {
  const h = harness(); setup(h); h.route("calendar");
  const old = h.requests.at(-1);
  h.source.emit("config", { config: { ...config, calendar: { enabled: true, entities: ["calendar.new"] } }, errors: [] });
  const current = h.requests.at(-1);
  assert.notEqual(current, old);
  old.respond({ events: [{ start: "2099-01-02", allDay: true, summary: "Old" }], failed: [] });
  assert.doesNotMatch(h.elements.content.textContent, /Old/);
  current.respond({ events: [{ start: "2099-01-02", allDay: true, summary: "New" }], failed: [] });
  assert.match(h.elements.content.textContent, /New/);
});
