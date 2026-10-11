import { createButtonsTile } from "./buttons.js";
import { createClimateTile } from "./climate.js";
import { createHeroTile } from "./hero.js";
import { createMediaTile } from "./media.js";
import { createCalendarTile } from "./calendar.js";
import { createPriceTile } from "./price.js";
import { createToggleTile } from "./toggle.js";
import { createVehicleTile } from "./vehicle.js";

export const TILE_FACTORIES = {
  hero: createHeroTile,
  toggle: createToggleTile,
  price: createPriceTile,
  calendar: createCalendarTile,
  vehicle: createVehicleTile,
  media: createMediaTile,
  climate: createClimateTile,
  buttons: createButtonsTile,
};
