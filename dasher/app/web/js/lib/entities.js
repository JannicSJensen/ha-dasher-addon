/*
 * Entity ids are found by key name: `entity`, `*_entity`, and lists under `entities` / `*_entities`.
 * `data` (service data) is never searched. Shared by the server (what to watch and allow, and
 * applying the entity mapping) and the browser (which tiles to update).
 */
const isEntityKey = (key) => key === "entity" || key.endsWith("_entity");
const isEntityListKey = (key) => key === "entities" || key.endsWith("_entities");

/** Collect every entity id referenced in a config subtree. */
export function collectEntities(node, out = new Set()) {
  if (Array.isArray(node)) {
    for (const item of node) collectEntities(item, out);
  } else if (node && typeof node === "object") {
    for (const [key, value] of Object.entries(node)) {
      if (key === "data") continue;
      if (isEntityKey(key) && typeof value === "string") out.add(value);
      else if (isEntityListKey(key) && Array.isArray(value)) {
        for (const v of value) if (typeof v === "string") out.add(v);
      } else collectEntities(value, out);
    }
  }
  return out;
}

/** A copy of `node` with entity ids replaced according to `map` (id -> replacement). */
export function mapEntities(node, map) {
  const swap = (id) => (Object.hasOwn(map, id) ? map[id] : id);
  if (Array.isArray(node)) return node.map((item) => mapEntities(item, map));
  if (!node || typeof node !== "object") return node;
  const out = {};
  for (const [key, value] of Object.entries(node)) {
    if (key === "data") out[key] = value;
    else if (isEntityKey(key) && typeof value === "string") out[key] = swap(value);
    else if (isEntityListKey(key) && Array.isArray(value)) out[key] = value.map((v) => (typeof v === "string" ? swap(v) : mapEntities(v, map)));
    else out[key] = mapEntities(value, map);
  }
  return out;
}

/**
 * Where each entity id is used, as readable labels: Map(id -> ["Page: Tile name", ...]).
 * `labelOf(path)` receives the nearest tile/page objects.
 */
export function describeUsage(config) {
  const usage = new Map();
  const add = (id, label) => {
    if (!usage.has(id)) usage.set(id, []);
    if (!usage.get(id).includes(label)) usage.get(id).push(label);
  };
  for (const page of Array.isArray(config?.pages) ? config.pages : []) {
    const pageName = page?.title ?? page?.id ?? "";
    for (const tile of Array.isArray(page?.tiles) ? page.tiles : []) {
      const name = tile?.name ?? tile?.type ?? "tile";
      for (const id of collectEntities(tile)) add(id, pageName ? `${pageName}: ${name}` : String(name));
    }
  }
  for (const id of collectEntities(config?.areas?.overrides ?? {})) add(id, "areas");
  for (const id of collectEntities(config?.ev ?? {})) add(id, "car page");
  return usage;
}
