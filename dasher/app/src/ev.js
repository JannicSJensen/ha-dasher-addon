import { EV_ROLES } from "./config.js";

const domainOf = (id) => id.slice(0, id.indexOf("."));
const RESTART_WORDS = /restart|reboot|genstart|neustart|redemarr|reinicia/i;
const CHARGER_PLATFORMS = new Set(["peblar", "easee", "wallbox", "zaptec", "ocpp", "keba", "goecharger", "myenergi", "tesla_wall_connector"]);

/**
 * How to recognise the entities of the car page in Home Assistant's registry (`pl` = integration,
 * `tk` = translation key) and states. EV Smart Charging and Peblar are known by name; everything else
 * is set in the `ev:` section of dashboard.yaml.
 */
const RULES = {
  smart_switch_entity: (e) => e.pl === "ev_smart_charging" && e.tk === "smart_charging_activated",
  smart_status_entity: (e) => e.pl === "ev_smart_charging" && e.tk === "status",
  smart_info_entity: (e) => e.pl === "ev_smart_charging" && e.tk === "charging",
  start_time_entity: (e) => e.pl === "ev_smart_charging" && e.tk === "charge_start_time",
  ready_time_entity: (e) => e.pl === "ev_smart_charging" && e.tk === "charge_completion_time",
  start_entity: (e) => e.pl === "ev_smart_charging" && e.tk === "manually_start_charging",
  stop_entity: (e) => e.pl === "ev_smart_charging" && e.tk === "manually_stop_charging",
  plug_entity: (e) => e.pl === "ev_smart_charging" && e.tk === "ev_connected",
  charge_switch_entity: (e) => CHARGER_PLATFORMS.has(e.pl) && domainOf(e.ei) === "switch" && e.tk === "charge",
  restart_entity: (e, index) =>
    CHARGER_PLATFORMS.has(e.pl) && domainOf(e.ei) === "button" && (index.get(e.ei)?.deviceClass === "restart" || RESTART_WORDS.test(e.ei)),
};

/** Roles found in the registry: { role: entity_id }. When several match the first (by id) wins. */
export function discoverEv({ registries, index = new Map() }) {
  const found = {};
  const entries = [...(registries?.entities ?? [])].filter((e) => e?.ei && !e.hb).sort((a, b) => a.ei.localeCompare(b.ei));
  for (const [role, matches] of Object.entries(RULES)) {
    const hit = entries.find((e) => matches(e, index));
    if (hit) found[role] = hit.ei;
  }
  return found;
}

/** Roles that make the page useful by themselves; without any of them it stays hidden in `auto` mode. */
const CONTROL_ROLES = ["start_entity", "stop_entity", "charge_switch_entity", "smart_switch_entity", "start_time_entity", "ready_time_entity", "restart_entity"];

/**
 * The car page as the tablets get it: explicit settings win over discovered entities.
 * `enabled: auto` shows the page only when something can be controlled.
 */
export function resolveEv({ settings, discovered }) {
  if (!settings || settings.enabled === false) return { enabled: false, roles: {} };
  const roles = {};
  for (const role of EV_ROLES) {
    const id = settings.roles[role] ?? discovered[role];
    if (id) roles[role] = id;
  }
  const controllable = CONTROL_ROLES.some((role) => roles[role]);
  return {
    enabled: settings.enabled === true || controllable,
    title: settings.title,
    icon: settings.icon,
    name: settings.name,
    image: settings.image,
    roles,
  };
}
