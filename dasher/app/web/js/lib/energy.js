export const ENERGY_PERIODS = ["day", "week", "month", "year"];
export const ENERGY_FIELDS = ["grid_import", "grid_export", "solar", "home", "battery_charge", "battery_discharge"];
export const ENERGY_REFRESH_MS = 5 * 60_000;

/** Statistics are nullable numbers, not entity-state strings. Never coerce missing data to zero. */
export const energyNumber = (value) => typeof value === "number" && Number.isFinite(value) ? value : null;

export function energyValue(value, { locale = "en", unit = "kWh", missing = "—", currency = false } = {}) {
  const number = energyNumber(value);
  if (number === null) return missing;
  if (currency && unit) {
    try {
      return new Intl.NumberFormat(locale, { style: "currency", currency: unit, maximumFractionDigits: 2 }).format(number);
    } catch {
      // HA may use a custom currency label rather than an ISO currency code.
    }
  }
  const text = new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(number);
  return unit ? `${text} ${unit}` : text;
}

export function energyDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value ? value : null;
}

export function clampEnergyDate(value, today) {
  const date = energyDate(value);
  const limit = energyDate(today);
  return date && limit && date > limit ? limit : date;
}

const dateOf = (value) => new Date(`${value}T12:00:00Z`);
const keyOf = (date) => date.toISOString().slice(0, 10);

/** Calendar arithmetic uses UTC as a date-only container, independent of the tablet's time zone and DST. */
export function energyRange(value, period = "day") {
  const key = energyDate(value);
  if (!key || !ENERGY_PERIODS.includes(period)) return null;
  const start = dateOf(key);
  if (period === "week") start.setUTCDate(start.getUTCDate() - (start.getUTCDay() + 6) % 7);
  if (period === "month" || period === "year") start.setUTCDate(1);
  if (period === "year") start.setUTCMonth(0);
  const end = new Date(start);
  if (period === "day" || period === "week") end.setUTCDate(end.getUTCDate() + (period === "day" ? 1 : 7));
  if (period === "month") end.setUTCMonth(end.getUTCMonth() + 1);
  if (period === "year") end.setUTCFullYear(end.getUTCFullYear() + 1);
  const last = new Date(end);
  last.setUTCDate(last.getUTCDate() - 1);
  return { first: keyOf(start), last: keyOf(last), end: keyOf(end) };
}

export function shiftEnergyDate(value, period, direction) {
  const range = energyRange(value, period);
  if (!range || ![-1, 1].includes(direction)) return null;
  const date = dateOf(range.first);
  if (period === "day" || period === "week") date.setUTCDate(date.getUTCDate() + direction * (period === "day" ? 1 : 7));
  if (period === "month") date.setUTCMonth(date.getUTCMonth() + direction);
  if (period === "year") date.setUTCFullYear(date.getUTCFullYear() + direction);
  return keyOf(date);
}

export function energyCanNext(value, period, today) {
  const range = energyRange(value, period);
  const current = energyRange(today, period);
  return Boolean(range && current && range.first < current.first);
}

export function energyRangeText(value, period, locale = "en", bounds) {
  const range = energyDate(bounds?.first) && energyDate(bounds?.last) ? bounds : energyRange(value, period);
  if (!range) return "";
  const options = period === "year" ? { year: "numeric" }
    : period === "month" ? { month: "long", year: "numeric" }
      : { day: "numeric", month: "short", year: "numeric" };
  const fmt = new Intl.DateTimeFormat(locale, { ...options, timeZone: "UTC" });
  const first = fmt.format(dateOf(range.first));
  return period === "week" ? `${first} – ${fmt.format(dateOf(range.last))}` : first;
}

export function energyBucketText(start, period, { locale = "en", timeZone, full = false } = {}) {
  const dateOnly = energyDate(start);
  const date = dateOnly ? dateOf(dateOnly) : new Date(start);
  if (start == null || !Number.isFinite(date.getTime())) return "—";
  const options = full
    ? { year: "numeric", month: "short", day: "numeric", ...(period === "day" ? { hour: "2-digit", minute: "2-digit", timeZoneName: "shortOffset" } : {}) }
    : period === "day" ? { hour: "2-digit", minute: "2-digit" }
      : period === "year" ? { month: "short" } : { day: "numeric", month: "short" };
  try {
    return new Intl.DateTimeFormat(locale, { ...options, timeZone: dateOnly ? "UTC" : timeZone || "UTC" }).format(date);
  } catch {
    return new Intl.DateTimeFormat(locale, { ...options, timeZone: "UTC" }).format(date);
  }
}

export function energyQuery(date, period = "day") {
  const params = new URLSearchParams({ period: ENERGY_PERIODS.includes(period) ? period : "day" });
  if (energyDate(date)) params.set("date", date);
  return `api/energy?${params}`;
}

export function energyFieldsForSources(sources = []) {
  const configured = new Set(sources.map((source) => source.kind));
  return ENERGY_FIELDS.filter((field) => field === "home" || configured.has(field));
}

export function energyChart(series = [], allowedFields = ENERGY_FIELDS) {
  const fields = allowedFields.filter((field) => series.some((row) => energyNumber(row[field]) !== null));
  const max = Math.max(0, ...series.flatMap((row) => fields.map((field) => Math.abs(energyNumber(row[field]) ?? 0))));
  return { fields, max, empty: fields.length === 0 };
}

export function energyBar(value, max) {
  const number = energyNumber(value);
  return number === null ? null : max > 0 ? Math.min(100, Math.abs(number) / max * 100) : 0;
}

export function energyDeviceValue(row) {
  return energyNumber(Object.hasOwn(row ?? {}, "exclusive_value") ? row.exclusive_value : row?.value);
}

export function energySourceCostVisible(source, sources = [source]) {
  if (source.cost_configured === false) return false;
  return source.cost_configured === true || sources.some((item) => energyNumber(item.cost) !== null);
}

export function energyHasStatistics(data) {
  return Object.values(data?.totals ?? {}).some((value) => energyNumber(value) !== null)
    || (data?.series ?? []).some((row) => ENERGY_FIELDS.some((field) => energyNumber(row[field]) !== null))
    || [...(data?.sources ?? []), ...(data?.devices ?? []), ...(data?.water_devices ?? [])].some((row) => energyNumber(row.value) !== null);
}

export function energyWarnings(data) {
  const warnings = [...(data?.warnings ?? [])];
  const measured = [...(data?.sources ?? []), ...(data?.devices ?? []), ...(data?.water_devices ?? [])];
  const fields = energyChart(data?.series ?? [], energyFieldsForSources(data?.sources ?? [])).fields;
  const missing = data?.configured && (!energyHasStatistics(data)
    || measured.some((source) => energyNumber(source.value) === null
      || Object.hasOwn(source, "exclusive_value") && energyNumber(source.exclusive_value) === null)
    || (data?.series ?? []).some((row) => fields.some((field) => energyNumber(row[field]) === null)));
  if (missing && !warnings.some((warning) => warning.code === "missing_statistics")) {
    warnings.push({ id: "client-missing-statistics", code: "missing_statistics" });
  }
  const negative = ENERGY_FIELDS.some((field) => energyNumber(data?.totals?.[field]) < 0)
    || (data?.series ?? []).some((row) => ENERGY_FIELDS.some((field) => energyNumber(row[field]) < 0));
  if (negative && !warnings.some((warning) => warning.code === "negative_balance")) {
    warnings.push({ id: "client-negative-balance", code: "negative_balance" });
  }
  return warnings;
}

function checkResponse(data) {
  if (data?.error) throw new Error(String(data.error));
  if (!data || typeof data.configured !== "boolean"
    || (data.configured && (!energyDate(data.range?.date) || !ENERGY_PERIODS.includes(data.range?.period)
      || !data.totals || typeof data.totals !== "object" || Array.isArray(data.totals)
      || !["series", "sources", "devices", "warnings"].every((key) => Array.isArray(data[key]))
      || data.water_devices != null && !Array.isArray(data.water_devices)))) {
    throw new Error("energy_invalid_response");
  }
  const prices = data.prices;
  if (prices != null && (!energyDate(prices.date) || energyNumber(prices.start) === null || energyNumber(prices.end) === null
    || prices.end <= prices.start || !Array.isArray(prices.slots)
    || prices.slots.some((slot) => energyNumber(slot?.start) === null || energyNumber(slot?.end) === null || energyNumber(slot?.value) === null
      || slot.start < prices.start || slot.end > prices.end || slot.end <= slot.start)
    || prices.slots.length && (typeof prices.unit !== "string" || !prices.unit.trim())
    || prices.ev?.hours != null && (energyNumber(prices.ev.hours) === null || prices.ev.hours < 0))) {
    throw new Error("energy_invalid_response");
  }
  return data;
}

/** Latest-request-wins loader. Clock and mounting are injected so lifecycle/races need no DOM in tests. */
export function createEnergyClient({ load, onChange = () => {}, date = null, period = "day", clock = globalThis, isMounted = () => true, getToday = () => null }) {
  let state = { date: energyDate(date), period: ENERGY_PERIODS.includes(period) ? period : "day", data: null, loading: false, error: null, stale: false };
  let current = null;
  let timer = null;
  let destroyed = false;
  let started = false;

  const emit = () => { if (!destroyed) onChange({ ...state }); };
  const cancel = () => {
    current?.abort();
    current = null;
  };

  async function refresh() {
    if (destroyed) return;
    cancel();
    const request = new AbortController();
    current = request;
    const date = clampEnergyDate(state.date, getToday());
    if (date !== state.date) state = { ...state, date, data: null, error: null, stale: false };
    state = { ...state, loading: true, error: null };
    emit();
    try {
      const data = checkResponse(await load(energyQuery(state.date, state.period), { signal: request.signal }));
      if (destroyed || current !== request) return;
      state = {
        ...state, data, loading: false, error: null, stale: false,
        date: energyDate(data.range?.date) ?? state.date,
        period: ENERGY_PERIODS.includes(data.range?.period) ? data.range.period : state.period,
      };
    } catch (error) {
      if (destroyed || current !== request) return;
      if (error?.name === "AbortError" && request.signal.aborted) return;
      state = { ...state, loading: false, error: error?.message || String(error), stale: Boolean(state.data) };
    } finally {
      if (!destroyed && current === request) {
        current = null;
        emit();
      }
    }
  }

  return {
    getState: () => ({ ...state }),
    start() {
      if (destroyed || started) return;
      started = true;
      timer = clock.setInterval(() => { if (isMounted() && !state.loading) void refresh(); }, ENERGY_REFRESH_MS);
      return refresh();
    },
    refresh,
    select(nextDate, nextPeriod = state.period) {
      if (destroyed || !ENERGY_PERIODS.includes(nextPeriod)) return;
      const next = clampEnergyDate(nextDate, getToday());
      if (next === state.date && nextPeriod === state.period) return refresh();
      cancel();
      state = { ...state, date: next, period: nextPeriod, data: null, loading: false, error: null, stale: false };
      return refresh();
    },
    stop() {
      cancel();
      if (timer !== null) clock.clearInterval(timer);
      timer = null;
      started = false;
      state = { ...state, loading: false };
    },
    destroy() {
      destroyed = true;
      cancel();
      if (timer !== null) clock.clearInterval(timer);
      timer = null;
    },
  };
}
