import assert from "node:assert/strict";
import { setImmediate } from "node:timers/promises";
import { test } from "node:test";
import { parseConfig } from "../src/config.js";
import { completeMenuOptions, MenuOptionsSync } from "../src/menu-options.js";
import { BUILTIN_MENU_ITEMS } from "../web/js/lib/menu.js";

const yaml = "pages:\n  - { id: home }\n  - { id: music }\n";
const pages = [{ id: "home" }, { id: "music" }];
const builtins = BUILTIN_MENU_ITEMS.map(({ id }) => id);

async function settled(sync) {
  for (let i = 0; i < 100 && sync.running; i++) await setImmediate();
  assert.equal(sync.running, false, "synchronization did not finish");
}

test("adds every built-in and custom page without altering existing overrides", () => {
  const existing = [{ id: "home", visible: false, title: "Main" }, { id: "music", order: 2 }];
  const result = completeMenuOptions(existing, pages);
  assert.deepEqual(result.slice(0, 2), existing);
  assert.deepEqual(result.slice(2).map(({ id }) => id), ["page:music", ...builtins.filter((id) => id !== "music")]);
  assert.equal(completeMenuOptions(result, pages), null);
  assert.throws(() => completeMenuOptions({}, pages), /not a list/);
});

test("new placeholder rows preserve all existing dashboard and legacy switch behavior", () => {
  const options = completeMenuOptions([], pages);
  assert.ok(options.every((item) => item.visibility === "default"));
  for (const settings of [
    {},
    { family: { enabled: true }, calendarPage: true },
  ]) {
    const text = `${yaml}music: false\nareas: false\nenergy: false\n`;
    const before = parseConfig(text, settings);
    const after = parseConfig(text, { ...settings, menuItems: options });
    assert.deepEqual(after.errors, []);
    assert.deepEqual({ ...after.config, menu_items: [] }, before.config);
  }
});

test("visibility choices hide and show items, or restore inherited behavior", () => {
  const text = `${yaml}calendar: false\n`;
  const hidden = parseConfig(text, { menuItems: [{ id: "home", visibility: "hide" }, { id: "calendar", visibility: "show" }] });
  assert.deepEqual(hidden.config.menu_items, [{ id: "page:home", visible: false }, { id: "calendar", visible: true }]);
  assert.equal(hidden.config.calendar.enabled, true);
  const inherited = parseConfig(text, { menuItems: [{ id: "calendar", visible: true, visibility: "default" }] });
  assert.equal(inherited.config.calendar.enabled, false);
  const legacy = parseConfig(text, { menuItems: [{ id: "calendar", visible: true }] });
  assert.equal(legacy.config.calendar.enabled, true);
  assert.match(parseConfig(text, { menuItems: [{ id: "home", visibility: "invalid" }] }).errors[0], /visibility/);
});

test("sync reads the latest saved options, preserves secrets and writes only when necessary", async () => {
  let saved = { menu_items: [{ id: "home", visible: false }], plex_token: "!secret plex_token", read_only: true };
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    if (init.method === "POST") saved = JSON.parse(init.body).options;
    return { ok: true, json: async () => ({ result: "ok", data: init.method === "POST" ? null : { options: saved } }) };
  };
  const logs = [];
  const sync = new MenuOptionsSync({ token: "test-token", fetchImpl, logger: { info: (s) => logs.push(s), warn: (s) => logs.push(s) } });
  sync.update({ pages });
  await settled(sync);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].url, "http://supervisor/addons/self/info");
  assert.equal(calls[1].url, "http://supervisor/addons/self/options");
  assert.equal(saved.plex_token, "!secret plex_token");
  assert.equal(saved.read_only, true);
  assert.deepEqual(saved.menu_items[0], { id: "home", visible: false });
  assert.ok(saved.menu_items.some((item) => item.id === "page:music"));
  sync.update({ pages });
  await settled(sync);
  assert.equal(calls.length, 3);
  assert.equal(logs.length, 1);
});

test("changes during an in-flight write are synchronized without losing saved overrides", async () => {
  let saved = { menu_items: [] };
  let release;
  const blocked = new Promise((resolve) => { release = resolve; });
  let writes = 0;
  const fetchImpl = async (_url, init) => {
    if (init.method === "POST") {
      writes++;
      if (writes === 1) await blocked;
      saved = JSON.parse(init.body).options;
    }
    return { ok: true, json: async () => ({ result: "ok", data: { options: saved } }) };
  };
  const sync = new MenuOptionsSync({ token: "test-token", fetchImpl, logger: { info() {}, warn() {} } });
  sync.update({ pages });
  await setImmediate();
  sync.update({ pages: [...pages, { id: "garage" }] });
  release();
  await settled(sync);
  assert.equal(writes, 2);
  assert.ok(saved.menu_items.some(({ id }) => id === "page:garage"));
});

test("errors are logged and retried, and invalid dashboard configurations are ignored", async () => {
  let requests = 0;
  const warnings = [];
  const sync = new MenuOptionsSync({
    token: "test-token", retryMs: 60_000,
    fetchImpl: async () => { requests++; return { ok: false, status: 503 }; },
    logger: { info() {}, warn: (message) => warnings.push(message) },
  });
  sync.update(null);
  assert.equal(requests, 0);
  sync.update({ pages });
  await settled(sync);
  assert.match(warnings[0], /HTTP 503/);
  assert.ok(sync.timer);
  clearTimeout(sync.timer);
});
