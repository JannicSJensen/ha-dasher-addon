import assert from "node:assert/strict";
import { test } from "node:test";
import { mappingItems, parseEntityMap, rankCandidates, serializeEntityMap, validateMapping } from "../src/mapping.js";

const entry = (id, name, extra = {}) => [id, { id, name, domain: id.split(".")[0], ...extra }];
const index = new Map([
  entry("light.living_room_lamp", "Living room lamp"),
  entry("light.kitchen_ceiling", "Kitchen ceiling"),
  entry("light.hall", "Hall light"),
  entry("sensor.energi_data_service", "Energi Data Service", { deviceClass: "monetary", unit: "DKK/kWh" }),
  entry("sensor.living_room_temp", "Living room temperature", { deviceClass: "temperature", unit: "°C" }),
  entry("switch.plug", "Plug"),
]);

test("parseEntityMap keeps valid same-kind pairs and reports the rest", () => {
  const { map, errors } = parseEntityMap(`
light.a: light.b
light.same: light.same
light.c: switch.d
bad id: light.e
sensor.x: 12
`);
  assert.deepEqual(map, { "light.a": "light.b" });
  assert.equal(errors.length, 3);
  assert.deepEqual(parseEntityMap(""), { map: {}, errors: [] });
  assert.equal(parseEntityMap("- a\n- b").errors.length, 1);
  assert.match(parseEntityMap("a: [").errors[0], /entity-map\.yaml/);
});

test("serializeEntityMap round-trips and starts with a comment", () => {
  const text = serializeEntityMap({ "sensor.b": "sensor.y", "light.a": "light.x" });
  assert.match(text, /^# Entity mapping/);
  assert.deepEqual(parseEntityMap(text).map, { "light.a": "light.x", "sensor.b": "sensor.y" });
  assert.equal(parseEntityMap(serializeEntityMap({})).map && Object.keys(parseEntityMap(serializeEntityMap({})).map).length, 0);
});

test("validateMapping accepts only entities of the dashboard, same kind, known to Home Assistant", () => {
  const rawEntities = new Set(["light.missing", "sensor.price"]);
  const ok = (body) => validateMapping(body, { rawEntities, index });
  assert.deepEqual(ok({ from: "light.missing", to: "light.hall" }), { ok: true, from: "light.missing", to: "light.hall" });
  assert.deepEqual(ok({ from: "light.missing", to: null }), { ok: true, from: "light.missing", to: null });
  assert.deepEqual(ok({ from: "light.missing", to: "light.missing" }), { ok: true, from: "light.missing", to: null });
  for (const body of [
    { from: "light.other", to: "light.hall" },
    { from: "light.missing", to: "switch.plug" },
    { from: "light.missing", to: "light.unknown" },
    { from: "light.missing", to: "not an id" },
    { from: 5, to: "light.hall" },
    {},
  ]) {
    const result = ok(body);
    assert.equal(result.ok, false, JSON.stringify(body));
    assert.equal(result.status, 400);
  }
});

test("mappingItems: unresolved first, then mapped, then the rest", () => {
  const items = mappingItems({
    rawEntities: new Set(["light.hall", "light.gone", "sensor.old", "switch.plug"]),
    usage: new Map([["light.gone", ["Home: Lamp"]]]),
    map: { "sensor.old": "sensor.energi_data_service" },
    index,
  });
  assert.deepEqual(items.map((i) => i.id), ["light.gone", "sensor.old", "light.hall", "switch.plug"]);
  assert.deepEqual(items[0], { id: "light.gone", domain: "light", tiles: ["Home: Lamp"], mapped: null, found: false, name: null });
  assert.deepEqual([items[1].mapped, items[1].found, items[1].name], ["sensor.energi_data_service", true, "Energi Data Service"]);
});

test("rankCandidates: same kind only, words of the id and tile name rank first, search filters", () => {
  const registries = {
    areas: [{ area_id: "kitchen", name: "Køkken" }],
    devices: [{ id: "d1", area_id: "kitchen" }],
    entities: [{ ei: "light.kitchen_ceiling", di: "d1" }],
  };
  const guess = rankCandidates({ index, registries, from: "light.kitchen_lamp", usage: ["Home: Kitchen"] });
  assert.deepEqual(guess.map((c) => c.id), ["light.kitchen_ceiling", "light.living_room_lamp", "light.hall"]);
  assert.equal(guess[0].area, "Køkken");
  assert.ok(guess.every((c) => c.id.startsWith("light.")));

  const price = rankCandidates({ index, registries, from: "sensor.electricity_price", q: "energi" });
  assert.deepEqual(price.map((c) => [c.id, c.device_class, c.unit]), [["sensor.energi_data_service", "monetary", "DKK/kWh"]]);

  assert.deepEqual(rankCandidates({ index, registries, from: "light.x", q: "køkken" }).map((c) => c.id), ["light.kitchen_ceiling"], "area names are searchable");
  assert.deepEqual(rankCandidates({ index, registries, from: "light.x", q: "zzz" }), []);
  assert.equal(rankCandidates({ index, registries, from: "light.x", limit: 2 }).length, 2);
  assert.equal(rankCandidates({ index, registries: null, from: "light.x" }).length, 3);
});
