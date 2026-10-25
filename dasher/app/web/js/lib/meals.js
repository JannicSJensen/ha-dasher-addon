const pad = (n) => String(n).padStart(2, "0");

export const todayLocal = (now = new Date()) => `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;

export function addDays(date, n) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** 0 = Monday ... 6 = Sunday */
export const weekdayIndex = (date) => (new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7;
export const mondayOf = (date) => addDays(date, -weekdayIndex(date));

/** Local noon of a "YYYY-MM-DD" date, for formatting with Intl. */
export const dateObject = (date) => {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(y, m - 1, d, 12);
};

/** The weeks to show: [{ monday, dates }], from the week of `from` for `weeks` weeks. */
export function weeksFrom(from, weeks) {
  const first = mondayOf(from);
  return Array.from({ length: weeks }, (_, i) => {
    const monday = addDays(first, i * 7);
    return { monday, dates: Array.from({ length: 7 }, (_, d) => addDays(monday, d)) };
  });
}

/** Today's dinner and the next one: { today, tomorrow } as entries or null. */
export function tonight(days, now = new Date()) {
  const today = todayLocal(now);
  const dinnerOn = (date) => (days[date]?.kind === "dinner" || days[date]?.kind === "leftovers" ? days[date] : null);
  return { today: dinnerOn(today), tomorrow: dinnerOn(addDays(today, 1)) };
}

// ---- ingredients -----------------------------------------------------------------------------------

const UNITS = {
  g: ["g", 1, "mass"], gram: ["g", 1, "mass"], kg: ["g", 1000, "mass"],
  ml: ["ml", 1, "volume"], cl: ["ml", 10, "volume"], dl: ["ml", 100, "volume"], l: ["ml", 1000, "volume"], liter: ["ml", 1000, "volume"],
  tsk: ["tsk", 1, "tsk"], teskefuld: ["tsk", 1, "tsk"], spsk: ["spsk", 1, "spsk"], spiseskefuld: ["spsk", 1, "spsk"],
  stk: ["stk", 1, "count"], "stk.": ["stk", 1, "count"], fed: ["fed", 1, "fed"], bundt: ["bundt", 1, "bundt"], dåse: ["dåse", 1, "dåse"], dåser: ["dåse", 1, "dåse"], pose: ["pose", 1, "pose"], poser: ["pose", 1, "pose"],
};

/** "400 g", "1,5 dl", "2 stk." -> { value: 400, unit: "g", family: "mass" }; null when there is no number. */
export function parseAmount(text) {
  const m = /^\s*(\d+\s*\/\s*\d+|\d+(?:[.,]\d+)?|½|¼|¾)\s*([^\d\s][^\s]*)?/.exec(String(text ?? ""));
  if (!m) return null;
  const fractions = { "½": 0.5, "¼": 0.25, "¾": 0.75 };
  let value;
  if (fractions[m[1]]) value = fractions[m[1]];
  else if (m[1].includes("/")) {
    const [a, b] = m[1].split("/").map((x) => Number(x.trim()));
    value = b ? a / b : NaN;
  } else value = Number(m[1].replace(",", "."));
  if (!Number.isFinite(value)) return null;
  const raw = (m[2] ?? "").toLowerCase();
  const known = UNITS[raw];
  if (known) return { value: value * known[1], unit: known[0], family: known[2] };
  return { value, unit: raw, family: raw ? `other:${raw}` : "count" };
}

/** 1500 g -> "1,5 kg", 250 ml -> "2,5 dl" ... in Danish style. */
export function formatAmount(value, unit) {
  const trim = (n) => String(Math.round(n * 10) / 10).replace(".", ",");
  if (unit === "g") return value >= 1000 ? `${trim(value / 1000)} kg` : `${trim(value)} g`;
  if (unit === "ml") return value >= 1000 ? `${trim(value / 1000)} l` : value >= 100 ? `${trim(value / 100)} dl` : `${trim(value)} ml`;
  return `${trim(value)}${unit && unit !== "stk" ? ` ${unit}` : unit === "stk" ? " stk" : ""}`;
}

export const normalizeName = (value) =>
  String(value ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9æøå ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/**
 * One row per ingredient of the given entries, amounts of the same kind added up (400 g + 300 g = 700 g).
 * Returns [{ key, name, amount, basic, dates, count }]; basics (salt, oil ...) have `basic: true`.
 */
export function aggregateIngredients(entries) {
  const rows = new Map();
  for (const entry of entries) {
    if (entry.kind !== "dinner") continue;
    for (const ing of entry.ingredients ?? []) {
      const parsed = parseAmount(ing.amount);
      const name = normalizeName(ing.name);
      if (!name) continue;
      const family = parsed?.family ?? "none";
      const key = `${name}|${family}`;
      const row = rows.get(key) ?? { key, name: ing.name, value: 0, unit: parsed?.unit ?? "", hasAmount: Boolean(parsed), basic: Boolean(ing.basic), dates: [], count: 0, free: [] };
      if (parsed) row.value += parsed.value;
      else if (ing.amount) row.free.push(ing.amount);
      row.basic = row.basic && Boolean(ing.basic);
      if (!row.dates.includes(entry.date)) row.dates.push(entry.date);
      row.count += 1;
      rows.set(key, row);
    }
  }
  return [...rows.values()]
    .map(({ value, unit, hasAmount, free, ...row }) => ({ ...row, amount: hasAmount ? formatAmount(value, unit) : free[0] ?? "" }))
    .sort((a, b) => Number(a.basic) - Number(b.basic) || a.name.localeCompare(b.name));
}

/** True when an ingredient is already on the shopping list (a list item that contains its name or the other way round). */
export function onList(name, items) {
  const n = normalizeName(name);
  if (n.length < 3) return false;
  return items.some((item) => {
    const i = normalizeName(item.summary ?? item);
    return i === n || i.includes(n) || (i.length >= 3 && n.includes(i));
  });
}

/** The text put on the shopping list: "Laks (500 g)". */
export const listItemText = (row) => (row.amount ? `${row.name} (${row.amount})` : row.name);

/** Seconds of a "simmer for 20 minutes" step, or null. */
export function stepTimer(step) {
  const m = /(\d+(?:[.,]\d+)?)\s*(?:-\s*\d+\s*)?(min(?:utter|ute|utes|\.)?|timer?|hours?)\b/i.exec(String(step ?? ""));
  if (!m) return null;
  const value = Number(m[1].replace(",", "."));
  const hours = /^(time|timer|hour)/i.test(m[2]);
  return Math.round(value * (hours ? 3600 : 60));
}

export const clockText = (seconds) => `${Math.floor(seconds / 60)}:${pad(Math.floor(seconds % 60))}`;
