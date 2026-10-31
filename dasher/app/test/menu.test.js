import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import YAML from "yaml";
import { ConfigStore, parseConfig } from "../src/config.js";
import { makeTranslator } from "../web/js/lib/i18n.js";
import { BUILTIN_MENU_ITEMS, menuItemActive, menuItems, menuRoute } from "../web/js/lib/menu.js";

const base = "pages:\n  - { id: home, title: Home, icon: home }\n  - { id: garage, title: Garage, icon: garage }\n";
const t = makeTranslator("en");
const ready = Object.fromEntries(BUILTIN_MENU_ITEMS.map(({ section }) => [section, { enabled: true }]));
const parse = (menuItems = [], yaml = base) => parseConfig(yaml, { menuItems });

test("empty menu options preserve the existing defaults and sidebar order", () => {
  const { config, errors } = parse();
  assert.deepEqual(errors, []);
  assert.deepEqual(config.menu_items, []);
  assert.equal(config.family.enabled, false);
  assert.equal(config.calendar.enabled, false);
  const items = menuItems(config, ready, t);
  assert.deepEqual(items.map((i) => i.key), ["page:home", "page:garage", "climate", "areas", "music", "meals", "todo", "devices", "media", "ev"]);
  assert.deepEqual(menuRoute("", items), { kind: "page", id: "home" });
  assert.deepEqual(menuRoute("#/unknown", items), { kind: "page", id: "home" });
});

test("every built-in can be enabled, hidden, renamed and given an icon through app options", () => {
  for (const { id, section } of BUILTIN_MENU_ITEMS) {
    const disabled = section === "music" ? "radio:\n  enabled: false\n" : `${section}: false\n`;
    const shown = parse([{ id, visible: true, title: `My ${id}`, icon: "mdi:star", order: 0 }], base + disabled);
    assert.deepEqual(shown.errors, [], id);
    assert.equal(shown.config[section].enabled, true, id);
    const item = menuItems(shown.config, ready, t).find((item) => item.key === id);
    assert.deepEqual([item.title, item.icon, item.order], [`My ${id}`, "mdi:star", 0]);
    const hidden = parse([{ id, visible: false }], `${base}${section}:\n  enabled: true\n`);
    assert.equal(hidden.config[section].enabled, false, id);
    assert.ok(!menuItems(hidden.config, ready, t).some((item) => item.key === id), id);
  }
});

test("overrides preserve detailed page settings, legacy switches and entity mapping", () => {
  const yaml = `${base}
calendar:
  enabled: false
  entities: [calendar.old]
  view: planner
family:
  enabled: false
  people:
    - { entity: person.emil, role: child, pin: "1234" }
music:
  enabled: false
  tabs: [radio]
`;
  const result = parseConfig(yaml, {
    entityMap: { "calendar.old": "calendar.new" },
    menuItems: [{ id: "calendar", visible: true }, { id: "family", visible: true }, { id: "music", title: "Speakers" }],
  });
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.config.calendar.entities, ["calendar.new"]);
  assert.equal(result.config.calendar.view, "planner");
  assert.equal(result.config.family.people[0].pin, "1234");
  assert.equal(result.config.music.enabled, false, "a label-only override does not enable a page");
  assert.deepEqual(result.config.music.tabs, ["radio"]);
  assert.equal(result.config.music.title, "Speakers");
  assert.ok(result.entities.has("calendar.new"));
  const legacy = parseConfig(base, { family: { enabled: true, children: ["person.emil"] }, calendarPage: true });
  assert.deepEqual([legacy.config.family.enabled, legacy.config.calendar.enabled, legacy.config.family.children], [true, true, ["person.emil"]]);
  const overridden = parseConfig(base, { family: { enabled: true }, calendarPage: true, menuItems: [{ id: "family", visible: false }, { id: "calendar", visible: false }] });
  assert.deepEqual([overridden.config.family.enabled, overridden.config.calendar.enabled], [false, false]);
});

test("custom pages accept shorthand and explicit ids; hidden pages cannot be selected", () => {
  const { config, errors } = parse([{ id: "home", visible: false }, { id: "page:garage", title: "Workshop", icon: "tools", order: 0 }]);
  assert.deepEqual(errors, []);
  assert.equal(config.pages[1].title, "Workshop");
  const items = menuItems(config, {}, t);
  assert.deepEqual(items.map((i) => [i.key, i.title, i.icon]), [["page:garage", "Workshop", "tools"]]);
  assert.deepEqual(menuRoute("#/home", items), { kind: "page", id: "garage" });
  const collision = parse([{ id: "page:music", visible: false }], `${base}  - { id: music }\n`);
  assert.deepEqual(collision.errors, []);
  assert.ok(!menuItems(collision.config, ready, t).some((i) => i.key === "page:music"));
  assert.ok(menuItems(collision.config, ready, t).some((i) => i.key === "music"));
});

test("numeric order interleaves custom and built-in pages with stable ties", () => {
  const { config } = parse([{ id: "home", order: 10 }, { id: "calendar", visible: true, order: 0 }, { id: "garage", order: 0 }]);
  const items = menuItems(config, ready, t);
  assert.deepEqual(items.slice(0, 3).map((i) => i.key), ["page:garage", "calendar", "climate"]);
  assert.ok(items.findIndex((i) => i.key === "page:home") > items.findIndex((i) => i.key === "devices"));
  const { config: calendarFirst } = parse([{ id: "calendar", visible: true, order: 0 }, { id: "home", order: 1 }, { id: "garage", order: 2 }]);
  assert.deepEqual(menuRoute("", menuItems(calendarFirst, ready, t)), { kind: "calendar", id: null });
});

test("routing preserves aliases, subpages and active icons, and rejects hidden built-ins", () => {
  const { config } = parse();
  const items = menuItems(config, ready, t);
  for (const [hash, route] of [
    ["#/radio", { kind: "music", id: null }],
    ["#/media", { kind: "plex", id: null }],
    ["#/area/living%20room", { kind: "area", id: "living room" }],
    ["#/todo/todo.shopping", { kind: "todo", id: "todo.shopping" }],
  ]) assert.deepEqual(menuRoute(hash, items), route);
  assert.ok(menuItemActive(items.find((i) => i.key === "areas"), { kind: "area", id: "living room" }));
  assert.ok(menuItemActive(items.find((i) => i.key === "todo"), { kind: "todo", id: "todo.shopping" }));
  assert.ok(menuItemActive(items[0], { kind: "page", id: "home" }));
  assert.ok(!menuItemActive(items[0], { kind: "page", id: "garage" }));
  const hidden = parse([{ id: "areas", visible: false }, { id: "music", visible: false }, { id: "todo", visible: false }]).config;
  const visible = menuItems(hidden, ready, t);
  for (const hash of ["#/areas", "#/area/living", "#/music", "#/radio", "#/todo/todo.shopping"]) {
    assert.deepEqual(menuRoute(hash, visible), { kind: "page", id: "home" });
  }
});

test("a custom radio page remains reachable when the built-in Music page is hidden", () => {
  const yaml = `${base}  - { id: radio }\n  - { id: music }\n`;
  const { config } = parse([{ id: "music", visible: false }], yaml);
  assert.deepEqual(menuRoute("#/radio", menuItems(config, ready, t)), { kind: "page", id: "radio" });
  const shown = parse([], yaml).config;
  assert.deepEqual(menuRoute("#/radio", menuItems(shown, ready, t)), { kind: "music", id: null });
});

test("availability updates and pending data do not expose disabled menu items", () => {
  const { config } = parse([{ id: "home", visible: false }, { id: "garage", visible: false }, { id: "calendar", visible: true }]);
  assert.deepEqual(menuItems(config, {}, t).map((i) => i.key), ["calendar"]);
  assert.deepEqual(menuItems(config, { music: { enabled: true } }, t).map((i) => i.key), ["music", "calendar"]);
  assert.deepEqual(menuItems(config, {}, t, { includePending: true }).map((i) => i.key), ["areas", "music", "calendar"]);
  const hidden = parse([{ id: "areas", visible: false }, { id: "music", visible: false }]).config;
  assert.deepEqual(menuItems(hidden, {}, t, { includePending: true }).map((i) => i.key), ["page:home", "page:garage"]);
});

test("all menu items can be hidden without removing tile definitions or crashing routing", () => {
  const overrides = [{ id: "home", visible: false }, { id: "garage", visible: false }, ...BUILTIN_MENU_ITEMS.map(({ id }) => ({ id, visible: false }))];
  const { config, entities } = parse(overrides, base.replace("icon: home }", "icon: home, tiles: [{ type: toggle, entity: light.test }] }"));
  assert.equal(config.pages.length, 2);
  assert.equal(config.pages[0].tiles[0].entity, "light.test");
  assert.ok(entities.has("light.test"));
  const items = menuItems(config, ready, t, { includePending: true });
  assert.deepEqual(items, []);
  assert.deepEqual(menuRoute("#/home", items), { kind: "empty", id: null });
  for (const lang of ["en", "da"]) {
    const translate = makeTranslator(lang);
    assert.notEqual(translate("menu_empty"), "menu_empty");
    assert.notEqual(translate("menu_empty_hint"), "menu_empty_hint");
  }
});

test("invalid options are reported without discarding valid fields and pages", () => {
  assert.match(parse({}).errors[0], /menu_items: must be a list/);
  const result = parse([
    null, { id: "unknown" }, { id: "home", title: "Main", visible: "false", icon: 4, order: -1 },
    { id: "page:home" }, { id: "garage", order: 1.5 }, { id: "areas", title: "  ", order: "1" },
  ]);
  assert.equal(result.errors.length, 9);
  assert.equal(result.config.pages[0].title, "Main");
  assert.equal(menuItems(result.config, {}, t)[0].key, "page:home");
  assert.ok(result.errors.every((e) => e.startsWith("menu_items[")));
});

test("ConfigStore reapplies app menu options on reload without rewriting dashboard.yaml", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dasher-menu-"));
  const warnings = [];
  try {
    const file = path.join(dir, "dashboard.yaml");
    fs.writeFileSync(file, base);
    const store = new ConfigStore({ dir, logger: { warn: (message) => warnings.push(message) }, menuItemsOption: [{ id: "home", title: "Main" }, { id: "calendar", visible: true }] });
    assert.equal(store.load().config.pages[0].title, "Main");
    fs.writeFileSync(file, `${base}calendar: false\n`);
    assert.equal(store.load().config.calendar.enabled, true);
    assert.equal(fs.readFileSync(file, "utf8"), `${base}calendar: false\n`);
    assert.deepEqual(warnings, []);
    const invalid = new ConfigStore({ dir, logger: { warn: (message) => warnings.push(message) }, menuItemsOption: [{ id: "unknown" }] });
    invalid.load();
    assert.match(warnings[0], /^App configuration: menu_items\[0\]/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("HA exposes and translates every menu override field", () => {
  const addon = YAML.parse(fs.readFileSync(new URL("../../config.yaml", import.meta.url), "utf8"));
  assert.deepEqual(addon.options.menu_items, []);
  assert.deepEqual(addon.schema.menu_items, [{ id: "str", visible: "bool?", title: "str?", icon: "str?", order: "int(0,)?" }]);
  for (const lang of ["en", "da"]) {
    const texts = YAML.parse(fs.readFileSync(new URL(`../../translations/${lang}.yaml`, import.meta.url), "utf8")).configuration.menu_items;
    for (const field of Object.keys(addon.schema.menu_items[0])) assert.ok(texts.fields[field]?.name && texts.fields[field]?.description, `${lang}: ${field}`);
  }
});
