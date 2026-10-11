import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";
import { AREA_DOMAINS, DEFAULT_AREA_DOMAINS } from "./areas.js";
import { DEFAULT_TABS, MUSIC_TABS } from "./music.js";
import { collectEntities, describeUsage, mapEntities } from "../web/js/lib/entities.js";
import { STOCK_EXAMPLE_HASHES, hashDashboard } from "./stock-examples.js";
import { MAP_FILE, parseEntityMap, serializeEntityMap } from "./mapping.js";

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
    pages,
  };

  const entities = collectEntities(pages);
  collectEntities(areas.overrides, entities);
  for (const id of Object.values(ev.roles)) entities.add(id);
  for (const id of climate.entities) entities.add(id);
  for (const id of [...music.players, music.default_player]) if (id) entities.add(id);
  return { config, errors, entities, rawEntities, usage };
}

/** Watches dashboard.yaml and keeps the parsed result current. */
export class ConfigStore {
  constructor({ dir, onChange, logger }) {
    this.dir = dir;
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

  _readEntityMap() {
    let text = "";
    try {
      text = fs.readFileSync(this.mapFile, "utf8");
    } catch {
      return {}; // no mapping yet
    }
    const { map, errors } = parseEntityMap(text);
    for (const e of errors) this.log.warn(e);
    return map;
  }

  /** Save the entity mapping (atomically) and reload the configuration with it. */
  saveEntityMap(map) {
    fs.mkdirSync(this.dir, { recursive: true });
    const tmp = `${this.mapFile}.tmp`;
    fs.writeFileSync(tmp, serializeEntityMap(map));
    fs.renameSync(tmp, this.mapFile);
    this.load();
    this._signature = this._fileSignature();
    this.onChange?.(this.current);
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
