const domainOf = (id) => id.slice(0, id.indexOf("."));

/** Integrations whose climate entities are helpers (created under Settings > Devices & services > Helpers). */
export const HELPER_PLATFORMS = ["generic_thermostat", "climate_group_helper", "climate_group"];

/**
 * The climate entities of the climate page, as ids sorted by name.
 *   source `helpers` (default): climate helpers only, `all`: every climate entity.
 *   `entities` lists them explicitly and wins over `source`; `exclude` removes some.
 * `registries.entities` rows: ei (entity id), pl (integration), hb (hidden).
 */
export function discoverClimate({ settings, registries, index = new Map() }) {
  const all = (registries?.entities ?? []).filter((e) => e?.ei && domainOf(e.ei) === "climate");
  const hiddenInHA = new Set(all.filter((e) => e.hb).map((e) => e.ei));
  const rows = all.filter((e) => !e.hb);
  const known = (id) => index.size === 0 || index.has(id);
  const nameOf = (id) => String(index.get(id)?.name ?? id).toLowerCase();

  let ids;
  if (settings.entities.length) ids = settings.entities;
  else if (settings.source === "all") {
    ids = [...new Set([...rows.map((e) => e.ei), ...[...index.keys()].filter((id) => domainOf(id) === "climate" && !hiddenInHA.has(id))])];
  } else {
    const platforms = new Set([...HELPER_PLATFORMS, ...settings.platforms]);
    ids = rows.filter((e) => platforms.has(e.pl)).map((e) => e.ei);
  }
  const hidden = new Set(settings.exclude);
  return [...new Set(ids)]
    .filter((id) => !hidden.has(id) && known(id))
    .sort((a, b) => nameOf(a).localeCompare(nameOf(b)));
}

/** The climate page as tablets get it; `enabled: auto` shows it only when there is something to show. */
export function resolveClimate({ settings, registries, index }) {
  if (!settings || settings.enabled === false) return { enabled: false, entities: [] };
  const entities = discoverClimate({ settings, registries, index });
  return { enabled: settings.enabled === true || entities.length > 0, title: settings.title, icon: settings.icon, entities };
}
