/*
 * Playing Plex on players that cannot take a Plex item (Apple TV over AirPlay, DLNA renderers): the app asks the
 * Plex server for the item's file and hands the player a stream link with `media_player.play_media`. This needs
 * the address and token of the Plex server. The link contains the token, so it is visible in Home Assistant's
 * player attributes, like any Plex client's link would be.
 */
import crypto from "node:crypto";

const MP4_FAMILY = new Set(["mp4", "m4v", "mov"]);
const GOOD_AUDIO = new Set(["aac", "ac3", "eac3", "mp3"]);
const MIME = { mp4: "video/mp4", m4v: "video/mp4", mov: "video/quicktime", mkv: "video/x-matroska", avi: "video/x-msvideo", ts: "video/mp2t" };
const HLS_MIME = "application/x-mpegURL";
const RESUME_MIN_S = 10;

/** The first Media/Part of a Plex metadata item, with the codecs that decide how to stream it. */
export function parseMetadata(json) {
  const item = json?.MediaContainer?.Metadata?.[0];
  if (!item) return null;
  const media = item.Media?.[0] ?? {};
  const part = media.Part?.[0] ?? {};
  return {
    key: String(item.ratingKey ?? ""),
    type: String(item.type ?? ""),
    title: [item.grandparentTitle, item.title].filter(Boolean).join(" - "),
    thumb: item.thumb ?? null,
    viewOffsetS: Math.floor(Number(item.viewOffset ?? 0) / 1000),
    container: String(part.container ?? media.container ?? "").toLowerCase(),
    videoCodec: String(media.videoCodec ?? "").toLowerCase(),
    audioCodec: String(media.audioCodec ?? "").toLowerCase(),
    partKey: part.key ?? null,
  };
}

/** The episode to play for a show or season: the first one that is not finished, else the first. */
export function pickEpisode(json) {
  const episodes = (json?.MediaContainer?.Metadata ?? []).filter((m) => m.type === "episode");
  const next = episodes.find((m) => !m.viewCount || m.viewOffset);
  return String((next ?? episodes[0])?.ratingKey ?? "") || null;
}

/**
 * How to stream an item to a kind of player.
 *   direct: the file itself, when the player can take it as it is (Apple TV: MP4-family with H.264; DLNA: any file).
 *   hls: a Plex transcode session as HLS, which can also start at the resume position.
 * `transcode`: "auto" | "always" | "never".
 */
export function chooseStream(meta, { platform, resume, transcode = "auto" }) {
  const offset = resume && meta.viewOffsetS >= RESUME_MIN_S ? meta.viewOffsetS : 0;
  const compatible =
    platform === "apple_tv" ? MP4_FAMILY.has(meta.container) && meta.videoCodec === "h264" && GOOD_AUDIO.has(meta.audioCodec) : Boolean(meta.partKey);
  const direct = transcode === "never" || (transcode === "auto" && compatible && offset === 0);
  return { kind: direct && meta.partKey ? "direct" : "hls", offset };
}

export class PlexStreamer {
  constructor({ url, token, fetchImpl = fetch, logger, clientId = crypto.randomUUID() }) {
    this.base = url ? String(url).replace(/\/+$/, "") : "";
    this.token = token ?? "";
    this.fetch = fetchImpl;
    this.log = logger;
    this.clientId = clientId;
  }

  get configured() {
    return Boolean(this.base && this.token);
  }

  async _get(path) {
    const response = await this.fetch(`${this.base}${path}`, {
      headers: { Accept: "application/json", "X-Plex-Token": this.token },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error(`The Plex server answered ${response.status}.`);
    return response.json();
  }

  async metadata(key) {
    const meta = parseMetadata(await this._get(`/library/metadata/${key}`));
    if (!meta) throw new Error("Plex does not know that item.");
    return meta;
  }

  /** The key of the episode to play for an item: itself, or the next episode of a show or season. */
  async playableKey(key, type) {
    if (type === "show") return pickEpisode(await this._get(`/library/metadata/${key}/allLeaves`));
    if (type === "season") return pickEpisode(await this._get(`/library/metadata/${key}/children`));
    return key;
  }

  _hlsUrl(key, offset) {
    const params = new URLSearchParams({
      path: `/library/metadata/${key}`,
      mediaIndex: "0",
      partIndex: "0",
      protocol: "hls",
      offset: String(offset),
      fastSeek: "1",
      copyts: "1",
      directPlay: "0",
      directStream: "1",
      subtitleSize: "100",
      audioBoost: "100",
      maxVideoBitrate: "20000",
      session: crypto.randomUUID(),
      "X-Plex-Platform": "Chrome",
      "X-Plex-Product": "Dasher",
      "X-Plex-Client-Identifier": this.clientId,
      "X-Plex-Token": this.token,
    });
    return `${this.base}/video/:/transcode/universal/start.m3u8?${params}`;
  }

  /** What to hand to `media_player.play_media` for an item on a kind of player. */
  async resolve({ key, type, resume, platform, transcode }) {
    if (!this.configured) throw new Error("The Plex address and token are not set in the app options.");
    const playKey = await this.playableKey(key, type);
    if (!playKey) throw new Error("There is nothing to play there.");
    const meta = await this.metadata(playKey);
    const { kind, offset } = chooseStream(meta, { platform, resume, transcode });
    const title = meta.title || "Plex";
    if (kind === "direct") {
      const url = `${this.base}${meta.partKey}?${new URLSearchParams({ "X-Plex-Token": this.token })}`;
      const mime = MIME[meta.container] ?? "video/mp4";
      return { url, mediaType: platform === "apple_tv" ? "video" : mime, title, kind, offset };
    }
    return { url: this._hlsUrl(playKey, offset), mediaType: platform === "apple_tv" ? "video" : HLS_MIME, title, kind, offset };
  }
}
