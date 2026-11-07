import { currentSlot, normalizeSlots } from "../web/js/lib/price.js";
import { energyDate, energyWindow } from "./energy-window.js";

const numeric = (value) => value == null || value === "" || typeof value === "boolean" ? null
  : Number.isFinite(Number(value)) ? Number(value) : null;

const priceUnit = (attributes) => attributes.unit_of_measurement
  ?? (attributes.currency && attributes.unit === "kWh" ? `${attributes.use_cent ? "cent" : attributes.currency}/kWh` : null);

export function isEnergyPriceState(state) {
  const attributes = state.attributes ?? {};
  const unit = priceUnit(attributes);
  return state.entity_id?.startsWith("sensor.") && typeof unit === "string" && /\/(?:kWh|MWh)$/i.test(unit)
    && ["raw_today", "today", "prices_today", "prices", "data"].some((key) => Array.isArray(attributes[key]));
}

export function energyPrices({ states = new Map(), preferences, core, evInfoEntity, now = Date.now() }) {
  const range = energyWindow({ timeZone: core.time_zone, now });
  const start = Date.parse(range.start);
  const end = Date.parse(range.end);
  const evState = states.get(evInfoEntity);
  const hours = numeric(evState?.attributes?.charging_number_of_hours);
  const ev = {
    entity_id: evInfoEntity ?? null,
    hours: hours != null && hours >= 0 ? hours : null,
    reason: evState?.attributes?.charging_is_planned === false || hours === 0 ? "no_plan" : hours > 0 ? null : "unavailable",
  };
  const preferred = preferences.sources.filter((source) => source.kind === "grid_import").map((source) => source.price_entity).filter(Boolean);
  const ids = [...new Set([...preferred, ...[...states.keys()].filter((id) => id.startsWith("sensor.")).sort()])];
  for (const id of ids) {
    const state = states.get(id);
    if (!state || ["unavailable", "unknown"].includes(state.state)) continue;
    const attributes = state.attributes ?? {};
    const unit = priceUnit(attributes);
    if (typeof unit !== "string" || !/\/(?:kWh|MWh)$/i.test(unit)) continue;
    const dated = ["raw_today", "today", "prices_today", "prices", "data"].find((key) => Array.isArray(attributes[key]));
    if (attributes[dated]?.every((value) => value == null || typeof value === "number") && state.last_updated
      && (!Number.isFinite(Date.parse(state.last_updated)) || energyDate(new Date(state.last_updated), core.time_zone) !== range.date)) continue;
    const slots = normalizeSlots(attributes, { dayStart: start, dayEnd: end })
      .map((slot) => ({ ...slot, start: Math.max(start, slot.start), end: Math.min(end, slot.end) }));
    if (!slots.length) continue;
    let covered = start;
    let partial = false;
    for (const slot of slots) {
      if (slot.start !== covered) partial = true;
      covered = slot.end;
    }
    return {
      date: range.date, start, end, entity_id: id, name: attributes.friendly_name ?? id, unit, slots,
      partial: partial || covered !== end, current: currentSlot(slots, now)?.value ?? null, ev,
    };
  }
  return { date: range.date, start, end, entity_id: null, slots: [], ev };
}
