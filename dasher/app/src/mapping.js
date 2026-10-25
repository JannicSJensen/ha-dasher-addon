import YAML from "yaml";

/** The file older versions of the app wrote the mapping to; still read, but the app option wins. */
export const MAP_FILE = "entity-map.yaml";

const ENTITY_RE = /^[a-z0-9_]+\.[a-z0-9_]+$/;
export const domainOf = (id) => id.slice(0, id.indexOf("."));

/** Read entity-map.yaml (the file older versions wrote): { map, errors }. Entries that are not valid same-domain pairs are skipped. */
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
  for (const [from, to] of Object.entries(raw)) addPair(map, errors, from, to, "entity-map.yaml");
  return { map, errors };
}

function addPair(map, errors, from, to, where) {
  if (typeof from !== "string" || typeof to !== "string" || !ENTITY_RE.test(from) || !ENTITY_RE.test(to)) errors.push(`${where}: "${from}" -> "${to}" is not a pair of entity ids`);
  else if (domainOf(from) !== domainOf(to)) errors.push(`${where}: ${from} and ${to} are of different kinds`);
  else if (from !== to) map[from] = to;
}

/**
 * The app option `entity_map`: a list of { from, to } (from: the entity id used in dashboard.yaml, to: the entity of
 * Home Assistant to use instead). Also accepts "from=to,from=to" (the ENTITY_MAP variable of local runs).
 */
export function parseEntityMapOption(value) {
  const errors = [];
  const map = {};
  let list = value;
  if (typeof value === "string") {
    list = value
      .split(",")
      .map((pair) => pair.trim())
      .filter(Boolean)
      .map((pair) => {
        const [from, to] = pair.split("=").map((x) => x.trim());
        return { from, to };
      });
  }
  for (const [i, entry] of (Array.isArray(list) ? list : []).entries()) {
    addPair(map, errors, String(entry?.from ?? "").trim(), String(entry?.to ?? "").trim(), `entity_map[${i + 1}]`);
  }
  return { map, errors };
}

/**
 * The entity ids of dashboard.yaml that Home Assistant does not know once the mapping is applied, as
 * [{ id, mappedTo }] (`mappedTo` is set when the id is mapped to an entity that does not exist either).
 * Empty until Home Assistant's entity list is known.
 */
export function unresolvedEntities({ rawEntities, map, index }) {
  if (!index || index.size === 0) return [];
  const out = [];
  for (const id of rawEntities) {
    const target = Object.hasOwn(map, id) ? map[id] : id;
    if (!index.has(target)) out.push({ id, mappedTo: target !== id ? target : null });
  }
  return out.sort((a, b) => a.id.localeCompare(b.id));
}

/** Log lines that help to fill in the `entity_map` option: what is unknown, where it is used and the best guesses. */
export function describeUnresolved({ unresolved, usage, index, registries, limit = 3 }) {
  return unresolved.map(({ id, mappedTo }) => {
    const where = (usage.get(id) ?? []).slice(0, 3).join(", ");
    const guesses = rankCandidates({ index, registries, from: id, usage: usage.get(id) ?? [], limit })
      .filter((c) => c.score > 0)
      .map((c) => `${c.id}${c.name ? ` (${c.name})` : ""}`);
    const subject = mappedTo ? `${id} is mapped to ${mappedTo}, which Home Assistant does not know` : `${id} is not known to Home Assistant`;
    return `${subject}${where ? ` (used in: ${where})` : ""}. ${guesses.length ? `Maybe use: ${guesses.join(", ")}. ` : ""}Set it in the app option "Entity mapping".`;
  });
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
