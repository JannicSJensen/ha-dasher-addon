/** Resolve hero weather without changing the saved dashboard or guessing an entity id. */
export function resolveWeatherBackgrounds(config, index = new Map()) {
  const entities = new Set();
  if (!config) return { config, entities };
  const calendarWeather = (page) => page.tiles.find((tile) => tile.type === "calendar" && typeof tile.weather_entity === "string" && tile.weather_entity.startsWith("weather."))?.weather_entity;
  const configuredWeather = config.pages.map(calendarWeather).find(Boolean);
  const discoveredWeather = [...index.keys()].filter((id) => id.startsWith("weather.")).sort()[0];
  const pages = config.pages.map((page) => ({
    ...page,
    tiles: page.tiles.map((tile) => {
      if (tile.type !== "hero" || !tile.weather_background) return tile;
      const weather = tile.weather_entity ?? calendarWeather(page) ?? configuredWeather ?? discoveredWeather ?? null;
      const sun = tile.sun_entity ?? (index.has("sun.sun") ? "sun.sun" : null);
      if (weather) entities.add(weather);
      if (sun) entities.add(sun);
      return { ...tile, weather_entity: weather, sun_entity: sun };
    }),
  }));
  return { config: { ...config, pages }, entities };
}
