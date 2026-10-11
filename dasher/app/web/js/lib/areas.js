import { isUnavailable } from "./format.js";

const domainOf = (id) => id.slice(0, id.indexOf("."));

const ICON_RULES = [
  [/udestue|have|garden|terrasse|patio|outdoor/, "tree"],
  [/stue|living|lounge/, "sofa"],
  [/spisebord|dining/, "table-furniture"],
  [/madlavning|k[oø]kken|kitchen/, "silverware-fork-knife"],
  [/k[oø]leskab|fridge/, "fridge-outline"],
  [/toilet|\bwc\b/, "toilet"],
  [/\bbad\b|bath|shower/, "shower"],
  [/bryggers|utility|laundry/, "washing-machine"],
  [/sove|bedroom|master|b[oø]rne|kids|child/, "bed"],
  [/kontor|office|study/, "desk"],
  [/entr[eé]|indgang|hall|entry|bagindgang/, "door"],
  [/garage|carport|skur|shed/, "garage"],
  [/drivhus|greenhouse/, "sprout"],
  [/loft|attic/, "home-roof"],
];

/** Pick an MDI icon for an area: explicit icon first, then a guess from its name. */
export function areaIcon(area) {
  if (area.icon) return String(area.icon).replace(/^mdi:/, "");
  const name = `${area.id} ${area.name}`.toLowerCase();
  return ICON_RULES.find(([re]) => re.test(name))?.[1] ?? "home-outline";
}

/**
 * The entities to show as tiles for an area: light group members are hidden behind their group,
 * and entities that are unavailable move to the end (their order is otherwise kept).
 */
export function visibleAreaEntities(area, getState) {
  const members = new Set();
  for (const id of area.entities) {
    if (domainOf(id) !== "light") continue;
    const list = getState(id)?.attributes?.entity_id;
    if (Array.isArray(list)) for (const m of list) if (m !== id) members.add(m);
  }
  const visible = area.entities.filter((id) => !members.has(id));
  return [...visible.filter((id) => !isUnavailable(getState(id))), ...visible.filter((id) => isUnavailable(getState(id)))];
}

/** Number of lights currently on, counting each light group once. */
export function lightsOn(area, getState) {
  return visibleAreaEntities(area, getState).filter((id) => domainOf(id) === "light" && getState(id)?.state === "on").length;
}

const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

function numeric(ids, getState) {
  const values = [];
  let unit = null;
  for (const id of ids) {
    const entity = getState(id);
    if (isUnavailable(entity)) continue;
    const n = Number(entity.state);
    if (!Number.isFinite(n)) continue;
    values.push(n);
    unit ??= entity.attributes?.unit_of_measurement ?? null;
  }
  return values.length ? { value: median(values), unit } : null;
}

/**
 * Header figures of an area. Several sensors are combined with the median so one odd
 * sensor (soil, outdoor, boiler) cannot skew the reading.
 */
export function areaStats(area, getState) {
  const states = area.windows.map((id) => getState(id)).filter((s) => !isUnavailable(s));
  return {
    temperature: numeric(area.temperature, getState),
    humidity: numeric(area.humidity, getState),
    windows: states.length ? { open: states.filter((s) => s.state === "on").length, total: states.length } : null,
  };
}

/** Distinct crops of one picture so tiles without their own photo do not all look the same. */
const CROPS = ["0% 0%", "100% 100%", "100% 0%", "0% 100%", "50% 50%", "25% 75%", "75% 25%"];
export const cropFor = (index) => CROPS[index % CROPS.length];
