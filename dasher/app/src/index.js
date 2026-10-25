import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildAreaModel, imageSignature, scanImages } from "./areas.js";
import { HiddenDevices } from "./hidden.js";
import { ConfigStore } from "./config.js";
import { discoverMusicAssistant } from "./discovery.js";
import { discoverEv, resolveEv } from "./ev.js";
import { resolveClimate } from "./climate.js";
import { MealsAI, allergenWarnings } from "./meals-ai.js";
import { Mealie } from "./mealie.js";
import { MealsStore, addDays, isDate, normalizeEntry, todayLocal, weekdayIndex, WEEKDAYS } from "./meals.js";
import { MealsCalendar, eventSignature } from "./meals-sync.js";
import { TodoService, cleanListName, resolveTodo } from "./todo.js";
import { deviceEntities, deviceKeys, discoverDevices, resolveDevices } from "./devices.js";
import { PlexService, plexBrowsers, plexConfigured, plexPlayers, validBrowse, validatePlay } from "./plex.js";
import { PlexStreamer } from "./plex-stream.js";
import { describeUnresolved, unresolvedEntities } from "./mapping.js";
import { MusicService, availableTabs, DETAIL_TYPES } from "./music.js";
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
const MEALS_EDIT = !READ_ONLY && options.allow_meal_editing !== false && process.env.ALLOW_MEAL_EDITING !== "0";
const AREA_EDIT = !READ_ONLY && options.allow_area_editing !== false && process.env.ALLOW_AREA_EDITING !== "0";
const TODO_MANAGE = !READ_ONLY && options.allow_todo_management !== false && process.env.ALLOW_TODO_MANAGEMENT !== "0";
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
  entityMapOption: options.entity_map ?? process.env.ENTITY_MAP ?? [],
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

/** Home Assistant's REST API (list creation and removal go through the config entries API). */
async function haRest(method, apiPath, body) {
  const response = await fetch(haHttpBase + apiPath, {
    method,
    headers: { Authorization: `Bearer ${haToken}`, ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(15_000),
  });
  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    // not JSON
  }
  if (!response.ok) throw new Error(data?.message ?? `HTTP ${response.status}`);
  return data;
}
const todo = new TodoService({ ha, rest: haRest, logger });
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
const hiddenDevices = new HiddenDevices({ dir: dataDir, logger });
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
  return { enabled: true, title: settings.title, icon: settings.icon, editable: AREA_EDIT, areas: areaModel.areas };
};

let radioPlayerIds = [];
let evState = { enabled: false, roles: {} };
let plexState = { enabled: false, players: [] };
const plexPayload = () => (plexState.enabled ? plexState : { enabled: false, players: [] });
const noDevices = { enabled: false, vacuums: [], appliances: [], removed: { vacuums: [], appliances: [] } };
let devicesState = noDevices;
const devicesPayload = () => (devicesState.enabled ? { ...devicesState, editable: AREA_EDIT } : noDevices);
let todoState = { enabled: false, lists: [], manage: false };
const todoPayload = () => (todoState.enabled ? todoState : { enabled: false, lists: [], manage: false });
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
    hidden: hiddenDevices.ids,
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
  devicesState = resolveDevices({ settings: current.config?.devices, discovered: discoverDevices({ registries: ha.registries, index: ha.entityIndex }), hidden: hiddenDevices.devices });
  todoState = resolveTodo({ settings: current.config?.todo, registries: ha.registries, index: ha.entityIndex, manage: TODO_MANAGE });
  allowed = new Set([
    ...current.entities,
    ...(todoState.enabled ? todoState.lists.map((l) => l.id) : []),
    ...(devicesState.enabled ? deviceEntities(devicesState) : []),
    ...(mealsEnabled() ? [mealsSettings().shopping].filter(Boolean) : []),
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
  broadcast("devices", devicesPayload());
  broadcast("meals", mealsPayload());
  syncMealsCalendar();
  broadcast("todo", todoPayload());
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
  missing: missingEntities().map((m) => m.id),
});

/** Entities of dashboard.yaml that Home Assistant does not know once the app option "Entity mapping" is applied. */
function missingEntities() {
  return unresolvedEntities({ rawEntities: configStore.current.rawEntities, map: configStore.entityMap, index: ha.entityIndex });
}

let missingSignature = "";
/** Tell the log what is missing, with guesses to use in the option; once per distinct set. */
function reportMissing() {
  const unresolved = missingEntities();
  const signature = JSON.stringify(unresolved);
  if (signature === missingSignature) return;
  missingSignature = signature;
  for (const line of describeUnresolved({ unresolved, usage: configStore.current.usage, index: ha.entityIndex, registries: ha.registries })) logger.warn(line);
}

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
  reportMissing();
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
  send(res, "devices", devicesPayload());
  send(res, "meals", mealsPayload());
  send(res, "todo", todoPayload());
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

const todoList = (id) => todoState.lists.find((l) => l.id === id);

async function handleTodoGet(res, params) {
  const id = params.get("entity_id");
  const forMeals = mealsEnabled() && id === mealsSettings().shopping; // the meal plan reads its shopping list too
  if (!forMeals && (!todoState.enabled || !todoList(id))) return json(res, 404, { error: "Unknown list." });
  try {
    return json(res, 200, await todo.items(id));
  } catch (err) {
    logger.warn(`To-do list ${id} could not be read: ${err.message}`);
    return json(res, 502, { error: err.message });
  }
}

/** Create, rename and delete lists (only Local To-do lists can be changed). */
async function handleTodoManage(req, res, action) {
  if (!todoState.enabled) return json(res, 503, { error: "The to-do page is not available." });
  if (!TODO_MANAGE) return json(res, 403, { error: "Changing lists is switched off." });
  let body;
  try {
    body = JSON.parse(await readBody(req));
  } catch (err) {
    return json(res, err.status ?? 400, { error: err.message || "Invalid JSON." });
  }
  try {
    if (action === "create") {
      const name = cleanListName(body?.name);
      if (!name) return json(res, 400, { error: "Give the list a name of 1 to 60 characters." });
      await todo.createList(name);
      logger.info(`To-do list "${name}" created`);
      return json(res, 200, { ok: true });
    }
    const list = todoList(body?.entity_id);
    if (!list) return json(res, 404, { error: "Unknown list." });
    if (!list.managed) return json(res, 400, { error: "Only lists of the Local To-do integration can be changed here." });
    if (action === "rename") {
      const name = cleanListName(body?.name);
      if (!name) return json(res, 400, { error: "Give the list a name of 1 to 60 characters." });
      await todo.renameList(list.id, name);
      logger.info(`To-do list ${list.id} renamed to "${name}"`);
    } else {
      await todo.deleteList(list.id);
      logger.info(`To-do list ${list.id} deleted`);
    }
    return json(res, 200, { ok: true });
  } catch (err) {
    logger.warn(`To-do ${action} failed: ${err.message}`);
    return json(res, err.status ?? 502, { error: err.message });
  }
}

// ---- meal plan (Madplan) ---------------------------------------------------------------------------

const meals = new MealsStore({ dir: dataDir, logger });
const mealsCalendar = new MealsCalendar({ ha, logger });

/** What the meal plan uses from Home Assistant: the AI Task, the shopping list and the calendar. */
function mealsSettings() {
  const cfg = configStore.current.config?.meals;
  const ids = [...ha.entityIndex.keys()];
  const registry = ha.registries?.entities ?? [];
  const todos = ids.filter((id) => id.startsWith("todo.")).sort();
  const shopping = cfg?.shopping_list_entity ?? registry.find((e) => e.pl === "shopping_list" && e.ei.startsWith("todo."))?.ei ?? todos[0] ?? null;
  return {
    cfg,
    ai: cfg?.ai_task_entity ?? ids.filter((id) => id.startsWith("ai_task.")).sort()[0] ?? null,
    shopping,
    calendar: cfg?.calendar_entity ?? (ids.includes("calendar.family") ? "calendar.family" : null), // the shared family calendar unless another is chosen
    household: cfg?.household ?? 4,
    dinner_time: cfg?.dinner_time ?? "18:00",
    language: cfg?.language ?? configStore.current.config?.language ?? "da",
  };
}

const mealie = new Mealie({ ha, logger, settings: () => configStore.current.config?.meals?.mealie ?? {} });
const mealsAi = new MealsAI({ ha, store: meals, logger, resolveEntity: () => mealsSettings().ai, settings: mealsSettings, mealie });
const refreshMealie = () => mealie.refresh({ force: true }).then(() => broadcast("meals", mealsPayload()));
ha.on("status", (up) => up && refreshMealie().catch(() => {}));
setInterval(() => mealie.refresh().catch(() => {}), 5 * 60_000).unref();

const mealsEnabled = () => {
  const { cfg, ai, shopping } = mealsSettings();
  if (!cfg || cfg.enabled === false) return false;
  return cfg.enabled === true || Boolean(ai || shopping);
};

const mealsPayload = () => {
  if (!mealsEnabled()) return { enabled: false };
  const s = mealsSettings();
  const today = todayLocal();
  const days = Object.fromEntries(Object.entries(meals.payload().days).filter(([date]) => date >= addDays(today, -14) && date <= addDays(today, 42)));
  return {
    enabled: true,
    title: s.cfg.title,
    icon: s.cfg.icon,
    editable: MEALS_EDIT,
    household: s.household,
    dinner_time: s.dinner_time,
    ai: Boolean(s.ai) && MEALS_EDIT,
    shopping_list: s.shopping,
    calendar: s.calendar,
    calendar_error: mealsCalendar.error,
    mealie: mealie.available,
    ...meals.payload(),
    days,
  };
};

/** Keep the calendar in step with the plan: only days from today on, only what changed. */
const calendarSynced = new Map(); // date -> signature
function syncMealsCalendar() {
  const { calendar, dinner_time: time } = mealsSettings();
  if (!calendar || !mealsEnabled()) return;
  const today = todayLocal();
  const dates = new Set([...meals.days.keys(), ...calendarSynced.keys()]);
  for (const date of dates) {
    if (date < today) continue;
    const entry = meals.days.get(date);
    const signature = eventSignature(entry, time);
    if (calendarSynced.get(date) === signature || (signature === "null" && !calendarSynced.has(date))) continue;
    calendarSynced.set(date, signature);
    mealsCalendar.syncDay(calendar, date, entry, time).then((ok) => {
      if (!ok) calendarSynced.delete(date);
      else if (signature === "null") calendarSynced.delete(date);
      broadcast("meals", mealsPayload());
    });
  }
}
meals.on("change", () => {
  broadcast("meals", mealsPayload());
  syncMealsCalendar();
});

let lastAutoPlan = "";
/** `meals: auto:` makes next week's plan on the chosen weekday and time, when that week has no dinners yet. */
function maybeAutoPlan() {
  const { cfg, ai } = mealsSettings();
  if (!cfg?.auto || !ai || !MEALS_EDIT || meals.job.status === "running") return;
  const now = new Date();
  const stamp = `${todayLocal(now)} ${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
  if (WEEKDAYS[weekdayIndex(todayLocal(now))] !== cfg.auto.weekday || stamp.slice(11) < cfg.auto.time || lastAutoPlan === todayLocal(now)) return;
  const monday = addDays(todayLocal(now), 7 - weekdayIndex(todayLocal(now)));
  lastAutoPlan = todayLocal(now);
  if ([...meals.days.values()].some((d) => d.kind === "dinner" && d.date >= monday && d.date < addDays(monday, 7))) return;
  logger.info(`Making next week's meal plan (from ${monday})`);
  mealsAi.generatePlan({ start: monday, days: cfg.auto.days }).catch(() => {});
}
setInterval(maybeAutoPlan, 60_000).unref();

/** The recipe collection in Mealie, searched with `?q=`. */
async function handleCookbook(res, params) {
  if (!mealsEnabled()) return json(res, 503, { error: "The meal plan is not available." });
  try {
    return json(res, 200, { recipes: await mealie.search(String(params.get("q") ?? "").slice(0, 100), 60) });
  } catch (err) {
    return json(res, err.status ?? 502, { error: err.message });
  }
}

async function handleMealsPost(req, res, action) {
  if (!mealsEnabled()) return json(res, 503, { error: "The meal plan is not available." });
  if (!MEALS_EDIT) return json(res, 403, { error: "Editing the meal plan is switched off." });
  let body;
  try {
    body = JSON.parse(await readBody(req, 64 * 1024));
  } catch (err) {
    return json(res, err.status ?? 400, { error: err.message || "Invalid JSON." });
  }
  try {
    switch (action) {
      case "day": {
        if (!isDate(body?.date)) return json(res, 400, { error: "Invalid date." });
        if (body.entry == null) {
          meals.setDay(body.date, null);
          return json(res, 200, { ok: true });
        }
        const entry = meals.setDay(body.date, { ...body.entry, source: ["ai", "mealie"].includes(body.entry.source) ? body.entry.source : "manual" });
        return entry ? json(res, 200, { ok: true, entry }) : json(res, 400, { error: "A dinner needs a name." });
      }
      case "prefs":
        return json(res, 200, { ok: true, prefs: meals.setPrefs(body?.prefs) });
      case "rate":
        return meals.rate(body?.name, body?.rating ?? null) ? json(res, 200, { ok: true }) : json(res, 400, { error: "Invalid rating." });
      case "generate": {
        if (!mealsAi.available) return json(res, 503, { error: "No AI Task is set up in Home Assistant." });
        if (meals.job.status === "running") return json(res, 409, { error: "A plan is already being made." });
        if (!isDate(body?.start)) return json(res, 400, { error: "Choose a start day." });
        const request = {
          start: body.start,
          days: body.days,
          skip: (Array.isArray(body.skip) ? body.skip : []).filter(isDate),
          wishes: String(body.wishes ?? "").slice(0, 500),
          surprise: body.surprise === true,
          cookbook: body.cookbook === true,
        };
        mealsAi.generatePlan(request).catch(() => {}); // runs on; the job state tells the tablets how it goes
        return json(res, 202, { ok: true });
      }
      case "recipe":
        if (!mealsAi.available) return json(res, 503, { error: "No AI Task is set up in Home Assistant." });
        if (!isDate(body?.date)) return json(res, 400, { error: "Invalid date." });
        await mealsAi.writeRecipe(body.date);
        return json(res, 200, { ok: true });
      case "mealie-use": {
        if (!isDate(body?.date)) return json(res, 400, { error: "Invalid date." });
        const entry = await mealie.recipe(body?.slug, mealsSettings().household);
        const warnings = allergenWarnings(normalizeEntry({ ...entry, date: body.date }, body.date), meals.prefs);
        const saved = meals.setDay(body.date, { ...entry, kind: "dinner", ...(warnings.length ? { warnings } : {}) });
        return saved ? json(res, 200, { ok: true, entry: saved }) : json(res, 400, { error: "The recipe could not be used." });
      }
      case "mealie-import": {
        const slug = await mealie.importUrl(String(body?.url ?? "").trim());
        return json(res, 200, { ok: true, slug });
      }
      case "alternatives":
        if (!mealsAi.available) return json(res, 503, { error: "No AI Task is set up in Home Assistant." });
        if (!isDate(body?.date)) return json(res, 400, { error: "Invalid date." });
        return json(res, 200, { alternatives: await mealsAi.alternatives(body.date) });
      default:
        return json(res, 404, { error: "Not found." });
    }
  } catch (err) {
    logger.warn(`Meal plan ${action} failed: ${err.message}`);
    return json(res, err.status ?? 502, { error: err.message });
  }
}

/** Remove a device from an area's overview, or bring it back. */
async function handleAreaDevice(req, res) {
  if (READ_ONLY || !AREA_EDIT) return json(res, 403, { error: "Editing the area devices is switched off." });
  let body;
  try {
    body = JSON.parse(await readBody(req));
  } catch (err) {
    return json(res, err.status ?? 400, { error: err.message || "Invalid JSON." });
  }
  const id = body?.entity_id;
  const known = areaModel.areas.some((a) => a.entities.includes(id) || a.hidden_entities.includes(id));
  if (!known || typeof body?.hidden !== "boolean") return json(res, 400, { error: "That device is not on an area page." });
  if (hiddenDevices.set(id, body.hidden)) {
    logger.info(`${id} ${body.hidden ? "removed from" : "restored to"} its area page`);
    rebuild({ refresh: false });
  }
  return json(res, 200, { ok: true });
}

/** Remove a card from the Devices page, or bring it back. */
async function handleDevicesCard(req, res) {
  if (READ_ONLY || !AREA_EDIT) return json(res, 403, { error: "Editing the devices is switched off." });
  let body;
  try {
    body = JSON.parse(await readBody(req));
  } catch (err) {
    return json(res, err.status ?? 400, { error: err.message || "Invalid JSON." });
  }
  if (!devicesState.enabled || !deviceKeys(devicesState).has(body?.key) || typeof body?.hidden !== "boolean") {
    return json(res, 400, { error: "That device is not on the Devices page." });
  }
  if (hiddenDevices.set(body.key, body.hidden, "devices")) {
    logger.info(`${body.key} ${body.hidden ? "removed from" : "restored to"} the Devices page`);
    rebuild({ refresh: false });
  }
  return json(res, 200, { ok: true });
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
      if (p === "/api/meals") return json(res, 200, mealsPayload());
      if (p === "/api/meals/cookbook") return await handleCookbook(res, url.searchParams);
      if (p === "/api/todo/items") return await handleTodoGet(res, url.searchParams);
      if (p.startsWith("/api/plex/")) return await handlePlexGet(res, p, url.searchParams);
      if (p === "/api/proxy") return await proxyImage(res, url.searchParams.get("path"));
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
    if (req.method === "POST" && p === "/api/service") return await handleService(req, res);
    if (req.method === "POST" && p === "/api/plex/play") return await handlePlexPlay(req, res);
    if (req.method === "POST" && p === "/api/areas/device") return await handleAreaDevice(req, res);
    if (req.method === "POST" && p.startsWith("/api/meals/")) return await handleMealsPost(req, res, p.slice("/api/meals/".length));
    if (req.method === "POST" && p === "/api/devices/card") return await handleDevicesCard(req, res);
    if (req.method === "POST" && ["/api/todo/create", "/api/todo/rename", "/api/todo/delete"].includes(p)) return await handleTodoManage(req, res, p.slice("/api/todo/".length));
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
