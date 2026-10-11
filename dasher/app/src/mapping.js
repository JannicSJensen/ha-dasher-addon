import YAML from "yaml";

export const MAP_FILE = "entity-map.yaml";

const ENTITY_RE = /^[a-z0-9_]+\.[a-z0-9_]+$/;
export const domainOf = (id) => id.slice(0, id.indexOf("."));

const HEADER = `# Entity mapping, written by the "map entities" screen of the dashboard.
# Left: an entity id used in dashboard.yaml. Right: the entity of your Home Assistant to use instead.
# You can edit this file by hand; delete a line to undo a mapping.
`;

/** Read entity-map.yaml: { map, errors }. Entries that are not valid same-domain pairs are skipped. */
export function parseEntityMap(text) {
  const errors = [];
  let raw;
  try {
    raw = YAML.parse(text);
  } catch (err) {
    return { map: {}, errors: [`entity-map.yaml: ${err.message}`] };
  }
  if (raw == null) return { map: {}, errors };
  if (typeof raw !== "object" || Array.isArray(raw)) return { map: {}, errors: ["entity-map.yaml must be a mapping of entity ids."] };
  const map = {};
  for (const [from, to] of Object.entries(raw)) {
    if (typeof to !== "string" || !ENTITY_RE.test(from) || !ENTITY_RE.test(to)) errors.push(`entity-map.yaml: "${from}: ${to}" is not a pair of entity ids`);
    else if (domainOf(from) !== domainOf(to)) errors.push(`entity-map.yaml: ${from} and ${to} are of different kinds`);
    else if (from !== to) map[from] = to;
  }
  return { map, errors };
}

export function serializeEntityMap(map) {
  const entries = Object.entries(map).sort(([a], [b]) => a.localeCompare(b));
  return HEADER + (entries.length ? YAML.stringify(Object.fromEntries(entries)) : "");
}

/**
 * Check a request to map `from` to `to` (or to remove the mapping with `to: null`).
 * `index` is the map of entities Home Assistant knows.
 */
export function validateMapping({ from, to }, { rawEntities, index }) {
  if (typeof from !== "string" || !rawEntities.has(from)) return { ok: false, status: 400, error: "That entity is not used in dashboard.yaml." };
  if (to == null || to === from) return { ok: true, from, to: null };
  if (typeof to !== "string" || !ENTITY_RE.test(to)) return { ok: false, status: 400, error: "Not a valid entity id." };
  if (domainOf(to) !== domainOf(from)) return { ok: false, status: 400, error: `${to} is not a ${domainOf(from)} entity.` };
  if (!index.has(to)) return { ok: false, status: 400, error: `Home Assistant does not know ${to}.` };
  return { ok: true, from, to };
}

/** One row per entity of dashboard.yaml for the mapping screen, unresolved ones first. */
export function mappingItems({ rawEntities, usage, map, index }) {
  const items = [...rawEntities].map((id) => {
    const mapped = Object.hasOwn(map, id) ? map[id] : null;
    const effective = mapped ?? id;
    const known = index.get(effective);
    return {
      id,
      domain: domainOf(id),
      tiles: usage.get(id) ?? [],
      mapped,
      found: Boolean(known),
      name: known?.name ?? null,
    };
  });
  const rank = (item) => (!item.found ? 0 : item.mapped ? 1 : 2);
  return items.sort((a, b) => rank(a) - rank(b) || a.id.localeCompare(b.id));
}

const words = (text) =>
  String(text ?? "")
    .toLowerCase()
    .split(/[^a-z0-9æøåäö]+/)
    .filter((w) => w.length >= 3);

/**
 * Entities of Home Assistant that could replace `from`: same kind, best guesses first.
 * With a search text every word must occur in the id, name or area; without one the entities whose
 * words match the missing id and the tiles that use it come first.
 */
export function rankCandidates({ index, registries, from, usage = [], q = "", limit = 40 }) {
  const domain = domainOf(from);
  const areaNames = new Map((registries?.areas ?? []).map((a) => [a.area_id, a.name]));
  const deviceArea = new Map((registries?.devices ?? []).map((d) => [d.id, d.area_id]));
  const entityArea = new Map();
  for (const e of registries?.entities ?? []) {
    const areaId = e.ai ?? (e.di ? deviceArea.get(e.di) : null);
    if (areaId && areaNames.has(areaId)) entityArea.set(e.ei, areaNames.get(areaId));
  }

  const hint = [...words(from.slice(domain.length + 1)), ...usage.flatMap((label) => words(label))];
  const query = words(q.length >= 3 ? q : "").concat(String(q).trim().length && String(q).trim().length < 3 ? [String(q).trim().toLowerCase()] : []);

  const results = [];
  for (const entry of index.values()) {
    if (entry.domain !== domain) continue;
    const area = entityArea.get(entry.id) ?? null;
    const haystack = `${entry.id} ${entry.name ?? ""} ${area ?? ""}`.toLowerCase();
    let score = 0;
    if (query.length) {
      if (!query.every((w) => haystack.includes(w))) continue;
      score = query.filter((w) => entry.id.toLowerCase().includes(w) || (entry.name ?? "").toLowerCase().includes(w)).length;
    } else {
      score = hint.filter((w) => haystack.includes(w)).length;
    }
    results.push({ id: entry.id, name: entry.name ?? null, area, device_class: entry.deviceClass ?? null, unit: entry.unit ?? null, score });
  }
  results.sort((a, b) => b.score - a.score || (a.name ?? a.id).localeCompare(b.name ?? b.id));
  return results.slice(0, limit);
}
