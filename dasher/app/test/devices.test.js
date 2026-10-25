import assert from "node:assert/strict";
import { test } from "node:test";
import { parseConfig } from "../src/config.js";
import { applianceKey, deviceEntities, deviceKeys, detectKind, discoverDevices, resolveDevices } from "../src/devices.js";
import { applianceInfo, batteryIcon, formatRemaining, remainingMinutes, vacuumInfo, vacuumMainCall } from "../web/js/lib/devices.js";

const row = (ei, di, pl, tk, extra = {}) => ({ ei, di, pl, tk, ...extra });
const registries = {
  devices: [
    { id: "w", name: "Frontbetjent vaskemaskine" },
    { id: "d", name: "Tørretumbler" },
    { id: "k", name: "Opvaskemaskine", name_by_user: "Opvask" },
    { id: "f", name: "Køleskab" },
  ],
  entities: [
    row("sensor.vask_current_status", "w", "lg_thinq", "current_state"),
    row("sensor.vask_remaining_time", "w", "lg_thinq", "remaining_time"),
    row("switch.vask_power", "w", "lg_thinq", "operation_power"),
    row("select.vask_operation", "w", "lg_thinq", "operation_mode"),
    row("number.vask_delay_ends_in", "w", "lg_thinq", "delay_ends_in"),
    row("sensor.torre_current_status", "d", "lg_thinq", "current_state"),
    row("sensor.opv_current_status", "k", "lg_thinq", "current_state"),
    row("sensor.fridge_current_status", "f", "lg_thinq", "current_state"),
    row("vacuum.robbie", null, "dreame_vacuum"),
    row("vacuum.hidden", null, "roborock", undefined, { hb: true }),
    row("switch.other_power", "w", "other", "operation_power"),
  ],
};

test("detectKind from device names and states", () => {
  assert.deepEqual(["Opvaskemaskine", "Tørretumbler", "Frontbetjent vaskemaskine", "Washer", "Dishwasher"].map((n) => detectKind(n)), ["dishwasher", "dryer", "washer", "washer", "dishwasher"]);
  assert.equal(detectKind("Køleskab"), null);
  assert.equal(detectKind("X", ["wrinkle_care"]), "dryer");
  assert.equal(detectKind("X", ["spinning"]), "washer");
});

test("discoverDevices finds vacuums and LG ThinQ appliances with their roles", () => {
  const found = discoverDevices({ registries });
  assert.deepEqual(found.vacuums, ["vacuum.robbie"]);
  assert.deepEqual(found.appliances.map((a) => [a.kind, a.name]), [["dishwasher", "Opvask"], ["washer", "Frontbetjent vaskemaskine"], ["dryer", "Tørretumbler"]].sort((a, b) => a[1].localeCompare(b[1])));
  const washer = found.appliances.find((a) => a.kind === "washer");
  assert.deepEqual(washer.roles, {
    status_entity: "sensor.vask_current_status",
    remaining_entity: "sensor.vask_remaining_time",
    power_entity: "switch.vask_power",
    operation_entity: "select.vask_operation",
    delay_entity: "number.vask_delay_ends_in",
  });
});

const settings = (over = {}) => ({ enabled: "auto", vacuums: [], exclude: [], appliances: [], ...over });

test("resolveDevices: explicit lists win, exclude removes, explicit appliances replace found ones", () => {
  const discovered = discoverDevices({ registries });
  assert.equal(resolveDevices({ settings: settings(), discovered }).enabled, true);
  assert.deepEqual(resolveDevices({ settings: settings({ vacuums: ["vacuum.x"] }), discovered }).vacuums, ["vacuum.x"]);
  assert.deepEqual(resolveDevices({ settings: settings({ exclude: ["vacuum.robbie"] }), discovered }).vacuums, []);
  const withoutWasher = resolveDevices({ settings: settings({ exclude: ["switch.vask_power"] }), discovered });
  assert.equal(withoutWasher.appliances.some((a) => a.kind === "washer"), false);
  const custom = resolveDevices({ settings: settings({ appliances: [{ kind: "washer", name: "Mine", roles: { status_entity: "sensor.vask_current_status" } }] }), discovered });
  assert.deepEqual(custom.appliances.filter((a) => a.kind === "washer").map((a) => a.name), ["Mine"]);
  assert.equal(resolveDevices({ settings: settings({ enabled: false }), discovered }).enabled, false);
  assert.equal(resolveDevices({ settings: settings(), discovered: { vacuums: [], appliances: [] } }).enabled, false);
  assert.deepEqual(resolveDevices({ settings: settings({ enabled: false }), discovered }).removed, { vacuums: [], appliances: [] });
  assert.ok(deviceEntities(custom).includes("vacuum.robbie"));
});

test("the devices: section is parsed and validated", () => {
  const { config, errors, entities } = parseConfig(
    "pages:\n  - id: a\n    tiles: []\ndevices:\n  title: Hjem\n  vacuums: [vacuum.a, light.x]\n  appliances:\n    - { kind: heater, name: Tøjvarmer, power_entity: switch.rack }\n    - { kind: toaster, power_entity: switch.t }\n    - { kind: washer }\n",
  );
  assert.equal(config.devices.title, "Hjem");
  assert.deepEqual(config.devices.vacuums, ["vacuum.a"]);
  assert.deepEqual(config.devices.appliances, [{ kind: "heater", name: "Tøjvarmer", roles: { power_entity: "switch.rack" } }]);
  assert.equal(errors.length, 3);
  assert.ok(entities.has("vacuum.a") && entities.has("switch.rack"));
});

const vac = (state, attrs = {}) => ({ state, attributes: { supported_features: 31676, ...attrs } });

test("vacuumInfo and the main button", () => {
  const cleaning = vacuumInfo(vac("cleaning", { battery_level: 54 }));
  assert.deepEqual([cleaning.cleaning, cleaning.battery, cleaning.canPause, cleaning.canDock], [true, 54, true, true]);
  assert.deepEqual(vacuumMainCall(cleaning), { service: "pause" });
  assert.deepEqual(vacuumMainCall(vacuumInfo(vac("docked"))), { service: "start" });
  assert.deepEqual(vacuumMainCall(vacuumInfo(vac("paused"))), { service: "start" });
  assert.equal(vacuumInfo(vac("docked", { battery: 80 })).battery, 80, "battery attribute fallback");
  assert.equal(vacuumInfo(vac("error", { error: "Stuck" })).error, "Stuck");
  assert.equal(vacuumInfo(vac("docked", { error: "No error" })).error, null);
  assert.equal(vacuumInfo({ state: "unavailable", attributes: {} }).usable, false);
  assert.equal(vacuumInfo({ state: "docked", attributes: { supported_features: 12288 } }).canPause, false);
  assert.equal(vacuumInfo({ state: "idle", attributes: { supported_features: 1 | 16 } }).startService, "turn_on");
  assert.equal(vacuumInfo(vac("docked", { fan_speed_list: ["a", "b"], fan_speed: "a" })).fanSpeeds.length, 2);
  assert.equal(batteryIcon(80, false), "battery-80");
  assert.equal(batteryIcon(100, true), "battery-charging-100");
  assert.equal(batteryIcon(null), "battery-unknown");
});

test("remaining time and appliance info", () => {
  const now = Date.parse("2026-10-11T20:00:00Z");
  assert.equal(remainingMinutes({ state: "2026-10-11T21:12:00Z", attributes: { device_class: "timestamp" } }, now), 72);
  assert.equal(remainingMinutes({ state: "30", attributes: { unit_of_measurement: "min" } }, now), 30);
  assert.equal(remainingMinutes({ state: "2", attributes: { unit_of_measurement: "h" } }, now), 120);
  assert.equal(remainingMinutes({ state: "unavailable", attributes: {} }, now), null);
  assert.deepEqual([formatRemaining(72), formatRemaining(5), formatRemaining(null)], ["1 h 12 min", "5 min", ""]);
  const states = {
    "sensor.s": { state: "running", attributes: {} },
    "sensor.r": { state: "2026-10-11T20:47:00Z", attributes: { device_class: "timestamp" } },
    "switch.p": { state: "on", attributes: {} },
    "select.o": { state: "unknown", attributes: { options: ["start", "stop"] } },
  };
  const roles = { status_entity: "sensor.s", remaining_entity: "sensor.r", power_entity: "switch.p", operation_entity: "select.o" };
  const running = applianceInfo(roles, (id) => states[id], now);
  assert.deepEqual([running.active, running.remaining, running.powerOn, running.canStart, running.canStop], [true, 47, true, true, true]);
  states["sensor.s"] = { state: "power_off", attributes: {} };
  const off = applianceInfo(roles, (id) => states[id], now);
  assert.deepEqual([off.active, off.remaining, off.powerOn], [false, null, false]);
  states["sensor.s"] = { state: "unavailable", attributes: {} };
  assert.equal(applianceInfo(roles, (id) => states[id], now).unavailable, true);
  assert.equal(applianceInfo({ power_entity: "switch.p" }, (id) => states[id], now).active, true, "a heater with only a switch is active when on");
});

test("removed cards leave the page but stay listed so they can be restored", () => {
  const discovered = discoverDevices({ registries });
  const hidden = new Set(["vacuum.robbie", "sensor.vask_current_status"]);
  const page = resolveDevices({ settings: settings(), discovered, hidden });
  assert.deepEqual(page.vacuums, []);
  assert.deepEqual(page.removed.vacuums, ["vacuum.robbie"]);
  assert.equal(page.appliances.some((a) => a.kind === "washer"), false);
  assert.deepEqual(page.removed.appliances.map((a) => [a.kind, a.key]), [["washer", "sensor.vask_current_status"]]);
  assert.ok(page.appliances.every((a) => a.key === applianceKey(a)));
  assert.ok(deviceEntities(page).includes("vacuum.robbie") && deviceEntities(page).includes("switch.vask_power"), "removed cards still stream their states");
  assert.ok(deviceKeys(page).has("vacuum.robbie") && deviceKeys(page).has("sensor.vask_current_status"));
  assert.ok(!deviceKeys(page).has("sensor.nope"));
  // everything removed: the page stays so the cards can be brought back
  const all = resolveDevices({ settings: settings(), discovered, hidden: deviceKeys(page) });
  assert.equal(all.enabled, true);
  assert.deepEqual([all.vacuums.length, all.appliances.length], [0, 0]);
  // a heater with only a switch is keyed by that switch
  assert.equal(applianceKey({ roles: { power_entity: "switch.rack" } }), "switch.rack");
});
