const CONDITIONS = {
  sunny: "clear",
  "clear-night": "clear",
  partlycloudy: "partlycloudy",
  cloudy: "cloudy",
  fog: "fog",
  rainy: "rain",
  pouring: "pouring",
  snowy: "snow",
  "snowy-rainy": "sleet",
  hail: "hail",
  lightning: "lightning",
  "lightning-rainy": "storm",
  windy: "wind",
  "windy-variant": "windy-cloudy",
  exceptional: "exceptional",
};

export function weatherPresentation(weather, sun) {
  const condition = weather?.state;
  const scene = Object.hasOwn(CONDITIONS, condition ?? "") ? CONDITIONS[condition] : null;
  const night = sun?.state === "below_horizon" || (sun?.state !== "above_horizon" && condition === "clear-night");
  const temperature = weather?.attributes?.temperature;
  return {
    condition: scene ? condition : null,
    scene,
    night,
    temperature: typeof temperature === "number" && Number.isFinite(temperature) ? temperature : null,
    unit: typeof weather?.attributes?.temperature_unit === "string" ? weather.attributes.temperature_unit : "°",
  };
}
