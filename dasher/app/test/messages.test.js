import assert from "node:assert/strict";
import { test } from "node:test";
import { parseConfig } from "../src/config.js";
import { activeMessages, pickupDays, shortName } from "../web/js/lib/messages.js";

const now = new Date(2026, 9, 11, 22, 20);
const t = (key) => ({ msg_trash: "Empty the trash can", msg_today: "Today", msg_tomorrow: "Tomorrow", msg_in_days: "In {n} days" })[key] ?? key;
const pickup = (days, extra = {}) => {
  const d = new Date(2026, 9, 11 + days);
  const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  return { state: String(days), attributes: { next_pickup_date: date, description: "240 L Rest/Mad - Beholder (Privat)", icon: "mdi:trash-can", icon_color: "#FFC108", ...extra } };
};

test("pickupDays uses the pick-up date, else the sensor's number", () => {
  assert.equal(pickupDays(pickup(1), now), 1);
  assert.equal(pickupDays(pickup(0), now), 0);
  assert.equal(pickupDays(pickup(8), now), 8);
  assert.equal(pickupDays({ state: "3", attributes: {} }, now), 3);
  assert.equal(pickupDays({ state: "unknown", attributes: {} }, now), null);
  assert.equal(pickupDays({ state: "unavailable", attributes: { next_pickup_date: "2026-10-12" } }, now), null);
  assert.equal(pickupDays(undefined, now), null);
});

test("shortName drops the owner and the container details", () => {
  assert.equal(shortName("240 L Rest/Mad - Beholder (Privat)"), "240 L Rest/Mad");
  assert.equal(shortName("370 l Plast+MDK/Papir - Egenløsning (Privat)"), "370 l Plast+MDK/Papir");
  assert.equal(shortName("240 l Pap Egenløsning (Privat)"), "240 l Pap Egenløsning");
  assert.equal(shortName(undefined), "");
});

test("pick-up messages show today and tomorrow by default, soonest first", () => {
  const states = { "sensor.a": pickup(1), "sensor.b": pickup(8, { icon_color: "#9E9E9E" }), "sensor.c": pickup(0, { description: "370 l Plast+MDK/Papir - Egenløsning (Privat)", icon: "mdi:note" }) };
  const list = activeMessages([{ entity: "sensor.a" }, { entity: "sensor.b" }, { entity: "sensor.c" }], (id) => states[id], { now, t, locale: "en-GB" });
  assert.deepEqual(list.map((m) => m.badge), ["Today", "Tomorrow"]);
  assert.equal(list[0].title, "Empty the trash can");
  assert.match(list[0].detail, /^370 l Plast\+MDK\/Papir · /);
  assert.equal(list[0].urgent, true);
  assert.deepEqual([list[0].icon, list[1].icon, list[1].color], ["note", "trash-can", "#FFC108"]);
});

test("within_days, name, title and colour can be set; far-away pick-ups stay hidden", () => {
  const states = { "sensor.b": pickup(3) };
  assert.equal(activeMessages([{ entity: "sensor.b" }], (id) => states[id], { now, t }).length, 0);
  const list = activeMessages([{ entity: "sensor.b", within_days: 3, name: "Paper", title: "Put out the paper", color: "#112233", icon: "newspaper" }], (id) => states[id], { now, t });
  assert.deepEqual([list[0].title, list[0].badge, list[0].color, list[0].icon, list[0].detail.startsWith("Paper")], ["Put out the paper", "In 3 days", "#112233", "newspaper", true]);
  const none = activeMessages([{ entity: "sensor.b", within_days: 0 }], (id) => states[id], { now, t });
  assert.equal(none.length, 0);
});

test("state messages show while their condition holds", () => {
  const states = { "binary_sensor.door": { state: "on", attributes: { friendly_name: "Garage door" } }, "sensor.t": { state: "31", attributes: {} } };
  const get = (id) => states[id];
  const list = activeMessages(
    [{ entity: "binary_sensor.door", text: "The garage door is open", icon: "garage-open" }, { entity: "sensor.t", when: { entity: "sensor.t", above: 30 }, text: "Hot" }, { entity: "sensor.t", when: { entity: "sensor.t", below: 10 }, text: "Cold" }],
    get,
    { now, t },
  );
  assert.deepEqual(list.map((m) => m.title), ["The garage door is open", "Hot"]);
  assert.equal(activeMessages([{ entity: "binary_sensor.door" }], get, { now, t })[0].title, "Garage door");
  assert.deepEqual(activeMessages(null, get, { now, t }), []);
});

test("the hero tile's messages entities are collected for tracking and mapping", () => {
  const { entities, rawEntities } = parseConfig("pages:\n  - id: a\n    tiles:\n      - type: hero\n        messages:\n          - { entity: sensor.waste, within_days: 1 }\n          - { entity: binary_sensor.x, when: { entity: sensor.y, state: on } }\n");
  for (const id of ["sensor.waste", "binary_sensor.x", "sensor.y"]) assert.ok(entities.has(id) && rawEntities.has(id), id);
});

// ---- vacuum water ----

import { tidyName, vacuumInfo, vacuumWater } from "../web/js/lib/devices.js";
import { withVacuumMessages } from "../web/js/lib/messages.js";

const vac = (state, attrs = {}) => ({ state, attributes: { friendly_name: "Robbie   Robbie ", supported_features: 31676, ...attrs } });
const tv = (key) => ({ msg_vac_water: "Change the water", msg_vac_fill: "Refill the clean water tank", msg_vac_empty: "Empty the dirty water tank" })[key] ?? key;

test("vacuumWater reads the tank status, the low water flag, the error and the faults", () => {
  assert.deepEqual(vacuumWater(vac("paused", { clean_water_tank_status: "Low water" })), { clean: true, dirty: false });
  assert.deepEqual(vacuumWater(vac("paused", { error: "Water tank dry", faults: { 107: "Water tank dry" } })), { clean: true, dirty: false });
  assert.deepEqual(vacuumWater(vac("docked", { low_water: true })), { clean: true, dirty: false });
  assert.deepEqual(vacuumWater(vac("docked", { low_water_warning: "No water in the tank" })), { clean: true, dirty: false });
  assert.deepEqual(vacuumWater(vac("docked", { dirty_water_tank_status: "Full" })), { clean: false, dirty: true });
  assert.deepEqual(vacuumWater(vac("error", { faults: { 9: "Dirty water tank full" } })), { clean: false, dirty: true });
  assert.deepEqual(vacuumWater(vac("docked", { clean_water_tank_status: "Installed", dirty_water_tank_status: "Installed", error: "No error", low_water_warning: "No warning", low_water: false })), { clean: false, dirty: false });
  assert.deepEqual(vacuumWater(vac("docked", { clean_water_tank_status: "Not installed" })), { clean: false, dirty: false });
  assert.deepEqual(vacuumWater({ state: "unavailable", attributes: { clean_water_tank_status: "Low water" } }), { clean: false, dirty: false });
  assert.deepEqual(vacuumWater(undefined), { clean: false, dirty: false });
  assert.equal(vacuumInfo(vac("paused", { clean_water_tank_status: "Low water" })).water.clean, true);
});

test("tidyName collapses the doubled names Dreame uses", () => {
  assert.deepEqual(["Robbie   Robbie ", "Overlord  Overlord", "Grass eater", "Robot Vac Robot Vac", "A B C"].map(tidyName), ["Robbie", "Overlord", "Grass eater", "Robot Vac", "A B C"]);
});

test("a vacuum that needs water gives a message for each vacuum, with its own name", () => {
  const states = { "vacuum.a": vac("paused", { clean_water_tank_status: "Low water" }), "vacuum.b": vac("docked", { friendly_name: "Overlord  Overlord", dirty_water_tank_status: "Full", low_water: true }), "vacuum.c": vac("docked") };
  const list = activeMessages([{ kind: "vacuum" }], (id) => states[id], { now, t: tv, vacuums: ["vacuum.a", "vacuum.b", "vacuum.c"] });
  assert.equal(list.length, 2);
  assert.deepEqual([list[0].title, list[0].detail, list[0].icon], ["Change the water", "Robbie · Refill the clean water tank", "water-alert"]);
  assert.equal(list[1].detail, "Overlord · Refill the clean water tank · Empty the dirty water tank");
  const one = activeMessages([{ kind: "vacuum", entity: "vacuum.a", name: "Living room", title: "Water!", color: "#112233" }], (id) => states[id], { now, t: tv, vacuums: ["vacuum.b"] });
  assert.deepEqual([one.length, one[0].title, one[0].detail.startsWith("Living room"), one[0].color], [1, "Water!", true, "#112233"]);
});

test("withVacuumMessages adds the reminder when the tile has messages, unless switched off or already listed", () => {
  assert.deepEqual(withVacuumMessages({}), []);
  assert.deepEqual(withVacuumMessages({ messages: [] }), [{ kind: "vacuum" }]);
  assert.deepEqual(withVacuumMessages({ messages: [{ entity: "sensor.x" }] }), [{ entity: "sensor.x" }, { kind: "vacuum" }]);
  assert.deepEqual(withVacuumMessages({ messages: [{ entity: "sensor.x" }], vacuum_water: false }), [{ entity: "sensor.x" }]);
  const own = { messages: [{ kind: "vacuum", entity: "vacuum.a" }] };
  assert.equal(withVacuumMessages(own), own.messages);
});
