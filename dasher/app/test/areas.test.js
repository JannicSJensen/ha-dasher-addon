import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { buildAreaModel, listImages, scanImages } from "../src/areas.js";

const noImages = { areas: new Map(), entities: new Map() };
const settings = (extra = {}) => ({ enabled: true, hide: [], domains: ["light", "media_player"], overrides: {}, ...extra });

const registries = {
  areas: [
    { area_id: "stuen", name: "Stue", floor_id: "ground", icon: "mdi:sofa", picture: "/api/image/serve/abc/512x512" },
    { area_id: "bad", name: "Bad", floor_id: "up", temperature_entity_id: "sensor.bad_designated" },
    { area_id: "tomt", name: "Tomt", floor_id: "ground" },
    { area_id: "hjem", name: "Hjem", floor_id: null },
    { area_id: "kaelder", name: "Kælder", floor_id: null },
  ],
  floors: [
    { floor_id: "up", name: "1. sal", level: 1 },
    { floor_id: "ground", name: "Stueplan", level: 0 },
  ],
  devices: [
    { id: "dev-bad", area_id: "bad", disabled_by: null },
    { id: "dev-off", area_id: "stuen", disabled_by: "user" },
  ],
  entities: [
    { ei: "light.stue_b", ai: "stuen" },
    { ei: "light.stue_a", ai: "stuen" },
    { ei: "media_player.tv", ai: "stuen" },
    { ei: "light.hidden", ai: "stuen", hb: true },
    { ei: "light.diagnostic", ai: "stuen", ec: 2 },
    { ei: "light.from_disabled_device", di: "dev-off" },
    { ei: "switch.not_wanted", ai: "stuen" },
    { ei: "sensor.stue_temp_1", ai: "stuen" },
    { ei: "sensor.stue_temp_2", ai: "stuen" },
    { ei: "sensor.stue_humidity", ai: "stuen" },
    { ei: "binary_sensor.stue_window", ai: "stuen" },
    { ei: "binary_sensor.stue_motion", ai: "stuen" },
    { ei: "light.bad_lamp", di: "dev-bad" },
    { ei: "light.bad_override", di: "dev-bad", ai: "stuen" },
    { ei: "light.hjem_only", ai: "hjem" },
    { ei: "light.kaelder_lamp", ai: "kaelder" },
  ],
};

const deviceClasses = new Map([
  ["sensor.stue_temp_1", "temperature"],
  ["sensor.stue_temp_2", "temperature"],
  ["sensor.stue_humidity", "humidity"],
  ["binary_sensor.stue_window", "window"],
  ["binary_sensor.stue_motion", "motion"],
]);

const build = (extra, images = noImages) => buildAreaModel({ registries, deviceClasses, settings: settings(extra), images });
const byId = (model, id) => model.areas.find((a) => a.id === id);

test("collects tiles per area, skips hidden/diagnostic entities and disabled devices", () => {
  const stue = byId(build(), "stuen");
  assert.deepEqual(stue.entities, ["light.bad_override", "light.stue_a", "light.stue_b", "media_player.tv"]);
});

test("entities inherit the area of their device, an own area wins", () => {
  const model = build();
  assert.deepEqual(byId(model, "bad").entities, ["light.bad_lamp"]);
  assert.ok(byId(model, "stuen").entities.includes("light.bad_override"));
});

test("temperature, humidity and window sensors are found through device classes", () => {
  const stue = byId(build(), "stuen");
  assert.deepEqual(stue.temperature, ["sensor.stue_temp_1", "sensor.stue_temp_2"]);
  assert.deepEqual(stue.humidity, ["sensor.stue_humidity"]);
  assert.deepEqual(stue.windows, ["binary_sensor.stue_window"]);
});

test("an area's own temperature sensor wins over detected ones", () => {
  assert.deepEqual(byId(build(), "bad").temperature, ["sensor.bad_designated"]);
});

test("areas without anything useful are dropped, and so are hidden ones", () => {
  const model = build({ hide: ["hjem", "Kælder"] });
  assert.equal(byId(model, "tomt"), undefined);
  assert.equal(byId(model, "hjem"), undefined);
  assert.equal(byId(model, "kaelder"), undefined);
  assert.ok(byId(build(), "hjem"));
});

test("areas are sorted by floor level, then name; areas without a floor come last", () => {
  assert.deepEqual(
    build().areas.map((a) => a.name),
    ["Stue", "Bad", "Hjem", "Kælder"],
  );
});

test("domains setting controls which entities become tiles", () => {
  const model = build({ domains: ["light"] });
  assert.ok(!byId(model, "stuen").entities.includes("media_player.tv"));
  assert.ok(!model.entities.has("media_player.tv"));
});

test("overrides rename, re-icon and designate sensors", () => {
  const model = build({
    overrides: { stuen: { name: "Opholdsstue", icon: "mdi:tv", temperature_entity: "sensor.special", window_entities: ["binary_sensor.w2"] } },
  });
  const stue = byId(model, "stuen");
  assert.equal(stue.name, "Opholdsstue");
  assert.equal(stue.icon, "mdi:tv");
  assert.deepEqual(stue.temperature, ["sensor.special"]);
  assert.deepEqual(stue.windows, ["binary_sensor.w2"]);
  assert.ok(model.entities.has("sensor.special"));
});

test("pictures: assets by area id or name, entity images, HA picture as fallback", () => {
  const images = {
    areas: new Map([["stuen", "areas/stuen.jpg"], ["bad", "areas/bad.png"]]),
    entities: new Map([["light.stue_a", "entities/light.stue_a.jpg"]]),
  };
  const model = build({}, images);
  const stue = byId(model, "stuen");
  assert.equal(stue.image, "areas/stuen.jpg");
  assert.deepEqual(stue.entity_images, { "light.stue_a": "entities/light.stue_a.jpg" });
  assert.equal(stue.picture, "/api/image/serve/abc/512x512");
  assert.equal(byId(build(), "stuen").image, null);
});

test("disabled areas or missing registries produce nothing", () => {
  assert.deepEqual(build({ enabled: false }).areas, []);
  assert.equal(buildAreaModel({ registries: null, settings: settings(), images: noImages }).areas.length, 0);
});

test("the allowed entity set covers tiles and sensors", () => {
  const { entities } = build();
  for (const id of ["light.stue_a", "sensor.stue_temp_1", "binary_sensor.stue_window", "sensor.bad_designated"]) {
    assert.ok(entities.has(id), id);
  }
  assert.ok(!entities.has("light.hidden"));
  assert.ok(!entities.has("binary_sensor.stue_motion"));
});

test("listImages indexes image files only and tolerates missing folders", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dasher-img-"));
  try {
    fs.mkdirSync(path.join(dir, "areas"));
    for (const f of ["Stuen.JPG", "bad.png", "notes.txt"]) fs.writeFileSync(path.join(dir, "areas", f), "x");
    const found = listImages(dir, "areas");
    assert.deepEqual([...found.keys()].sort(), ["bad", "stuen"]);
    assert.equal(found.get("stuen"), "areas/Stuen.JPG");
    assert.equal(scanImages(path.join(dir, "nope")).areas.size, 0);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("thermostats are area devices by default", () => {
  const regs = { ...registries, entities: [...registries.entities, { ei: "climate.stue", ai: "stuen" }, { ei: "climate.hall_old", ai: "hjem" }] };
  const model = buildAreaModel({ registries: regs, deviceClasses, settings: { enabled: true, hide: [], domains: ["light", "fan", "cover", "media_player", "climate"], overrides: {} }, images: noImages });
  assert.ok(byId(model, "stuen").entities.includes("climate.stue"));
  assert.ok(model.entities.has("climate.hall_old"));
});

test("removed devices move to hidden_entities, stay tracked, and an area with only removed devices stays", () => {
  const hidden = new Set(["light.stue_a", "media_player.tv", "light.hjem_only"]);
  const model = buildAreaModel({ registries, deviceClasses, settings: settings(), images: noImages, hidden });
  const stue = byId(model, "stuen");
  assert.deepEqual(stue.entities, ["light.bad_override", "light.stue_b"]);
  assert.deepEqual(stue.hidden_entities, ["light.stue_a", "media_player.tv"]);
  const hjem = byId(model, "hjem");
  assert.deepEqual([hjem.entities, hjem.hidden_entities], [[], ["light.hjem_only"]]);
  assert.ok(model.entities.has("light.stue_a") && model.entities.has("light.hjem_only"));
  assert.deepEqual(byId(build(), "stuen").hidden_entities, []);
});
