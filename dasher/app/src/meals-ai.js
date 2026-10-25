import { WEEKDAYS, addDays, isDate, normalizeEntry, normalizeName, weekdayIndex } from "./meals.js";

/*
 * Meal planning with Home Assistant's AI Task (`ai_task.generate_data`). The model is asked for JSON as text, then
 * every plan is checked against the family's rules here (it is not trusted to keep them): what is wrong is sent back
 * up to twice and the best try is kept.
 */

const LANGUAGE_NAMES = { da: "Danish", en: "English", de: "German", sv: "Swedish", nb: "Norwegian", nl: "Dutch" };
const MAX_ATTEMPTS = 3;
const REPEAT_TITLE_DAYS = 28;
const REPEAT_MAIN_DAYS = 7;
const AI_TIMEOUT_MS = 240_000;

/** The JSON object in a model answer, also when it is wrapped in a code fence or has text around it. */
export function extractJson(value) {
  if (value && typeof value === "object") return value;
  const raw = String(value ?? "");
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(raw);
  const body = fenced ? fenced[1] : raw;
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("The AI did not answer with JSON.");
  try {
    return JSON.parse(body.slice(start, end + 1));
  } catch {
    throw new Error("The AI answer could not be read as JSON.");
  }
}

const words = (list) =>
  String(list ?? "")
    .split(/[,;\n]+/)
    .map((w) => normalizeName(w))
    .filter((w) => w.length >= 3);

const dateRange = (start, days) => Array.from({ length: days }, (_, i) => addDays(start, i));

/** Titles of the dishes before `before` within `window` days, newest last: [{ date, title, key, main }]. */
export function recentDishes(daysMap, before, window) {
  const from = addDays(before, -window);
  return [...daysMap.values()]
    .filter((d) => d.date >= from && d.date < before && d.kind === "dinner")
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((d) => ({ date: d.date, title: d.title, key: normalizeName(d.title), main: normalizeName(d.main_ingredient) }));
}

/** Favourites that should be on the plan: "week" always, "2weeks" and "month" when not made within that time. */
export function dueFavourites(favourites, daysMap, start) {
  const spans = { "2weeks": 14, month: 28 };
  return favourites.filter((f) => {
    if (f.every === "week") return true;
    const span = spans[f.every];
    if (!span) return false;
    const key = normalizeName(f.name);
    return !recentDishes(daysMap, start, span).some((d) => d.key.includes(key));
  });
}

/**
 * Check a plan (skeleton days from the AI) against the rules.
 * Returns violations [{ date, code, message }]; `date` is null for the plan as a whole.
 */
export function validatePlan({ days, dates, skip = [], prefs, ratings = new Map(), history = [], household = 4 }) {
  const out = [];
  const skipSet = new Set(skip);
  const wanted = dates.filter((d) => !skipSet.has(d));
  const byDate = new Map(days.map((d) => [d.date, d]));
  const add = (date, code, message) => out.push({ date, code, message });

  for (const date of wanted) if (!byDate.has(date)) add(date, "missing", `${date} has no dinner.`);
  for (const d of days) if (!dates.includes(d.date)) add(d.date, "extra", `${d.date} is outside the plan.`);
  for (const date of skipSet) if (byDate.get(date)?.kind === "dinner") add(date, "skipped", `${date} must be skipped, no dinner.`);

  const dinners = days.filter((d) => d.kind === "dinner" && wanted.includes(d.date));
  const disliked = [...ratings.values()].filter((r) => r.rating === "dislike").map((r) => normalizeName(r.name));
  const avoid = [...words(prefs.avoid), ...words(prefs.allergies)];

  for (const d of dinners) {
    const key = normalizeName(d.title);
    const haystack = `${key} ${normalizeName(d.description)} ${normalizeName(d.main_ingredient)}`;
    for (const bad of disliked) if (bad && haystack.includes(bad)) add(d.date, "disliked", `${d.title} is a disliked dish (${bad}).`);
    for (const bad of avoid) if (haystack.includes(bad)) add(d.date, "avoid", `${d.title} contains something to avoid (${bad}).`);
    const earlier = history.filter((h) => h.date >= addDays(d.date, -REPEAT_TITLE_DAYS));
    if (earlier.some((h) => h.key === key)) add(d.date, "repeat", `${d.title} was on a recent plan.`);
    if (prefs.max_minutes_weekday && weekdayIndex(d.date) < 5 && d.minutes > prefs.max_minutes_weekday) {
      add(d.date, "time", `${d.title} takes ${d.minutes} min, the weekday limit is ${prefs.max_minutes_weekday}.`);
    }
  }

  // the same main ingredient within a week (history and the plan itself)
  const seen = [...history.map((h) => ({ date: h.date, main: h.main })), ...dinners.map((d) => ({ date: d.date, main: normalizeName(d.main_ingredient) }))];
  for (const d of dinners) {
    const main = normalizeName(d.main_ingredient);
    if (!main) continue;
    const clash = seen.find((s) => s.main === main && s.date !== d.date && Math.abs(Date.parse(s.date) - Date.parse(d.date)) / 86_400_000 < REPEAT_MAIN_DAYS && s.date < d.date);
    if (clash) add(d.date, "main", `${d.title}: ${d.main_ingredient} was the main ingredient on ${clash.date} too.`);
  }

  for (const [day, fixed] of Object.entries(prefs.fixed_days ?? {})) {
    const index = WEEKDAYS.indexOf(day);
    for (const date of wanted.filter((x) => weekdayIndex(x) === index)) {
      const d = byDate.get(date);
      if (d && !normalizeName(`${d.title} ${d.description}`).includes(normalizeName(fixed))) add(date, "fixed", `${date} should be: ${fixed}.`);
    }
  }

  if (prefs.vegetarian_days > 0) {
    const veg = dinners.filter((d) => d.vegetarian).length;
    const needed = Math.min(prefs.vegetarian_days, Math.round((wanted.length / 7) * prefs.vegetarian_days) || 1);
    if (veg < needed) add(null, "vegetarian", `The plan has ${veg} vegetarian dinners, ${needed} are wanted.`);
  }

  const leftovers = days.filter((d) => d.kind === "leftovers" && wanted.includes(d.date));
  if (leftovers.length > Math.max(prefs.leftover_days, 0) * Math.ceil(wanted.length / 7)) add(null, "leftovers", `Too many leftover days: ${leftovers.length}.`);
  for (const d of leftovers) {
    const source = byDate.get(d.from);
    if (!source || source.kind !== "dinner" || !source.double_portion || source.date >= d.date) add(d.date, "leftover_source", `${d.date} is leftovers but ${d.from ?? "no day"} is not an earlier double portion.`);
  }
  return out;
}

// ---- prompts -----------------------------------------------------------------------------------------

const header = (task, language) => `[dasher:${task}]\nYou are a practical Danish-home meal planner. Write all text values in ${LANGUAGE_NAMES[language] ?? language}. Answer with one JSON object and nothing else, no markdown.`;

function rulesText(prefs, household, ratings) {
  const lines = [`Household: ${household} servings per dinner.`];
  if (prefs.vegetarian_days) lines.push(`At least ${prefs.vegetarian_days} vegetarian dinners per week.`);
  if (prefs.leftover_days) lines.push(`Up to ${prefs.leftover_days} leftover day(s) per week: a dinner with double_portion true, followed by a day of kind "leftovers" with "from" set to that dinner's date.`);
  if (prefs.max_minutes_weekday) lines.push(`Monday to Friday dinners take at most ${prefs.max_minutes_weekday} minutes.`);
  if (prefs.allergies) lines.push(`ALLERGIES, never use: ${prefs.allergies}.`);
  if (prefs.avoid) lines.push(`Avoid: ${prefs.avoid}.`);
  for (const [day, fixed] of Object.entries(prefs.fixed_days ?? {})) lines.push(`Every ${day}: ${fixed}.`);
  const disliked = [...ratings.values()].filter((r) => r.rating === "dislike").map((r) => r.name);
  if (disliked.length) lines.push(`Never suggest these disliked dishes: ${disliked.join(", ")}.`);
  const liked = [...ratings.values()].filter((r) => r.rating !== "dislike").map((r) => r.name);
  if (liked.length) lines.push(`The family likes (use as inspiration when they fit): ${liked.slice(0, 25).join(", ")}.`);
  for (const note of prefs.notes ?? []) lines.push(`Always remember: ${note}`);
  return lines.join("\n");
}

export function buildPlanPrompt({ language, dates, skip, prefs, household, ratings, history, due, wishes, surprise, feedback }) {
  const wanted = dates.filter((d) => !skip.includes(d));
  const lines = [
    header("plan", language),
    "",
    `Plan dinners for these dates (weekday in brackets): ${dates.map((d) => `${d} (${WEEKDAYS[weekdayIndex(d)]})`).join(", ")}.`,
    skip.length ? `Do NOT plan a dinner for: ${skip.join(", ")} (nobody eats at home).` : "",
    "",
    rulesText(prefs, household, ratings),
    due.length ? `These favourites must be on the plan: ${due.map((f) => f.name).join(", ")}.` : "",
    history.length ? `Dishes from the last weeks, do not repeat them (the main ingredient counts: salmon is salmon): ${history.map((h) => `${h.title}`).join("; ")}.` : "",
    wishes ? `Wishes for this plan: ${wishes}` : "",
    surprise ? "Surprise the family: dishes from other cuisines they have never had, exciting flavours and surprising combinations, still within every rule above." : "Vary the dinners: different main ingredients and cuisines, mostly everyday dishes a family cooks.",
    feedback?.length ? `\nYour previous answer broke these rules, fix them and keep everything else that was fine:\n${feedback.map((f) => `- ${f}`).join("\n")}` : "",
    "",
    `Return {"days":[...]} with exactly one object for each of the ${wanted.length} dates to plan:`,
    `{"date":"YYYY-MM-DD","kind":"dinner"|"leftovers","title":"short dish name","description":"one sentence","minutes":number,"vegetarian":boolean,"double_portion":boolean,"main_ingredient":"the main protein or vegetable, one word","from":"YYYY-MM-DD or null"}`,
  ];
  return lines.filter((l) => l !== "").join("\n");
}

export function buildRecipePrompt({ language, entry, household, prefs }) {
  return [
    header("recipe", language),
    "",
    `Write the recipe for the dinner "${entry.title}"${entry.description ? ` (${entry.description})` : ""} for ${entry.double_portion ? household * 2 : household} servings.`,
    entry.minutes ? `Target time: about ${entry.minutes} minutes.` : "",
    entry.vegetarian ? "It must be vegetarian." : "",
    prefs.allergies ? `ALLERGIES, never use: ${prefs.allergies}.` : "",
    prefs.avoid ? `Avoid: ${prefs.avoid}.` : "",
    `Return {"servings":number,"minutes":number,"vegetarian":boolean,"ingredients":[{"name":"ingredient","amount":"400 g"}],"steps":["step text"],"tip":"one short tip or empty"}.`,
    'Use metric units. List salt, oil, butter, spices and other pantry basics too, with "basic":true on them. Keep steps short and in order.',
  ]
    .filter(Boolean)
    .join("\n");
}

export function buildAlternativesPrompt({ language, entry, prefs, household, ratings, history, plannedTitles }) {
  return [
    header("alternatives", language),
    "",
    `Suggest 3 other dinners to replace "${entry.title}" on ${entry.date} (${WEEKDAYS[weekdayIndex(entry.date)]}). They must differ from each other and from: ${[...plannedTitles, ...history.map((h) => h.title)].slice(0, 40).join("; ") || "nothing"}.`,
    "",
    rulesText(prefs, household, ratings),
    `Return {"alternatives":[{"title":"short dish name","description":"one sentence","minutes":number,"vegetarian":boolean,"main_ingredient":"one word"}]}.`,
  ].join("\n");
}

// ---- orchestration -----------------------------------------------------------------------------------

/** Words from allergies/avoid found in an entry's ingredients, as warnings for the day. */
export function allergenWarnings(entry, prefs) {
  const bad = [...words(prefs.allergies), ...words(prefs.avoid)];
  const hay = entry.ingredients.map((i) => normalizeName(i.name));
  return [...new Set(bad.filter((b) => hay.some((h) => h.includes(b))))].map((b) => `Contains ${b}, which is on the allergy/avoid list. Check before cooking.`);
}

export class MealsAI {
  /** `resolveEntity()` gives the ai_task entity to use (or null when there is none). */
  constructor({ ha, store, logger, resolveEntity, settings = () => ({}) }) {
    this.ha = ha;
    this.store = store;
    this.log = logger;
    this.resolveEntity = resolveEntity;
    this.settings = settings;
  }

  get language() {
    return this.settings().language ?? "da";
  }

  get household() {
    return this.settings().household ?? 4;
  }

  get available() {
    return Boolean(this.resolveEntity());
  }

  async _ask(task, instructions) {
    const entityId = this.resolveEntity();
    if (!entityId) throw Object.assign(new Error("No AI Task entity is set up in Home Assistant."), { status: 503 });
    const response = await this.ha.callServiceWithResponse("ai_task", "generate_data", { task_name: `Madplan ${task}`, instructions, entity_id: entityId }, undefined, { timeoutMs: AI_TIMEOUT_MS });
    return extractJson(response?.data);
  }

  _ratings() {
    return new Map([...this.store.ratings].map(([k, v]) => [k, v]));
  }

  /** Make a plan for `days` days from `start`; resolves when the dinners are stored (recipes follow in the job). */
  async generatePlan({ start, days = 7, skip = [], wishes = "", surprise = false }) {
    if (this.store.job.status === "running") throw Object.assign(new Error("A plan is already being made."), { status: 409 });
    if (!isDate(start)) throw Object.assign(new Error("Choose a start day."), { status: 400 });
    days = Math.min(14, Math.max(1, Number(days) || 7));
    const dates = dateRange(start, days);
    skip = skip.filter((d) => dates.includes(d));
    const prefs = this.store.prefs;
    const ratings = this._ratings();
    const history = recentDishes(this.store.days, start, REPEAT_TITLE_DAYS);
    const due = dueFavourites(prefs.favourites, this.store.days, start);
    this.store.setJob({ status: "running", message: "plan" });
    try {
      let best = null;
      let feedback = [];
      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        this.store.setJob({ status: "running", message: attempt === 1 ? "plan" : "fix" });
        const prompt = buildPlanPrompt({ language: this.language, dates, skip, prefs, household: this.household, ratings, history, due, wishes, surprise, feedback });
        const answer = await this._ask("plan", prompt);
        const skeleton = (Array.isArray(answer?.days) ? answer.days : []).map((d) => normalizeEntry({ ...d, source: "ai", servings: this.household }, d?.date)).filter(Boolean);
        const violations = validatePlan({ days: skeleton, dates, skip, prefs, ratings, history, household: this.household });
        if (!best || violations.length < best.violations.length) best = { skeleton, violations };
        if (!violations.length) break;
        feedback = violations.map((v) => v.message);
        this.log.info(`Meal plan attempt ${attempt}: ${violations.length} rule(s) broken`);
      }
      if (!best.skeleton.length) throw new Error("The AI gave no dinners.");

      const entries = best.skeleton.filter((d) => dates.includes(d.date) && !skip.includes(d.date));
      for (const e of entries) {
        const own = best.violations.filter((v) => v.date === e.date || v.date === null).map((v) => v.message);
        if (own.length) e.warnings = own.slice(0, 4);
      }
      for (const date of skip) entries.push({ date, kind: "skip", title: "" });
      this.store.setDays(entries, dates);

      const todo = entries.filter((e) => e.kind === "dinner");
      let done = 0;
      const queue = [...todo];
      const worker = async () => {
        while (queue.length) {
          const e = queue.shift();
          try {
            await this.writeRecipe(e.date, { quiet: true });
          } catch (err) {
            this.log.warn(`Recipe for ${e.date} failed: ${err.message}`);
          }
          done += 1;
          this.store.setJob({ status: "running", message: "recipes", progress: `${done}/${todo.length}` });
        }
      };
      this.store.setJob({ status: "running", message: "recipes", progress: `0/${todo.length}` });
      await Promise.all([worker(), worker()]);
      this.store.setJob({ status: "ready", message: best.violations.length ? "ready_with_warnings" : "ready" });
      return { days: entries.length, violations: best.violations };
    } catch (err) {
      this.log.warn(`Meal plan failed: ${err.message}`);
      this.store.setJob({ status: "error", error: err.message });
      throw err;
    }
  }

  /** Write (or rewrite) the recipe of a day's dinner. */
  async writeRecipe(date, { quiet = false } = {}) {
    const entry = this.store.days.get(date);
    if (!entry || entry.kind !== "dinner") throw Object.assign(new Error("There is no dinner on that day."), { status: 400 });
    const track = !quiet && this.store.job.status !== "running";
    if (track) this.store.setJob({ status: "running", message: "recipe" });
    try {
      const answer = await this._ask("recipe", buildRecipePrompt({ language: this.language, entry, household: this.household, prefs: this.store.prefs }));
      const next = normalizeEntry({ ...entry, servings: answer.servings ?? entry.servings, minutes: answer.minutes ?? entry.minutes, vegetarian: answer.vegetarian ?? entry.vegetarian, ingredients: answer.ingredients, steps: answer.steps, tip: answer.tip, source: entry.source === "manual" ? "manual" : "ai" }, date);
      if (!next?.ingredients.length || !next.steps.length) throw new Error("The recipe was empty.");
      const warnings = [...(entry.warnings ?? []).filter((w) => !w.startsWith("Contains ")), ...allergenWarnings(next, this.store.prefs)];
      this.store.setDay(date, { ...next, ...(warnings.length ? { warnings } : {}) });
      if (track) this.store.setJob({ status: "ready", message: "ready" });
    } catch (err) {
      if (track) this.store.setJob({ status: "error", error: err.message });
      throw err;
    }
  }

  /** Three other dishes for a day. */
  async alternatives(date) {
    const entry = this.store.days.get(date);
    if (!entry) throw Object.assign(new Error("There is no dinner on that day."), { status: 400 });
    const history = recentDishes(this.store.days, date, REPEAT_TITLE_DAYS);
    const planned = [...this.store.days.values()].filter((d) => d.kind === "dinner" && Math.abs(Date.parse(d.date) - Date.parse(date)) <= 7 * 86_400_000).map((d) => d.title);
    const answer = await this._ask("alternatives", buildAlternativesPrompt({ language: this.language, entry, prefs: this.store.prefs, household: this.household, ratings: this._ratings(), history, plannedTitles: planned }));
    const list = (Array.isArray(answer?.alternatives) ? answer.alternatives : []).map((a) => normalizeEntry({ ...a, date, kind: "dinner", source: "ai", servings: this.household }, date)).filter(Boolean);
    return list.slice(0, 3).map(({ title, description, minutes, vegetarian, main_ingredient }) => ({ title, description, minutes, vegetarian, main_ingredient }));
  }
}
