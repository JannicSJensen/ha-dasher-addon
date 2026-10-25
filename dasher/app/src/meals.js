import { EventEmitter } from "node:events";
import fs from "node:fs";
import path from "node:path";

/*
 * The meal plan (Madplan): dinners per day, the family's rules and ratings. Kept in the app's data folder
 * (meals.json), so it is shared by all tablets and included in Home Assistant's backups.
 */

export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export const KINDS = ["dinner", "leftovers", "eatout", "skip"];
export const WEEKDAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
export const FAVOURITE_EVERY = ["week", "2weeks", "month", "inspiration"];
export const RATINGS = ["like", "dislike", "favourite"];
const KEEP_DAYS = 120;
const SAVE_DELAY_MS = 500;

const text = (value, max) => String(value ?? "").replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, " ").replace(/[ \t]+/g, " ").trim().slice(0, max);
const int = (value, min, max, fallback) => {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};

export const isDate = (value) => typeof value === "string" && DATE_RE.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));

/** Add days to a "YYYY-MM-DD" date (calendar arithmetic, no time zones). */
export function addDays(date, n) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** 0 = Monday ... 6 = Sunday */
export const weekdayIndex = (date) => (new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7;

export const todayLocal = (now = new Date()) => `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;

/** A dish name made comparable: lower case, no accents or punctuation, single spaces. */
export const normalizeName = (value) =>
  String(value ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9æøå ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

function normalizeIngredients(list) {
  const out = [];
  for (const item of Array.isArray(list) ? list : []) {
    const name = text(typeof item === "string" ? item : item?.name, 80);
    if (!name) continue;
    out.push({ name, amount: text(typeof item === "object" ? item?.amount : "", 40), ...(item?.basic ? { basic: true } : {}) });
    if (out.length >= 60) break;
  }
  return out;
}

/** A day's entry as stored: every field checked and shortened. Returns null when it has no usable title. */
export function normalizeEntry(raw, date) {
  if (!raw || typeof raw !== "object" || !isDate(date)) return null;
  const kind = KINDS.includes(raw.kind) ? raw.kind : "dinner";
  const title = text(raw.title, 120);
  if (!title && (kind === "dinner" || kind === "leftovers")) return null;
  const steps = (Array.isArray(raw.steps) ? raw.steps : []).map((s) => text(typeof s === "string" ? s : s?.text, 600)).filter(Boolean).slice(0, 40);
  return {
    date,
    kind,
    title,
    description: text(raw.description, 400),
    servings: int(raw.servings, 1, 20, 4),
    minutes: int(raw.minutes, 0, 600, 0),
    vegetarian: Boolean(raw.vegetarian),
    double_portion: Boolean(raw.double_portion),
    main_ingredient: text(raw.main_ingredient, 60),
    from: isDate(raw.from) ? raw.from : null,
    ingredients: normalizeIngredients(raw.ingredients),
    steps,
    tip: text(raw.tip, 400),
    source: ["manual", "ai"].includes(raw.source) ? raw.source : "manual",
    ...(Array.isArray(raw.warnings) && raw.warnings.length ? { warnings: raw.warnings.map((w) => text(w, 200)).filter(Boolean).slice(0, 8) } : {}),
  };
}

export const DEFAULT_PREFS = {
  vegetarian_days: 0,
  leftover_days: 0,
  max_minutes_weekday: 0,
  avoid: "",
  allergies: "",
  fixed_days: {},
  favourites: [],
  notes: [],
};

export function normalizePrefs(raw) {
  const r = raw && typeof raw === "object" ? raw : {};
  const fixed = {};
  for (const day of WEEKDAYS) {
    const value = text(r.fixed_days?.[day], 80);
    if (value) fixed[day] = value;
  }
  const favourites = [];
  for (const f of Array.isArray(r.favourites) ? r.favourites : []) {
    const name = text(f?.name, 80);
    if (name) favourites.push({ name, every: FAVOURITE_EVERY.includes(f?.every) ? f.every : "inspiration" });
    if (favourites.length >= 30) break;
  }
  return {
    vegetarian_days: int(r.vegetarian_days, 0, 7, 0),
    leftover_days: int(r.leftover_days, 0, 4, 0),
    max_minutes_weekday: int(r.max_minutes_weekday, 0, 240, 0),
    avoid: text(r.avoid, 300),
    allergies: text(r.allergies, 300),
    fixed_days: fixed,
    favourites,
    notes: (Array.isArray(r.notes) ? r.notes : []).map((n) => text(n, 200)).filter(Boolean).slice(0, 20),
  };
}

export class MealsStore extends EventEmitter {
  constructor({ dir, logger }) {
    super();
    this.dir = dir;
    this.log = logger;
    this.days = new Map(); // date -> entry
    this.prefs = normalizePrefs({});
    this.ratings = new Map(); // normalized dish name -> { name, rating }
    this.job = { status: "idle", message: "", error: null, at: null };
    this._timer = null;
    this._load();
  }

  get file() {
    return this.dir ? path.join(this.dir, "meals.json") : null;
  }

  _load() {
    if (!this.file) return;
    try {
      const data = JSON.parse(fs.readFileSync(this.file, "utf8"));
      for (const [date, raw] of Object.entries(data.days ?? {})) {
        const entry = normalizeEntry(raw, date);
        if (entry) this.days.set(date, entry);
      }
      this.prefs = normalizePrefs(data.prefs);
      for (const item of Array.isArray(data.ratings) ? data.ratings : []) {
        const name = text(item?.name, 120);
        if (name && RATINGS.includes(item?.rating)) this.ratings.set(normalizeName(name), { name, rating: item.rating });
      }
    } catch {
      // first start, or an unreadable file: start empty
    }
  }

  _changed() {
    this._save();
    this.emit("change");
  }

  _save() {
    if (!this.file) return;
    clearTimeout(this._timer);
    this._timer = setTimeout(() => this.flush(), SAVE_DELAY_MS);
    this._timer.unref?.();
  }

  flush() {
    if (!this.file) return;
    clearTimeout(this._timer);
    try {
      const limit = addDays(todayLocal(), -KEEP_DAYS);
      for (const date of [...this.days.keys()]) if (date < limit) this.days.delete(date);
      fs.mkdirSync(this.dir, { recursive: true });
      const tmp = `${this.file}.tmp`;
      fs.writeFileSync(
        tmp,
        JSON.stringify({ days: Object.fromEntries([...this.days].sort(([a], [b]) => a.localeCompare(b))), prefs: this.prefs, ratings: [...this.ratings.values()] }, null, 1),
      );
      fs.renameSync(tmp, this.file);
    } catch (err) {
      this.log?.warn(`Could not save ${this.file}: ${err.message}`);
    }
  }

  /** Set a day (an entry) or clear it (null). Returns the stored entry or null. */
  setDay(date, raw) {
    if (!isDate(date)) return null;
    if (raw == null) {
      if (this.days.delete(date)) this._changed();
      return null;
    }
    const entry = normalizeEntry(raw, date);
    if (!entry) return null;
    this.days.set(date, entry);
    this._changed();
    return entry;
  }

  /** Replace several days at once (a new plan); `clear` lists dates to empty first. */
  setDays(entries, clear = []) {
    for (const date of clear) this.days.delete(date);
    const stored = [];
    for (const raw of entries) {
      const entry = normalizeEntry(raw, raw?.date);
      if (!entry) continue;
      this.days.set(entry.date, entry);
      stored.push(entry);
    }
    this._changed();
    return stored;
  }

  setPrefs(raw) {
    this.prefs = normalizePrefs(raw);
    this._changed();
    return this.prefs;
  }

  rate(name, rating) {
    const clean = text(name, 120);
    if (!clean) return false;
    const key = normalizeName(clean);
    if (rating == null) this.ratings.delete(key);
    else if (RATINGS.includes(rating)) this.ratings.set(key, { name: clean, rating });
    else return false;
    this._changed();
    return true;
  }

  ratingOf(name) {
    return this.ratings.get(normalizeName(name))?.rating ?? null;
  }

  setJob(job) {
    this.job = { status: "idle", message: "", error: null, at: new Date().toISOString(), ...job };
    this.emit("change");
  }

  /** Everything a tablet needs. */
  payload() {
    return {
      days: Object.fromEntries([...this.days].sort(([a], [b]) => a.localeCompare(b))),
      prefs: this.prefs,
      ratings: [...this.ratings.values()],
      job: this.job,
    };
  }
}
