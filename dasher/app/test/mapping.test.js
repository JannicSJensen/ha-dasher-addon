import assert from "node:assert/strict";
import { test } from "node:test";
import { describeUnresolved, parseEntityMap, parseEntityMapOption, rankCandidates, unresolvedEntities } from "../src/mapping.js";

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

test("parseEntityMapOption reads the app option, a from=to string, and reports bad rows", () => {
  const { map, errors } = parseEntityMapOption([
    { from: "sensor.car_range", to: "sensor.fordpass_elveh" },
    { from: " light.a ", to: " light.b " },
    { from: "light.same", to: "light.same" },
    { from: "light.c", to: "switch.d" },
    { from: "bad id", to: "light.e" },
    { from: "", to: "" },
    null,
  ]);
  assert.deepEqual(map, { "sensor.car_range": "sensor.fordpass_elveh", "light.a": "light.b" });
  assert.equal(errors.length, 4);
  assert.match(errors[0], /^entity_map\[4\]/);
  assert.deepEqual(parseEntityMapOption("light.a=light.b, sensor.x=sensor.y").map, { "light.a": "light.b", "sensor.x": "sensor.y" });
  assert.deepEqual(parseEntityMapOption(undefined), { map: {}, errors: [] });
  assert.deepEqual(parseEntityMapOption([]), { map: {}, errors: [] });
});

test("unresolvedEntities: unknown ids after the mapping, and mappings to unknown entities", () => {
  const rawEntities = new Set(["light.gone", "light.hall", "sensor.old", "sensor.old2", "switch.plug"]);
  const map = { "sensor.old": "sensor.energi_data_service", "sensor.old2": "sensor.nope" };
  assert.deepEqual(unresolvedEntities({ rawEntities, map, index }), [
    { id: "light.gone", mappedTo: null },
    { id: "sensor.old2", mappedTo: "sensor.nope" },
  ]);
  assert.deepEqual(unresolvedEntities({ rawEntities, map, index: new Map() }), [], "nothing is reported before Home Assistant's entities are known");
});

test("describeUnresolved explains what to put in the option, with guesses", () => {
  const lines = describeUnresolved({
    unresolved: [{ id: "light.kitchen_lamp", mappedTo: null }, { id: "sensor.old2", mappedTo: "sensor.nope" }],
    usage: new Map([["light.kitchen_lamp", ["Home: Kitchen"]]]),
    index,
    registries: null,
  });
  assert.match(lines[0], /^light\.kitchen_lamp is not known to Home Assistant \(used in: Home: Kitchen\)\. Maybe use: light\.kitchen_ceiling \(Kitchen ceiling\)/);
  assert.match(lines[0], /app option "Entity mapping"\.$/);
  assert.match(lines[1], /^sensor\.old2 is mapped to sensor\.nope, which Home Assistant does not know/);
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
