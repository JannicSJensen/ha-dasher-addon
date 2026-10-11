/**
 * Tiny fake Home Assistant for local development and screenshots.
 *   node dev/mock-ha.js   (listens on :8123)
 * Implements just enough of the WebSocket API: auth, get_states, subscribe_events,
 * call_service (mutates state and emits state_changed) and ping.
 */
import fs from "node:fs";
import http from "node:http";
import { WebSocketServer } from "ws";

const now = new Date();
const day = new Date(now);
day.setHours(0, 0, 0, 0);
const prices = Array.from({ length: 24 }, (_, h) => {
  const start = new Date(day.getTime() + h * 3600_000);
  const value = 0.3 + 0.9 * Math.max(0, Math.sin(((h - 5) / 24) * Math.PI * 2)) + (h >= 17 && h <= 20 ? 1.2 : 0);
  return { start: start.toISOString(), end: new Date(start.getTime() + 3600_000).toISOString(), value: Number(value.toFixed(3)) };
});

const states = new Map();
const put = (entity_id, state, attributes = {}) =>
  states.set(entity_id, { entity_id, state, attributes, last_changed: new Date().toISOString(), last_updated: new Date().toISOString(), context: {} });

put("light.living_room_lamp", "on", { friendly_name: "Living room lamp", brightness: 180, supported_color_modes: ["brightness"] });
put("light.garage_spots", "off", { friendly_name: "Garage spots", supported_color_modes: ["onoff"] });
put("light.carport", "off", { friendly_name: "Carport", supported_color_modes: ["onoff"] });
put("input_boolean.good_night", "off", { friendly_name: "Good night" });
put("input_boolean.vacation", "on", { friendly_name: "Vacation" });
// waste pick-ups like the RenoWeb sensors: state = days left, plus the date and a bin colour
const dayLabel = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
put("sensor.waste_general", "1", { friendly_name: "Waste general", description: "240 L Rest/Mad - Beholder (Privat)", next_pickup_date: dayLabel(1), icon: "mdi:trash-can", icon_color: "#FFC108", unit_of_measurement: "dage" });
put("sensor.waste_paper", "8", { friendly_name: "Waste paper", description: "240 l Pap Egenløsning (Privat)", next_pickup_date: dayLabel(8), icon: "mdi:note", icon_color: "#9E9E9E", unit_of_measurement: "dage" });
put("sensor.waste_plastic", "0", { friendly_name: "Waste plastic", description: "370 l Plast+MDK/Papir - Egenløsning (Privat)", next_pickup_date: dayLabel(0), icon: "mdi:trash-can", icon_color: "#9E9E9E", unit_of_measurement: "dage" });
put("sun.sun", "above_horizon", {});
// climate helpers (groups per room) and a device thermostat that the climate page leaves out
const thermostat = (id, name, current, target, state = "heat", extra = {}) =>
  put(id, state, { friendly_name: name, current_temperature: current, temperature: target, hvac_modes: ["off", "heat"], min_temp: 5, max_temp: 30, target_temp_step: 0.5, supported_features: 1, ...extra });
thermostat("climate.stue", "stue", 22.1, 20.5, "heat", { hvac_action: "heating" });
thermostat("climate.rud", "rud", 23.6, 20, "heat", { hvac_action: "idle" });
thermostat("climate.hjalte", "hjalte", 21.6, 19);
thermostat("climate.bryggers", "bryggers", 22.1, 21.5, "off");
thermostat("climate.bad", "bad", 23.7, 24, "heat", { hvac_modes: ["off"] });
thermostat("climate.climate_stue_01", "climate-stue-01", 22.1, 22);
// Plex: two players that can play Plex media (a Cast TV and a Plex client) and one that is offline
put("media_player.living_room_tv", "idle", { friendly_name: "Living room TV", supported_features: 152127 });
put("media_player.plex_ipad", "idle", { friendly_name: "Plex (iPad)", supported_features: 152127 });
put("media_player.stuen_tv", "idle", { friendly_name: "Stuen TV" });
put("media_player.plex_apple_tv", "unavailable", { friendly_name: "Plex (Apple TV)", restored: true });
// the car's remote climate (FordPass)
put("switch.fordpass_x_ignition", "off", { friendly_name: "RC: Start" });
put("number.fordpass_x_rcctemperature", "22.0", { friendly_name: "RC: Temperature", min: 15.5, max: 30.5, step: 0.5, mode: "box", unit_of_measurement: "°C" });
put("switch.fordpass_x_rccdefrostfront", "off", { friendly_name: "RC: Front" });
put("switch.fordpass_x_rccdefrostrear", "off", { friendly_name: "RC: Rear" });
// vacuums and LG ThinQ-like appliances (washer running, dishwasher idle, dryer offline)
put("vacuum.robbie", "docked", { friendly_name: "Robbie", supported_features: 31676, battery_level: 80, fan_speed: "standard", fan_speed_list: ["silent", "standard", "strong", "turbo"] });
put("vacuum.overlord", "cleaning", { friendly_name: "Overlord", supported_features: 31676, battery_level: 54, fan_speed: "strong", fan_speed_list: ["silent", "standard", "strong", "turbo"] });
put("vacuum.roborock_old", "unavailable", { friendly_name: "roborock.vacuum.s5" });
const appliance = (slug, status, extra = {}) => {
  put(`sensor.${slug}_current_status`, status, { options: ["running", "end", "power_off", "pause", "spinning"], device_class: "enum", friendly_name: `${slug} status` });
  put(`sensor.${slug}_remaining_time`, extra.remaining ?? "unknown", { device_class: "timestamp", friendly_name: `${slug} remaining` });
  put(`switch.${slug}_power`, extra.power ?? "on", { friendly_name: `${slug} power` });
  put(`select.${slug}_operation`, "unknown", { options: ["start", "stop", "power_off", "wake_up"], friendly_name: `${slug} operation` });
  put(`number.${slug}_delay_ends_in`, "0", { min: 0, max: 19, step: 1, unit_of_measurement: "h", friendly_name: `${slug} delay` });
};
appliance("vaskemaskine", "running", { remaining: new Date(Date.now() + 47 * 60_000).toISOString() });
appliance("opvaskemaskine", "end", { power: "on" });
appliance("torretumbler", "unavailable", { power: "unavailable" });
put("calendar.family", "off", { friendly_name: "Family" });
put("calendar.privat", "off", { friendly_name: "Privat" });
put("weather.forecast_home", "cloudy", { friendly_name: "Forecast Home", temperature: 11 });
const TIMES = ["None", ...Array.from({ length: 96 }, (_, i) => `${String(Math.floor(i / 4)).padStart(2, "0")}:${String((i % 4) * 15).padStart(2, "0")}`)];
put("sensor.ev_smart_charging_status", "waiting_for_charging_to_begin", { friendly_name: "EV Smart Charging Status" });
put("sensor.ev_smart_charging_charging", "off", { friendly_name: "EV Smart Charging Lading", ev_soc: "67.0", ev_target_soc: "80.0", charging_is_planned: true, charging_start_time: new Date(day.getTime() + 25 * 3600_000).toISOString(), charging_stop_time: new Date(day.getTime() + 28.5 * 3600_000).toISOString() });
put("switch.ev_smart_charging_smart_charging_activated", "on", { friendly_name: "Smart ladning aktiveret" });
put("switch.ev_smart_charging_ev_connected", "on", { friendly_name: "Elbil tilkoblet" });
put("select.ev_smart_charging_charge_start_time", "None", { friendly_name: "Starttidspunkt", options: TIMES });
put("select.ev_smart_charging_charge_completion_time", "08:00", { friendly_name: "Sluttidspunkt", options: TIMES });
put("button.ev_smart_charging_manually_start_charging", "unknown", { friendly_name: "Start opladning manuelt" });
put("button.ev_smart_charging_manually_stop_charging", "unknown", { friendly_name: "Stop opladning manuelt" });
put("switch.peblar_ev_charger_charge", "off", { friendly_name: "Peblar EV Charger Charge" });
put("button.peblar_ev_charger_restart", "unknown", { friendly_name: "Peblar EV Charger Genstart", device_class: "restart" });
put("sensor.living_room_temperature", "21.4", { friendly_name: "Living room temperature", device_class: "temperature", unit_of_measurement: "°C" });
put("binary_sensor.garage_door", "off", { friendly_name: "Garage door", device_class: "door" });
put("scene.cozy", "unknown", {});
put("scene.movie", "unknown", {});
put("sensor.electricity_price", String(prices[now.getHours()].value), { friendly_name: "Electricity price", raw_today: prices });
put("media_player.living_room", "playing", { friendly_name: "Bose", media_title: "Rix FM Fresh", source: "Radio", volume_level: 0.3, mass_player_type: "player" });
put("media_player.garage_speaker", "idle", { friendly_name: "Garage speaker", volume_level: 0.15, mass_player_type: "player" });
put("sensor.car_range", "692", { friendly_name: "Volvo", unit_of_measurement: "km" });
put("sensor.car_battery", "56", { unit_of_measurement: "%" });
put("sensor.car_charging_state", "charging", {});
put("sensor.car_fuel_level", "98", { unit_of_measurement: "%" });
put("climate.heat_pump", "heat_cool", {
  friendly_name: "Heat pump",
  current_temperature: 19,
  temperature: 22,
  min_temp: 10,
  max_temp: 25,
  target_temp_step: 0.5,
  hvac_modes: ["off", "heat", "cool", "heat_cool"],
  fan_modes: ["auto", "low", "high"],
  fan_mode: "auto",
  swing_modes: ["off", "vertical"],
  swing_mode: "off",
});

// MOCK_STATES=<file.json> replaces the demo entities with a recorded snapshot (array of state objects).
if (process.env.MOCK_STATES) {
  states.clear();
  for (const s of JSON.parse(fs.readFileSync(process.env.MOCK_STATES, "utf8"))) put(s.entity_id, s.state, s.attributes);
}
for (const [id, s] of states) {
  if (s.attributes.mass_player_type === "player") s.attributes = { group_members: [], ...s.attributes, supported_features: 8320575 };
  if (s.state === "playing" && s.attributes.mass_player_type === "player") {
    Object.assign(s.attributes, { entity_picture: `/api/media_player_proxy/${id}?token=mock`, media_duration: 175, media_position: 20, media_position_updated_at: new Date().toISOString() });
  }
}

// Area/entity registries. MOCK_REGISTRY=<file.json> ({areas, floors, devices, entities}) replaces the demo data.
let registry = {
  areas: [
    { area_id: "living_room", name: "Living room", floor_id: "ground", icon: null, picture: null },
    { area_id: "garage", name: "Garage", floor_id: "ground", icon: "mdi:garage", picture: null },
    { area_id: "bedroom", name: "Bedroom", floor_id: "upstairs", icon: null, picture: null },
  ],
  floors: [
    { floor_id: "ground", name: "Ground floor", level: 0 },
    { floor_id: "upstairs", name: "Upstairs", level: 1 },
  ],
  devices: [
    { id: "dev-wash", name: "Vaskemaskine" },
    { id: "dev-dish", name: "Opvaskemaskine" },
    { id: "dev-dry", name: "Tørretumbler" },
  ],
  entities: [
    { ei: "light.living_room_lamp", ai: "living_room" },
    { ei: "media_player.living_room", ai: "living_room", pl: "music_assistant" },
    { ei: "media_player.garage_speaker", ai: "garage", pl: "music_assistant" },
    { ei: "sensor.living_room_temperature", ai: "living_room" },
    { ei: "light.garage_spots", ai: "garage" },
    { ei: "light.carport", ai: "garage" },
    { ei: "binary_sensor.garage_door", ai: "garage" },
    { ei: "climate.stue", pl: "climate_group_helper" },
    { ei: "climate.rud", pl: "climate_group_helper" },
    { ei: "climate.hjalte", pl: "climate_group_helper" },
    { ei: "climate.bryggers", pl: "climate_group_helper" },
    { ei: "climate.bad", pl: "climate_group_helper" },
    { ei: "climate.climate_stue_01", pl: "zwave_js" },
    { ei: "media_player.living_room_tv", pl: "cast" },
    { ei: "media_player.plex_ipad", pl: "plex" },
    { ei: "media_player.stuen_tv", pl: "apple_tv" },
    { ei: "media_player.plex_apple_tv", pl: "plex" },
    { ei: "switch.fordpass_x_ignition", pl: "fordpass", tk: "ignition" },
    { ei: "number.fordpass_x_rcctemperature", pl: "fordpass", tk: "rcctemperature" },
    { ei: "switch.fordpass_x_rccdefrostfront", pl: "fordpass", tk: "rccdefrostfront" },
    { ei: "switch.fordpass_x_rccdefrostrear", pl: "fordpass", tk: "rccdefrostrear" },
    { ei: "sensor.vaskemaskine_current_status", di: "dev-wash", pl: "lg_thinq", tk: "current_state" },
    { ei: "sensor.vaskemaskine_remaining_time", di: "dev-wash", pl: "lg_thinq", tk: "remaining_time" },
    { ei: "switch.vaskemaskine_power", di: "dev-wash", pl: "lg_thinq", tk: "operation_power" },
    { ei: "select.vaskemaskine_operation", di: "dev-wash", pl: "lg_thinq", tk: "operation_mode" },
    { ei: "number.vaskemaskine_delay_ends_in", di: "dev-wash", pl: "lg_thinq", tk: "delay_ends_in" },
    { ei: "sensor.opvaskemaskine_current_status", di: "dev-dish", pl: "lg_thinq", tk: "current_state" },
    { ei: "sensor.opvaskemaskine_remaining_time", di: "dev-dish", pl: "lg_thinq", tk: "remaining_time" },
    { ei: "switch.opvaskemaskine_power", di: "dev-dish", pl: "lg_thinq", tk: "operation_power" },
    { ei: "select.opvaskemaskine_operation", di: "dev-dish", pl: "lg_thinq", tk: "operation_mode" },
    { ei: "number.opvaskemaskine_delay_ends_in", di: "dev-dish", pl: "lg_thinq", tk: "delay_ends_in" },
    { ei: "sensor.torretumbler_current_status", di: "dev-dry", pl: "lg_thinq", tk: "current_state" },
    { ei: "sensor.torretumbler_remaining_time", di: "dev-dry", pl: "lg_thinq", tk: "remaining_time" },
    { ei: "switch.torretumbler_power", di: "dev-dry", pl: "lg_thinq", tk: "operation_power" },
    { ei: "select.torretumbler_operation", di: "dev-dry", pl: "lg_thinq", tk: "operation_mode" },
    { ei: "number.torretumbler_delay_ends_in", di: "dev-dry", pl: "lg_thinq", tk: "delay_ends_in" },
    { ei: "vacuum.robbie", pl: "dreame_vacuum" },
    { ei: "vacuum.overlord", pl: "dreame_vacuum" },
    { ei: "vacuum.roborock_old", pl: "roborock" },
    { ei: "calendar.family" },
    { ei: "calendar.privat" },
    { ei: "weather.forecast_home" },
    // car charging (EV Smart Charging and a Peblar charger), recognised by integration and translation key
    { ei: "sensor.ev_smart_charging_status", pl: "ev_smart_charging", tk: "status" },
    { ei: "sensor.ev_smart_charging_charging", pl: "ev_smart_charging", tk: "charging" },
    { ei: "switch.ev_smart_charging_smart_charging_activated", pl: "ev_smart_charging", tk: "smart_charging_activated" },
    { ei: "switch.ev_smart_charging_ev_connected", pl: "ev_smart_charging", tk: "ev_connected" },
    { ei: "select.ev_smart_charging_charge_start_time", pl: "ev_smart_charging", tk: "charge_start_time", ec: 1 },
    { ei: "select.ev_smart_charging_charge_completion_time", pl: "ev_smart_charging", tk: "charge_completion_time", ec: 1 },
    { ei: "button.ev_smart_charging_manually_start_charging", pl: "ev_smart_charging", tk: "manually_start_charging" },
    { ei: "button.ev_smart_charging_manually_stop_charging", pl: "ev_smart_charging", tk: "manually_stop_charging" },
    { ei: "switch.peblar_ev_charger_charge", pl: "peblar", tk: "charge", ec: 1 },
    { ei: "button.peblar_ev_charger_restart", pl: "peblar", ec: 1 },
  ],
};
if (process.env.MOCK_REGISTRY) registry = JSON.parse(fs.readFileSync(process.env.MOCK_REGISTRY, "utf8"));

// Calendar events and a daily forecast relative to today, in the same shapes Home Assistant returns.
const isoLocal = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const atDay = (offset, h, m = 0) => {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  d.setHours(h, m, 0, 0);
  return d;
};
function calendarEvents(id) {
  const timed = (summary, offset, [h1, m1], [h2, m2]) => ({ summary, start: atDay(offset, h1, m1).toISOString(), end: atDay(offset, h2, m2).toISOString(), description: null, location: null });
  const allDay = (summary, from, to) => ({ summary, start: isoLocal(atDay(from, 0)), end: isoLocal(atDay(to, 0)), description: null, location: null });
  if (id === "calendar.family") {
    return [
      allDay("Have i gave hos mormor og morfar", -1, 1),
      timed("Already over today", 0, [6, 0], [7, 0]),
      timed("Arbejdstid", 1, [9, 45], [16, 0]),
      timed("Kat arbejde Holbæk", 2, [9, 0], [18, 15]),
      timed("Arbejdstid", 2, [9, 45], [16, 0]),
      timed("Arbejdstid", 3, [12, 0], [19, 15]),
    ];
  }
  return [timed("Tandlæge", 3, [14, 30], [15, 15]), allDay("Ferie", 5, 8)];
}
function forecastDays() {
  const conditions = ["cloudy", "partlycloudy", "rainy", "sunny", "lightning-rainy", "snowy", "fog"];
  return Array.from({ length: 7 }, (_, i) => ({ datetime: atDay(i, 12).toISOString().replace(/^.{10}/, isoLocal(atDay(i, 12))), temperature: 11 + (i % 3) * 2, condition: conditions[i % conditions.length] }));
}

// Plex library as Home Assistant's Plex integration exposes it through media browsing.
const SRV = "abc123def456";
const plexUri = (key, resume) => `plex://${SRV}/${key}${resume ? "?resume=1" : ""}`;
const PLEX_TITLES = {};
const plexItem = (key, type, title, { resume = false, expand = false } = {}) => {
  PLEX_TITLES[key] = title;
  return { title, media_class: type, media_content_id: plexUri(key, resume), media_content_type: type, can_play: true, can_expand: expand, thumbnail: `/api/plex_image_proxy/${SRV}/${key}` };
};
const PLEX_HUBS = {
  "home.continue": ["Continue Watching", () => [
    plexItem(2001, "episode", "Lanterns - S01E01 - Pilot", { resume: true }),
    plexItem(2002, "movie", "Rage of Stars (2026)", { resume: true }),
    plexItem(2003, "episode", "The Mandalorian - S03E08 - The Return", { resume: true }),
  ]],
  "home.movies.recent": ["Recently Added Movies", () => [
    plexItem(3001, "movie", "Speed 2: Cruise Control (1997)"),
    plexItem(3002, "movie", "Mutiny (2026)"),
    plexItem(3003, "movie", "Iron Man 2 (2010)"),
    plexItem(3004, "movie", "The Fix (2026)"),
  ]],
  "home.television.recent": ["Recently Added TV", () => [
    plexItem(1001, "show", "The Boys", { expand: true }),
    plexItem(1002, "show", "Slow Horses", { expand: true }),
    plexItem(2004, "episode", "Slow Horses - S06E04 - Lost & Found"),
  ]],
  "home.music.recent": ["Recently Added Music", () => [plexItem(4001, "album", "Some Album - Greatest Hits")]],
  "home.recommended": ["Recommended For You", () => [plexItem(3005, "movie", "Something Else (2020)")]],
};
function plexBrowse({ entity_id, media_content_type, media_content_id }) {
  const e = states.get(entity_id);
  if (!e || e.state === "unavailable") throw new Error("Entity not available");
  const isCast = entity_id.includes("living_room_tv");
  const server = () => ({
    title: "Bryggers", media_class: "directory", media_content_id: plexUri("server"), media_content_type: "server", can_play: false, can_expand: true,
    children: [
      { title: "Recommended (Bryggers)", media_class: "directory", media_content_id: plexUri("server/Recommended"), media_content_type: "server", can_play: false, can_expand: true },
      { title: "Movies", media_class: "directory", media_content_id: plexUri("1"), media_content_type: "library", can_play: false, can_expand: true },
    ],
  });
  if (!media_content_type) return isCast ? { title: "Cast", media_class: "directory", media_content_id: "", media_content_type: "app", children: [{ title: "Plex", media_class: "app", media_content_id: "", media_content_type: "plex", can_play: false, can_expand: true }] } : server();
  if (media_content_type === "plex") return server();
  if (media_content_type === "server") {
    return { title: "Bryggers", media_class: "directory", media_content_id: media_content_id, media_content_type: "server", can_expand: true,
      children: Object.entries(PLEX_HUBS).map(([id, [title]]) => ({ title, media_class: "directory", media_content_id: plexUri(`server/${id}`), media_content_type: "hub", can_play: false, can_expand: true })) };
  }
  if (media_content_type === "hub") {
    const id = media_content_id.split("/").pop();
    if (!PLEX_HUBS[id]) throw new Error("Hub not found");
    return { title: PLEX_HUBS[id][0], media_class: "directory", media_content_id, media_content_type: "hub", can_expand: true, children: PLEX_HUBS[id][1]() };
  }
  if (media_content_type === "show") {
    const key = Number(media_content_id.split("/").pop().split("?")[0]);
    return { title: PLEX_TITLES[key] ?? "Show", media_class: "tv_show", media_content_id, media_content_type: "show", can_expand: true,
      children: [1, 2].map((n) => plexItem(key * 10 + n, "season", `Season ${n}`, { expand: true })) };
  }
  if (media_content_type === "season") {
    const key = Number(media_content_id.split("/").pop().split("?")[0]);
    return { title: `${PLEX_TITLES[Math.floor(key / 10)] ?? "Show"} - Season ${key % 10}`, media_class: "season", media_content_id, media_content_type: "season", can_expand: true,
      children: [1, 2, 3].map((n) => plexItem(key * 100 + n, "episode", `S0${key % 10}E0${n} - Episode ${n}`)) };
  }
  throw new Error("Media not found");
}
const plexPoster = (key) => {
  const hue = (Number(key) * 47) % 360;
  const label = String(PLEX_TITLES[key] ?? "Plex").replace(/&/g, "&amp;").replace(/</g, "&lt;").slice(0, 24);
  const wide = [2001, 2003, 2004].includes(Number(key));
  const [w, h] = wide ? [320, 180] : [200, 300];
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}"><rect width="${w}" height="${h}" fill="hsl(${hue} 45% 32%)"/><text x="${w / 2}" y="${h / 2}" font-family="Arial,sans-serif" font-weight="700" font-size="20" fill="#fff" text-anchor="middle">${label}</text></svg>`;
};

// Music Assistant: radio stations (logos are served by this mock at /imageproxy).
const STATIONS = [
  ["DR P1", "#ff6a13", "P1"], ["DR P3", "#8fa5a0", "P3"], ["DR P4 København", "#ffa400", "P4"], ["DR P4 Sjælland", "#ffa400", "P4"],
  ["DR P6 Beat", "#4a4650", "P6"], ["DR P8 Jazz", "#6d2b8f", "P8"], ["myROCK", "#1c1c1c", "ROCK"], ["NOVA", "#1f4260", "NOVA"],
  ["Pop FM", "#e8851d", "Pop FM"], ["Radio 100", "#2b72b5", "100"], ["The Voice", "#101010", "VOICE"],
].map(([name, color, label], i) => ({
  media_type: "radio",
  uri: `library://radio/${i + 1}`,
  name,
  version: "",
  image: `http://127.0.0.1:${process.env.MOCK_PORT ?? 8123}/imageproxy?path=${i}&provider=builtin`,
  favorite: false,
  _color: color,
  _label: label,
}));

const logo = (index) => {
  const st = STATIONS[Number(index)] ?? STATIONS[0];
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200"><rect width="200" height="200" fill="${st._color}"/><text x="100" y="115" font-family="Arial,sans-serif" font-weight="700" font-size="${st._label.length > 3 ? 44 : 78}" fill="#fff" text-anchor="middle">${st._label}</text></svg>`;
};

const sockets = new Set();
const emit = (entity_id) => {
  const new_state = states.get(entity_id);
  for (const { ws, subscription } of sockets) {
    if (subscription) ws.send(JSON.stringify({ id: subscription, type: "event", event: { event_type: "state_changed", data: { entity_id, new_state } } }));
  }
};

// Sync groups of Music Assistant players: the leader's group_members lists everyone, leader first.
const GROUPING = 524288;
const MEDIA_KEYS = ["media_content_id", "media_content_type", "media_title", "media_artist", "media_album_name", "app_id"];

function setGroup(leaderId, memberIds) {
  const list = memberIds.length > 1 ? memberIds : [];
  for (const id of memberIds) patch(id, (a) => (a.group_members = list));
}

function patch(id, fn, state) {
  const s = states.get(id);
  if (!s) return;
  const next = { ...s, attributes: { ...s.attributes }, last_changed: new Date().toISOString() };
  fn(next.attributes);
  if (state) next.state = state;
  states.set(id, next);
  emit(id);
}

/** Members mirror the leader's playback, as Music Assistant does for synced players. */
function mirrorLeader(leaderId) {
  const leader = states.get(leaderId);
  const members = leader?.attributes.group_members ?? [];
  for (const id of members.filter((m) => m !== leaderId)) {
    patch(id, (a) => MEDIA_KEYS.forEach((k) => (a[k] = leader.attributes[k])), leader.state);
  }
}

function callGroupService({ service, service_data = {}, target = {} }) {
  const ids = [].concat(target.entity_id ?? []);
  if (service === "join") {
    const leaderId = ids[0];
    const current = states.get(leaderId)?.attributes.group_members ?? [];
    const members = [...new Set([...(current.length ? current : [leaderId]), ...service_data.group_members])];
    for (const m of service_data.group_members) {
      // leaving a previous group first
      const old = states.get(m)?.attributes.group_members ?? [];
      if (old.length && old[0] !== leaderId) setGroup(old[0], old.filter((x) => x !== m));
    }
    setGroup(leaderId, members);
    mirrorLeader(leaderId);
  } else if (service === "unjoin") {
    for (const id of ids) {
      const group = states.get(id)?.attributes.group_members ?? [];
      if (!group.length) continue;
      patch(id, (a) => (a.group_members = []), "idle");
      setGroup(group[0], group.filter((m) => m !== id));
    }
  }
}

function callService({ domain, service, service_data = {}, target = {} }) {
  if (domain === "media_player" && (service === "join" || service === "unjoin")) {
    callGroupService({ service, service_data, target });
    console.log(`[mock-ha] ${domain}.${service}`, [].concat(target.entity_id ?? []).join(","), JSON.stringify(service_data));
    return;
  }
  const ids = [].concat(target.entity_id ?? []);
  for (const id of ids) {
    const s = states.get(id);
    if (!s) continue;
    const next = { ...s, attributes: { ...s.attributes }, last_changed: new Date().toISOString() };
    if (service === "turn_on" && domain === "light") {
      next.state = "on";
      if (service_data.brightness_pct != null) next.attributes.brightness = Math.round((service_data.brightness_pct / 100) * 255);
    } else if (service === "turn_off") next.state = "off";
    else if (service === "toggle") next.state = s.state === "on" ? "off" : "on";
    else if (service === "media_play_pause") next.state = s.state === "playing" ? "paused" : "playing";
    else if (service === "select_option") {
      next.state = service_data.option;
      if (id.endsWith("_operation")) patch(`sensor.${id.replace(/^select\./, "").replace(/_operation$/, "")}_current_status`, () => {}, service_data.option === "start" ? "running" : "end");
    }
    else if (domain === "media_player" && service === "play_media" && /^https?:\/\//.test(String(service_data.media_content_id))) {
      next.state = "playing";
      console.log(`[mock-ha] stream ${service_data.media_content_type} ${service_data.media_content_id} on ${id}`);
    } else if (domain === "media_player" && service === "play_media" && String(service_data.media_content_id).startsWith("plex://")) {
      next.state = "playing";
      next.attributes.media_title = `plex ${service_data.media_content_id}`;
      console.log(`[mock-ha] plex play ${service_data.media_content_type} ${service_data.media_content_id} on ${id}`);
    } else if (domain === "climate" && service === "set_temperature") next.attributes.temperature = service_data.temperature;
    else if (domain === "climate" && service === "set_hvac_mode") next.state = service_data.hvac_mode;
    else if (domain === "button" && service === "press") {
      next.state = new Date().toISOString();
      if (id.endsWith("manually_start_charging")) patch("sensor.ev_smart_charging_charging", () => {}, "on"), patch("sensor.ev_smart_charging_status", () => {}, "charging");
      if (id.endsWith("manually_stop_charging")) patch("sensor.ev_smart_charging_charging", () => {}, "off"), patch("sensor.ev_smart_charging_status", () => {}, "no_charging_planned");
    } else if (service === "media_pause") next.state = "paused";
    else if (service === "media_play") next.state = "playing";
    else if (service === "media_stop") next.state = "idle";
    else if (domain === "music_assistant" && service === "play_media") {
      const station = STATIONS.find((st) => st.uri === service_data.media_id);
      Object.assign(next.attributes, {
        media_content_id: service_data.media_id,
        media_content_type: "music",
        media_title: station ? "We're Good" : service_data.media_id,
        media_artist: "Dua Lipa",
        media_album_name: station ? station.name : undefined,
        app_id: "music_assistant",
        entity_picture: `/api/media_player_proxy/${id}?token=mock&cache=${Date.now()}`,
        media_duration: 215,
        media_position: 12,
        media_position_updated_at: new Date().toISOString(),
      });
      next.state = "playing";
    } else if (service === "volume_set") next.attributes.volume_level = service_data.volume_level;
    else if (service === "set_temperature") next.attributes.temperature = service_data.temperature;
    else if (service === "set_hvac_mode") next.state = service_data.hvac_mode;
    else if (service === "set_fan_mode") next.attributes.fan_mode = service_data.fan_mode;
    else if (service === "set_swing_mode") next.attributes.swing_mode = service_data.swing_mode;
    states.set(id, next);
    emit(id);
    if ((next.attributes.group_members ?? []).length) mirrorLeader(next.attributes.group_members[0]);
  }
  console.log(`[mock-ha] ${domain}.${service}`, ids.join(","), JSON.stringify(service_data));
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, "http://localhost");
  const pictureMatch = url.pathname.match(/^\/api\/media_player_proxy\/(media_player\.[a-z0-9_]+)$/);
  if (pictureMatch) {
    const label = pictureMatch[1].split(".")[1].slice(0, 2).toUpperCase();
    res.writeHead(200, { "Content-Type": "image/svg+xml" });
    return res.end(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 300"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#2e86ab"/><stop offset="1" stop-color="#e4572e"/></linearGradient></defs><rect width="300" height="300" fill="url(#g)"/><circle cx="150" cy="150" r="95" fill="rgba(0,0,0,.2)"/><circle cx="150" cy="150" r="20" fill="rgba(255,255,255,.8)"/><text x="18" y="46" font-family="Arial" font-weight="700" font-size="30" fill="rgba(255,255,255,.85)">${label}</text></svg>`);
  }
  // a tiny Plex server for stream links (set PLEX_URL=http://127.0.0.1:8123 PLEX_TOKEN=tok)
  const plexMeta = url.pathname.match(/^\/library\/metadata\/(\d+)(\/allLeaves|\/children)?$/);
  if (plexMeta) {
    if (req.headers["x-plex-token"] !== "tok") {
      res.writeHead(401);
      return res.end();
    }
    const key = Number(plexMeta[1]);
    const one = (k, type, title, mkv) => ({ ratingKey: String(k), type, title, viewOffset: k === 2001 ? 754000 : 0, Media: [{ container: mkv ? "mkv" : "mp4", videoCodec: mkv ? "hevc" : "h264", audioCodec: mkv ? "dts" : "aac", Part: [{ key: `/library/parts/${k}/1/file.${mkv ? "mkv" : "mp4"}`, container: mkv ? "mkv" : "mp4" }] }] });
    const list = plexMeta[2] ? [one(key * 100 + 1, "episode", "Episode 1"), one(key * 100 + 2, "episode", "Episode 2")] : [one(key, key === 2001 ? "episode" : "movie", PLEX_TITLES[key] ?? "Title", key % 2 === 1)];
    res.writeHead(200, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ MediaContainer: { Metadata: list } }));
  }
  const plexImage = url.pathname.match(/^\/api\/plex_image_proxy\/([a-z0-9]+)\/(\d+)$/);
  if (plexImage) {
    res.writeHead(200, { "Content-Type": "image/svg+xml" });
    return res.end(plexPoster(plexImage[2]));
  }
  if (url.pathname === "/imageproxy") {
    res.writeHead(200, { "Content-Type": "image/svg+xml" });
    return res.end(logo(url.searchParams.get("path")));
  }
  res.writeHead(404);
  res.end();
});
const wss = new WebSocketServer({ server, path: "/api/websocket" });
wss.on("connection", (ws) => {
  const entry = { ws, subscription: null };
  sockets.add(entry);
  ws.send(JSON.stringify({ type: "auth_required", ha_version: "mock" }));
  ws.on("close", () => sockets.delete(entry));
  ws.on("message", (raw) => {
    const msg = JSON.parse(raw.toString());
    const reply = (result) => ws.send(JSON.stringify({ id: msg.id, type: "result", success: true, result }));
    if (msg.type === "auth") return ws.send(JSON.stringify({ type: msg.access_token ? "auth_ok" : "auth_invalid", ha_version: "mock" }));
    if (msg.type === "ping") return ws.send(JSON.stringify({ id: msg.id, type: "pong" }));
    if (msg.type === "get_states") return reply([...states.values()]);
    if (msg.type === "config/area_registry/list") return reply(registry.areas);
    if (msg.type === "config/floor_registry/list") return reply(registry.floors);
    if (msg.type === "config/device_registry/list") return reply(registry.devices);
    if (msg.type === "config/entity_registry/list_for_display") return reply({ entity_categories: {}, entities: registry.entities });
    if (msg.type === "subscribe_events") {
      entry.subscription = msg.id;
      return reply(null);
    }
    if (msg.type === "config_entries/get") {
      return reply(msg.domain === "music_assistant" ? [{ entry_id: "01MOCKMAENTRY", domain: "music_assistant", state: "loaded", title: "Music Assistant" }] : []);
    }
    if (msg.type === "call_service" && msg.domain === "music_assistant" && msg.service === "get_library") {
      const items = STATIONS.map(({ _color, _label, ...item }) => item);
      return reply({ context: {}, response: { items, limit: msg.service_data.limit, offset: 0, order_by: "name", media_type: "radio" } });
    }
    if (msg.type === "media_player/browse_media") {
      try {
        return reply(plexBrowse(msg));
      } catch (err) {
        return ws.send(JSON.stringify({ id: msg.id, type: "result", success: false, error: { code: "failed", message: err.message } }));
      }
    }
    if (msg.type === "call_service" && msg.domain === "calendar" && msg.service === "get_events") {
      const wanted = msg.target?.entity_id ?? [];
      return reply({ context: {}, response: Object.fromEntries(wanted.map((id) => [id, { events: calendarEvents(id) }])) });
    }
    if (msg.type === "call_service" && msg.domain === "weather" && msg.service === "get_forecasts") {
      const id = [msg.target?.entity_id].flat()[0];
      return reply({ context: {}, response: { [id]: { forecast: forecastDays() } } });
    }
    if (msg.type === "call_service") {
      callService(msg);
      return reply({ context: {} });
    }
    reply(null);
  });
});
server.listen(Number(process.env.MOCK_PORT ?? 8123), () => console.log("[mock-ha] listening on :8123"));
