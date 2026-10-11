/**
 * Tablets reach Home Assistant through the add-on without logging in, so every
 * service call is checked against (a) a fixed allow-list of harmless services
 * and (b) the set of entities that appear in dashboard.yaml.
 */
const ALLOWED_SERVICES = {
  light: ["turn_on", "turn_off", "toggle"],
  switch: ["turn_on", "turn_off", "toggle"],
  fan: ["turn_on", "turn_off", "toggle", "set_percentage", "set_preset_mode", "oscillate"],
  cover: ["open_cover", "close_cover", "stop_cover", "toggle", "set_cover_position"],
  scene: ["turn_on"],
  script: ["turn_on", "turn_off", "toggle"],
  automation: ["trigger", "turn_on", "turn_off", "toggle"],
  button: ["press"],
  input_button: ["press"],
  input_boolean: ["turn_on", "turn_off", "toggle"],
  input_number: ["set_value", "increment", "decrement"],
  input_select: ["select_option", "select_next", "select_previous"],
  number: ["set_value"],
  select: ["select_option", "select_next", "select_previous"],
  vacuum: ["start", "pause", "stop", "return_to_base", "locate"],
  media_player: [
    "media_play",
    "media_pause",
    "media_play_pause",
    "media_stop",
    "media_next_track",
    "media_previous_track",
    "volume_set",
    "volume_up",
    "volume_down",
    "volume_mute",
    "media_seek",
    "shuffle_set",
    "repeat_set",
    "turn_on",
    "turn_off",
    "select_source",
  ],
  climate: [
    "turn_on",
    "turn_off",
    "set_temperature",
    "set_hvac_mode",
    "set_fan_mode",
    "set_swing_mode",
    "set_preset_mode",
  ],
  homeassistant: ["turn_on", "turn_off", "toggle"],
};

const NAME_RE = /^[a-z0-9_]+$/;
const ENTITY_RE = /^[a-z0-9_]+\.[a-z0-9_]+$/;
const FORBIDDEN_DATA_KEYS = ["entity_id", "device_id", "area_id", "floor_id", "label_id"];

export function validateServiceCall(body, watched) {
  if (!body || typeof body !== "object") return { ok: false, error: "Body must be a JSON object." };
  const { domain, service } = body;
  if (typeof domain !== "string" || !NAME_RE.test(domain)) return { ok: false, error: "Invalid domain." };
  if (typeof service !== "string" || !NAME_RE.test(service)) return { ok: false, error: "Invalid service." };
  if (!ALLOWED_SERVICES[domain]?.includes(service)) {
    return { ok: false, error: `Service ${domain}.${service} is not allowed.` };
  }

  const raw = body.entity_id;
  const ids = Array.isArray(raw) ? raw : [raw];
  if (ids.length === 0 || ids.length > 20 || !ids.every((e) => typeof e === "string" && ENTITY_RE.test(e))) {
    return { ok: false, error: "entity_id must be one or more valid entity ids." };
  }
  for (const id of ids) {
    if (!watched.has(id)) return { ok: false, error: `${id} is not part of the dashboard.` };
    if (domain !== "homeassistant" && id.split(".")[0] !== domain) {
      return { ok: false, error: `${id} does not belong to domain ${domain}.` };
    }
  }

  const data = body.data ?? {};
  if (typeof data !== "object" || Array.isArray(data)) return { ok: false, error: "data must be an object." };
  for (const key of FORBIDDEN_DATA_KEYS) {
    if (key in data) return { ok: false, error: `data.${key} is not allowed.` };
  }

  return { ok: true, domain, service, entityIds: ids, data };
}

/** Only image-serving HA endpoints may be proxied to tablets. */
const PROXY_PREFIXES = ["/api/media_player_proxy/", "/api/image_proxy/", "/api/camera_proxy/", "/api/image/serve/"];

export function validateProxyPath(p) {
  if (typeof p !== "string" || p.length > 2048) return false;
  if (!p.startsWith("/") || p.startsWith("//") || p.includes("\\") || p.includes("..")) return false;
  if (/[\u0000-\u001f]/.test(p)) return false;
  return PROXY_PREFIXES.some((prefix) => p.startsWith(prefix));
}
