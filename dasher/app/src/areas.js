import fs from "node:fs";
import path from "node:path";
import { ROOM_TYPES, roomImage, roomType } from "./room-images.js";

export const DEFAULT_AREA_DOMAINS = ["light", "fan", "cover", "media_player", "climate"];
/** Domains the toggle tile (and the service policy) can handle in area pages. */
export const AREA_DOMAINS = new Set(["light", "fan", "cover", "media_player", "climate", "switch", "input_boolean"]);

const IMAGE_EXT = new Set([".jpg", ".jpeg", ".png", ".webp", ".avif", ".gif", ".svg"]);
const WINDOW_CLASSES = new Set(["window", "door", "garage_door", "opening"]);

export const slugify = (s) =>
  String(s ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

const domainOf = (entityId) => entityId.slice(0, entityId.indexOf("."));

/**
 * Index image files of a folder by lower-case base name -> path relative to the assets root.
 * Not recursive; a missing folder is simply empty.
 */
export function listImages(assetsDir, sub) {
  const map = new Map();
  let files = [];
  try {
    files = fs.readdirSync(path.join(assetsDir, sub));
  } catch {
    return map;
  }
  for (const file of files.sort()) {
    const ext = path.extname(file).toLowerCase();
    if (!IMAGE_EXT.has(ext)) continue;
    const base = path.basename(file, path.extname(file)).toLowerCase();
    if (!map.has(base)) map.set(base, `${sub}/${file}`);
  }
  return map;
}

export function scanImages(assetsDir) {
  return { areas: listImages(assetsDir, "areas"), entities: listImages(assetsDir, "entities") };
}

const imageSignature = (images) => JSON.stringify([[...images.areas], [...images.entities]]);
export { imageSignature };

const matchesAny = (list, area) => {
  const keys = new Set([area.area_id, slugify(area.area_id), slugify(area.name)]);
  return list.some((item) => keys.has(item) || keys.has(slugify(item)));
};

/**
 * Turn the Home Assistant registries into what the area pages need.
 *
 * registries: { areas, floors, devices: [{id, area_id, disabled_by}], entities: [display entries] }
 * deviceClasses: Map(entity_id -> device_class) taken from the live states
 * settings: the parsed `areas:` section of dashboard.yaml
 * images: result of scanImages()
 * hidden: Set of device ids people removed from the overview; they stay in `hidden_entities` so they can be restored
 *
 * Returns { areas, entities } where `entities` is every entity id the pages can show or control.
 */
export function buildAreaModel({ registries, deviceClasses = new Map(), settings, images, hidden = new Set(), builtinPictures = new Set() }) {
  const empty = { areas: [], entities: new Set() };
  if (!registries || !settings?.enabled) return empty;

  const domains = settings.domains?.length ? settings.domains : DEFAULT_AREA_DOMAINS;
  const domainRank = new Map(domains.map((d, i) => [d, i]));
  const devices = new Map(registries.devices.map((d) => [d.id, d]));
  const floors = new Map((registries.floors ?? []).map((f) => [f.floor_id, f]));
  const buckets = new Map();
  const bucket = (id) => {
    if (!buckets.has(id)) buckets.set(id, { tiles: [], temperature: [], humidity: [], windows: [] });
    return buckets.get(id);
  };

  for (const entry of registries.entities) {
    const id = entry.ei;
    if (!id || entry.hb || entry.ec != null) continue; // hidden, config or diagnostic entities
    const device = entry.di ? devices.get(entry.di) : null;
    if (device?.disabled_by) continue;
    const areaId = entry.ai ?? device?.area_id;
    if (!areaId) continue;

    const domain = domainOf(id);
    const cls = deviceClasses.get(id);
    if (domainRank.has(domain)) bucket(areaId).tiles.push(id);
    else if (domain === "sensor" && cls === "temperature") bucket(areaId).temperature.push(id);
    else if (domain === "sensor" && cls === "humidity") bucket(areaId).humidity.push(id);
    else if (domain === "binary_sensor" && WINDOW_CLASSES.has(cls)) bucket(areaId).windows.push(id);
  }

  const all = new Set();
  const result = [];

  for (const area of registries.areas) {
    const override = settings.overrides?.[area.area_id] ?? settings.overrides?.[slugify(area.name)] ?? {};
    if (override.hide || matchesAny(settings.hide ?? [], area)) continue;

    const b = buckets.get(area.area_id) ?? { tiles: [], temperature: [], humidity: [], windows: [] };
    const designatedTemp = override.temperature_entity ?? area.temperature_entity_id;
    const designatedHumidity = override.humidity_entity ?? area.humidity_entity_id;
    const temperature = designatedTemp ? [designatedTemp] : b.temperature.sort();
    const humidity = designatedHumidity ? [designatedHumidity] : b.humidity.sort();
    const windows = override.window_entities?.length ? override.window_entities : b.windows.sort();
    const allTiles = b.tiles.sort((x, y) => domainRank.get(domainOf(x)) - domainRank.get(domainOf(y)) || x.localeCompare(y));
    const tiles = allTiles.filter((id) => !hidden.has(id));
    const hiddenTiles = allTiles.filter((id) => hidden.has(id));

    if (!allTiles.length && !temperature.length && !humidity.length && !windows.length) continue;

    const floor = area.floor_id ? floors.get(area.floor_id) : null;
    const slug = slugify(area.name);
    const wanted = override.image ? slugify(override.image) : null;
    // The picture of the area in Home Assistant comes first; files in assets/areas are for areas without one.
    const imageFile = override.image
      ? (/[./]/.test(override.image) ? override.image : (images.areas.get(wanted) ?? null))
      : area.picture
        ? null
        : (images.areas.get(area.area_id.toLowerCase()) ?? images.areas.get(slug) ?? null);

    const entityImages = {};
    for (const id of allTiles) {
      const file = images.entities.get(id.toLowerCase());
      if (file) entityImages[id] = file;
    }

    for (const id of [...allTiles, ...temperature, ...humidity, ...windows]) all.add(id);

    result.push({
      id: area.area_id,
      name: String(override.name ?? area.name),
      floor: floor?.name ?? null,
      floor_level: floor?.level ?? null,
      icon: override.icon ?? area.icon ?? null,
      image: imageFile,
      picture: area.picture ?? null,
      builtin_picture: Boolean(area.picture) && builtinPictures.has(area.area_id),
      default_image: settings.default_images === false ? null : roomImage(override.room ?? roomType(area.name, area.area_id)),
      entities: tiles,
      hidden_entities: hiddenTiles,
      entity_images: entityImages,
      temperature,
      humidity,
      windows,
    });
  }

  result.sort(
    (a, b) =>
      (a.floor_level ?? Infinity) - (b.floor_level ?? Infinity) ||
      (a.floor ?? "").localeCompare(b.floor ?? "") ||
      a.name.localeCompare(b.name),
  );

  return { areas: result, entities: all };
}
