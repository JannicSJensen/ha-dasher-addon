/*
 * The Devices page: robot vacuums (every vacuum entity) and household appliances: washing machines, dryers,
 * dishwashers and simple clothes heaters. LG ThinQ appliances are found by their device; others are listed in the
 * `devices:` section of dashboard.yaml.
 */
const domainOf = (id) => id.slice(0, id.indexOf("."));

export const APPLIANCE_KINDS = ["washer", "dryer", "dishwasher", "heater"];
export const APPLIANCE_ROLES = ["status_entity", "remaining_entity", "power_entity", "operation_entity", "delay_entity"];
const APPLIANCE_PLATFORMS = new Set(["lg_thinq"]);

/** How to recognise an appliance's entities from the registry (`tk` = translation key) and the entity id. */
const ROLE_RULES = {
  status_entity: (e) => domainOf(e.ei) === "sensor" && (e.tk === "current_state" || /_current_(status|state)$/.test(e.ei)),
  remaining_entity: (e) => domainOf(e.ei) === "sensor" && (e.tk === "remaining_time" || /_remaining_time$/.test(e.ei)),
  power_entity: (e) => domainOf(e.ei) === "switch" && (e.tk === "operation_power" || /_power$/.test(e.ei)),
  operation_entity: (e) => domainOf(e.ei) === "select" && (e.tk === "operation_mode" || /_operation$/.test(e.ei)),
  delay_entity: (e) => domainOf(e.ei) === "number" && (e.tk === "delay_ends_in" || /_delay(ed)?_end(s_in)?$/.test(e.ei)),
};

/** washer | dryer | dishwasher | null, from the device name and the states the status sensor can have. */
export function detectKind(name, statusOptions = []) {
  const text = String(name ?? "").toLowerCase();
  if (/opvask|dish/.test(text)) return "dishwasher";
  if (/tørre|torre|dryer|tumbl|tørret/.test(text)) return "dryer";
  if (/vask|wash|laundry/.test(text)) return "washer";
  if (statusOptions.some((o) => /wrinkle_care/.test(o))) return "dryer";
  if (statusOptions.some((o) => /spinning|rinse_hold|steam_softening/.test(o))) return "washer";
  return null;
}

/** Vacuums and appliances found in the registry: { vacuums: [ids], appliances: [{ id, kind, name, roles }] }. */
export function discoverDevices({ registries, index = new Map() }) {
  const entries = (registries?.entities ?? []).filter((e) => e?.ei && !e.hb);
  const known = (id) => index.size === 0 || index.has(id);
  const vacuums = [
    ...new Set([...entries.filter((e) => domainOf(e.ei) === "vacuum").map((e) => e.ei), ...[...index.keys()].filter((id) => domainOf(id) === "vacuum" && !(registries?.entities ?? []).some((e) => e.ei === id && e.hb))]),
  ]
    .filter(known)
    .sort((a, b) => String(index.get(a)?.name ?? a).localeCompare(String(index.get(b)?.name ?? b)));

  const devices = new Map((registries?.devices ?? []).map((d) => [d.id, d]));
  const byDevice = new Map();
  for (const entry of entries) {
    if (!entry.di || !APPLIANCE_PLATFORMS.has(entry.pl)) continue;
    if (!byDevice.has(entry.di)) byDevice.set(entry.di, []);
    byDevice.get(entry.di).push(entry);
  }
  const appliances = [];
  for (const [deviceId, rows] of byDevice) {
    const roles = {};
    for (const [role, matches] of Object.entries(ROLE_RULES)) {
      const hit = rows.filter((e) => known(e.ei)).sort((a, b) => a.ei.localeCompare(b.ei)).find(matches);
      if (hit) roles[role] = hit.ei;
    }
    if (!roles.status_entity) continue;
    const device = devices.get(deviceId);
    const name = device?.name_by_user ?? device?.name ?? null;
    const options = index.get(roles.status_entity)?.options ?? [];
    const kind = detectKind(name ?? roles.status_entity, options);
    if (!kind) continue;
    appliances.push({ id: `dev-${deviceId}`, kind, name, roles });
  }
  appliances.sort((a, b) => String(a.name ?? a.id).localeCompare(String(b.name ?? b.id)));
  return { vacuums, appliances };
}

/** The key under which a card of the Devices page is removed and restored: a vacuum's entity id, an appliance's status (else power) entity. */
export const applianceKey = (appliance) => appliance.roles.status_entity ?? appliance.roles.power_entity ?? null;

/**
 * The Devices page as tablets get it: explicit settings win over discovered devices. `hidden` (a Set of keys) holds the
 * cards people removed; they stay in `removed` so they can be brought back.
 */
export function resolveDevices({ settings, discovered, hidden = new Set() }) {
  if (!settings || settings.enabled === false) return { enabled: false, vacuums: [], appliances: [], removed: { vacuums: [], appliances: [] } };
  const excluded = new Set(settings.exclude);
  const allVacuums = (settings.vacuums.length ? settings.vacuums : discovered.vacuums).filter((id) => !excluded.has(id));

  const explicit = settings.appliances.map((a, i) => ({ id: `custom-${i}`, kind: a.kind, name: a.name, roles: a.roles }));
  const taken = new Set(explicit.flatMap((a) => Object.values(a.roles)));
  const found = discovered.appliances.filter((a) => !Object.values(a.roles).some((id) => excluded.has(id) || taken.has(id)));
  const allAppliances = [...found, ...explicit].map((a) => ({ ...a, key: applianceKey(a) }));

  const vacuums = allVacuums.filter((id) => !hidden.has(id));
  const appliances = allAppliances.filter((a) => !hidden.has(a.key));
  const removed = { vacuums: allVacuums.filter((id) => hidden.has(id)), appliances: allAppliances.filter((a) => hidden.has(a.key)) };

  const enabled = settings.enabled === true || allVacuums.length > 0 || allAppliances.length > 0;
  return { enabled, title: settings.title, icon: settings.icon, vacuums, appliances, removed };
}

/** Every entity id of a resolved Devices page, removed cards included (their names are shown when they can be restored). */
export const deviceEntities = (resolved) => [
  ...resolved.vacuums,
  ...resolved.removed.vacuums,
  ...[...resolved.appliances, ...resolved.removed.appliances].flatMap((a) => Object.values(a.roles)),
];

/** The keys that can be removed from the page now. */
export const deviceKeys = (resolved) => new Set([...resolved.vacuums, ...resolved.removed.vacuums, ...[...resolved.appliances, ...resolved.removed.appliances].map((a) => a.key)].filter(Boolean));
