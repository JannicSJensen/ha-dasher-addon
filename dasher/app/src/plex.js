/*
 * Plex through Home Assistant's Plex integration: media browsing (`media_player/browse_media`) for the
 * home screen hubs (continue watching, recently added), and `media_player.play_media` to play on a
 * Plex client or a Google Cast device. Nothing here talks to a Plex server directly.
 */
const domainOf = (id) => id.slice(0, id.indexOf("."));

/** Integrations whose media players can play Plex media: Plex's own clients and Google Cast devices. */
export const PLEX_PLAYER_PLATFORMS = ["plex", "cast"];

export const PLEX_ID_RE = /^plex:\/\/([A-Za-z0-9]+)\/(\d+)(\?resume=1)?$/;
const HUB_ID_RE = /^plex:\/\/[A-Za-z0-9]+\/server\/[A-Za-z0-9._-]+$/;
const EXPAND_TYPES = new Set(["show", "season"]);
const PLAY_TYPES = new Set(["movie", "episode", "show", "season", "video", "clip"]);
const MOVIE_TYPES = new Set(["movie", "video", "clip"]);
const SERIES_TYPES = new Set(["show", "season", "episode"]);

const CACHE_HOME_MS = 60_000;
const CACHE_BROWSE_MS = 5 * 60_000;
const IMAGE_CACHE_ENTRIES = 300;
const IMAGE_CACHE_BYTES = 60 * 1024 * 1024;
const MAX_ITEMS = 40;

/** Platforms that can play a Plex item as it is; every other player needs a stream link (see plex-stream.js). */
const NATIVE_PLATFORMS = new Set(PLEX_PLAYER_PLATFORMS);
/** Platforms added to the list by default when stream links are available. */
const STREAM_DEFAULT_PLATFORMS = ["apple_tv"];

/**
 * Players the Media page can use: the explicit list, else every Plex client and Cast device, and with a Plex
 * address and token (`streaming`) also Apple TVs. Each has a `mode`: "native" or "stream".
 */
export function plexPlayers({ settings, registries, streaming = false }) {
  if (!settings || settings.enabled === false) return [];
  const rows = (registries?.entities ?? []).filter((e) => e?.ei && domainOf(e.ei) === "media_player" && !e.hb);
  const platform = new Map(rows.map((e) => [e.ei, e.pl]));
  // Music Assistant shows up as a Plex client, but it only plays music.
  const wanted = new Set([...PLEX_PLAYER_PLATFORMS, ...(streaming ? STREAM_DEFAULT_PLATFORMS : [])]);
  const found = rows.filter((e) => wanted.has(e.pl) && !/music_assistant/.test(e.ei)).map((e) => e.ei);
  const ids = settings.players.length ? settings.players : found;
  const hidden = new Set(settings.exclude);
  return [...new Set(ids)]
    .filter((id) => !hidden.has(id))
    .map((id) => {
      const pl = platform.get(id) ?? null;
      return { id, platform: pl, mode: NATIVE_PLATFORMS.has(pl) ? "native" : "stream" };
    })
    .filter((p) => p.mode === "native" || streaming);
}

/** Every Plex client and Cast device, used to browse Plex through Home Assistant (whether or not it is a choice for playing). */
export function plexBrowsers(registries) {
  return (registries?.entities ?? [])
    .filter((e) => e?.ei && domainOf(e.ei) === "media_player" && !e.hb && PLEX_PLAYER_PLATFORMS.includes(e.pl))
    .map((e) => ({ id: e.ei, platform: e.pl }));
}

/** True when the Plex integration has entities in Home Assistant. */
export const plexConfigured = (registries) => (registries?.entities ?? []).some((e) => e?.pl === "plex");

const cleanTitle = (text) => String(text ?? "").trim();
const num = (code) => `S${Number(code.slice(1, code.indexOf("E")))} · E${Number(code.slice(code.indexOf("E") + 1))}`;

/** Split the title Home Assistant builds ("Show - S01E02 - Name", "Movie (2016)") into title, subtitle and meta. */
export function splitTitle(raw, type) {
  const text = cleanTitle(raw);
  if (type === "episode") {
    const full = /^(.*?) - (S\d+E\d+) - (.*)$/i.exec(text);
    if (full) return { title: full[1], subtitle: full[3], meta: num(full[2].toUpperCase()) };
    const short = /^(S\d+E\d+) - (.*)$/i.exec(text);
    if (short) return { title: short[2], subtitle: "", meta: num(short[1].toUpperCase()) };
  }
  if (type === "season") {
    const full = /^(.*?) - (.+)$/.exec(text);
    if (full) return { title: full[1], subtitle: full[2], meta: "" };
  }
  const year = /^(.*) \((\d{4})\)$/.exec(text);
  if (year && MOVIE_TYPES.has(type)) return { title: year[1], subtitle: "", meta: year[2] };
  return { title: text, subtitle: "", meta: "" };
}

/** One browse child as the page needs it, or null for anything that is not a Plex item. */
export function normalizeItem(raw) {
  const match = PLEX_ID_RE.exec(String(raw?.media_content_id ?? ""));
  if (!match) return null;
  const type = String(raw.media_content_type ?? "");
  const { title, subtitle, meta } = splitTitle(raw.title, type);
  return {
    id: raw.media_content_id,
    type,
    title,
    subtitle,
    meta,
    expandable: Boolean(raw.can_expand) && EXPAND_TYPES.has(type),
    playable: Boolean(raw.can_play) && PLAY_TYPES.has(type),
    resume: Boolean(match[3]),
    image: raw.thumbnail ? `api/plex/image/${match[1]}/${match[2]}` : null,
  };
}

/** What a hub is, from its identifier and title ("home.continue", "Fortsæt med at se", "Recently Added Movies"). */
export function classifyHub(hub) {
  const id = String(hub?.media_content_id ?? "").split("/").pop().toLowerCase();
  const title = String(hub?.title ?? "").toLowerCase();
  if (/continue|ondeck|inprogress/.test(id) || /continue|fortsæt|weiter|continuer/.test(title)) return "continue";
  if (/recent|added/.test(id) || /recent|added|tilføjet|senest|nyligt/.test(title)) return "recent";
  return null;
}

/** Sections for the page from the hubs' items: continue watching, recent movies, recent series. */
export function buildSections(hubs) {
  const sections = { continue: [], recent_movies: [], recent_series: [] };
  const seen = { continue: new Set(), recent_movies: new Set(), recent_series: new Set() };
  const add = (key, item) => {
    if (seen[key].has(item.id) || sections[key].length >= MAX_ITEMS) return;
    seen[key].add(item.id);
    sections[key].push(item);
  };
  for (const { kind, items } of hubs) {
    for (const item of items) {
      if (kind === "continue") {
        if (MOVIE_TYPES.has(item.type) || SERIES_TYPES.has(item.type)) add("continue", item);
      } else if (MOVIE_TYPES.has(item.type)) add("recent_movies", item);
      else if (SERIES_TYPES.has(item.type)) add("recent_series", item);
    }
  }
  return Object.entries(sections)
    .filter(([, items]) => items.length)
    .map(([kind, items]) => ({ kind, items }));
}

/** Check a play request: a Plex item id, an allowed type and a configured player. */
export function validatePlay({ entity_id: entityId, id, type }, players) {
  if (!players.some((p) => p.id === entityId)) return { ok: false, error: "That player is not on the Media page." };
  if (typeof id !== "string" || !PLEX_ID_RE.test(id)) return { ok: false, error: "Not a Plex item." };
  if (!PLAY_TYPES.has(type)) return { ok: false, error: "That kind of item cannot be played." };
  return { ok: true, entityId, id, type, player: players.find((p) => p.id === entityId) };
}

export const validBrowse = ({ id, type }) => EXPAND_TYPES.has(type) && PLEX_ID_RE.test(String(id ?? ""));

export class PlexService {
  constructor({ ha, logger, fetchImage, streamer = null, transcode = "auto", now = Date.now }) {
    this.ha = ha;
    this.streamer = streamer;
    this.transcode = transcode;
    this.log = logger;
    this.fetchImage = fetchImage;
    this.now = now;
    this.players = [];
    this.browsers = [];
    this._cache = new Map();
    this._images = new Map();
    this._imageBytes = 0;
    this._hubsLogged = false;
  }

  configure(players, browsers = players) {
    const changed = JSON.stringify([players, browsers]) !== JSON.stringify([this.players, this.browsers]);
    this.players = players;
    this.browsers = browsers;
    if (changed) this._cache.clear();
  }

  async _cached(key, ttl, load) {
    const hit = this._cache.get(key);
    if (hit && this.now() - hit.at < ttl) return hit.value;
    const value = await load();
    this._cache.set(key, { at: this.now(), value });
    if (this._cache.size > 80) this._cache.delete(this._cache.keys().next().value);
    return value;
  }

  /**
   * `media_player/browse_media` through a Plex or Cast entity: ones known to be online first, then the rest
   * (their state may not be tracked here), until one answers.
   */
  async _browse(type, id) {
    const rank = (p) => (this.ha.states.get(p.id)?.state === "unavailable" ? 2 : this.ha.states.has(p.id) ? 0 : 1);
    const candidates = [...this.browsers].sort((a, b) => rank(a) - rank(b) || Number(b.platform === "plex") - Number(a.platform === "plex"));
    if (!candidates.length) throw new Error("No Plex or Cast player is available to browse with. Turn one on.");
    let lastError;
    for (const player of candidates) {
      try {
        return await this.ha.request({
          type: "media_player/browse_media",
          entity_id: player.id,
          ...(type ? { media_content_type: type, media_content_id: id } : {}),
        });
      } catch (err) {
        lastError = err;
      }
    }
    throw new Error(`No Plex or Cast player is available to browse with. Turn one on. (${lastError.message})`);
  }

  /** The Plex server node (libraries and the "Recommended" folder), found from the root. */
  async _server() {
    return this._cached("server", CACHE_BROWSE_MS, async () => {
      let node = await this._browse();
      if (node?.media_content_type !== "server" && node?.media_content_type !== "plex_root") {
        const app = (node?.children ?? []).find((c) => c.media_content_type === "plex");
        if (app) node = await this._browse("plex", app.media_content_id ?? "");
      }
      if (node?.media_content_type === "plex_root") node = (node.children ?? []).find((c) => c.media_content_type === "server") ?? node;
      const recommended = (node?.children ?? []).find((c) => c.media_content_type === "server" && /\/Recommended$/.test(String(c.media_content_id)));
      if (!recommended) {
        const seen = (node?.children ?? []).map((c) => `${c.title} (${c.media_content_type})`).join(", ") || "nothing";
        throw new Error(`Home Assistant's Plex integration did not offer a Recommended folder (found: ${seen}).`);
      }
      return { title: node.title, recommendedId: recommended.media_content_id };
    });
  }

  async home() {
    return this._cached("home", CACHE_HOME_MS, async () => {
      const server = await this._server();
      const folder = await this._browse("server", server.recommendedId);
      const hubs = (folder?.children ?? []).filter((c) => c.media_content_type === "hub" && HUB_ID_RE.test(String(c.media_content_id)));
      if (!this._hubsLogged) {
        this._hubsLogged = true;
        this.log.info(`Plex: hubs ${hubs.map((h) => `${String(h.media_content_id).split("/").pop()} (${h.title})`).join(", ") || "none"}`);
      }
      const wanted = hubs.map((hub) => ({ hub, kind: classifyHub(hub) })).filter((h) => h.kind).slice(0, 12);
      const loaded = await Promise.all(
        wanted.map(async ({ hub, kind }) => {
          try {
            const raw = await this._cached(`hub:${hub.media_content_id}`, CACHE_HOME_MS, () => this._browse("hub", hub.media_content_id));
            return { kind, items: (raw?.children ?? []).map(normalizeItem).filter(Boolean) };
          } catch (err) {
            this.log.warn(`Plex: could not read "${hub.title}": ${err.message}`);
            return { kind, items: [] };
          }
        }),
      );
      return { server: server.title, sections: buildSections(loaded) };
    });
  }

  /** Seasons of a show or episodes of a season. */
  async children(id, type) {
    return this._cached(`children:${id}`, CACHE_BROWSE_MS, async () => {
      const raw = await this._browse(type, id);
      return { ...splitTitle(raw?.title, type), items: (raw?.children ?? []).map(normalizeItem).filter(Boolean) };
    });
  }

  /** Play on a player: the Plex item itself on Plex clients and Cast, a stream link on everything else. */
  async play(entityId, id, type, player = this.players.find((p) => p.id === entityId)) {
    if (player?.mode === "stream") {
      if (!this.streamer?.configured) throw new Error("The Plex address and token are not set in the app options.");
      const match = PLEX_ID_RE.exec(id);
      const stream = await this.streamer.resolve({ key: match[2], type, resume: Boolean(match[3]), platform: player.platform, transcode: this.transcode });
      this.log.info(`Plex: streaming ${stream.title} (${stream.kind}${stream.offset ? `, from ${stream.offset}s` : ""}) to ${entityId}`);
      const data = { media_content_id: stream.url, media_content_type: stream.mediaType };
      if (player.platform !== "apple_tv") data.extra = { title: stream.title };
      await this.ha.callService("media_player", "play_media", data, [entityId]);
      return;
    }
    await this.ha.callService("media_player", "play_media", { media_content_id: id, media_content_type: type }, [entityId]);
  }

  /** A thumbnail as { type, body }, fetched through Home Assistant and kept in memory. */
  async image(serverId, key) {
    const path = `/api/plex_image_proxy/${serverId}/${key}`;
    const cached = this._images.get(path);
    if (cached) return cached;
    const entry = await this.fetchImage(path);
    if (!entry) return null;
    this._images.set(path, entry);
    this._imageBytes += entry.body.length;
    while (this._images.size > IMAGE_CACHE_ENTRIES || this._imageBytes > IMAGE_CACHE_BYTES) {
      const [oldest, value] = this._images.entries().next().value;
      this._images.delete(oldest);
      this._imageBytes -= value.body.length;
    }
    return entry;
  }
}
