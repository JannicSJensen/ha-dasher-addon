import { findActiveStation, groupOf } from "./radio.js";

const PLAYING = new Set(["playing", "buffering"]);

/** A speaker in a sync group is represented by the group leader. */
const leaderOf = (id, getState) => {
  const leader = groupOf(id, getState).leader;
  return getState(leader) ? leader : id;
};

/**
 * Which speaker the "now playing" tile shows: one that is playing, else one that is paused, else
 * null. `current` keeps the tile on the same speaker while it is still active, so it does not jump
 * between two speakers that play at the same time; otherwise the most recently changed one wins.
 * `active` lists all candidates, so the tile can offer to switch between them.
 */
export function chooseNowPlaying({ ids, getState, current = null }) {
  const collapse = (list) => [...new Set(list.map((id) => leaderOf(id, getState)))];
  const changed = (id) => Date.parse(getState(id)?.last_changed ?? "") || 0;
  const pick = (list) => (list.includes(current) ? current : [...list].sort((a, b) => changed(b) - changed(a))[0]);

  const playing = collapse(ids.filter((id) => PLAYING.has(getState(id)?.state)));
  if (playing.length) return { id: pick(playing), mode: "playing", active: playing };
  const paused = collapse(ids.filter((id) => getState(id)?.state === "paused"));
  if (paused.length) return { id: pick(paused), mode: "paused", active: paused };
  return null;
}

/** The most recently played track among the given speakers: { id, entry } or null. */
export function lastPlayedFor(ids, lastPlayed) {
  let best = null;
  for (const id of ids) {
    const entry = lastPlayed?.[id];
    if (entry && (!best || entry.at > best.entry.at)) best = { id, entry };
  }
  return best;
}

/** Title, artist and station of what a player (or a remembered entry) is playing. */
export function describeMedia(attrs = {}, stations = []) {
  const title = attrs.media_title ?? attrs.media_channel ?? "";
  const station = findActiveStation(stations, { state: "playing", attributes: attrs });
  const artist = attrs.media_artist ?? null;
  const subtitle = [artist, station && station.name !== title ? station.name : null].filter(Boolean).join(" · ");
  return { title: title || station?.name || "", artist, station, subtitle };
}

/** "2 hours ago" in the given locale. */
export function timeAgo(at, { now = Date.now(), locale } = {}) {
  const seconds = Math.max(0, Math.round((now - at) / 1000));
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  if (seconds < 45) return rtf.format(0, "second");
  if (seconds < 3600) return rtf.format(-Math.round(seconds / 60), "minute");
  if (seconds < 86_400) return rtf.format(-Math.round(seconds / 3600), "hour");
  return rtf.format(-Math.round(seconds / 86_400), "day");
}

/** Position within the current track in seconds, running on while it plays. */
export function trackPosition(attrs = {}, state, now = Date.now()) {
  const duration = Number(attrs.media_duration);
  const position = Number(attrs.media_position);
  if (!Number.isFinite(duration) || duration <= 0 || !Number.isFinite(position)) return null;
  let current = position;
  const updated = Date.parse(attrs.media_position_updated_at ?? "");
  if (state === "playing" && Number.isFinite(updated)) current += (now - updated) / 1000;
  return { duration, position: Math.min(duration, Math.max(0, current)) };
}
