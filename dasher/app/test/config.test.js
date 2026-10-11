import assert from "node:assert/strict";
import { test } from "node:test";
import { collectEntities, parseConfig } from "../src/config.js";

const base = `
pages:
  - title: Home Page
    tiles:
      - type: toggle
        entity: light.kitchen
      - type: hero
        backgrounds:
          - when: { entity: sun.sun, state: below_horizon }
            image: night.jpg
        buttons:
          - icon: coffee
            tap: { action: service, service: scene.turn_on, entity: scene.cozy, data: { entity_id: light.ignored } }
          - icon: lamp
            entity: light.lamp
      - type: vehicle
        entity: sensor.range
        rows:
          - { icon: battery, entity: sensor.battery, label_entity: sensor.state }
`;

test("parses pages, slugs ids and applies defaults", () => {
  const { config, errors } = parseConfig(base);
  assert.deepEqual(errors, []);
  assert.equal(config.pages[0].id, "home-page");
  assert.equal(config.pages[0].columns, 4);
  assert.equal(config.pages[0].tiles[0].w, 1);
  assert.equal(config.pages[0].tiles[0].col, null);
});

test("collects entities from nested keys but not from service data", () => {
  const { entities } = parseConfig(base);
  assert.deepEqual(
    [...entities].sort(),
    ["light.kitchen", "light.lamp", "scene.cozy", "sensor.battery", "sensor.range", "sensor.state", "sun.sun"],
  );
});

test("unknown tile types and bad entity ids are reported and dropped", () => {
  const { config, errors } = parseConfig(`
pages:
  - id: a
    tiles:
      - { type: nope }
      - { type: toggle, entity: "Light.Bad Id" }
      - { type: toggle, entity: light.ok }
`);
  assert.equal(errors.length, 2);
  assert.equal(config.pages[0].tiles.length, 1);
});

test("invalid YAML and missing pages never throw", () => {
  assert.equal(parseConfig("pages: [").config, null);
  assert.equal(parseConfig("title: x").config, null);
  assert.equal(parseConfig("").config, null);
});

test("duplicate page ids are made unique", () => {
  const { config } = parseConfig("pages:\n  - { id: a }\n  - { id: a }\n");
  assert.notEqual(config.pages[0].id, config.pages[1].id);
});

test("collectEntities handles `entities` lists", () => {
  assert.deepEqual([...collectEntities({ entities: ["light.a", "light.b"] })], ["light.a", "light.b"]);
});

test("app version in config.yaml matches package.json", async () => {
  const { readFileSync } = await import("node:fs");
  const { default: YAML } = await import("yaml");
  const addon = YAML.parse(readFileSync(new URL("../../config.yaml", import.meta.url), "utf8"));
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  assert.equal(addon.version, pkg.version);
});

test("areas section: defaults, validation and override entities", () => {
  const defaults = parseConfig("pages:\n  - id: a\n").config.areas;
  assert.equal(defaults.enabled, true);
  assert.deepEqual(defaults.domains, ["light", "fan", "cover", "media_player"]);

  const { config, errors, entities } = parseConfig(`
pages:
  - id: a
areas:
  enabled: true
  title: Rum
  hide: [hjem]
  domains: [light, lock]
  overrides:
    stuen:
      name: Stue
      temperature_entity: sensor.t
      humidity_entity: "bad id"
      window_entities: [binary_sensor.w, nope]
`);
  assert.equal(config.areas.title, "Rum");
  assert.deepEqual(config.areas.domains, ["light"]);
  assert.equal(errors.length, 3);
  assert.deepEqual([...entities].sort(), ["binary_sensor.w", "sensor.t"]);
  assert.equal(parseConfig("pages:\n  - id: a\nareas:\n  enabled: false\n").config.areas.enabled, false);
});

test("radio section: defaults, validation and entities", () => {
  const defaults = parseConfig("pages:\n  - id: a\n").config.music;
  assert.equal(defaults.enabled, true);
  assert.deepEqual(defaults.players, []);

  const { config, errors, entities } = parseConfig(`
pages:
  - id: a
radio:
  title: Radio
  players: [media_player.a, light.nope]
  exclude: media_player.skip
  default_player: sensor.bad
`);
  assert.equal(errors.length, 2);
  assert.deepEqual(config.music.players, ["media_player.a"]);
  assert.deepEqual(config.music.exclude, ["media_player.skip"]);
  assert.equal(config.music.default_player, null);
  assert.deepEqual([...entities], ["media_player.a"]);
});

test("music section: `radio:` is an alias, tabs are validated", () => {
  const alias = parseConfig("pages:\n  - id: a\nradio:\n  title: Radio\n").config.music;
  assert.equal(alias.title, "Radio");
  assert.deepEqual(alias.tabs, ["discover", "radio", "albums", "artists", "podcasts", "search"]);

  const { config, errors } = parseConfig("pages:\n  - id: a\nmusic:\n  tabs: [albums, albums, nope, search]\n");
  assert.deepEqual(config.music.tabs, ["albums", "search"]);
  assert.equal(errors.length, 1);
});

test("every app option has a translation in each language, and the YAML files parse", async () => {
  const { readFileSync } = await import("node:fs");
  const { default: YAML } = await import("yaml");
  const read = (file) => YAML.parse(readFileSync(new URL(file, import.meta.url), "utf8"));
  const addon = read("../../config.yaml");
  assert.ok(addon.hassio_api, "needed to find Music Assistant as an app");
  for (const lang of ["en", "da"]) {
    const texts = read(`../../translations/${lang}.yaml`).configuration;
    for (const option of Object.keys(addon.schema)) {
      assert.ok(texts[option]?.name && texts[option]?.description, `${lang}: ${option}`);
    }
  }
});

import { describeUsage, mapEntities } from "../web/js/lib/entities.js";

test("mapEntities replaces ids by key, leaves service data and other strings alone", () => {
  const config = {
    pages: [
      {
        tiles: [
          { type: "toggle", entity: "light.a", name: "light.a" },
          { type: "vehicle", entity: "sensor.r", rows: [{ entity: "sensor.b", label_entity: "sensor.s", icon: "x" }] },
          { type: "hero", buttons: [{ tap: { action: "service", entity: "scene.c", data: { entity_id: "light.a" } } }], backgrounds: [{ when: { entity: "sun.sun", state: "x" } }] },
          { type: "buttons", entities: ["light.a", "light.z"], window_entities: ["binary_sensor.w"], players: "music" },
        ],
      },
    ],
  };
  const mapped = mapEntities(config, { "light.a": "light.new", "sensor.s": "sensor.s2", "binary_sensor.w": "binary_sensor.w2" });
  const [toggle, vehicle, hero, buttons] = mapped.pages[0].tiles;
  assert.equal(toggle.entity, "light.new");
  assert.equal(toggle.name, "light.a", "only entity keys are touched");
  assert.equal(vehicle.rows[0].label_entity, "sensor.s2");
  assert.equal(vehicle.rows[0].entity, "sensor.b");
  assert.equal(hero.buttons[0].tap.data.entity_id, "light.a", "service data is left as it is");
  assert.equal(hero.backgrounds[0].when.entity, "sun.sun");
  assert.deepEqual(buttons.entities, ["light.new", "light.z"]);
  assert.deepEqual(buttons.window_entities, ["binary_sensor.w2"]);
  assert.equal(config.pages[0].tiles[0].entity, "light.a", "the input is not modified");
  assert.deepEqual(mapEntities(config, {}).pages[0].tiles[0], config.pages[0].tiles[0]);
  assert.equal(mapEntities({ entity: "toString" }, {}).entity, "toString", "prototype keys are not ids");
});

test("describeUsage lists where an entity is used", () => {
  const usage = describeUsage({
    pages: [
      { title: "Home", tiles: [{ type: "toggle", name: "Lamp", entity: "light.a" }, { type: "media", entities: ["media_player.a", "light.a"] }] },
      { id: "garage", tiles: [{ type: "climate", entity: "climate.hp" }] },
    ],
    areas: { overrides: { stue: { temperature_entity: "sensor.t" } } },
  });
  assert.deepEqual(usage.get("light.a"), ["Home: Lamp", "Home: media"]);
  assert.deepEqual(usage.get("climate.hp"), ["garage: climate"]);
  assert.deepEqual(usage.get("sensor.t"), ["areas"]);
});

test("parseConfig applies the entity map but remembers the entities as written", () => {
  const yaml = "pages:\n  - id: a\n    tiles:\n      - { type: toggle, name: Lamp, entity: light.missing }\n      - { type: toggle, entity: light.ok }\n";
  const { config, entities, rawEntities, usage } = parseConfig(yaml, { entityMap: { "light.missing": "light.real" } });
  assert.equal(config.pages[0].tiles[0].entity, "light.real");
  assert.equal(config.pages[0].tiles[1].entity, "light.ok");
  assert.deepEqual([...entities].sort(), ["light.ok", "light.real"]);
  assert.deepEqual([...rawEntities].sort(), ["light.missing", "light.ok"]);
  assert.deepEqual(usage.get("light.missing"), ["a: Lamp"]);
});

test("ConfigStore saves the mapping next to dashboard.yaml and reloads with it", async () => {
  const fs = await import("node:fs");
  const os = await import("node:os");
  const path = await import("node:path");
  const { ConfigStore } = await import("../src/config.js");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dasher-map-"));
  try {
    fs.writeFileSync(path.join(dir, "dashboard.yaml"), "pages:\n  - id: a\n    tiles:\n      - { type: toggle, entity: light.missing }\n");
    let changes = 0;
    const store = new ConfigStore({ dir, logger: { info() {}, warn() {}, error() {}, debug() {} }, onChange: () => changes++ });
    store.load();
    assert.deepEqual([...store.current.entities], ["light.missing"]);

    store.saveEntityMap({ "light.missing": "light.real" });
    assert.equal(changes, 1);
    assert.deepEqual([...store.current.entities], ["light.real"]);
    assert.deepEqual([...store.current.rawEntities], ["light.missing"]);
    assert.match(fs.readFileSync(path.join(dir, "entity-map.yaml"), "utf8"), /light\.missing: light\.real/);
    assert.ok(!fs.existsSync(path.join(dir, "entity-map.yaml.tmp")));

    // a fresh store picks the mapping up from disk, an unparsable file is ignored
    const other = new ConfigStore({ dir, logger: { info() {}, warn() {}, error() {}, debug() {} } });
    other.load();
    assert.deepEqual([...other.current.entities], ["light.real"]);

    store.saveEntityMap({});
    assert.deepEqual([...store.current.entities], ["light.missing"]);
    fs.writeFileSync(path.join(dir, "entity-map.yaml"), "{{{");
    other.load();
    assert.deepEqual([...other.current.entities], ["light.missing"]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
