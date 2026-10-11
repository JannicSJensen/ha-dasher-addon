/**
 * Collect every entity id referenced in a config subtree. Shared by the server
 * (to decide what to watch and allow) and the browser (to know which tiles to update).
 */
export function collectEntities(node, out = new Set()) {
  if (Array.isArray(node)) {
    for (const item of node) collectEntities(item, out);
  } else if (node && typeof node === "object") {
    for (const [key, value] of Object.entries(node)) {
      if (key === "data") continue;
      if ((key === "entity" || key.endsWith("_entity")) && typeof value === "string") out.add(value);
      else if ((key === "entities" || key.endsWith("_entities")) && Array.isArray(value)) {
        for (const v of value) if (typeof v === "string") out.add(v);
      } else collectEntities(value, out);
    }
  }
  return out;
}
