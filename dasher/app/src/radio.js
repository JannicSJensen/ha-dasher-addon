import { EventEmitter } from "node:events";
import crypto from "node:crypto";

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const IMAGE_CACHE_ENTRIES = 64;
const REFRESH_MS = 10 * 60 * 1000;

const stationId = (uri) => crypto.createHash("sha1").update(uri).digest("hex").slice(0, 10);

/** Only http(s) URLs are ever fetched; the URL itself always comes from Home Assistant, never from a tablet. */
function safeUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

/**
 * Radio stations of a Music Assistant instance, read through Home Assistant's
 * `music_assistant.get_library` action, and playback of a station on a Music Assistant player.
 *
 * Emits "change" whenever the published payload changes.
 */
export class RadioService extends EventEmitter {
  constructor({ ha, logger, fetchImpl = globalThis.fetch }) {
    super();
    this.ha = ha;
    this.log = logger;
    this.fetch = fetchImpl;
    this.settings = { enabled: false };
    this.stations = [];
    this.error = null;
    this.entryId = null;
    this._imageUrls = new Map(); // station id -> source url
    this._imageCache = new Map(); // station id -> { type, body }
    this._signature = "";
    this._timer = null;
    this._loading = null;
  }

  configure(settings) {
    const idChanged = settings?.config_entry_id !== this.settings.config_entry_id;
    this.settings = settings ?? { enabled: false };
    if (idChanged) {
      this.entryId = null;
      this.stations = [];
    }
  }

  start() {
    clearInterval(this._timer);
    this._timer = setInterval(() => this.refresh(), REFRESH_MS);
    this._timer.unref?.();
  }

  stop() {
    clearInterval(this._timer);
  }

  payload() {
    return {
      stations: this.stations.map(({ id, name, uri, image }) => ({ id, name, uri, image })),
      error: this.error,
    };
  }

  /** Load the stations; concurrent calls share one request and failures never throw. */
  refresh() {
    if (!this.settings.enabled || !this.ha.connected) return Promise.resolve();
    this._loading ??= this._load().finally(() => {
      this._loading = null;
    });
    return this._loading;
  }

  async _load() {
    try {
      const entryId = await this._findEntryId();
      const response = await this.ha.callServiceWithResponse("music_assistant", "get_library", {
        config_entry_id: entryId,
        media_type: "radio",
        limit: 500,
        order_by: "name",
      });
      const items = Array.isArray(response?.items) ? response.items : [];
      this._setStations(items);
      this.error = null;
      this.log.info(`Radio: ${this.stations.length} stations from Music Assistant`);
    } catch (err) {
      this.error = err.message;
      this.log.warn(`Radio: could not load stations: ${err.message}`);
    }
    this._publish();
  }

  async _findEntryId() {
    if (this.settings.config_entry_id) return this.settings.config_entry_id;
    if (this.entryId) return this.entryId;
    const entries = await this.ha.request({ type: "config_entries/get", domain: "music_assistant" });
    const entry = (entries ?? []).find((e) => e.state === "loaded") ?? entries?.[0];
    if (!entry) throw new Error("The Music Assistant integration is not set up in Home Assistant.");
    this.entryId = entry.entry_id;
    return this.entryId;
  }

  _setStations(items) {
    const seen = new Set();
    this.stations = [];
    this._imageUrls.clear();
    for (const item of items) {
      if (!item?.uri || !item?.name || seen.has(item.uri)) continue;
      seen.add(item.uri);
      const id = stationId(item.uri);
      const source = item.image ? safeUrl(item.image) : null;
      if (source) this._imageUrls.set(id, source);
      this.stations.push({
        id,
        name: String(item.name),
        uri: String(item.uri),
        image: source ? `api/radio/image/${id}?v=${stationId(source)}` : null,
      });
    }
    for (const key of [...this._imageCache.keys()]) if (!this._imageUrls.has(key)) this._imageCache.delete(key);
  }

  _publish() {
    const signature = JSON.stringify(this.payload());
    if (signature === this._signature) return;
    this._signature = signature;
    this.emit("change");
  }

  station(id) {
    return this.stations.find((s) => s.id === id) ?? null;
  }

  /** Play a station on a Music Assistant player, replacing its queue. */
  async play(entityId, id) {
    const station = this.station(id);
    if (!station) throw Object.assign(new Error("Unknown radio station."), { status: 404 });
    await this.ha.callService(
      "music_assistant",
      "play_media",
      { media_id: station.uri, media_type: "radio", enqueue: "replace" },
      [entityId],
    );
  }

  /** Group speakers: `add` join the leader's group, `remove` leave whatever group they are in. */
  async group(leader, { add = [], remove = [] }) {
    for (const id of remove) await this.ha.callService("media_player", "unjoin", {}, [id]);
    if (add.length) await this.ha.callService("media_player", "join", { group_members: add }, [leader]);
  }

  /** The logo of a known station as { type, body }, fetched once and kept in memory. */
  async image(id) {
    const cached = this._imageCache.get(id);
    if (cached) return cached;
    const source = this._imageUrls.get(id);
    if (!source) return null;

    const response = await this.fetch(source, { signal: AbortSignal.timeout(10_000) });
    const type = response.headers.get("content-type") ?? "";
    if (!response.ok || !type.startsWith("image/")) throw new Error(`Not an image (${response.status})`);
    const body = Buffer.from(await response.arrayBuffer());
    if (body.length > MAX_IMAGE_BYTES) throw new Error("Image too large");

    const entry = { type, body };
    this._imageCache.set(id, entry);
    if (this._imageCache.size > IMAGE_CACHE_ENTRIES) this._imageCache.delete(this._imageCache.keys().next().value);
    return entry;
  }
}

/** Music Assistant players: the explicit list from the settings, else everything the integration created. */
export function radioPlayers(settings, registries) {
  if (!settings?.enabled) return [];
  if (settings.players.length) return settings.players.filter((id) => !settings.exclude.includes(id));
  const found = (registries?.entities ?? [])
    .filter((e) => e.pl === "music_assistant" && e.ei?.startsWith("media_player.") && !e.hb && e.ec == null)
    .map((e) => e.ei)
    .filter((id) => !settings.exclude.includes(id));
  return [...new Set(found)].sort();
}

/** Check a grouping request from a tablet against the radio page's players. */
export function validateGroupRequest(body, players) {
  if (!body || typeof body !== "object") return { ok: false, error: "Body must be a JSON object." };
  const known = new Set(players);
  const toList = (v) => (Array.isArray(v) ? v : v == null ? [] : null);
  const add = toList(body.add);
  const remove = toList(body.remove);
  if (add === null || remove === null) return { ok: false, error: "add and remove must be lists." };
  if (typeof body.leader !== "string" || !known.has(body.leader)) return { ok: false, error: "leader is not a speaker on the radio page." };
  if ([...add, ...remove].some((id) => typeof id !== "string" || !known.has(id))) {
    return { ok: false, error: "Every speaker must be one of the radio page's speakers." };
  }
  if (add.length + remove.length === 0 || add.length + remove.length > 20) return { ok: false, error: "Nothing to change." };
  if (add.includes(body.leader) || remove.includes(body.leader)) return { ok: false, error: "The group leader cannot be added or removed." };
  return { ok: true, leader: body.leader, add: [...new Set(add)], remove: [...new Set(remove)] };
}
