import assert from "node:assert/strict";
import { test } from "node:test";
import { parseConfig } from "../src/config.js";
import { discoverEv, resolveEv } from "../src/ev.js";

const entry = (ei, pl, tk, extra = {}) => ({ ei, pl, tk, ...extra });
const registries = {
  entities: [
    entry("sensor.ev_smart_charging_status", "ev_smart_charging", "status"),
    entry("sensor.ev_smart_charging_charging", "ev_smart_charging", "charging"),
    entry("switch.ev_smart_charging_smart_charging_activated", "ev_smart_charging", "smart_charging_activated"),
    entry("switch.ev_smart_charging_ev_connected", "ev_smart_charging", "ev_connected"),
    entry("select.ev_smart_charging_charge_start_time", "ev_smart_charging", "charge_start_time", { ec: 1 }),
    entry("select.ev_smart_charging_charge_completion_time", "ev_smart_charging", "charge_completion_time", { ec: 1 }),
    entry("button.ev_smart_charging_manually_start_charging", "ev_smart_charging", "manually_start_charging"),
    entry("button.ev_smart_charging_manually_stop_charging", "ev_smart_charging", "manually_stop_charging"),
    entry("switch.peblar_ev_charger_charge", "peblar", "charge", { ec: 1 }),
    entry("switch.peblar_ev_charger_force_single_phase", "peblar", "force_single_phase", { ec: 1 }),
    entry("button.peblar_ev_charger_identify", "peblar", undefined, { ec: 1 }),
    entry("button.peblar_ev_charger_genstart", "peblar", undefined, { ec: 1 }),
    entry("button.esphome_restart", "esphome", undefined),
    entry("switch.hidden_charge", "peblar", "charge", { hb: true }),
  ],
};

test("discoverEv finds the EV Smart Charging and Peblar entities, also config-category ones", () => {
  const found = discoverEv({ registries });
  assert.deepEqual(found, {
    smart_switch_entity: "switch.ev_smart_charging_smart_charging_activated",
    smart_status_entity: "sensor.ev_smart_charging_status",
    smart_info_entity: "sensor.ev_smart_charging_charging",
    start_time_entity: "select.ev_smart_charging_charge_start_time",
    ready_time_entity: "select.ev_smart_charging_charge_completion_time",
    start_entity: "button.ev_smart_charging_manually_start_charging",
    stop_entity: "button.ev_smart_charging_manually_stop_charging",
    plug_entity: "switch.ev_smart_charging_ev_connected",
    charge_switch_entity: "switch.peblar_ev_charger_charge",
    restart_entity: "button.peblar_ev_charger_genstart",
  });
});

test("restart buttons are recognised by device class, and other integrations are ignored", () => {
  const regs = { entities: [entry("button.charger_reboot_now", "peblar"), entry("button.charger_identify", "peblar"), entry("button.router_restart", "tplink")] };
  assert.equal(discoverEv({ registries: regs }).restart_entity, "button.charger_reboot_now");
  const byClass = { entities: [entry("button.charger_power_cycle", "peblar")] };
  const index = new Map([["button.charger_power_cycle", { deviceClass: "restart" }]]);
  assert.equal(discoverEv({ registries: byClass, index }).restart_entity, "button.charger_power_cycle");
  assert.deepEqual(discoverEv({ registries: null }), {});
});

test("resolveEv: explicit entities win, and the page only shows when something can be controlled", () => {
  const settings = (over = {}) => parseConfig("pages:\n  - id: a\n").config.ev && { ...parseConfig("pages:\n  - id: a\n").config.ev, ...over };
  const found = discoverEv({ registries });

  const auto = resolveEv({ settings: settings({ roles: { battery_entity: "sensor.soc", restart_entity: "button.mine" } }), discovered: found });
  assert.equal(auto.enabled, true);
  assert.equal(auto.roles.battery_entity, "sensor.soc");
  assert.equal(auto.roles.restart_entity, "button.mine", "explicit wins over discovered");
  assert.equal(auto.roles.charge_switch_entity, "switch.peblar_ev_charger_charge");

  assert.equal(resolveEv({ settings: settings(), discovered: {} }).enabled, false, "nothing to control: hidden");
  assert.equal(resolveEv({ settings: settings({ roles: { battery_entity: "sensor.soc" } }), discovered: {} }).enabled, false, "a battery alone is not enough");
  assert.equal(resolveEv({ settings: settings({ enabled: true }), discovered: {} }).enabled, true, "forced on");
  assert.equal(resolveEv({ settings: settings({ enabled: false }), discovered: found }).enabled, false, "forced off");
  assert.equal(resolveEv({ settings: undefined, discovered: found }).enabled, false);
});

test("the ev section is parsed, validated and takes part in entity mapping", () => {
  const { config, errors, rawEntities, entities } = parseConfig(
    "pages:\n  - id: a\nev:\n  name: Car\n  image: car.jpg\n  battery_entity: sensor.soc\n  range_entity: not an id\n",
    { entityMap: { "sensor.soc": "sensor.real_soc" } },
  );
  assert.equal(errors.length, 1);
  assert.deepEqual(config.ev.roles, { battery_entity: "sensor.real_soc" });
  assert.deepEqual([...rawEntities], ["sensor.soc"]);
  assert.deepEqual([...entities], ["sensor.real_soc"]);
  assert.equal(config.ev.enabled, "auto");
  assert.equal(parseConfig("pages:\n  - id: a\nev:\n  enabled: false\n").config.ev.enabled, false);
});

test("discoverEv prefers the car's own FordPass entities over EV Smart Charging's connected switch", () => {
  const withCar = {
    entities: [
      ...registries.entities,
      entry("sensor.fordpass_x_elvehplug", "fordpass", "elvehplug"),
      entry("sensor.fordpass_x_soc", "fordpass", "soc"),
      entry("sensor.fordpass_x_elveh", "fordpass", "elveh"),
      entry("sensor.fordpass_x_elvehcharging", "fordpass", "elvehcharging"),
    ],
  };
  const found = discoverEv({ registries: withCar });
  assert.equal(found.plug_entity, "sensor.fordpass_x_elvehplug");
  assert.equal(found.battery_entity, "sensor.fordpass_x_soc");
  assert.equal(found.range_entity, "sensor.fordpass_x_elveh");
  // without a car integration the EV Smart Charging switch is still used
  assert.equal(discoverEv({ registries }).plug_entity, "switch.ev_smart_charging_ev_connected");
  assert.equal(discoverEv({ registries }).battery_entity, undefined);
});

test("discoverEv finds the FordPass remote climate entities", () => {
  const regs = {
    entities: [
      entry("switch.fordpass_x_ignition", "fordpass", "ignition"),
      entry("number.fordpass_x_rcctemperature", "fordpass", undefined),
      entry("switch.fordpass_x_rccdefrostfront", "fordpass", "rccdefrostfront"),
      entry("switch.fordpass_x_rccdefrostrear", "fordpass", "rccdefrostrear"),
      entry("sensor.fordpass_x_ignition", "fordpass", "ignition"),
      entry("switch.other_ignition", "other", "ignition"),
    ],
  };
  const found = discoverEv({ registries: regs });
  assert.equal(found.remote_start_entity, "switch.fordpass_x_ignition");
  assert.equal(found.remote_temp_entity, "number.fordpass_x_rcctemperature");
  assert.equal(found.defrost_front_entity, "switch.fordpass_x_rccdefrostfront");
  assert.equal(found.defrost_rear_entity, "switch.fordpass_x_rccdefrostrear");
  // remote start alone makes the page useful
  assert.equal(resolveEv({ settings: parseConfig("pages:\n  - id: a\n    tiles: []\nev: {}\n").config.ev, discovered: found }).enabled, true);
  const explicit = parseConfig("pages:\n  - id: a\n    tiles: []\nev:\n  remote_temp_entity: number.my_temp\n").config.ev;
  assert.equal(resolveEv({ settings: explicit, discovered: found }).roles.remote_temp_entity, "number.my_temp");
});
