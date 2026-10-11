import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";
import { AREA_DOMAINS, DEFAULT_AREA_DOMAINS } from "./areas.js";
import { DEFAULT_TABS, MUSIC_TABS } from "./music.js";
import { collectEntities } from "../web/js/lib/entities.js";

export { collectEntities };

export const TILE_TYPES = new Set([
  "hero",
  "toggle",
  "price",
  "vehicle",
  "media",
  "climate",
  "buttons",
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

/**
 * Parse and normalise a dashboard.yaml document.
 * Never throws: problems end up in `errors` and offending tiles are dropped.
 */
export function parseConfig(text) {
  const errors = [];
  let raw;
  try {
    raw = YAML.parse(text);
  } catch (err) {
    return { config: null, errors: [`YAML syntax error: ${err.message}`], entities: new Set() };
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { config: null, errors: ["The file must contain a YAML mapping."], entities: new Set() };
  }
  if (!Array.isArray(raw.pages) || raw.pages.length === 0) {
    return { config: null, errors: ["`pages` must be a non-empty list."], entities: new Set() };
  }

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

  const config = {
    title: String(raw.title ?? "Dasher"),
    language: String(raw.language ?? "en"),
    locale: raw.locale ? String(raw.locale) : null,
    accent: String(raw.accent ?? "#2dd4bf"),
    idle_return: Number(raw.idle_return) > 0 ? Number(raw.idle_return) : 0,
    areas,
    music,
    pages,
  };

  const entities = collectEntities(pages);
  collectEntities(areas.overrides, entities);
  for (const id of [...music.players, music.default_player]) if (id) entities.add(id);
  return { config, errors, entities };
}

/** Watches dashboard.yaml and keeps the parsed result current. */
export class ConfigStore {
  constructor({ dir, onChange, logger }) {
    this.dir = dir;
    this.file = path.join(dir, "dashboard.yaml");
    this.assetsDir = path.join(dir, "assets");
    this.onChange = onChange;
    this.log = logger;
    this.current = { config: null, errors: ["Not loaded yet."], entities: new Set() };
    this._signature = "";
  }

  seedIfMissing(examplePath) {
    fs.mkdirSync(this.assetsDir, { recursive: true });
    for (const sub of ["areas", "entities"]) fs.mkdirSync(path.join(this.assetsDir, sub), { recursive: true });
    if (!fs.existsSync(this.file)) {
      fs.copyFileSync(examplePath, this.file);
      this.log.info(`Created example configuration at ${this.file}`);
    }
  }

  load() {
    let text = "";
    try {
      text = fs.readFileSync(this.file, "utf8");
    } catch (err) {
      this.current = { config: null, errors: [`Cannot read ${this.file}: ${err.message}`], entities: new Set() };
      return this.current;
    }
    this.current = parseConfig(text);
    for (const e of this.current.errors) this.log.warn(`dashboard.yaml: ${e}`);
    return this.current;
  }

  /** Poll for changes (inotify is unreliable on bind mounts and atomic saves). */
  watch(intervalMs = 2000) {
    const check = () => {
      let sig = "";
      try {
        const st = fs.statSync(this.file);
        sig = `${st.mtimeMs}:${st.size}`;
      } catch {
        sig = "missing";
      }
      if (sig !== this._signature) {
        const first = this._signature === "";
        this._signature = sig;
        this.load();
        if (!first) {
          this.log.info("dashboard.yaml changed, reloading");
          this.onChange?.(this.current);
        }
      }
    };
    check();
    this._timer = setInterval(check, intervalMs);
    this._timer.unref?.();
  }
}
