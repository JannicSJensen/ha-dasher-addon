/*
 * The Party plugin of Music Assistant (host dashboard): the guest join link as a QR code and the live queue of
 * the party player, with a mark on the songs guests requested or boosted. It reads three plugin commands
 * (`party/url`, `party/config`, `party/player`) and the party player's queue.
 */
import QRCode from "qrcode";
import { MAError, imageSource, pickImage } from "./ma-api.js";

const QUEUE_ITEMS = 30;

const names = (list) =>
  (Array.isArray(list) ? list : [])
    .map((a) => a?.name)
    .filter(Boolean)
    .join(", ");

/** One queue item as the tablets show it: title, artist, picture and whether a guest requested or boosted it. */
export function queueEntry(item, { baseUrl, registerImage }) {
  if (!item || typeof item !== "object") return null;
  const media = item.media_item && typeof item.media_item === "object" ? item.media_item : {};
  const title = String(media.name ?? item.name ?? "").trim();
  if (!title) return null;
  const source = imageSource(pickImage(media) ?? item.image ?? null, baseUrl);
  const extra = item.extra_attributes && typeof item.extra_attributes === "object" ? item.extra_attributes : {};
  const duration = Number(item.duration ?? media.duration);
  return {
    id: String(item.queue_item_id ?? ""),
    title,
    artist: names(media.artists) || (media.media_type === "radio" ? "" : String(media.artist ?? "")),
    album: media.album?.name ?? null,
    image: source ? registerImage(source) : null,
    duration: Number.isFinite(duration) && duration > 0 ? Math.round(duration) : null,
    requested: Boolean(extra.party_guest),
    boosted: Boolean(extra.party_boosted),
  };
}

/** Everything the Party tab shows, from the plugin's answers and the party player's queue. */
export function buildParty({ url, config, playerId, queue, items }, options) {
  const entries = (Array.isArray(items) ? items : []).map((item) => queueEntry(item, options)).filter(Boolean);
  const hasCurrent = Number.isInteger(queue?.current_index);
  const now = hasCurrent ? (entries[0] ?? null) : null;
  const elapsed = Number(queue?.elapsed_time);
  return {
    available: true,
    enabled: Boolean(url),
    name: config?.party_name ? String(config.party_name) : null,
    qrText: config?.qr_text ? String(config.qr_text) : null,
    mode: config?.mode === "remote" ? "remote" : "venue",
    requestColor: /^#[0-9a-f]{3,8}$/i.test(config?.request_badge_color ?? "") ? config.request_badge_color : null,
    boostColor: /^#[0-9a-f]{3,8}$/i.test(config?.boost_badge_color ?? "") ? config.boost_badge_color : null,
    player: playerId ?? null,
    state: queue?.state ?? null,
    elapsed: Number.isFinite(elapsed) ? Math.round(elapsed) : null,
    now,
    next: hasCurrent ? entries.slice(1) : entries,
  };
}

/** QR code of the guest link as SVG (dark modules on white, with the quiet zone scanners need). */
export function qrSvg(url) {
  return QRCode.toString(url, { type: "svg", margin: 2, errorCorrectionLevel: "M", color: { dark: "#000000", light: "#ffffff" } });
}

/** Whether an error means "this plugin is not there" (the command is unknown to Music Assistant). */
export const isMissingPlugin = (err) => err instanceof MAError && /not found|unknown command|invalid command/i.test(err.message);

export class PartyReader {
  constructor({ client, options, ttlMs = 3000, now = Date.now }) {
    this.client = client;
    this.options = options;
    this.ttl = ttlMs;
    this.now = now;
    this._cache = null;
    this._qr = new Map();
  }

  async read() {
    if (this._cache && this.now() - this._cache.at < this.ttl) return this._cache.value;
    let url;
    try {
      url = await this.client.call("party/url");
    } catch (err) {
      if (isMissingPlugin(err)) throw new MAError("The Party plugin is not enabled in Music Assistant (Settings, Plugins).", 404);
      throw err;
    }
    const [config, playerId] = await Promise.all([this.client.call("party/config").catch(() => null), this.client.call("party/player").catch(() => null)]);
    let queue = null;
    let items = [];
    if (playerId) {
      queue = await this.client.call("player_queues/get", { queue_id: playerId }).catch(() => null);
      if (queue) {
        const offset = Number.isInteger(queue.current_index) ? queue.current_index : 0;
        items = await this.client.call("player_queues/items", { queue_id: playerId, limit: QUEUE_ITEMS, offset }).catch(() => []);
      }
    }
    const value = buildParty({ url, config, playerId, queue, items }, typeof this.options === "function" ? this.options() : this.options);
    if (url) value.qr = `api/music/party/qr?v=${encodeURIComponent(String(url).slice(-16))}`;
    this._url = url ?? null;
    this._cache = { at: this.now(), value };
    return value;
  }

  /** The QR code SVG for the current guest link, or null when guest access is off. */
  async qr() {
    await this.read();
    if (!this._url) return null;
    if (!this._qr.has(this._url)) {
      this._qr.clear();
      this._qr.set(this._url, await qrSvg(this._url));
    }
    return { type: "image/svg+xml", body: Buffer.from(this._qr.get(this._url)) };
  }
}
