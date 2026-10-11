import { isUnavailable } from "./format.js";

const OFF = new Set(["off"]);

export const isOff = (entity) => OFF.has(entity?.state);

/** "heating" | "cooling" | "idle" | "off" | "unavailable" | other state: what the card says and how it is coloured. */
export function climateStatus(entity) {
  if (isUnavailable(entity)) return "unavailable";
  if (isOff(entity)) return "off";
  const action = entity.attributes?.hvac_action;
  if (action && action !== "off") return action;
  return entity.state === "cool" ? "cooling" : entity.state === "heat" ? "heating" : entity.state;
}

/** Sentence-case a name such as "stue" -> "Stue" (helpers are often named in lower case). */
export const niceName = (name) => {
  const text = String(name ?? "").trim();
  return text ? text.charAt(0).toLocaleUpperCase() + text.slice(1) : text;
};

/** The next setpoint after pressing + or - (`direction` 1 / -1), snapped to the step and kept in range. */
export function stepTarget(current, direction, { step = 0.5, min = 5, max = 35 } = {}) {
  const base = Number.isFinite(Number(current)) ? Number(current) : min;
  const next = Math.round((base + direction * step) / step) * step;
  return Math.min(max, Math.max(min, Number(next.toFixed(2))));
}

/** The service call that switches a thermostat on or off, based on what it supports. */
export function powerCall(entity) {
  const modes = entity?.attributes?.hvac_modes ?? [];
  if (!isOff(entity)) return modes.includes("off") ? { service: "set_hvac_mode", data: { hvac_mode: "off" } } : { service: "turn_off" };
  const mode = ["heat_cool", "auto", "heat", "cool"].find((m) => modes.includes(m)) ?? modes.find((m) => m !== "off");
  return mode ? { service: "set_hvac_mode", data: { hvac_mode: mode } } : { service: "turn_on" };
}

/** Counts and the average room temperature for the page header. */
export function climateSummary(entities) {
  const live = entities.filter((e) => !isUnavailable(e));
  const temps = live.map((e) => Number(e.attributes?.current_temperature)).filter(Number.isFinite);
  return {
    total: entities.length,
    on: live.filter((e) => !isOff(e)).length,
    average: temps.length ? temps.reduce((a, b) => a + b, 0) / temps.length : null,
  };
}
