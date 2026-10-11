import { isUnavailable } from "./format.js";

const norm = (s) => String(s ?? "").trim().toLowerCase();
const ACTIVE_STATES = new Set(["playing", "paused", "buffering"]);

/**
 * The station a player is currently on. Music Assistant reports the playing item's URI in
 * `media_content_id`; as a fallback the station name is looked for in the title fields.
 */
export function findActiveStation(stations, player) {
  if (!player || !ACTIVE_STATES.has(player.state)) return null;
  const a = player.attributes ?? {};
  if (a.media_content_id) {
    const byUri = stations.find((s) => s.uri === a.media_content_id);
    if (byUri) return byUri;
  }
  const fields = [a.media_title, a.media_album_name, a.media_artist, a.media_channel].map(norm).filter(Boolean);
  return stations.find((s) => fields.includes(norm(s.name))) ?? null;
}

/** Choose the speaker to show: the saved one, the configured default, a playing one, else the first. */
export function pickPlayer({ players, getState, saved, defaultPlayer }) {
  const usable = players.filter((id) => !isUnavailable(getState(id)));
  if (saved && usable.includes(saved)) return saved;
  if (defaultPlayer && usable.includes(defaultPlayer)) return defaultPlayer;
  return usable.find((id) => getState(id)?.state === "playing") ?? usable[0] ?? null;
}

/** Two-letter fallback for a station without a logo: "DR P4 København" -> "DP". */
export function initials(name) {
  const words = String(name).split(/\s+/).filter(Boolean);
  if (words.length === 1) return words[0].slice(0, 3).toUpperCase();
  return words.slice(0, 2).map((w) => w[0]).join("").toUpperCase();
}

/** media_player.MediaPlayerEntityFeature.GROUPING */
const GROUPING = 524288;

/** Can this speaker be put into (or lead) a sync group? Music Assistant group players cannot. */
export function canGroup(state) {
  if (!state || isUnavailable(state)) return false;
  if (state.attributes?.mass_player_type === "group") return false;
  return (Number(state.attributes?.supported_features) & GROUPING) !== 0;
}

/**
 * The sync group a speaker belongs to. Home Assistant lists the members in `group_members`,
 * leader first, on every member; a speaker on its own has an empty (or one-entry) list.
 */
export function groupOf(id, getState) {
  const state = getState(id);
  const members = state?.attributes?.group_members;
  if (state?.attributes?.mass_player_type === "group" || !Array.isArray(members) || members.length < 2 || !members.includes(id)) {
    return { leader: id, members: [id], grouped: false };
  }
  return { leader: members[0], members: [...members], grouped: true };
}
