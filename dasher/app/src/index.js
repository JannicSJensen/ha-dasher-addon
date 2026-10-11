import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildAreaModel, imageSignature, scanImages } from "./areas.js";
import { ConfigStore } from "./config.js";
import { discoverMusicAssistant } from "./discovery.js";
import { discoverEv, resolveEv } from "./ev.js";
import { resolveClimate } from "./climate.js";
import { PlexService, plexBrowsers, plexConfigured, plexPlayers, validBrowse, validatePlay } from "./plex.js";
import { PlexStreamer } from "./plex-stream.js";
import { mappingItems, rankCandidates, validateMapping } from "./mapping.js";
import { MusicService, availableTabs, DETAIL_TYPES } from "./music.js";
import { PSEUDO_IDS, buildSuggestions } from "./suggestions.js";
import { CalendarService, calendarScope, parseWindow } from "./calendar.js";
import { NowPlayingStore } from "./nowplaying.js";
import { RadioService, radioPlayers, validateGroupRequest } from "./radio.js";
import { HAClient } from "./ha-client.js";
import { iconSvg } from "./icons.js";
import { validateProxyPath, validateServiceCall } from "./policy.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(here, "..");
const webRoot = path.join(appRoot, "web");
const version = JSON.parse(fs.readFileSync(path.join(appRoot, "package.json"), "utf8")).version;

// ---- options & environment ------------------------------------------------

function readOptions() {
  const file = process.env.OPTIONS_FILE ?? "/data/options.json";
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return {};
  }
}

const options = readOptions();
const LEVELS = { debug: 0, info: 1, warning: 2, error: 3 };
const minLevel = LEVELS[options.log_level ?? process.env.LOG_LEVEL ?? "info"] ?? 1;
const logger = Object.fromEntries(
  ["debug", "info", "warn", "error"].map((name) => {
    const level = LEVELS[name === "warn" ? "warning" : name];
    const out = name === "error" ? console.error : console.log;
    return [name, (msg) => level >= minLevel && out(`[${new Date().toISOString()}] ${name.toUpperCase()} ${msg}`)];
  }),
);

const PORT = Number(process.env.PORT ?? 8099);
const READ_ONLY = options.read_only === true;
// Tablets may map entities that are missing from Home Assistant to existing ones (see entity-map.yaml).
const MAPPING_ENABLED = !READ_ONLY && options.allow_entity_mapping !== false && process.env.ALLOW_ENTITY_MAPPING !== "0";
const configDir = process.env.CONFIG_DIR ?? "/config";

const supervisorToken = process.env.SUPERVISOR_TOKEN;
const haHttpBase = supervisorToken ? "http://supervisor/core" : (process.env.HA_URL ?? "").replace(/\/$/, "");
const haToken = supervisorToken ?? process.env.HA_TOKEN;
if (!haHttpBase || !haToken) {
  logger.error("No Home Assistant connection: set SUPERVISOR_TOKEN (add-on) or HA_URL and HA_TOKEN (development).");
  process.exit(1);
}
const haWsUrl = supervisorToken
  ? "ws://supervisor/core/websocket"
  : `${haHttpBase.replace(/^http/, "ws")}/api/websocket`;

// ---- state ------------------------------------------------------------------

const clients = new Set();

const send = (res, event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
const broadcast = (event, data) => clients.forEach((res) => send(res, event, data));

const ha = new HAClient({ wsUrl: haWsUrl, token: haToken, logger });
const configStore = new ConfigStore({
  dir: configDir,
  logger,
  onChange: () => {
    rebuild({ refresh: true });
    broadcast("config", configPayload());
  },
});
const radio = new RadioService({ ha, logger });
radio.on("change", () => broadcast("music", musicPayload()));
const music = new MusicService({
  ha,
  logger,
  url: options.music_assistant_url ?? process.env.MA_URL,
  token: options.music_assistant_token ?? process.env.MA_TOKEN,
});

// When no address is set and Music Assistant runs as a Home Assistant app, find it through the Supervisor.
let discoveryTimer = null;
async function discoverMusic() {
  if (music.client.baseUrl || !supervisorToken) return;
  const found = await discoverMusicAssistant({ token: supervisorToken, log: logger });
  if (!found) return;
  music.client.baseUrl = found.url;
  clearInterval(discoveryTimer);
  logger.info(`Music Assistant found as app ${found.slug} at ${found.url}`);
  broadcast("music", musicPayload());
}
if (!music.client.baseUrl && supervisorToken) {
  discoverMusic();
  discoveryTimer = setInterval(discoverMusic, 60_000);
  discoveryTimer.unref?.();
}

// ---- now playing memory -----------------------------------------------------------

/** Fetch an artwork picture of a media player: HA-relative paths with the token, absolute URLs without. */
async function fetchPicture(picture) {
  let target;
  const headers = {};
  if (picture.startsWith("/") && !picture.startsWith("//")) {
    target = haHttpBase + picture;
    headers.Authorization = `Bearer ${haToken}`;
  } else if (/^https?:\/\//.test(picture)) target = picture;
  else return null;
  const response = await fetch(target, { headers, signal: AbortSignal.timeout(10_000) });
  const type = response.headers.get("content-type") ?? "";
  if (!response.ok || !type.startsWith("image/")) return null;
  return { type, body: Buffer.from(await response.arrayBuffer()) };
}

const dataDir = process.env.DATA_DIR ?? (fs.existsSync("/data") ? "/data" : null);
const calendars = new CalendarService({ ha, logger });
const plexStreamer = new PlexStreamer({ url: options.plex_url ?? process.env.PLEX_URL, token: options.plex_token ?? process.env.PLEX_TOKEN, logger });
const plex = new PlexService({
  ha,
  logger,
  streamer: plexStreamer,
  fetchImage: async (path) => {
    const upstream = await fetch(haHttpBase + path, { headers: { Authorization: `Bearer ${haToken}` }, signal: AbortSignal.timeout(10_000) });
    const type = upstream.headers.get("content-type") ?? "";
    if (!upstream.ok || !type.startsWith("image/")) return null;
    const body = Buffer.from(await upstream.arrayBuffer());
    return body.length > 10 * 1024 * 1024 ? null : { type, body };
  },
});
const nowPlaying = new NowPlayingStore({ dir: dataDir, logger, fetchPicture });
nowPlaying.on("change", () => broadcast("lastplayed", nowPlaying.payload()));

// ---- areas ------------------------------------------------------------------

let images = { areas: new Map(), entities: new Map() };
let imageSig = "";
let areaModel = { areas: [], entities: new Set() };
// Everything tablets may see or control: the dashboard's own entities plus the area pages' entities.
let allowed = new Set();

const areasPayload = () => {
  const settings = configStore.current.config?.areas;
  if (!settings?.enabled) return { enabled: false, areas: [] };
  return { enabled: true, title: settings.title, icon: settings.icon, areas: areaModel.areas };
};

let radioPlayerIds = [];
let evState = { enabled: false, roles: {} };
let plexState = { enabled: false, players: [] };
const plexPayload = () => (plexState.enabled ? plexState : { enabled: false, players: [] });
let climateState = { enabled: false, entities: [] };
const climatePayload = () => (climateState.enabled ? climateState : { enabled: false, entities: [] });
const evPayload = () => (evState.enabled ? evState : { enabled: false, roles: {} });

/** What the Music page needs: speakers, radio stations and which tabs are usable. */
const musicPayload = () => {
  const settings = configStore.current.config?.music;
  if (!settings?.enabled || radioPlayerIds.length === 0) return { enabled: false, players: [], stations: [], tabs: [], error: null };
  return {
    enabled: true,
    title: settings.title,
    icon: settings.icon,
    default_player: settings.default_player,
    fullscreen: settings.fullscreen,
    players: radioPlayerIds,
    tabs: availableTabs(settings, music.configured),
    library: music.configured,
    library_missing: music.client.missing,
    ...radio.payload(),
  };
};

/** Recompute everything derived from the config and the registries, and tell the tablets. */
function rebuild({ refresh }) {
  const current = configStore.current;
  areaModel = buildAreaModel({
    registries: ha.registries,
    deviceClasses: ha.deviceClasses,
    settings: current.config?.areas,
    images,
  });
  radioPlayerIds = radioPlayers(current.config?.music, ha.registries);
  radio.configure(current.config?.music);
  evState = resolveEv({
    settings: current.config?.ev,
    discovered: discoverEv({ registries: ha.registries, index: ha.entityIndex }),
  });
  climateState = resolveClimate({ settings: current.config?.climate, registries: ha.registries, index: ha.entityIndex });
  {
    const settings = current.config?.plex;
    const players = plexPlayers({ settings, registries: ha.registries, streaming: plexStreamer.configured });
    const enabled = Boolean(settings) && settings.enabled !== false && players.length > 0 && (settings.enabled === true || plexConfigured(ha.registries));
    plexState = {
      enabled,
      title: settings?.title ?? null,
      icon: settings?.icon,
      players: enabled ? players.map((p) => p.id) : [],
      platforms: enabled ? Object.fromEntries(players.map((p) => [p.id, p.platform])) : {},
    };
    plex.configure(enabled ? players : [], enabled ? plexBrowsers(ha.registries) : []);
    plex.transcode = settings?.transcode ?? "auto";
  }
  allowed = new Set([
    ...current.entities,
    ...areaModel.entities,
    ...radioPlayerIds,
    ...(evState.enabled ? Object.values(evState.roles) : []),
    ...(climateState.enabled ? climateState.entities : []),
    ...plexState.players,
  ]);
  ha.setWatched(allowed, { refresh, required: current.entities });
  broadcast("areas", areasPayload());
  broadcast("music", musicPayload());
  broadcast("ev", evPayload());
  broadcast("climate", climatePayload());
  broadcast("plex", plexPayload());
  if (radioPlayerIds.length && (radio.stations.length === 0 || radio.error)) radio.refresh();
}

function rescanImages() {
  const next = scanImages(configStore.assetsDir);
  const sig = imageSignature(next);
  if (sig === imageSig) return;
  const first = imageSig === "";
  imageSig = sig;
  images = next;
  if (!first) rebuild({ refresh: false });
}

const configPayload = () => ({ config: configStore.current.config, errors: configStore.current.errors });
const statusPayload = () => ({
  ha: ha.connected,
  readOnly: READ_ONLY,
  missing: ha.missing,
  mapping: { enabled: MAPPING_ENABLED, mapped: Object.keys(configStore.entityMap).length },
});

ha.on("registries", () => {
  rebuild({ refresh: false });
  logger.info(`Area pages: ${areaModel.areas.length} areas, ${areaModel.entities.size} entities`);
});
ha.on("status", () => broadcast("status", statusPayload()));
ha.on("state", (state) => {
  nowPlaying.observe(state);
  broadcast("state", state);
});
ha.on("snapshot", (states) => {
  for (const state of states.values()) nowPlaying.observe(state);
  broadcast("status", statusPayload());
  broadcast("snapshot", Object.fromEntries(states));
});

// ---- http helpers -----------------------------------------------------------

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".avif": "image/avif",
  ".woff2": "font/woff2",
  ".ico": "image/x-icon",
};

function json(res, status, body) {
  const text = JSON.stringify(body);
  res.writeHead(status, { "Content-Type": MIME[".json"], "Cache-Control": "no-store" });
  res.end(text);
}

function readBody(req, limit = 16 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(Object.assign(new Error("Body too large."), { status: 413 }));
        req.destroy();
      } else chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function serveFile(res, root, relPath, cacheControl) {
  let decoded;
  try {
    decoded = decodeURIComponent(relPath);
  } catch {
    return json(res, 400, { error: "Bad path." });
  }
  const file = path.resolve(root, "." + path.posix.normalize("/" + decoded));
  if (file !== root && !file.startsWith(root + path.sep)) return json(res, 403, { error: "Forbidden." });
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) return json(res, 404, { error: "Not found." });
    res.writeHead(200, {
      "Content-Type": MIME[path.extname(file).toLowerCase()] ?? "application/octet-stream",
      "Content-Length": st.size,
      "Cache-Control": cacheControl,
    });
    fs.createReadStream(file).pipe(res);
  });
}

async function proxyImage(res, requestedPath) {
  if (!validateProxyPath(requestedPath)) return json(res, 400, { error: "Path not allowed." });
  try {
    const upstream = await fetch(haHttpBase + requestedPath, {
      headers: { Authorization: `Bearer ${haToken}` },
      signal: AbortSignal.timeout(10_000),
    });
    const type = upstream.headers.get("content-type") ?? "";
    if (!upstream.ok || !type.startsWith("image/")) return json(res, 404, { error: "No image." });
    const buf = Buffer.from(await upstream.arrayBuffer());
    if (buf.length > 10 * 1024 * 1024) return json(res, 413, { error: "Image too large." });
    res.writeHead(200, { "Content-Type": type, "Content-Length": buf.length, "Cache-Control": "private, max-age=300" });
    res.end(buf);
  } catch (err) {
    logger.debug(`Image proxy failed: ${err.message}`);
    json(res, 502, { error: "Upstream failed." });
  }
}

function handleEvents(req, res) {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-store",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.write("retry: 3000\n\n");
  send(res, "hello", { version });
  send(res, "status", statusPayload());
  send(res, "config", configPayload());
  send(res, "areas", areasPayload());
  send(res, "music", musicPayload());
  send(res, "ev", evPayload());
  send(res, "climate", climatePayload());
  send(res, "plex", plexPayload());
  send(res, "lastplayed", nowPlaying.payload());
  send(res, "snapshot", Object.fromEntries(ha.states));
  clients.add(res);
  req.on("close", () => clients.delete(res));
}

async function handleService(req, res) {
  if (READ_ONLY) return json(res, 403, { error: "The add-on is in read-only mode." });
  let body;
  try {
    body = JSON.parse(await readBody(req));
  } catch (err) {
    return json(res, err.status ?? 400, { error: err.message || "Invalid JSON." });
  }
  const check = validateServiceCall(body, allowed);
  if (!check.ok) return json(res, 400, { error: check.error });
  try {
    await ha.callService(check.domain, check.service, check.data, check.entityIds);
    logger.debug(`${check.domain}.${check.service} ${check.entityIds.join(",")}`);
    json(res, 200, { ok: true });
  } catch (err) {
    logger.warn(`Service call failed: ${err.message}`);
    json(res, 502, { error: err.message });
  }
}

async function handleRadioPlay(req, res) {
  if (READ_ONLY) return json(res, 403, { error: "The add-on is in read-only mode." });
  let body;
  try {
    body = JSON.parse(await readBody(req));
  } catch (err) {
    return json(res, err.status ?? 400, { error: err.message || "Invalid JSON." });
  }
  if (typeof body?.entity_id !== "string" || !radioPlayerIds.includes(body.entity_id)) {
    return json(res, 400, { error: "That is not a Music Assistant player on the radio page." });
  }
  if (typeof body.station !== "string") return json(res, 400, { error: "station is required." });
  try {
    await radio.play(body.entity_id, body.station);
    logger.debug(`radio ${body.station} -> ${body.entity_id}`);
    json(res, 200, { ok: true });
  } catch (err) {
    logger.warn(`Radio playback failed: ${err.message}`);
    json(res, err.status ?? 502, { error: err.message });
  }
}

async function handleRadioGroup(req, res) {
  if (READ_ONLY) return json(res, 403, { error: "The add-on is in read-only mode." });
  let body;
  try {
    body = JSON.parse(await readBody(req));
  } catch (err) {
    return json(res, err.status ?? 400, { error: err.message || "Invalid JSON." });
  }
  const check = validateGroupRequest(body, radioPlayerIds);
  if (!check.ok) return json(res, 400, { error: check.error });
  try {
    await radio.group(check.leader, check);
    logger.debug(`radio group ${check.leader} +${check.add.join(",")} -${check.remove.join(",")}`);
    json(res, 200, { ok: true });
  } catch (err) {
    logger.warn(`Speaker grouping failed: ${err.message}`);
    json(res, 502, { error: err.message });
  }
}

// ---- entity mapping -----------------------------------------------------------------

const mappingState = () => {
  const { rawEntities, usage } = configStore.current;
  return { rawEntities, usage, map: configStore.entityMap, index: ha.entityIndex };
};

async function handleMappingGet(res, p, params) {
  if (!MAPPING_ENABLED) return json(res, 403, { error: "Entity mapping is switched off." });
  const state = mappingState();
  if (p === "/api/entities/mapping") {
    return json(res, 200, {
      connected: ha.connected,
      items: mappingItems(state),
      suggestions: buildSuggestions({ config: configStore.current.config, index: ha.entityIndex }),
    });
  }
  if (p === "/api/entities/candidates") {
    const from = params.get("for");
    if (!state.rawEntities.has(from) && !PSEUDO_IDS.has(from)) return json(res, 400, { error: "That entity is not used in dashboard.yaml." });
    const q = String(params.get("q") ?? "").trim().slice(0, 80);
    return json(res, 200, { items: rankCandidates({ index: ha.entityIndex, registries: ha.registries, from, usage: state.usage.get(from) ?? [], q }) });
  }
  return json(res, 404, { error: "Not found." });
}

async function handleMappingPut(req, res) {
  if (!MAPPING_ENABLED) return json(res, 403, { error: "Entity mapping is switched off." });
  let body;
  try {
    body = JSON.parse(await readBody(req));
  } catch (err) {
    return json(res, err.status ?? 400, { error: err.message || "Invalid JSON." });
  }
  const state = mappingState();
  const check = validateMapping(body ?? {}, state);
  if (!check.ok) return json(res, check.status, { error: check.error });
  const next = { ...configStore.entityMap };
  if (check.to) next[check.from] = check.to;
  else delete next[check.from];
  try {
    configStore.saveEntityMap(next);
  } catch (err) {
    logger.error(`Could not save the entity mapping: ${err.message}`);
    return json(res, 500, { error: "The mapping could not be saved." });
  }
  logger.info(check.to ? `Entity ${check.from} is now mapped to ${check.to}` : `Entity mapping of ${check.from} removed`);
  const item = mappingItems(mappingState()).find((i) => i.id === check.from);
  return json(res, 200, { ok: true, item });
}

const sendImage = (res, image) => {
  res.writeHead(200, { "Content-Type": image.type, "Content-Length": image.body.length, "Cache-Control": "public, max-age=86400" });
  res.end(image.body);
};

async function handlePlexGet(res, p, params) {
  if (!plexState.enabled) return json(res, 503, { error: "The Media page is not available." });
  try {
    if (p === "/api/plex/home") return json(res, 200, await plex.home());
    if (p === "/api/plex/browse") {
      const query = { id: params.get("id"), type: params.get("type") };
      if (!validBrowse(query)) return json(res, 400, { error: "Cannot browse that item." });
      return json(res, 200, await plex.children(query.id, query.type));
    }
    const image = /^\/api\/plex\/image\/([A-Za-z0-9]+)\/(\d+)$/.exec(p);
    if (image) {
      const picture = await plex.image(image[1], image[2]);
      if (!picture) return json(res, 404, { error: "No image." });
      res.writeHead(200, { "Content-Type": picture.type, "Content-Length": picture.body.length, "Cache-Control": "private, max-age=86400" });
      return res.end(picture.body);
    }
    return json(res, 404, { error: "Not found." });
  } catch (err) {
    logger.warn(`Plex request failed: ${err.message}`);
    return json(res, 502, { error: err.message });
  }
}

async function handlePlexPlay(req, res) {
  if (READ_ONLY) return json(res, 403, { error: "The add-on is in read-only mode." });
  if (!plexState.enabled) return json(res, 503, { error: "The Media page is not available." });
  let body;
  try {
    body = JSON.parse(await readBody(req));
  } catch (err) {
    return json(res, err.status ?? 400, { error: err.message || "Invalid JSON." });
  }
  const check = validatePlay(body ?? {}, plex.players);
  if (!check.ok) return json(res, 400, { error: check.error });
  try {
    await plex.play(check.entityId, check.id, check.type, check.player);
    logger.info(`Plex: playing ${check.id} on ${check.entityId}`);
    return json(res, 200, { ok: true });
  } catch (err) {
    logger.warn(`Plex play failed: ${err.message}`);
    return json(res, 502, { error: err.message });
  }
}

async function handleCalendar(res, params) {
  const scope = calendarScope(configStore.current.config, [...ha.entityIndex.keys()]);
  const window = parseWindow(params.get("start"), params.get("end"));
  if (!window) return json(res, 400, { error: "Invalid time window." });
  const asked = params.get("entities");
  const ids = !asked || asked === "all" ? [...scope.calendars] : asked.split(",").filter((id) => scope.calendars.has(id));
  const weatherId = params.get("weather");
  try {
    const [events, forecast] = await Promise.all([
      calendars.events(ids, window),
      weatherId && scope.weather.has(weatherId) ? calendars.forecast(weatherId) : {},
    ]);
    const names = Object.fromEntries(ids.map((id) => [id, ha.entityIndex.get(id)?.name ?? ha.states.get(id)?.attributes?.friendly_name ?? id]));
    return json(res, 200, { calendars: names, events, forecast });
  } catch (err) {
    logger.warn(`Calendar request failed: ${err.message}`);
    return json(res, 502, { error: err.message });
  }
}

async function handleMusicGet(res, p, params) {
  if (!music.configured) return json(res, 503, { error: "Music Assistant address and token are not set in the add-on options." });
  try {
    if (p === "/api/music/library") {
      return json(res, 200, await music.library({
        tab: params.get("tab"),
        q: params.get("q"),
        limit: params.get("limit"),
        offset: params.get("offset"),
        sort: params.get("sort"),
        favorite: params.get("fav") === "1",
      }));
    }
    if (p === "/api/music/discover") return json(res, 200, await music.discover());
    if (p === "/api/music/party") return json(res, 200, await music.party());
    if (p === "/api/music/party/qr") {
      const qr = await music.partyQr();
      if (!qr) return json(res, 404, { error: "Guest access is switched off in the Party plugin." });
      res.writeHead(200, { "Content-Type": qr.type, "Content-Length": qr.body.length, "Cache-Control": "no-store" });
      return res.end(qr.body);
    }
    if (p === "/api/music/search") return json(res, 200, await music.search(params.get("q")));
    if (p === "/api/music/item") {
      if (!DETAIL_TYPES.has(params.get("type"))) return json(res, 400, { error: "Unknown item type." });
      return json(res, 200, await music.detail(params.get("type"), params.get("provider"), params.get("id")));
    }
    if (p.startsWith("/api/music/image/")) {
      const image = await music.image(p.slice("/api/music/image/".length));
      return image ? sendImage(res, image) : json(res, 404, { error: "Unknown image." });
    }
    return json(res, 404, { error: "Not found." });
  } catch (err) {
    logger.debug(`Music request ${p} failed: ${err.message}`);
    return json(res, err.status ?? 502, { error: err.message });
  }
}

async function handleMusicPlay(req, res) {
  if (READ_ONLY) return json(res, 403, { error: "The add-on is in read-only mode." });
  let body;
  try {
    body = JSON.parse(await readBody(req));
  } catch (err) {
    return json(res, err.status ?? 400, { error: err.message || "Invalid JSON." });
  }
  if (typeof body?.entity_id !== "string" || !radioPlayerIds.includes(body.entity_id)) {
    return json(res, 400, { error: "That is not a Music Assistant player on the music page." });
  }
  try {
    await music.play(body.entity_id, body);
    logger.debug(`music ${body.uri} -> ${body.entity_id}`);
    json(res, 200, { ok: true });
  } catch (err) {
    logger.warn(`Music playback failed: ${err.message}`);
    json(res, err.status ?? 502, { error: err.message });
  }
}

function handleNowPlayingArt(res, rawId) {
  let id;
  try {
    id = decodeURIComponent(rawId);
  } catch {
    return json(res, 400, { error: "Bad id." });
  }
  const image = nowPlaying.art(id);
  return image ? sendImage(res, image) : json(res, 404, { error: "No artwork." });
}

async function handleRadioImage(res, id) {
  try {
    const image = await radio.image(id);
    if (!image) return json(res, 404, { error: "Unknown station." });
    sendImage(res, image);
  } catch (err) {
    logger.debug(`Radio logo failed: ${err.message}`);
    json(res, 502, { error: "Logo not available." });
  }
}

// ---- server -----------------------------------------------------------------

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  const p = url.pathname;
  try {
    if (req.method === "GET" || req.method === "HEAD") {
      if (p === "/api/events") return handleEvents(req, res);
      if (p === "/api/config") return json(res, 200, configPayload());
      if (p === "/api/calendar") return await handleCalendar(res, url.searchParams);
      if (p.startsWith("/api/plex/")) return await handlePlexGet(res, p, url.searchParams);
      if (p === "/api/proxy") return await proxyImage(res, url.searchParams.get("path"));
      if (p.startsWith("/api/entities/")) return await handleMappingGet(res, p, url.searchParams);
      if (p.startsWith("/api/nowplaying/art/")) return handleNowPlayingArt(res, p.slice("/api/nowplaying/art/".length));
      if (p.startsWith("/api/music/")) return await handleMusicGet(res, p, url.searchParams);
      if (p.startsWith("/api/radio/image/")) return await handleRadioImage(res, p.slice("/api/radio/image/".length));
      if (p === "/healthz") return json(res, 200, { ok: true, ha: ha.connected });
      if (p.startsWith("/icons/") && p.endsWith(".svg")) {
        const svg = iconSvg(p.slice("/icons/".length, -".svg".length));
        if (!svg) return json(res, 404, { error: "Unknown icon." });
        res.writeHead(200, { "Content-Type": MIME[".svg"], "Cache-Control": "public, max-age=604800" });
        return res.end(svg);
      }
      if (p.startsWith("/assets/")) {
        return serveFile(res, path.resolve(configStore.assetsDir), p.slice("/assets/".length), "no-cache");
      }
      if (p.startsWith("/api/")) return json(res, 404, { error: "Not found." });
      const rel = p === "/" ? "index.html" : p.slice(1);
      const longCache = rel.startsWith("fonts/");
      return serveFile(res, webRoot, rel, longCache ? "public, max-age=31536000, immutable" : "no-cache");
    }
    if (req.method === "PUT" && p === "/api/entities/map") return await handleMappingPut(req, res);
    if (req.method === "POST" && p === "/api/service") return await handleService(req, res);
    if (req.method === "POST" && p === "/api/plex/play") return await handlePlexPlay(req, res);
    if (req.method === "POST" && p === "/api/radio/play") return await handleRadioPlay(req, res);
    if (req.method === "POST" && p === "/api/music/play") return await handleMusicPlay(req, res);
    if (req.method === "POST" && p === "/api/radio/group") return await handleRadioGroup(req, res);
    json(res, 405, { error: "Method not allowed." });
  } catch (err) {
    logger.error(`Unhandled error for ${req.method} ${p}: ${err.stack}`);
    if (!res.headersSent) json(res, 500, { error: "Internal error." });
    else res.end();
  }
});

const heartbeat = setInterval(() => clients.forEach((res) => res.write(": ping\n\n")), 20_000);
heartbeat.unref();

configStore.seedIfMissing(path.join(appRoot, "examples", "dashboard.yaml"));
configStore.watch();
rescanImages();
allowed = new Set(configStore.current.entities);
ha.setWatched(allowed, { refresh: false });
ha.start();
radio.start();
setInterval(rescanImages, 3000).unref();

server.listen(PORT, () => logger.info(`Dasher ${version} listening on :${PORT} (config: ${configStore.file})`));

for (const sig of ["SIGTERM", "SIGINT"]) {
  process.on(sig, () => {
    logger.info(`${sig} received, shutting down`);
    ha.stop();
    radio.stop();
    nowPlaying.stop();
    clients.forEach((res) => res.end());
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 2000).unref();
  });
}
