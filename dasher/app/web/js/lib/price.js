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
export function normalizeSlots(attributes, { attribute, now = new Date() } = {}) {
  const key = attribute ?? ATTRIBUTE_CANDIDATES.find((k) => Array.isArray(attributes?.[k]));
  const list = key ? attributes?.[key] : null;
  if (!Array.isArray(list) || list.length === 0) return [];

  const dayStart = startOfDay(now).getTime();

  if (typeof list[0] === "number") {
    const step = DAY_MS / list.length;
    return list.map((value, i) => ({ start: dayStart + i * step, end: dayStart + (i + 1) * step, value }));
  }

  const slots = [];
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const startRaw = pick(item, START_KEYS);
    const value = Number(pick(item, VALUE_KEYS));
    const start = new Date(startRaw).getTime();
    if (Number.isNaN(start) || Number.isNaN(value)) continue;
    const endRaw = pick(item, END_KEYS);
    const end = endRaw ? new Date(endRaw).getTime() : NaN;
    slots.push({ start, end, value });
  }
  slots.sort((a, b) => a.start - b.start);

  // Fill in missing ends from the next slot, or the median step for the last one.
  const steps = slots.slice(1).map((s, i) => s.start - slots[i].start).sort((a, b) => a - b);
  const fallbackStep = steps[Math.floor(steps.length / 2)] ?? 3600 * 1000;
  slots.forEach((s, i) => {
    if (Number.isNaN(s.end)) s.end = slots[i + 1]?.start ?? s.start + fallbackStep;
  });

  return slots.filter((s) => s.end > dayStart && s.start < dayStart + DAY_MS);
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
