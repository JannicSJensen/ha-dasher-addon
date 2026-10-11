import { isUnavailable } from "./format.js";

const ON = new Set(["on", "true", "yes", "charging"]);
const PLUGGED = new Set(["on", "connected", "plugged", "plugged_in", "true", "yes"]);
const UNPLUGGED = new Set(["off", "disconnected", "not_plugged_in", "unplugged", "false", "no"]);

const num = (value) => {
  const n = Number(value);
  return value != null && value !== "" && Number.isFinite(n) ? n : null;
};

/** Battery level and target in percent: the battery sensor, else what EV Smart Charging reports. */
export function batteryOf(roles, getState) {
  const own = roles.battery_entity ? getState(roles.battery_entity) : null;
  const info = roles.smart_info_entity ? getState(roles.smart_info_entity) : null;
  const percent = !isUnavailable(own) ? num(own.state) : num(info?.attributes?.ev_soc);
  return { percent, target: num(info?.attributes?.ev_target_soc) };
}

/** true / false, or null when unknown. */
export function isCharging(roles, getState) {
  const id = roles.charging_entity ?? roles.smart_info_entity ?? roles.charge_switch_entity;
  const state = id ? getState(id) : null;
  if (isUnavailable(state)) return null;
  return ON.has(String(state.state).toLowerCase());
}

/** true when plugged in, false when not, null when unknown. */
export function isPluggedIn(roles, getState) {
  const state = roles.plug_entity ? getState(roles.plug_entity) : null;
  if (isUnavailable(state)) return null;
  const value = String(state.state).toLowerCase();
  return PLUGGED.has(value) ? true : UNPLUGGED.has(value) ? false : null;
}

/** The service call that starts or stops (`action` "start" | "stop") through an entity, or null. */
export function serviceFor(entityId, action) {
  const domain = entityId.slice(0, entityId.indexOf("."));
  switch (domain) {
    case "button":
    case "input_button":
      return { domain, service: "press" };
    case "switch":
    case "input_boolean":
      return { domain, service: action === "stop" ? "turn_off" : "turn_on" };
    case "script":
    case "scene":
      return { domain, service: "turn_on" };
    case "automation":
      return { domain, service: "trigger", data: { skip_condition: true } };
    default:
      return null;
  }
}

/** Which entity and service a start or stop uses: the dedicated one, else the charger's switch. */
export function chargeAction(roles, action) {
  const id = (action === "stop" ? roles.stop_entity : roles.start_entity) ?? roles.charge_switch_entity;
  const call = id ? serviceFor(id, action) : null;
  return call ? { id, ...call } : null;
}

const TIME = /^(\d{1,2}):(\d{2})(?::\d{2})?$/;

/** Split the options of a time select into times and the "no time" option (e.g. "None"). */
export function parseTimeOptions(options = []) {
  const times = [];
  let off = null;
  for (const option of options) {
    const m = TIME.exec(String(option));
    if (m) times.push({ value: String(option), hour: Number(m[1]), minute: Number(m[2]) });
    else off ??= option;
  }
  return { times, off };
}

export const hoursOf = (times) => [...new Set(times.map((t) => t.hour))].sort((a, b) => a - b);
export const minutesOf = (times, hour) => times.filter((t) => t.hour === hour).map((t) => t.minute).sort((a, b) => a - b);

export const pad = (n) => String(n).padStart(2, "0");

/** Planned charging window from the EV Smart Charging sensor: { start, end } as "HH:MM" or null. */
export function plannedWindow(attrs = {}, { timeZone } = {}) {
  const show = (iso) => {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return null;
    return new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone }).format(date);
  };
  if (!attrs.charging_start_time || !attrs.charging_stop_time) return null;
  const start = show(attrs.charging_start_time);
  const end = show(attrs.charging_stop_time);
  return start && end ? { start, end } : null;
}
