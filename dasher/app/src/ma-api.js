/**
 * Music Assistant's own HTTP API (POST /api with a Bearer token), used read-only for browsing,
 * plus the mapping from its media items to the small cards the tablets show.
 */

export class MAError extends Error {
  constructor(message, status = 502) {
    super(message);
    this.status = status;
  }
}

export class MAClient {
  constructor({ url, token, fetchImpl = globalThis.fetch, timeoutMs = 20_000 }) {
    this.baseUrl = normalizeUrl(url);
    this.token = token ? String(token) : "";
    this.fetch = fetchImpl;
    this.timeoutMs = timeoutMs;
  }

  get configured() {
    return Boolean(this.baseUrl && this.token);
  }

  /** Run a command and return its result. Errors carry a message that is safe to show. */
  async call(command, args = {}) {
    if (!this.configured) throw new MAError("Music Assistant address and token are not configured.", 503);
    let response;
    try {
      response = await this.fetch(`${this.baseUrl}/api`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.token}` },
        body: JSON.stringify({ message_id: "1", command, args }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (err) {
      throw new MAError(`Music Assistant is not reachable at ${this.baseUrl} (${describeNetworkError(err)}).`);
    }
    if (response.status === 401 || response.status === 403) {
      throw new MAError("Music Assistant refused the access token. Create a new one under Settings → Profile.", 502);
    }
    const type = response.headers.get("content-type") ?? "";
    const body = type.includes("json") ? await response.json().catch(() => null) : await response.text().catch(() => "");
    if (!response.ok) {
      const detail = typeof body === "string" ? body : (body?.details ?? body?.error ?? body?.message ?? "");
      throw new MAError(`Music Assistant: ${String(detail).slice(0, 200) || `HTTP ${response.status}`}`);
    }
    return body;
  }
}

const NETWORK_ERRORS = {
  ECONNREFUSED: "connection refused",
  ECONNRESET: "connection reset",
  ENOTFOUND: "unknown host",
  EHOSTUNREACH: "host unreachable",
  ENETUNREACH: "network unreachable",
  ETIMEDOUT: "timed out",
  UND_ERR_CONNECT_TIMEOUT: "timed out",
};

function describeNetworkError(err) {
  if (err?.name === "TimeoutError") return "timed out";
  const code = err?.cause?.code ?? err?.cause?.errors?.[0]?.code;
  return NETWORK_ERRORS[code] ?? code ?? err?.message ?? "unknown error";
}

export function normalizeUrl(value) {
  if (!value) return "";
  try {
    const url = new URL(String(value).trim());
    if (url.protocol !== "http:" && url.protocol !== "https:") return "";
    return url.origin + url.pathname.replace(/\/+$/, "");
  } catch {
    return "";
  }
}

// ---- images ---------------------------------------------------------------------

/** Port of the official client's image choice: own image, album, metadata, artists, landscape. */
export function pickImage(item, type = "thumb", depth = 0) {
  if (!item || depth > 3) return null;
  if (item.image?.type === type) return item.image;
  const album = item.album;
  if (album && typeof album === "object") {
    const found = pickImage(album, type, depth + 1);
    if (found) return found;
  }
  for (const img of item.metadata?.images ?? []) if (img?.type === type) return img;
  for (const artist of item.artists ?? []) {
    const found = pickImage(artist, type, depth + 1);
    if (found) return found;
  }
  if (item.podcast && typeof item.podcast === "object") {
    const found = pickImage(item.podcast, type, depth + 1);
    if (found) return found;
  }
  if (type === "thumb") return pickImage(item, "landscape", depth + 1) ?? item.image ?? item.metadata?.images?.[0] ?? null;
  return null;
}

/** Where the add-on can fetch an image from (it is the add-on that fetches, never the tablet). */
export function imageSource(image, baseUrl, size = 300) {
  if (!image?.path) return null;
  if (image.remotely_accessible) return /^https?:\/\//.test(image.path) ? image.path : null;
  if (image.proxy_id) return `${baseUrl}/imageproxy/${encodeURIComponent(image.proxy_id)}?size=${size}`;
  // older servers: the original path is double encoded
  const encoded = encodeURIComponent(encodeURIComponent(image.path));
  return `${baseUrl}/imageproxy?path=${encoded}&provider=${encodeURIComponent(image.provider ?? "")}&size=${size}`;
}

// ---- cards ------------------------------------------------------------------------

export const CONTAINER_TYPES = new Set(["album", "artist", "podcast", "playlist", "audiobook"]);
const SHOWN_TYPES = new Set(["album", "artist", "track", "playlist", "radio", "podcast", "podcast_episode", "audiobook"]);

const names = (list) =>
  (Array.isArray(list) ? list : [])
    .map((a) => a?.name)
    .filter(Boolean)
    .join(", ");

const stripTags = (text) =>
  String(text ?? "")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();

function subtitleOf(item, type) {
  switch (type) {
    case "album":
      return [names(item.artists), item.year || null].filter(Boolean).join(" · ");
    case "track":
      return [names(item.artists), item.album?.name].filter(Boolean).join(" · ");
    case "podcast":
      return item.publisher ?? "";
    case "podcast_episode":
      return item.podcast?.name ?? "";
    case "playlist":
      return item.owner ?? "";
    case "audiobook":
      return names(item.authors) || names(item.artists) || "";
    default:
      return "";
  }
}

/**
 * Turn a Music Assistant media item into a card for the tablets. `registerImage(url)` hands out the
 * tablet-facing URL for an image the add-on will proxy. Returns null for items that cannot be shown.
 */
export function toCard(item, { baseUrl, registerImage }) {
  if (!item || typeof item !== "object") return null;
  const type = item.media_type ?? null;
  if (!SHOWN_TYPES.has(type) || !item.name) return null;
  const provider = item.provider ?? "library";
  const id = item.item_id != null ? String(item.item_id) : null;
  const uri = item.uri || (id ? `${provider}://${type}/${id}` : null);
  if (!uri) return null;

  const source = imageSource(pickImage(item), baseUrl);
  const card = {
    type,
    name: String(item.name),
    subtitle: subtitleOf(item, type),
    uri,
    provider,
    id,
    image: source ? registerImage(source) : null,
    container: CONTAINER_TYPES.has(type),
    favorite: Boolean(item.favorite),
  };
  if (Number.isFinite(item.duration) && item.duration > 0) card.duration = Math.round(item.duration);
  if (type === "track" && item.track_number) card.number = item.track_number;
  if (type === "album" && item.year) card.year = item.year;
  if (type === "podcast" && item.total_episodes) card.total = item.total_episodes;
  if (type === "podcast_episode") {
    if (item.fully_played) card.played = true;
    if (Number.isFinite(item.resume_position_ms) && item.resume_position_ms > 0) card.resume = Math.round(item.resume_position_ms / 1000);
    const date = item.metadata?.release_date;
    if (date) card.date = String(date).slice(0, 10);
  }
  if (item.metadata?.explicit) card.explicit = true;
  return card;
}

/** Header information for a detail page (more fields than a card). */
export function toDetail(item, options) {
  const card = toCard(item, options);
  if (!card) return null;
  const description = stripTags(item.metadata?.description ?? item.metadata?.review ?? "");
  if (description) card.description = description.slice(0, 800);
  const genres = (item.metadata?.genres ?? []).slice(0, 4);
  if (genres.length) card.genres = genres;
  return card;
}

/** Group the result of a search by what the tablets display. */
export function toSearchGroups(results, options) {
  const map = (list) => (Array.isArray(list) ? list : []).map((i) => toCard(i, options)).filter(Boolean);
  return {
    artists: map(results?.artists),
    albums: map(results?.albums),
    tracks: map(results?.tracks),
    playlists: map(results?.playlists),
    podcasts: map(results?.podcasts),
    radio: map(results?.radio),
  };
}
