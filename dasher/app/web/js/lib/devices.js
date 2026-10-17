import { isUnavailable } from "./format.js";

// vacuum.* supported_features
export const VACUUM = { TURN_ON: 1, TURN_OFF: 2, PAUSE: 4, STOP: 8, RETURN_HOME: 16, FAN_SPEED: 32, LOCATE: 512, START: 8192 };
const has = (attrs, flag) => attrs?.supported_features == null || (Number(attrs.supported_features) & flag) !== 0;

const BUSY_STATES = new Set(["cleaning", "mowing"]);

/** "Robbie   Robbie " (Dreame repeats its name) -> "Robbie". */
export function tidyName(name) {
  const words = String(name ?? "").trim().split(/\s+/).filter(Boolean);
  const half = words.length / 2;
  if (words.length >= 2 && Number.isInteger(half) && words.slice(0, half).join(" ").toLowerCase() === words.slice(half).join(" ").toLowerCase()) return words.slice(0, half).join(" ");
  return words.join(" ");
}

const CLEAN_WATER_TEXT = /water tank dry|low water|no water|water shortage|water level low|clean water tank (low|empty|dry)|lack of water/i;
const DIRTY_WATER_TEXT = /dirty water tank (is )?full|waste water (tank )?(is )?full|dirty tank full|water tank full/i;

/**
 * Whether a (Dreame-style) vacuum needs its water changed: { clean, dirty }. `clean`: the clean water tank is low or
 * empty, `dirty`: the dirty water tank is full. Read from the vacuum's own attributes (tank status, low water flag,
 * the error and the faults), so no extra entities are needed.
 */
export function vacuumWater(entity) {
  const none = { clean: false, dirty: false };
  if (!entity || entity.state === "unavailable") return none;
  const a = entity.attributes ?? {};
  const texts = [a.error, a.low_water_warning, ...(a.faults && typeof a.faults === "object" ? Object.values(a.faults) : [])]
    .filter((x) => typeof x === "string" && x && !/^no (error|warning)$/i.test(x));
  const clean = a.low_water === true || /low|empty|dry/i.test(String(a.clean_water_tank_status ?? "")) || texts.some((x) => CLEAN_WATER_TEXT.test(x));
  const dirty = /full/i.test(String(a.dirty_water_tank_status ?? "")) || texts.some((x) => DIRTY_WATER_TEXT.test(x));
  return { clean, dirty };
}

/** What a vacuum card needs: a simple status, battery, fan speed and which buttons make sense. */
export function vacuumInfo(entity) {
  if (isUnavailable(entity)) return { status: entity?.state === "unknown" ? "unknown" : "unavailable", usable: false, fanSpeeds: [], error: null, water: { clean: false, dirty: false } };
  const a = entity.attributes ?? {};
  const state = entity.state;
  const battery = [a.battery_level, a.battery].map(Number).find((n) => Number.isFinite(n) && n >= 0 && n <= 100) ?? null;
  const status = state === "error" || a.has_error ? "error" : state;
  const cleaning = BUSY_STATES.has(state);
  return {
    status,
    usable: true,
    cleaning,
    docked: state === "docked",
    returning: state === "returning",
    paused: state === "paused",
    battery,
    charging: Boolean(a.charging) || state === "docked",
    fanSpeed: a.fan_speed ?? null,
    fanSpeeds: Array.isArray(a.fan_speed_list) && has(a, VACUUM.FAN_SPEED) ? a.fan_speed_list : [],
    canPause: has(a, VACUUM.PAUSE),
    canStop: has(a, VACUUM.STOP),
    canDock: has(a, VACUUM.RETURN_HOME),
    canLocate: has(a, VACUUM.LOCATE) && a.supported_features != null,
    startService: a.supported_features != null && !has(a, VACUUM.START) && has(a, VACUUM.TURN_ON) ? "turn_on" : "start",
    water: vacuumWater(entity),
    error: typeof a.error === "string" && a.error && !/^no error$/i.test(a.error) ? a.error : null,
  };
}

/** The service for the main vacuum button: pause while cleaning, else start (which resumes a paused clean). */
export function vacuumMainCall(info) {
  if (info.cleaning || info.returning) return info.canPause ? { service: "pause" } : info.canStop ? { service: "stop" } : null;
  return { service: info.startService };
}

/** Battery icon name for a level. */
export function batteryIcon(level, charging) {
  if (level == null) return "battery-unknown";
  const step = Math.min(100, Math.max(10, Math.round(level / 10) * 10));
  if (charging) return level >= 95 ? "battery-charging-100" : `battery-charging-${step}`;
  return level >= 95 ? "battery" : `battery-${step}`;
}

const ACTIVE_STATUS = new Set(["running", "rinsing", "spinning", "drying", "cooling", "cool_down", "steam_softening", "refreshing", "wrinkle_care", "rinse_hold", "washing", "heating"]);

/** Minutes left from a timestamp sensor ("2026-10-11T20:30:00+00:00") or a number with a min/h unit; null when unknown. */
export function remainingMinutes(entity, now = Date.now()) {
  if (isUnavailable(entity)) return null;
  const a = entity.attributes ?? {};
  if (a.device_class === "timestamp" || /^\d{4}-\d{2}-\d{2}T/.test(String(entity.state))) {
    const at = Date.parse(entity.state);
    return Number.isFinite(at) ? Math.max(0, Math.round((at - now) / 60_000)) : null;
  }
  const n = Number(entity.state);
  if (!Number.isFinite(n)) return null;
  return a.unit_of_measurement === "h" ? Math.round(n * 60) : a.unit_of_measurement === "s" ? Math.round(n / 60) : Math.round(n);
}

export function formatRemaining(minutes) {
  if (minutes == null) return "";
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h ? `${h} h ${String(m).padStart(2, "0")} min` : `${m} min`;
}

/** Status, remaining time and switch state of an appliance from its entities. */
export function applianceInfo(roles, getState, now = Date.now()) {
  const status = roles.status_entity ? getState(roles.status_entity) : null;
  const power = roles.power_entity ? getState(roles.power_entity) : null;
  const operation = roles.operation_entity ? getState(roles.operation_entity) : null;
  const unavailable = roles.status_entity ? isUnavailable(status) && status?.state !== "unknown" : power ? isUnavailable(power) : false;
  const raw = status && !isUnavailable(status) ? status.state : null;
  const powerOn = power && !isUnavailable(power) ? (power.state === "on" || (power.state !== "off" && power.state !== "idle")) : null;
  const active = raw ? ACTIVE_STATUS.has(raw) : powerOn === true && !roles.status_entity;
  const options = operation?.attributes?.options ?? [];
  return {
    status: raw,
    unavailable,
    active,
    powerOn: raw === "power_off" ? false : powerOn,
    remaining: active ? remainingMinutes(roles.remaining_entity ? getState(roles.remaining_entity) : null, now) : null,
    // a select that was never used reports "unknown", which still works
    canStart: Boolean(operation) && operation.state !== "unavailable" && options.includes("start"),
    canStop: Boolean(operation) && operation.state !== "unavailable" && options.includes("stop"),
  };
}
