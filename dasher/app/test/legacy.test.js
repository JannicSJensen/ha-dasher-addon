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
    constructor(tag) { this.tag = tag; this.tagName = tag.toUpperCase(); this.children = []; this._text = ""; this.attributes = {}; this.style = {}; this.listeners = {}; this.className = ""; }
    set textContent(value) { this._text = String(value); this.children = []; }
    get textContent() { return this._text + this.children.map((child) => child.textContent).join(""); }
    appendChild(child) { child.parentNode = this; this.children.push(child); return child; }
    addEventListener(type, fn) { this.listeners[type] = fn; }
    setAttribute(name, value) { this.attributes[name] = String(value); }
    getAttribute(name) { return this.attributes[name] ?? null; }
    focus() { document.activeElement = this; }
    querySelector(selector) {
      return all(this).find((item) => selector[0] === "." && (item.className || "").split(" ").includes(selector.slice(1))) ?? null;
    }
  }
  const all = (root) => [root, ...root.children.flatMap(all)];
  const elements = Object.fromEntries(["notice", "content", "menu", "faces", "title", "connection", "connection-warning",
    "night-mode", "navigation", "navigation-toggle", "standard-dashboard", "face-picker", "face-picker-toggle",
    "face-picker-label", "face-picker-close", "face-picker-title", "face-picker-hint", "face-picker-list",
    "face-picker-status", "face-picker-notice"].map((id) => [id, new Element("div")]));
  elements["face-picker"].hidden = true;
  elements["face-picker-toggle"].disabled = true;
  const images = [];
  const document = {
    body: new Element("body"),
    documentElement: new Element("html"),
    getElementById: (id) => elements[id], createElement: (tag) => {
      const element = new Element(tag);
      if (tag === "img") images.push(element);
      return element;
    },
    querySelectorAll: (selector) => Object.values(elements).flatMap(all).filter((item) =>
      (selector === "[data-legacy-clock]" && item.getAttribute("data-legacy-clock") !== null) ||
      (selector === "[data-analog-clock]" && item.getAttribute("data-analog-clock") !== null)),
  };
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
  const intervals = new Map();
  let now = Date.parse("2026-01-02T10:15:00Z");
  class ClockDate extends Date {
    constructor(...args) { super(...(args.length ? args : [now])); }
  }
  vm.runInNewContext(script, {
    document, window, EventSource: Source, XMLHttpRequest: Xhr,
    setTimeout: (fn) => { timers.set(++timerId, fn); return timerId; },
    clearTimeout: (id) => timers.delete(id), setInterval: (fn, delay) => intervals.set(delay, fn), Date: ClockDate, JSON, Math, Array,
    encodeURIComponent, isFinite,
  });
  function find(text) {
    const node = all(elements.content).find((item) => item.tag === "button" && item.textContent === text);
    assert.ok(node, `Missing button: ${text}; content: ${elements.content.textContent}`);
    return node;
  }
  const route = (id) => { location.hash = "#/" + id; listeners.hashchange(); };
  const flush = () => { const callbacks = [...timers.values()]; timers.clear(); callbacks.forEach((fn) => fn()); };
  const findClass = (name) => all(elements.content).find((item) => (item.className || "").split(" ").includes(name));
  const tick = (time) => { now = Date.parse(time); intervals.get(1000)(); };
  const findTag = (tag) => all(elements.content).find((item) => item.tag === tag);
  const keydown = (key, options = {}) => {
    const event = { key, ...options, prevented: false, preventDefault() { this.prevented = true; } };
    listeners.keydown(event);
    return event;
  };
  return { elements, document, images, source, requests, find, findClass, findTag, route, flush, tick, keydown, location };
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

test("legacy clock updates in place and shows real weather without inventing temperatures", () => {
  const h = harness(); setup(h);
  const hero = { type: "hero", time_format: "12h", weather_entity: "weather.home", buttons: [] };
  h.source.emit("config", { config: { ...config, pages: [{ id: "home", title: "Home", tiles: [hero] }] }, errors: [] });
  h.source.emit("state", entity("weather.home", "rainy", { temperature: 0, temperature_unit: "°C" }));
  const clock = h.findClass("clock-panel");
  assert.ok(clock);
  assert.match(h.elements.content.textContent, /0°C/);
  assert.match(h.elements.content.textContent, /Rain/);
  const before = clock.getAttribute("aria-label");
  h.tick("2026-01-02T10:16:00Z");
  assert.notEqual(clock.getAttribute("aria-label"), before);
  assert.equal(h.findClass("clock-panel"), clock);
  h.source.emit("state", entity("weather.home", "unavailable"));
  assert.match(h.elements.content.textContent, /Unavailable/);
  assert.doesNotMatch(h.elements.content.textContent, /0°C/);
  h.source.emit("config", { config: { ...config, pages: [{ id: "home", title: "Home", tiles: [{ ...hero, show_clock: false }] }] }, errors: [] });
  assert.equal(h.findClass("clock-panel"), undefined);
  h.source.emit("config", { config: { ...config, locale: "not_a_locale", pages: [{ id: "home", title: "Home", tiles: [hero] }] }, errors: [] });
  assert.match(h.elements.notice.textContent, /Invalid dashboard locale/);
  assert.ok(h.findClass("clock-date").textContent);
});

test("legacy music presents artwork through the proxy and responds to playback state", () => {
  const h = harness(); setup(h);
  h.source.emit("music", { enabled: true, players: ["media_player.idle", "media_player.speaker"] });
  h.source.emit("state", entity("media_player.idle", "idle", { friendly_name: "Idle speaker" }));
  h.source.emit("state", entity("media_player.speaker", "playing", {
    friendly_name: "Active speaker", media_title: "A song", media_artist: "An artist",
    entity_picture: "/api/media_player_proxy/media_player.speaker?token=mock",
  }));
  h.route("music");
  assert.equal(h.elements.content.children[1].children[0].textContent, "Active speaker");
  assert.match(h.elements.content.textContent, /A song/);
  assert.match(h.elements.content.textContent, /An artist/);
  assert.equal(h.findClass("music-artwork").src, "../api/proxy?path=%2Fapi%2Fmedia_player_proxy%2Fmedia_player.speaker%3Ftoken%3Dmock");
  h.find("Play / pause").onclick();
  assert.equal(h.requests.at(-1).body.service, "media_play_pause");
  h.source.emit("state", entity("media_player.speaker", "paused", { friendly_name: "Active speaker", entity_picture: "javascript:alert(1)" }));
  assert.equal(h.elements.content.children[1].children[0].textContent, "Active speaker");
  assert.equal(h.findClass("music-artwork"), undefined);
  assert.ok(h.findClass("music-placeholder"));
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

test("legacy faces preserve menu controls and load configured albums and cameras", () => {
  const h = harness(); setup(h);
  const legacy = { faces: ["home", "home_plus", "modular", "weather", "calendar", "clock", "analog", "flow", "photos", "cameras"],
    photos: true, photo_interval: 120, cameras: true, camera_interval: 30, errors: [] };
  h.source.emit("config", { config, errors: [], legacy });
  assert.match(h.elements.faces.textContent, /Home Modular Plus/);
  assert.match(h.elements.faces.textContent, /Home Camera/);
  assert.ok(h.findClass("home-thermostat"));
  assert.match(h.find("Lights · on").className, /is-active/);
  assert.equal(h.findClass("home-control-icon").src, "../icons/lightbulb.svg");
  h.find("Lights · on").onclick();
  assert.equal(h.requests.at(-1).body.service, "toggle");
  for (const id of ["home_plus", "modular", "weather", "clock", "analog", "flow"]) {
    h.route("face/" + id);
    assert.ok(h.elements.content.textContent.length, id);
  }
  assert.doesNotMatch(h.elements.content.textContent, /Scene/);
  h.route("face/photos");
  const photos = h.requests.at(-1);
  assert.equal(photos.url, "../api/legacy/photos");
  photos.respond({ albums: [{ id: "Family", name: "Family", photos: ["holiday.jpg"] }] });
  assert.match(h.findClass("face-image").src, /legacy\/photo\?album=Family&name=holiday.jpg/);
  const select = h.findTag("select");
  select.value = ":Family";
  select.onchange();
  assert.match(h.findClass("face-image").src, /legacy\/photo\?album=Family&name=holiday.jpg/);
  h.findClass("face-image").onerror();
  assert.match(h.elements.content.textContent, /Could not load image/);
  h.route("face/cameras");
  const cameras = h.requests.at(-1);
  assert.equal(cameras.url, "../api/legacy/cameras");
  cameras.respond({ cameras: [{ id: "camera.front", name: "Front" }] });
  assert.match(h.findClass("face-image").src, /legacy\/camera\?entity=camera.front/);
  h.route("climate");
  assert.match(h.elements.content.textContent, /0.5°/);
});

test("legacy face controls reflect live state and honor climate visibility", () => {
  const h = harness(); setup(h);
  const legacy = { faces: ["home", "home_plus"], errors: [] };
  h.source.emit("config", { config, errors: [], legacy });
  assert.match(h.findClass("thermostat-value").textContent, /20°/);
  h.find("+ 0.5°").onclick();
  h.flush();
  assert.deepEqual(h.requests.at(-1).body, { domain: "climate", service: "set_temperature", entity_id: "climate.room", data: { temperature: 20.5 } });
  h.source.emit("state", entity("light.lamp", "off"));
  assert.doesNotMatch(h.find("Lights · off").className, /is-active/);
  h.source.emit("state", entity("climate.room", "off", { temperature: 20.5, current_temperature: 19, hvac_modes: ["off", "heat"] }));
  assert.doesNotMatch(h.findClass("home-thermostat").className, /is-active/);
  assert.match(h.findClass("home-thermostat").textContent, /off/);
  h.source.emit("state", entity("climate.room", "heat", { temperature: null, current_temperature: 19 }));
  assert.equal(h.findClass("thermostat-value").textContent, "Unavailable");
  assert.match(h.findClass("thermostat-value").className, /is-unavailable/);
  assert.equal(h.find("+ 0.5°").disabled, true);
  h.source.emit("status", { ha: true, readOnly: true });
  assert.equal(h.find("Lights · off").disabled, true);
  assert.equal(h.find("+ 0.5°").disabled, true);
  h.source.emit("config", { config: { ...config, menu_items: [{ id: "climate", visible: false }] }, errors: [], legacy });
  assert.equal(h.findClass("home-thermostat"), undefined);
  h.route("face/home_plus");
  assert.equal(h.findClass("home-thermostat"), undefined);
});

test("legacy navigation opens on demand and keeps connection warnings visible", () => {
  const h = harness();
  h.source.onerror();
  assert.match(h.elements["connection-warning"].textContent, /Disconnected/);
  setup(h);
  h.source.emit("config", { config, errors: [], legacy: { faces: ["home", "clock"], errors: [] } });
  const toggle = h.elements["navigation-toggle"], navigation = h.elements.navigation;
  assert.equal(navigation.hidden, true);
  assert.equal(toggle.getAttribute("aria-expanded"), "false");
  toggle.onclick();
  assert.equal(navigation.hidden, false);
  assert.equal(toggle.getAttribute("aria-label"), "Close dashboard menu");
  h.source.emit("status", { ha: false, readOnly: false });
  assert.equal(navigation.hidden, false);
  assert.match(h.elements["connection-warning"].textContent, /Disconnected/);
  h.route("face/clock");
  assert.equal(navigation.hidden, true);
  assert.equal(toggle.getAttribute("aria-expanded"), "false");
  h.source.emit("status", { ha: true, readOnly: true });
  assert.match(h.elements["connection-warning"].textContent, /Read-only/);
  h.source.emit("status", { ha: true, readOnly: false });
  assert.equal(h.elements["connection-warning"].textContent, "");
  toggle.onclick();
  h.elements["night-mode"].onclick();
  assert.equal(h.elements["night-mode"].getAttribute("aria-pressed"), "true");
  assert.equal(navigation.hidden, false);
  h.keydown("Escape");
  assert.equal(navigation.hidden, true);
  h.source.emit("config", { config: { ...config, language: "da" }, errors: [], legacy: { faces: ["home"], errors: [] } });
  assert.equal(h.document.documentElement.lang, "da");
  assert.equal(toggle.getAttribute("aria-label"), "Åbn dashboardmenu");
  assert.equal(h.elements.menu.getAttribute("aria-label"), "Dashboardsider");
});

test("legacy face picker previews configured faces without loading private images", () => {
  const h = harness();
  const toggle = h.elements["face-picker-toggle"], picker = h.elements["face-picker"];
  assert.equal(toggle.disabled, true);
  toggle.onclick();
  assert.equal(picker.hidden, true);
  setup(h);
  const legacy = { faces: ["home", "weather", "analog", "photos", "cameras"], photos: false, cameras: false,
    photo_interval: 120, camera_interval: 30, errors: [] };
  h.source.emit("config", { config, errors: [], legacy });
  h.elements["navigation-toggle"].onclick();
  const requestCount = h.requests.length;
  toggle.onclick();
  assert.equal(h.elements.navigation.hidden, true);
  assert.equal(picker.hidden, false);
  assert.equal(toggle.getAttribute("aria-expanded"), "true");
  assert.equal(h.document.activeElement, h.elements["face-picker-close"]);
  const choices = h.elements["face-picker-list"].children;
  assert.deepEqual(choices.map((choice) => choice.getAttribute("data-face")), legacy.faces);
  assert.equal(choices[0].getAttribute("aria-current"), "true");
  assert.match(choices[0].getAttribute("aria-label"), /Selected/);
  assert.equal(choices[0].children[0].getAttribute("aria-hidden"), "true");
  assert.match(choices[0].children[0].textContent, /20°/);
  assert.match(choices[3].getAttribute("aria-label"), /Not enabled/);
  assert.match(choices[4].getAttribute("aria-label"), /Not enabled/);
  const dial = allElements(choices[2]).find((item) => item.getAttribute("data-analog-clock") !== null);
  assert.match(dial.querySelector(".analog-hour").style.transform, /^rotate\(/);
  assert.equal(h.requests.length, requestCount);
  choices[1].onclick();
  assert.equal(h.location.hash, "#/face/weather");
  assert.equal(picker.hidden, true);
  assert.equal(toggle.getAttribute("aria-expanded"), "false");
  assert.equal(h.document.activeElement, toggle);
  h.route("face/weather");
  assert.match(h.elements.content.className, /face-weather/);
  toggle.onclick();
  const selected = h.elements["face-picker-list"].children[1];
  assert.equal(selected.getAttribute("aria-current"), "true");
  selected.onclick();
  assert.equal(picker.hidden, true);
  assert.equal(h.location.hash, "#/face/weather");
  assert.ok(!h.requests.some((request) => /legacy\/(photos|cameras)/.test(request.url)));
});

function allElements(root) {
  return [root, ...root.children.flatMap(allElements)];
}

test("legacy face previews use configured climate and weather without inventing values", () => {
  const h = harness(); setup(h);
  const hero = { ...config.pages[0].tiles[0], weather_entity: "weather.home" };
  const weatherConfig = { ...config, pages: [{ ...config.pages[0], tiles: [hero] }] };
  const legacy = { faces: ["home", "weather"], errors: [] };
  h.source.emit("config", { config: weatherConfig, errors: [], legacy });
  h.source.emit("state", entity("weather.home", "cloudy", { temperature: 0, temperature_unit: "°C" }));
  const toggle = h.elements["face-picker-toggle"], list = h.elements["face-picker-list"];
  toggle.onclick();
  assert.match(list.children[0].children[0].textContent, /20°/);
  assert.match(list.children[1].children[0].textContent, /0°C/);
  h.keydown("Escape");
  h.source.emit("state", entity("climate.room", "heat", { temperature: null }));
  h.source.emit("state", entity("weather.home", "unavailable"));
  toggle.onclick();
  assert.match(list.children[0].children[0].textContent, /—/);
  assert.doesNotMatch(list.children[0].children[0].textContent, /20°/);
  assert.match(list.children[1].children[0].textContent, /—/);
  h.keydown("Escape");
  h.source.emit("config", { config: { ...weatherConfig, menu_items: [{ id: "climate", visible: false }] }, errors: [], legacy });
  toggle.onclick();
  assert.ok(!allElements(list.children[0]).some((item) => item.className.split(" ").includes("preview-primary")));
  const twelveHourConfig = { ...weatherConfig, pages: [{ ...weatherConfig.pages[0], tiles: [{ ...hero, time_format: "12h" }] }] };
  h.source.emit("config", { config: twelveHourConfig, errors: [], legacy });
  assert.match(list.children[0].children[0].textContent, /\b(?:AM|PM)\b/);
});

test("legacy face chooser only loads enabled photos and cameras after selecting them", () => {
  const h = harness(); setup(h);
  const legacy = { faces: ["home", "photos", "cameras"], photos: true, cameras: true,
    photo_interval: 120, camera_interval: 30, errors: [] };
  h.source.emit("config", { config, errors: [], legacy });
  const toggle = h.elements["face-picker-toggle"], list = h.elements["face-picker-list"];
  h.route("climate");
  toggle.onclick();
  assert.ok(list.children.every((choice) => choice.getAttribute("aria-current") === null));
  assert.ok(!h.requests.some((request) => /legacy\/(photos|cameras)/.test(request.url)));
  list.children[1].onclick();
  h.route("face/photos");
  assert.equal(h.requests.filter((request) => request.url === "../api/legacy/photos").length, 1);
  toggle.onclick();
  assert.ok(!h.requests.some((request) => request.url === "../api/legacy/cameras"));
  list.children[2].onclick();
  h.route("face/cameras");
  assert.equal(h.requests.filter((request) => request.url === "../api/legacy/cameras").length, 1);
});

test("legacy face picker updates configuration, warnings and labels while open", () => {
  const h = harness(); setup(h);
  h.source.emit("config", { config, errors: [], legacy: { faces: ["home", "clock", "photos"], errors: [] } });
  const toggle = h.elements["face-picker-toggle"], list = h.elements["face-picker-list"];
  toggle.onclick();
  const stale = list.children[1];
  h.source.emit("state", entity("light.lamp", "off"));
  assert.equal(list.children[1], stale);
  h.source.emit("status", { ha: false, readOnly: true });
  assert.match(h.elements["face-picker-status"].textContent, /Disconnected.*Read-only/);
  h.source.emit("config", { config: { ...config, language: "da" }, errors: [],
    legacy: { faces: ["analog"], errors: [] } });
  assert.equal(h.elements["face-picker-label"].textContent, "Visninger");
  assert.equal(h.elements["face-picker-title"].textContent, "Vælg en visning");
  assert.equal(h.elements["face-picker-close"].getAttribute("aria-label"), "Luk visningsvælger");
  assert.deepEqual(list.children.map((choice) => choice.getAttribute("data-face")), ["analog"]);
  assert.equal(h.document.activeElement, h.elements["face-picker-close"]);
  stale.onclick();
  assert.equal(h.location.hash, "");
  assert.equal(h.elements["face-picker"].hidden, false);
  h.source.emit("config", { config: { ...config, language: "da" }, errors: [],
    legacy: { faces: [], errors: ["Invalid face list"] } });
  assert.match(list.textContent, /Ingen visninger er konfigureret/);
  assert.equal(h.elements["face-picker-notice"].textContent, "Invalid face list");
  h.keydown("Escape");
  assert.equal(h.elements["face-picker"].hidden, true);
  assert.equal(h.document.activeElement, toggle);
});

test("legacy face picker traps keyboard focus and closes on navigation", () => {
  const h = harness(); setup(h);
  h.source.emit("config", { config, errors: [], legacy: { faces: ["home", "clock"], errors: [] } });
  const toggle = h.elements["face-picker-toggle"], close = h.elements["face-picker-close"];
  toggle.onclick();
  const choices = h.elements["face-picker-list"].children;
  assert.equal(h.keydown("Tab", { shiftKey: true }).prevented, true);
  assert.equal(h.document.activeElement, choices[1]);
  assert.equal(h.keydown("Tab").prevented, true);
  assert.equal(h.document.activeElement, close);
  h.route("face/clock");
  assert.equal(h.elements["face-picker"].hidden, true);
  assert.equal(h.document.activeElement, toggle);
  toggle.onclick();
  h.elements["navigation-toggle"].onclick();
  assert.equal(h.elements["face-picker"].hidden, true);
  assert.equal(h.elements.navigation.hidden, false);
});

test("home plus keeps additional thermostats after the main controls", () => {
  const h = harness(); setup(h);
  h.source.emit("climate", { enabled: true, entities: ["climate.room", "climate.second"] });
  h.source.emit("state", entity("climate.second", "heat", { friendly_name: "Bedroom", temperature: 21 }));
  h.source.emit("config", { config, errors: [], legacy: { faces: ["home_plus"], errors: [] } });
  const children = h.elements.content.children;
  assert.ok(children.findIndex((child) => child.className.includes("home-control")) <
    children.findIndex((child) => child.textContent.includes("Bedroom")));
  assert.match(h.elements.content.textContent, /Bedroom/);
});

test("legacy wallpaper loads local assets, reports errors and ignores stale loads", () => {
  const h = harness(); setup(h);
  const legacy = { faces: ["clock"], wallpaper: "home view.jpg" };
  h.source.emit("config", { config, errors: [], legacy });
  const first = h.images.at(-1);
  assert.equal(first.src, "../assets/home%20view.jpg");
  h.source.emit("config", { config, errors: [], legacy: { ...legacy, wallpaper: "new.png" } });
  const second = h.images.at(-1);
  first.onload();
  assert.equal(h.document.body.style.backgroundImage, "");
  second.onload();
  assert.match(h.document.body.style.backgroundImage, /new\.png/);
  const imagesBeforePicker = h.images.length;
  h.elements["face-picker-toggle"].onclick();
  assert.equal(h.elements["face-picker-list"].children[0].children[0].style.backgroundImage, h.document.body.style.backgroundImage);
  assert.equal(h.images.length, imagesBeforePicker);
  h.elements["face-picker-close"].onclick();
  h.elements["night-mode"].onclick();
  assert.equal(h.elements["night-mode"].getAttribute("aria-pressed"), "true");
  assert.match(h.document.body.className, /legacy-night/);
  assert.match(h.document.body.style.backgroundImage, /rgba\(35,0,0,.82\)/);
  h.elements["night-mode"].onclick();
  assert.equal(h.elements["night-mode"].getAttribute("aria-pressed"), "false");
  assert.doesNotMatch(h.document.body.className, /legacy-night/);
  assert.match(h.document.body.style.backgroundImage, /rgba\(12,16,30,.35\)/);
  h.source.emit("config", { config, errors: [], legacy });
  h.images.at(-1).onerror();
  assert.match(h.elements.notice.textContent, /Could not load legacy wallpaper: home view.jpg/);
  assert.equal(h.document.body.style.backgroundImage, "");
});

test("disabled legacy image faces avoid requests and swipe switches faces", () => {
  const h = harness(); setup(h);
  const legacy = { faces: ["photos", "cameras"], photos: false, cameras: false, photo_interval: 120, camera_interval: 30, errors: [] };
  h.source.emit("config", { config, errors: [], legacy });
  assert.match(h.elements.content.textContent, /Enable legacy photo/);
  assert.ok(!h.requests.some((r) => /legacy\/photos/.test(r.url)));
  const target = h.elements.content;
  target.listeners.touchstart({ target, touches: [{ clientX: 200, clientY: 100 }] });
  target.listeners.touchend({ changedTouches: [{ clientX: 100, clientY: 102 }] });
  assert.equal(h.location.hash, "#/face/cameras");
  h.route("face/cameras");
  assert.match(h.elements.content.textContent, /Enable legacy camera/);
  assert.ok(!h.requests.some((r) => /legacy\/cameras/.test(r.url)));
});
