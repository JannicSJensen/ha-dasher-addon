const KEY = "dasher.plex.player";

/** The player to play on: the remembered one if it is still listed and online, else the first online one. */
export function choosePlayer(ids, getState, remembered) {
  const online = (id) => getState(id) && getState(id).state !== "unavailable";
  if (remembered && ids.includes(remembered) && online(remembered)) return remembered;
  return ids.find(online) ?? ids[0] ?? null;
}

export function rememberedPlayer() {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function rememberPlayer(id) {
  try {
    localStorage.setItem(KEY, id);
  } catch {
    // private mode: the choice just is not kept
  }
}

/** The same item without the resume flag, to play from the start. */
export const fromStart = (item) => ({ ...item, id: item.id.replace(/\?resume=1$/, "") });

export const WIDE_TYPES = new Set(["episode"]);
