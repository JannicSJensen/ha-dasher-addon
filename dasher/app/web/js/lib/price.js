const START_KEYS = ["start", "hour", "time", "datetime", "from", "start_time"];
const END_KEYS = ["end", "to", "end_time"];
const VALUE_KEYS = ["value", "price", "total", "energy"];
const ATTRIBUTE_CANDIDATES = ["raw_today", "today", "prices_today", "prices", "data"];

const DAY_MS = 24 * 3600 * 1000;

const pick = (obj, keys) => keys.map((k) => obj[k]).find((v) => v !== undefined && v !== null);

export function startOfDay(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

/**
 * Turn the price attribute of a sensor into [{start, end, value}] slots (ms epoch).
 * Supports Nordpool / Energi Data Service style objects as well as plain number arrays
 * (assumed to cover the local day evenly, e.g. 24 or 96 values).
 */
export function normalizeSlots(attributes, { attribute, now = new Date(), dayStart = startOfDay(now).getTime(), dayEnd = dayStart + DAY_MS } = {}) {
  const key = attribute ?? ATTRIBUTE_CANDIDATES.find((k) => Array.isArray(attributes?.[k]));
  const list = key ? attributes?.[key] : null;
  if (!Array.isArray(list) || list.length === 0) return [];

  if (list.every((value) => value == null || typeof value === "number")) {
    const step = (dayEnd - dayStart) / list.length;
    return list.map((value, i) => ({ start: dayStart + i * step, end: dayStart + (i + 1) * step, value }))
      .filter((slot) => typeof slot.value === "number" && Number.isFinite(slot.value));
  }

  const slots = [];
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const startRaw = pick(item, START_KEYS);
    const rawValue = pick(item, VALUE_KEYS);
    if (rawValue == null || rawValue === "" || typeof rawValue === "boolean") continue;
    const value = Number(rawValue);
    const start = new Date(startRaw).getTime();
    if (!Number.isFinite(start) || !Number.isFinite(value)) continue;
    const endRaw = pick(item, END_KEYS);
    const end = endRaw ? new Date(endRaw).getTime() : NaN;
    slots.push({ start, end, value });
  }
  slots.sort((a, b) => a.start - b.start);

  // Fill in missing ends from the next slot, or the median step for the last one.
  const steps = slots.slice(1).map((s, i) => s.start - slots[i].start).filter((step) => step > 0).sort((a, b) => a - b);
  const fallbackStep = Math.min(steps[Math.floor(steps.length / 2)] ?? 3600_000, 3600_000);
  slots.forEach((s, i) => {
    if (Number.isNaN(s.end)) s.end = Math.min(slots[i + 1]?.start ?? Infinity, s.start + fallbackStep);
  });

  return slots.filter((s) => s.end > s.start && s.end > dayStart && s.start < dayEnd);
}

/** Cheapest continuous run, weighted by elapsed time; missing or overlapping rates cannot cover a run. */
export function cheapestPriceWindow(slots, hours, { now = Date.now(), end = Infinity } = {}) {
  const duration = hours * 3600_000;
  if (!Number.isFinite(duration) || duration <= 0 || !Number.isFinite(now)) return null;
  const rows = slots.filter((slot) => Number.isFinite(slot.start) && Number.isFinite(slot.end) && Number.isFinite(slot.value) && slot.end > slot.start).sort((a, b) => a.start - b.start);
  const candidates = [...new Set([now, ...rows.flatMap((slot) => [slot.start, slot.end - duration])])]
    .filter((start) => start >= now && start + duration <= end).sort((a, b) => a - b);
  let best = null;
  for (const start of candidates) {
    const stop = start + duration;
    let cursor = start;
    let weighted = 0;
    for (const slot of rows) {
      if (slot.end <= cursor) continue;
      if (slot.start > cursor || cursor > start && slot.start < cursor) break;
      const until = Math.min(stop, slot.end);
      weighted += slot.value * (until - cursor);
      cursor = until;
      if (cursor === stop) break;
    }
    if (cursor !== stop) continue;
    const average = weighted / duration;
    if (!best || average < best.average - 1e-10) best = { start, end: stop, average, hours };
  }
  return best;
}

export function currentSlot(slots, now = Date.now()) {
  return slots.find((s) => now >= s.start && now < s.end) ?? null;
}

/** Classify a value as "low" | "mid" | "high" using the 1/3 and 2/3 percentiles of the day. */
export function makeClassifier(slots, thresholds) {
  const sorted = slots.map((s) => s.value).sort((a, b) => a - b);
  const at = (q) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
  const low = thresholds?.low ?? (sorted.length ? at(1 / 3) : 0);
  const high = thresholds?.high ?? (sorted.length ? at(2 / 3) : 0);
  return (value) => (value < low ? "low" : value > high ? "high" : "mid");
}

export function priceRange(slots) {
  if (!slots.length) return null;
  const values = slots.map((s) => s.value);
  return { min: Math.min(...values), max: Math.max(...values) };
}
