const badRequest = (message) => Object.assign(new Error(message), { status: 400 });
const DAY_MS = 24 * 60 * 60_000;
export const ENERGY_PERIODS = ["day", "week", "month", "year"];

export function energyDate(value, timeZone) {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(value);
  const get = (key) => parts.find((part) => part.type === key).value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function parseDay(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw badRequest("Choose a valid Energy date (YYYY-MM-DD).");
  const date = new Date(`${value}T00:00:00Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value || date.getUTCFullYear() < 1970) throw badRequest("Choose a valid Energy date (YYYY-MM-DD).");
  return date;
}

export function energyMidnight(day, timeZone) {
  const target = parseDay(day).getTime();
  const format = new Intl.DateTimeFormat("en-GB", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  });
  let instant = target;
  for (let i = 0; i < 4; i++) {
    const parts = Object.fromEntries(format.formatToParts(instant).filter((part) => part.type !== "literal").map((part) => [part.type, Number(part.value)]));
    const local = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
    const delta = target - local;
    if (!delta) return new Date(instant);
    instant += delta;
  }
  throw badRequest("This Energy date has no midnight in Home Assistant's time zone.");
}

export function energyWindow({ date, period = "day", timeZone, now = Date.now() }) {
  if (!ENERGY_PERIODS.includes(period)) throw badRequest("Energy period must be day, week, month or year.");
  const today = energyDate(now, timeZone);
  const anchor = date == null || date === "" ? today : date;
  const startDay = parseDay(anchor);
  if (anchor > today) throw badRequest("Energy dates cannot be in the future.");
  if (period === "week") startDay.setUTCDate(startDay.getUTCDate() - (startDay.getUTCDay() + 6) % 7);
  else if (period === "month") startDay.setUTCDate(1);
  else if (period === "year") startDay.setUTCMonth(0, 1);
  const endDay = new Date(startDay);
  if (period === "day" || period === "week") endDay.setUTCDate(endDay.getUTCDate() + (period === "week" ? 7 : 1));
  else if (period === "month") endDay.setUTCMonth(endDay.getUTCMonth() + 1);
  else endDay.setUTCFullYear(endDay.getUTCFullYear() + 1);
  const first = startDay.toISOString().slice(0, 10);
  const last = new Date(endDay.getTime() - DAY_MS).toISOString().slice(0, 10);
  return {
    date: anchor, period, first, last,
    start: energyMidnight(first, timeZone).toISOString(),
    end: energyMidnight(endDay.toISOString().slice(0, 10), timeZone).toISOString(),
    statistic_period: period === "day" ? "hour" : period === "year" ? "month" : "day",
  };
}
