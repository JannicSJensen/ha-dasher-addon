/** Per-device preferences (e.g. the speaker chosen on the radio page). Never throws. */
const PREFIX = "dasher.";

export function getPref(key, fallback = null) {
  try {
    return localStorage.getItem(PREFIX + key) ?? fallback;
  } catch {
    return fallback;
  }
}

export function setPref(key, value) {
  try {
    localStorage.setItem(PREFIX + key, value);
  } catch {
    // storage can be blocked in private mode or kiosk setups; the choice then lasts until reload
  }
}
