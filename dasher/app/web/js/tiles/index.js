import { createButtonsTile } from "./buttons.js";
import { createClimateTile } from "./climate.js";
import { createDinnerTile } from "./dinner.js";
import { createFamilyTile } from "./family.js";
import { createOffersTile } from "./offers.js";
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
  dinner: createDinnerTile,
  family: createFamilyTile,
  offers: createOffersTile,
  vehicle: createVehicleTile,
  media: createMediaTile,
  climate: createClimateTile,
  buttons: createButtonsTile,
};
