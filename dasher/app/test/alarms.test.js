import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { AlarmTimers, ALARM_MAX_SECONDS, ALARM_PRESETS, ALARM_STORAGE_KEY, alarmTime } from "../web/js/lib/alarms.js";
import { parseConfig } from "../src/config.js";
import { menuItems, menuRoute } from "../web/js/lib/menu.js";
import { makeTranslator } from "../web/js/lib/i18n.js";
import { completeMenuOptions } from "../src/menu-options.js";

function setup(initial = null) {
  let value = initial;
  let now = 100_000;
  let sequence = 0;
  const errors = [];
  const storage = { getItem: () => value, setItem: (_, next) => { value = next; } };
  const create = () => new AlarmTimers({ storage, now: () => now, id: () => String(++sequence), onError: (error) => errors.push(error.message) });
  return { storage, create, errors, advance: (ms) => { now += ms; }, value: () => value };
}

test("preset durations and illustrations are shipped", () => {
  assert.deepEqual(ALARM_PRESETS.map((preset) => preset.seconds), [360, 600, 240, 720]);
  for (const preset of ALARM_PRESETS) assert.match(readFileSync(new URL(`../web/${preset.image}`, import.meta.url), "utf8"), /<svg/);
});

test("multiple independent timers use deadlines and recover after reload, navigation and elapsed time", () => {
  const env = setup();
  const timers = env.create();
  assert.equal(timers.start({ name: "Egg", seconds: 360, preset: "soft" }), true);
  assert.equal(timers.start({ name: "Tea", seconds: 240, preset: "tea" }), true);
  env.advance(245_000);
  const restored = env.create();
  assert.deepEqual(restored.due().map((item) => item.name), ["Tea"]);
  assert.equal(restored.items[0].end - restored.now(), 115_000);
  assert.equal(restored.remove(restored.items[1].id), true);
  assert.deepEqual(env.create().items.map((item) => item.name), ["Egg"]);
  env.advance(120_000);
  assert.deepEqual(restored.due().map((item) => item.name), ["Egg"]);
  assert.equal(restored.remove(restored.items[0].id), true);
  assert.deepEqual(env.create().items, []);
});

test("custom input constraints and formatting include seconds and 24 hours", () => {
  const timers = setup().create();
  for (const seconds of [0, -1, 0.1, NaN, ALARM_MAX_SECONDS + 1]) {
    assert.throws(() => timers.start({ name: "Custom", seconds }), /Invalid/);
  }
  assert.throws(() => timers.start({ name: " ", seconds: 1 }), /Invalid/);
  assert.throws(() => timers.start({ name: "x".repeat(81), seconds: 1 }), /Invalid/);
  assert.equal(timers.start({ name: "Custom", seconds: ALARM_MAX_SECONDS }), true);
  assert.equal(alarmTime(360), "6:00");
  assert.equal(alarmTime(0.5), "0:01");
  assert.equal(alarmTime(3601), "1:00:01");
  assert.equal(alarmTime(86400), "24:00:00");
});

test("storage errors are surfaced and never pretend a timer was saved or overwrite unreadable data", () => {
  const errors = [];
  const broken = new AlarmTimers({ storage: { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("write"); } }, id: () => "1", onError: (e) => errors.push(e.message) });
  assert.equal(broken.start({ name: "Egg", seconds: 6 }), false);
  assert.deepEqual(broken.items, []);
  assert.equal(errors.length, 2);
  const env = setup("{invalid");
  const corrupt = env.create();
  assert.equal(corrupt.start({ name: "Egg", seconds: 6 }), false);
  assert.equal(env.value(), "{invalid");
  const writesFail = new AlarmTimers({ storage: { getItem: () => null, setItem: () => { throw new Error("full"); } }, id: () => "1", onError: (e) => errors.push(e.message) });
  assert.equal(writesFail.start({ name: "Egg", seconds: 6 }), false);
  assert.equal(writesFail.items.length, 0);
  assert.equal(errors.at(-1), "full");
});

test("alarms are an enabled built-in menu entry, configurable and independently hideable", () => {
  const yaml = "pages:\n  - id: home\n";
  const translate = makeTranslator("en");
  const result = parseConfig(yaml);
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.config.alarms, { enabled: true, title: null, icon: "timer-outline" });
  assert.equal(menuRoute("#/alarms", menuItems(result.config, {}, translate)).kind, "alarms");
  assert.ok(completeMenuOptions([], result.config.pages).some((item) => item.id === "alarms"));
  const hidden = parseConfig(yaml, { menuItems: [{ id: "alarms", visibility: "hide" }] });
  assert.equal(hidden.config.alarms.enabled, false);
  assert.equal(menuRoute("#/alarms", menuItems(hidden.config, {}, translate)).id, "home");
  const shown = parseConfig(`${yaml}alarms: false\n`, { menuItems: [{ id: "alarms", visibility: "show", title: "Cooking" }] });
  assert.equal(shown.config.alarms.enabled, true);
  assert.equal(shown.config.alarms.title, "Cooking");
  assert.equal(parseConfig(`${yaml}alarms: false\n`).config.alarms.enabled, false);
  assert.match(parseConfig(`${yaml}alarms: invalid\n`).errors[0], /alarms/);
  assert.equal(ALARM_STORAGE_KEY, "dasher.alarms.v1");
});
