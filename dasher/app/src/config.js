import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";
import { AREA_DOMAINS, DEFAULT_AREA_DOMAINS } from "./areas.js";
import { ROOM_TYPES } from "./room-images.js";
import { DEFAULT_TABS, MUSIC_TABS } from "./music.js";
import { collectEntities, describeUsage, mapEntities } from "../web/js/lib/entities.js";
import { STOCK_EXAMPLE_HASHES, hashDashboard } from "./stock-examples.js";
import { APPLIANCE_KINDS, APPLIANCE_ROLES } from "./devices.js";
import { MAP_FILE, parseEntityMap, parseEntityMapOption } from "./mapping.js";

export { collectEntities };

export const TILE_TYPES = new Set([
  "hero",
  "toggle",
  "price",
  "vehicle",
  "media",
  "climate",
  "buttons",
  "calendar",
  "dinner",
]);

const ENTITY_RE = /^[a-z0-9_]+\.[a-z0-9_]+$/;

const slugify = (s) =>
  String(s).toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

const posInt = (v, fallback) => {
  const n = Number(v);
  return Number.isInteger(n) && n >= 1 ? n : fallback;
};


const toList = (v) => (Array.isArray(v) ? v : v == null ? [] : [v]).map(String);

/** Normalise the optional `areas:` section; problems are pushed to `errors`. */
function parseAreas(raw, errors) {
  const a = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const domains = toList(a.domains).filter((d) => {
    const ok = AREA_DOMAINS.has(d);
    if (!ok) errors.push(`areas.domains: "${d}" is not supported. Use: ${[...AREA_DOMAINS].join(", ")}.`);
    return ok;
  });

  const overrides = {};
  const source = a.overrides && typeof a.overrides === "object" ? a.overrides : {};
  for (const [areaId, value] of Object.entries(source)) {
    const o = value && typeof value === "object" ? value : {};
    const clean = {};
    if (o.name != null) clean.name = String(o.name);
    if (o.icon != null) clean.icon = String(o.icon);
    if (o.image != null) clean.image = String(o.image);
    if (o.room != null) {
      if (ROOM_TYPES.includes(String(o.room))) clean.room = String(o.room);
      else errors.push(`areas.overrides.${areaId}.room: "${o.room}" is not a room type. Use: ${ROOM_TYPES.join(", ")}.`);
    }
    if (o.hide === true) clean.hide = true;
    for (const key of ["temperature_entity", "humidity_entity"]) {
      if (o[key] == null) continue;
      if (ENTITY_RE.test(String(o[key]))) clean[key] = String(o[key]);
      else errors.push(`areas.overrides.${areaId}.${key}: invalid entity id "${o[key]}"`);
    }
    if (o.window_entities != null) {
      const ids = toList(o.window_entities);
      const bad = ids.filter((e) => !ENTITY_RE.test(e));
      if (bad.length) errors.push(`areas.overrides.${areaId}.window_entities: invalid entity id(s): ${bad.join(", ")}`);
      clean.window_entities = ids.filter((e) => ENTITY_RE.test(e));
    }
    overrides[areaId] = clean;
  }

  return {
    enabled: a.enabled !== false,
    title: a.title != null ? String(a.title) : null,
    icon: String(a.icon ?? "floor-plan"),
    hide: toList(a.hide),
    default_images: a.default_images !== false,
    domains: domains.length ? domains : DEFAULT_AREA_DOMAINS,
    overrides,
  };
}

/** Normalise the optional `music:` section (alias: `radio:`) for the Music Assistant page. */
function parseMusic(raw, errors) {
  const r = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const ids = (key) => {
    const list = toList(r[key]);
    const bad = list.filter((e) => !ENTITY_RE.test(e) || !e.startsWith("media_player."));
    if (bad.length) errors.push(`music.${key}: not a media_player entity id: ${bad.join(", ")}`);
    return list.filter((e) => !bad.includes(e));
  };
  const players = ids("players");
  const exclude = ids("exclude");
  let defaultPlayer = r.default_player != null ? String(r.default_player) : null;
  if (defaultPlayer && !(ENTITY_RE.test(defaultPlayer) && defaultPlayer.startsWith("media_player."))) {
    errors.push(`music.default_player: not a media_player entity id: ${defaultPlayer}`);
    defaultPlayer = null;
  }
  const tabs = toList(r.tabs).filter((tab) => {
    const ok = MUSIC_TABS.includes(tab);
    if (!ok) errors.push(`music.tabs: "${tab}" is not a tab. Use: ${MUSIC_TABS.join(", ")}.`);
    return ok;
  });
  return {
    enabled: r.enabled !== false,
    title: r.title != null ? String(r.title) : null,
    icon: String(r.icon ?? "music"),
    tabs: tabs.length ? [...new Set(tabs)] : DEFAULT_TABS,
    players,
    exclude,
    default_player: defaultPlayer,
    fullscreen: r.fullscreen !== false,
    config_entry_id: r.config_entry_id != null ? String(r.config_entry_id) : null,
  };
}

export const EV_ROLES = [
  "battery_entity",
  "range_entity",
  "plug_entity",
  "charging_entity",
  "charge_switch_entity",
  "start_entity",
  "stop_entity",
  "smart_switch_entity",
  "smart_status_entity",
  "smart_info_entity",
  "start_time_entity",
  "ready_time_entity",
  "restart_entity",
  "remote_start_entity",
  "remote_temp_entity",
  "defrost_front_entity",
  "defrost_rear_entity",
];

/** Normalise the optional `ev:` section (the car page). Entities not listed are found automatically. */
function parseEv(raw, errors) {
  const r = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const roles = {};
  for (const key of EV_ROLES) {
    if (r[key] == null) continue;
    const id = String(r[key]);
    if (ENTITY_RE.test(id)) roles[key] = id;
    else errors.push(`ev.${key}: invalid entity id "${id}"`);
  }
  const enabled = r.enabled === false ? false : r.enabled === true ? true : "auto";
  return {
    enabled,
    title: r.title != null ? String(r.title) : null,
    icon: String(r.icon ?? "car-electric"),
    name: r.name != null ? String(r.name) : null,
    image: r.image != null ? String(r.image) : null,
    roles,
  };
}

/** Normalise the optional `devices:` section (vacuums, washing machines, dryers, dishwashers, clothes heaters). */
function parseDevices(raw, errors) {
  const r = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const ids = (key, domain) => {
    const out = [];
    for (const id of toList(r[key])) {
      if (ENTITY_RE.test(id) && (!domain || id.startsWith(`${domain}.`))) out.push(id);
      else errors.push(`devices.${key}: "${id}" is not ${domain ? `a ${domain} ` : "an "}entity id`);
    }
    return out;
  };
  const appliances = [];
  for (const [i, a] of (Array.isArray(r.appliances) ? r.appliances : []).entries()) {
    const where = `devices.appliances[${i}]`;
    if (!a || typeof a !== "object" || !APPLIANCE_KINDS.includes(a.kind)) {
      errors.push(`${where}: kind must be one of ${APPLIANCE_KINDS.join(", ")}.`);
      continue;
    }
    const roles = {};
    for (const role of APPLIANCE_ROLES) {
      if (a[role] == null) continue;
      if (ENTITY_RE.test(String(a[role]))) roles[role] = String(a[role]);
      else errors.push(`${where}.${role}: invalid entity id "${a[role]}"`);
    }
    if (!roles.status_entity && !roles.power_entity) {
      errors.push(`${where}: needs a status_entity or a power_entity.`);
      continue;
    }
    appliances.push({ kind: a.kind, name: a.name != null ? String(a.name) : null, roles });
  }
  return {
    enabled: r.enabled === false ? false : r.enabled === true ? true : "auto",
    title: r.title != null ? String(r.title) : null,
    icon: String(r.icon ?? "washing-machine"),
    vacuums: ids("vacuums", "vacuum"),
    exclude: ids("exclude"),
    appliances,
  };
}

/** Normalise the optional `meals:` section (the meal plan page). */
function parseMeals(raw, errors) {
  const r = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const entity = (key, domain) => {
    if (r[key] == null) return null;
    const id = String(r[key]);
    if (ENTITY_RE.test(id) && id.startsWith(`${domain}.`)) return id;
    errors.push(`meals.${key}: "${id}" is not a ${domain} entity id`);
    return null;
  };
  const time = /^([01]?\d|2[0-3]):[0-5]\d$/.test(String(r.dinner_time ?? "")) ? String(r.dinner_time).padStart(5, "0") : "18:00";
  const auto = r.auto && typeof r.auto === "object" ? r.auto : null;
  return {
    enabled: r.enabled === false ? false : r.enabled === true ? true : "auto",
    title: r.title != null ? String(r.title) : null,
    icon: String(r.icon ?? "silverware-fork-knife"),
    shopping_list_entity: entity("shopping_list_entity", "todo"),
    calendar_entity: entity("calendar_entity", "calendar"),
    ai_task_entity: entity("ai_task_entity", "ai_task"),
    household: posInt(r.household, 4),
    dinner_time: time,
    language: r.language != null ? String(r.language).toLowerCase().slice(0, 2) : null,
    mealie: {
      enabled: r.mealie === false || r.mealie?.enabled === false ? false : "auto",
      config_entry_id: /^[A-Za-z0-9]{10,40}$/.test(String(r.mealie?.config_entry_id ?? "")) ? String(r.mealie.config_entry_id) : null,
    },
    auto: auto
      ? {
          weekday: ["mon", "tue", "wed", "thu", "fri", "sat", "sun"].includes(auto.weekday) ? auto.weekday : "sat",
          time: /^([01]?\d|2[0-3]):[0-5]\d$/.test(String(auto.time ?? "")) ? String(auto.time).padStart(5, "0") : "08:00",
          days: Math.min(14, posInt(auto.days, 7)),
        }
      : null,
  };
}

/**
 * Normalise the optional `ambient:` section: the calm clock screen that takes over after a while without touch.
 * `ambient: 600` (seconds) is the short form; `ambient: false` or no section leaves it off.
 */
function parseAmbient(raw, errors) {
  const object = raw && typeof raw === "object" && !Array.isArray(raw);
  const r = object ? raw : {};
  const after = typeof raw === "number" || (typeof raw === "string" && raw.trim() !== "") ? Number(raw) : r.after != null ? Number(r.after) : object ? 600 : 0;
  const buttons = [];
  for (const [i, b] of (Array.isArray(r.buttons) ? r.buttons : []).entries()) {
    if (!b || typeof b !== "object" || typeof b.icon !== "string") {
      errors.push(`ambient.buttons[${i}]: a button needs an icon`);
      continue;
    }
    if (b.entity != null && !ENTITY_RE.test(String(b.entity))) {
      errors.push(`ambient.buttons[${i}].entity: invalid entity id "${b.entity}"`);
      continue;
    }
    buttons.push({ icon: b.icon, name: b.name != null ? String(b.name) : null, ...(b.entity ? { entity: String(b.entity) } : {}), ...(b.tap != null ? { tap: b.tap } : {}), ...(b.active_when ? { active_when: b.active_when } : {}) });
    if (buttons.length >= 4) break;
  }
  const enabled = r.enabled !== false && Number.isFinite(after) && after >= 10;
  return {
    enabled,
    after: enabled ? Math.round(after) : 0,
    buttons,
    time_format: r.time_format === "12h" ? "12h" : "24h",
    brightness: Number.isFinite(Number(r.brightness)) ? Math.min(1, Math.max(0.1, Number(r.brightness))) : 0.8,
  };
}

/** Normalise the optional `todo:` section (the to-do lists page). */
function parseTodo(raw, errors) {
  const r = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const ids = (key) => {
    const out = [];
    for (const id of toList(r[key])) {
      if (ENTITY_RE.test(id) && id.startsWith("todo.")) out.push(id);
      else errors.push(`todo.${key}: "${id}" is not a todo entity id`);
    }
    return out;
  };
  return {
    enabled: r.enabled === false ? false : r.enabled === true ? true : "auto",
    title: r.title != null ? String(r.title) : null,
    icon: String(r.icon ?? "format-list-checks"),
    lists: ids("lists"),
    exclude: ids("exclude"),
  };
}

/** Normalise the optional `plex:` section (the Media page). */
function parsePlex(raw, errors) {
  const r = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const ids = (key) => {
    const out = [];
    for (const id of toList(r[key])) {
      if (ENTITY_RE.test(id) && id.startsWith("media_player.")) out.push(id);
      else errors.push(`plex.${key}: "${id}" is not a media player entity id`);
    }
    return out;
  };
  return {
    enabled: r.enabled === false ? false : r.enabled === true ? true : "auto",
    title: r.title != null ? String(r.title) : null,
    icon: String(r.icon ?? "movie-open-outline"),
    players: ids("players"),
    exclude: ids("exclude"),
    transcode: ["always", "never"].includes(r.transcode) ? r.transcode : "auto",
  };
}

/** Normalise the optional `climate:` section (the climate overview page). */
function parseClimate(raw, errors) {
  const r = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const ids = (key) => {
    const out = [];
    for (const id of toList(r[key])) {
      if (ENTITY_RE.test(id) && id.startsWith("climate.")) out.push(id);
      else errors.push(`climate.${key}: "${id}" is not a climate entity id`);
    }
    return out;
  };
  const source = r.source === "all" ? "all" : "helpers";
  if (r.source != null && !["all", "helpers"].includes(r.source)) errors.push(`climate.source must be "helpers" or "all"`);
  return {
    enabled: r.enabled === false ? false : r.enabled === true ? true : "auto",
    title: r.title != null ? String(r.title) : null,
    icon: String(r.icon ?? "home-thermometer-outline"),
    source,
    entities: ids("entities"),
    exclude: ids("exclude"),
    platforms: toList(r.platforms).filter((p) => /^[a-z0-9_]+$/.test(p)),
  };
}

/**
 * Parse and normalise a dashboard.yaml document.
 * Never throws: problems end up in `errors` and offending tiles are dropped.
 */
export function parseConfig(text, { entityMap = {} } = {}) {
  const errors = [];
  const failed = (message) => ({ config: null, errors: [message], entities: new Set(), rawEntities: new Set(), usage: new Map() });
  let raw;
  try {
    raw = YAML.parse(text);
  } catch (err) {
    return failed(`YAML syntax error: ${err.message}`);
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return failed("The file must contain a YAML mapping.");
  if (!Array.isArray(raw.pages) || raw.pages.length === 0) return failed("`pages` must be a non-empty list.");

  // The entities as written in the file, before the user's mapping replaces some of them.
  const rawEntities = collectEntities(raw.pages);
  collectEntities(raw.areas?.overrides ?? {}, rawEntities);
  collectEntities(raw.ev ?? {}, rawEntities);
  collectEntities(raw.climate ?? {}, rawEntities);
  for (const id of toList(raw.plex?.players)) rawEntities.add(id);
  for (const id of toList(raw.devices?.vacuums)) rawEntities.add(id);
  for (const id of toList(raw.todo?.lists)) rawEntities.add(id);
  collectEntities(raw.meals ?? {}, rawEntities);
  collectEntities(raw.ambient ?? {}, rawEntities);
  collectEntities(raw.devices?.appliances ?? [], rawEntities);
  for (const id of [...rawEntities]) if (!ENTITY_RE.test(id)) rawEntities.delete(id);
  const usage = describeUsage(raw);
  if (Object.keys(entityMap).length) raw = mapEntities(raw, entityMap);

  const defaults = {
    columns: posInt(raw.columns, 4),
    rows: posInt(raw.rows, 2),
    gap: Number.isFinite(Number(raw.gap)) ? Number(raw.gap) : 8,
  };

  const usedIds = new Set();
  const pages = raw.pages.map((page, i) => {
    const p = page && typeof page === "object" ? page : {};
    let id = slugify(p.id ?? p.title ?? "") || `page-${i + 1}`;
    while (usedIds.has(id)) id += "-x";
    usedIds.add(id);
    const label = `pages[${i}] (${id})`;

    const tiles = [];
    for (const [j, tile] of (Array.isArray(p.tiles) ? p.tiles : []).entries()) {
      const where = `${label}.tiles[${j}]`;
      if (!tile || typeof tile !== "object" || !TILE_TYPES.has(tile.type)) {
        errors.push(`${where}: unknown tile type "${tile?.type}". Use one of: ${[...TILE_TYPES].join(", ")}.`);
        continue;
      }
      const bad = [...collectEntities(tile)].filter((e) => !ENTITY_RE.test(e));
      if (bad.length) {
        errors.push(`${where}: invalid entity id(s): ${bad.join(", ")}`);
        continue;
      }
      tiles.push({
        ...tile,
        col: tile.col == null ? null : posInt(tile.col, null),
        row: tile.row == null ? null : posInt(tile.row, null),
        w: posInt(tile.w, 1),
        h: posInt(tile.h, 1),
      });
    }

    return {
      id,
      title: String(p.title ?? id),
      icon: String(p.icon ?? "view-dashboard"),
      columns: posInt(p.columns, defaults.columns),
      rows: posInt(p.rows, defaults.rows),
      gap: Number.isFinite(Number(p.gap)) ? Number(p.gap) : defaults.gap,
      tiles,
    };
  });

  const areas = parseAreas(raw.areas, errors);
  const music = parseMusic(raw.music ?? raw.radio, errors);
  const ev = parseEv(raw.ev, errors);
  const climate = parseClimate(raw.climate, errors);
  const plex = parsePlex(raw.plex, errors);
  const devices = parseDevices(raw.devices, errors);
  const todo = parseTodo(raw.todo, errors);
  const meals = parseMeals(raw.meals, errors);
  const ambient = parseAmbient(raw.ambient, errors);

  const config = {
    title: String(raw.title ?? "Dasher"),
    language: String(raw.language ?? "en"),
    locale: raw.locale ? String(raw.locale) : null,
    accent: String(raw.accent ?? "#2dd4bf"),
    idle_return: Number(raw.idle_return) > 0 ? Number(raw.idle_return) : 0,
    areas,
    music,
    ev,
    climate,
    plex,
    devices,
    todo,
    meals,
    ambient,
    pages,
  };

  const entities = collectEntities(pages);
  collectEntities(areas.overrides, entities);
  for (const id of Object.values(ev.roles)) entities.add(id);
  for (const id of climate.entities) entities.add(id);
  for (const id of plex.players) entities.add(id);
  for (const id of devices.vacuums) entities.add(id);
  for (const id of todo.lists) entities.add(id);
  for (const id of [meals.shopping_list_entity, meals.calendar_entity, meals.ai_task_entity]) if (id) entities.add(id);
  collectEntities(ambient, entities);
  for (const a of devices.appliances) for (const id of Object.values(a.roles)) entities.add(id);
  for (const id of [...music.players, music.default_player]) if (id) entities.add(id);
  return { config, errors, entities, rawEntities, usage };
}

/** Watches dashboard.yaml and keeps the parsed result current. */
export class ConfigStore {
  /** `entityMapOption`: the app option `entity_map` (a list of { from, to }). */
  constructor({ dir, onChange, logger, entityMapOption = [] }) {
    this.dir = dir;
    this.optionMap = parseEntityMapOption(entityMapOption);
    this._legacyLogged = false;
    this.file = path.join(dir, "dashboard.yaml");
    this.mapFile = path.join(dir, MAP_FILE);
    this.entityMap = {};
    this.assetsDir = path.join(dir, "assets");
    this.onChange = onChange;
    this.log = logger;
    this.current = { config: null, errors: ["Not loaded yet."], entities: new Set(), rawEntities: new Set(), usage: new Map() };
    this._signature = "";
  }

  seedIfMissing(examplePath) {
    fs.mkdirSync(this.assetsDir, { recursive: true });
    for (const sub of ["areas", "entities"]) fs.mkdirSync(path.join(this.assetsDir, sub), { recursive: true });
    const example = fs.readFileSync(examplePath, "utf8");
    // Always keep a current copy of the example next to the dashboard, to compare or copy from.
    try {
      fs.writeFileSync(path.join(this.dir, "dashboard.example.yaml"), example);
    } catch (err) {
      this.log.warn(`Could not write dashboard.example.yaml: ${err.message}`);
    }
    if (!fs.existsSync(this.file)) {
      fs.writeFileSync(this.file, example);
      this.log.info(`Created example configuration at ${this.file}`);
      return;
    }
    // An untouched dashboard from an older version follows the app's updates; an edited one is never changed.
    const existing = fs.readFileSync(this.file, "utf8");
    const hash = hashDashboard(existing);
    if (hash !== hashDashboard(example) && STOCK_EXAMPLE_HASHES.has(hash)) {
      fs.writeFileSync(`${this.file}.bak`, existing);
      fs.writeFileSync(this.file, example);
      this.log.info(`dashboard.yaml was the unedited example of an older version and has been updated (old copy: dashboard.yaml.bak)`);
    }
  }

  load() {
    let text = "";
    try {
      text = fs.readFileSync(this.file, "utf8");
    } catch (err) {
      this.current = { config: null, errors: [`Cannot read ${this.file}: ${err.message}`], entities: new Set(), rawEntities: new Set(), usage: new Map() };
      return this.current;
    }
    this.entityMap = this._readEntityMap();
    this.current = parseConfig(text, { entityMap: this.entityMap });
    for (const e of this.current.errors) this.log.warn(`dashboard.yaml: ${e}`);
    return this.current;
  }

  /** The mapping: the app option, over the entity-map.yaml that older versions wrote. */
  _readEntityMap() {
    if (!this._optionLogged) {
      this._optionLogged = true;
      for (const e of this.optionMap.errors) this.log.warn(e);
    }
    let legacy = {};
    try {
      const { map, errors } = parseEntityMap(fs.readFileSync(this.mapFile, "utf8"));
      for (const e of errors) this.log.warn(e);
      legacy = map;
    } catch {
      // no file: nothing to carry over
    }
    const unmoved = Object.keys(legacy).filter((id) => !Object.hasOwn(this.optionMap.map, id));
    if (unmoved.length && !this._legacyLogged) {
      this._legacyLogged = true;
      this.log.warn(
        `${MAP_FILE} is still used for ${unmoved.length} mapping(s). Copy them to the app option "Entity mapping" (Settings, Apps, Dasher, Configuration): ${unmoved.map((id) => `${id} -> ${legacy[id]}`).join(", ")}`,
      );
    }
    return { ...legacy, ...this.optionMap.map };
  }

  _fileSignature() {
    const part = (file) => {
      try {
        const st = fs.statSync(file);
        return `${st.mtimeMs}:${st.size}`;
      } catch {
        return "missing";
      }
    };
    return `${part(this.file)}|${part(this.mapFile)}`;
  }

  /** Poll for changes (inotify is unreliable on bind mounts and atomic saves). */
  watch(intervalMs = 2000) {
    const check = () => {
      const sig = this._fileSignature();
      if (sig !== this._signature) {
        const first = this._signature === "";
        this._signature = sig;
        this.load();
        if (!first) {
          this.log.info("Configuration changed, reloading");
          this.onChange?.(this.current);
        }
      }
    };
    check();
    this._timer = setInterval(check, intervalMs);
    this._timer.unref?.();
  }
}
