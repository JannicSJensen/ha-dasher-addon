/**
 * Features of newer versions that dashboard.yaml does not use yet. The mapping screen lists them
 * so the user can pick the entities and copy a ready-made snippet into dashboard.yaml.
 * The `for` ids are stand-ins that only steer the search for suggestions (words in the id rank matches).
 */
export const PSEUDO_IDS = new Set(["calendar.calendar", "weather.forecast_weather", "sensor.electricity_price_pris_energi"]);

export function buildSuggestions({ config, index }) {
  const tiles = (Array.isArray(config?.pages) ? config.pages : []).flatMap((page) => (Array.isArray(page?.tiles) ? page.tiles : []));
  const has = (domain) => [...index.keys()].some((id) => id.startsWith(`${domain}.`));
  const out = [];
  if (!tiles.some((tile) => tile.type === "calendar") && has("calendar")) {
    out.push({
      id: "calendar",
      fields: [
        { key: "entities", domain: "calendar", for: "calendar.calendar", multi: true },
        { key: "weather_entity", domain: "weather", for: "weather.forecast_weather", multi: false, optional: true },
      ],
    });
  }
  if (tiles.some((tile) => tile.type === "vehicle" && !tile.price)) {
    out.push({ id: "car_price", fields: [{ key: "entity", domain: "sensor", for: "sensor.electricity_price_pris_energi", multi: false }] });
  }
  return out;
}
