export const TAB_ICONS = {
  discover: "compass-outline",
  radio: "radio",
  albums: "album",
  artists: "account-music",
  podcasts: "podcast",
  party: "party-popper",
  playlists: "playlist-music",
  search: "magnify",
};

/** 201 -> "3:21", 3725 -> "1:02:05" */
export function formatDuration(seconds) {
  const total = Math.max(0, Math.round(Number(seconds) || 0));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
}

/** Total length for a header line: 4980 -> "1 h 23 min", 1500 -> "25 min". */
export function formatTotal(seconds) {
  const minutes = Math.round((Number(seconds) || 0) / 60);
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, "0")} min`;
}

/** The neighbouring tab, or null at either end (no wrap-around while swiping). */
export function neighbourTab(tabs, current, step) {
  const next = tabs.indexOf(current) + step;
  return next >= 0 && next < tabs.length ? tabs[next] : null;
}

export { swipeStep } from "./swipe.js";

const CONTAINER_START = new Set(["album", "playlist", "podcast"]);

/**
 * What to send to the server to play `item`. Inside an album, playlist or podcast a tap starts that
 * container at the tapped item; elsewhere it plays the item itself. "add" queues just the item.
 */
export function playRequest(item, { container = null, enqueue = "replace" } = {}) {
  if (enqueue !== "add" && container && CONTAINER_START.has(container.type) && ["track", "podcast_episode"].includes(item.type)) {
    return { uri: container.uri, type: container.type, startItem: item.uri, enqueue };
  }
  return { uri: item.uri, type: item.type, enqueue };
}
