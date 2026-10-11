import { EventEmitter } from "node:events";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const ACTIVE = new Set(["playing", "paused", "buffering"]);
const MAX_ENTRIES = 40;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const SAVE_DELAY_MS = 2000;

const fileKey = (entityId) => crypto.createHash("sha1").update(entityId).digest("hex").slice(0, 16);

/**
 * Remembers, per speaker, the last track that played (title, artist, artwork, when), so the
 * "now playing" tile can still show it when everything is stopped, even after a restart.
 *
 * Emits "change" when the published payload changes.
 */
export class NowPlayingStore extends EventEmitter {
  /**
   * @param {object} options
   * @param {string|null} options.dir  folder for the persisted state; null keeps it in memory only
   * @param {(picture: string) => Promise<{type: string, body: Buffer}|null>} options.fetchPicture
   */
  constructor({ dir, logger, fetchPicture, now = Date.now }) {
    super();
    this.dir = dir;
    this.log = logger;
    this.fetchPicture = fetchPicture;
    this.now = now;
    this.entries = new Map(); // entity id -> { key, title, artist, album, uri, at, art }
    this._art = new Map(); // entity id -> { type, body }
    this._idle = new Set(); // speakers seen not playing since their last recorded track
    this._saveTimer = null;
    this._signature = "";
    this._load();
  }

  // ---- persistence ----------------------------------------------------------------

  get file() {
    return this.dir ? path.join(this.dir, "nowplaying.json") : null;
  }

  _load() {
    if (!this.file) return;
    try {
      const data = JSON.parse(fs.readFileSync(this.file, "utf8"));
      for (const [id, entry] of Object.entries(data.entries ?? {})) {
        if (entry && typeof entry.title === "string") this.entries.set(id, entry);
      }
      for (const [id, entry] of this.entries) {
        if (!entry.art) continue;
        try {
          this._art.set(id, { type: entry.art, body: fs.readFileSync(path.join(this.dir, `art-${fileKey(id)}.bin`)) });
        } catch {
          entry.art = null;
        }
      }
      this._signature = JSON.stringify(this.payload());
    } catch {
      // first start, or an unreadable file: start empty
    }
  }

  _scheduleSave() {
    if (!this.file) return;
    clearTimeout(this._saveTimer);
    this._saveTimer = setTimeout(() => this.flush(), SAVE_DELAY_MS);
    this._saveTimer.unref?.();
  }

  flush() {
    if (!this.file) return;
    clearTimeout(this._saveTimer);
    try {
      fs.mkdirSync(this.dir, { recursive: true });
      fs.writeFileSync(this.file, JSON.stringify({ entries: Object.fromEntries(this.entries) }));
    } catch (err) {
      this.log.warn(`Could not save the last played tracks: ${err.message}`);
    }
  }

  // ---- recording ------------------------------------------------------------------

  /** Feed every state of a media player; only a new track on a playing or paused speaker is recorded. */
  observe(state) {
    if (!state?.entity_id?.startsWith("media_player.")) return;
    const id = state.entity_id;
    if (!ACTIVE.has(state.state)) {
      this._idle.add(id);
      return;
    }
    const a = state.attributes ?? {};
    const title = a.media_title ?? a.media_channel;
    if (!title) return;

    const key = [title, a.media_artist, a.media_album_name, a.media_content_id].join("|");
    const previous = this.entries.get(id);
    const resumed = this._idle.delete(id);
    if (previous?.key === key && !resumed) return;

    const entry = {
      key,
      title: String(title),
      artist: a.media_artist ? String(a.media_artist) : null,
      album: a.media_album_name ? String(a.media_album_name) : null,
      uri: a.media_content_id ? String(a.media_content_id) : null,
      at: this.now(),
      art: previous?.key === key ? (previous.art ?? null) : null,
    };
    this.entries.set(id, entry);
    this._prune();
    this._scheduleSave();
    this._publish();
    if (a.entity_picture && (!entry.art || previous?.key !== key)) this._fetchArt(id, entry, String(a.entity_picture));
  }

  _prune() {
    if (this.entries.size <= MAX_ENTRIES) return;
    const oldest = [...this.entries.entries()].sort((x, y) => x[1].at - y[1].at)[0][0];
    this.entries.delete(oldest);
    this._art.delete(oldest);
  }

  async _fetchArt(id, entry, picture) {
    try {
      const image = await this.fetchPicture(picture);
      if (!image || image.body.length > MAX_IMAGE_BYTES) return;
      if (this.entries.get(id) !== entry) return; // another track started meanwhile
      this._art.set(id, image);
      entry.art = image.type;
      if (this.dir) {
        fs.mkdirSync(this.dir, { recursive: true });
        fs.writeFileSync(path.join(this.dir, `art-${fileKey(id)}.bin`), image.body);
      }
      this._scheduleSave();
      this._publish();
    } catch (err) {
      this.log.debug(`Artwork for ${id} not saved: ${err.message}`);
    }
  }

  // ---- publishing -----------------------------------------------------------------

  payload() {
    const out = {};
    for (const [id, e] of this.entries) {
      out[id] = {
        title: e.title,
        artist: e.artist,
        album: e.album,
        uri: e.uri,
        at: e.at,
        art: e.art ? `api/nowplaying/art/${encodeURIComponent(id)}?v=${e.at}` : null,
      };
    }
    return out;
  }

  _publish() {
    const signature = JSON.stringify(this.payload());
    if (signature === this._signature) return;
    this._signature = signature;
    this.emit("change");
  }

  /** Remembered artwork of a speaker's last track, or null. */
  art(entityId) {
    return this._art.get(entityId) ?? null;
  }

  stop() {
    this.flush();
  }
}
