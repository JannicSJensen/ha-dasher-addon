const isKrone = (unit) => /^(dkk|kr|kroner)\b/i.test(String(unit ?? "").trim());

/**
 * The YAML to paste into dashboard.yaml for a suggestion.
 * `picks` = { entities: string[], weather_entity: string|null, entity: string|null }; `units` maps entity id -> unit.
 */
export function buildSnippet(id, picks = {}, units = {}) {
  if (id === "calendar") {
    const lines = ["- type: calendar", "  # col: 3     # where it goes on the page (leave out to place it automatically)", "  # row: 1"];
    if (picks.entities?.length) lines.push(`  entities: [${picks.entities.join(", ")}]`);
    else lines.push("  # entities: [calendar.family]   # leave out to show every calendar");
    if (picks.weather_entity) lines.push(`  weather_entity: ${picks.weather_entity}`);
    lines.push("  days: 7");
    return lines.join("\n");
  }
  if (id === "car_price") {
    if (!picks.entity) return "";
    const lines = ["price:", `  entity: ${picks.entity}`];
    if (isKrone(units[picks.entity])) lines.push("  multiplier: 100     # kr -> øre", "  unit: øre", "  decimals: 0");
    return lines.join("\n");
  }
  return "";
}
