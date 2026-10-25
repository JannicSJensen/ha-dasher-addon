import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { parseConfig } from "../src/config.js";
import { MealsAI, allergenWarnings, dueFavourites, extractJson, recentDishes, validatePlan } from "../src/meals-ai.js";
import { MealsStore, addDays, normalizeEntry, normalizePrefs, weekdayIndex } from "../src/meals.js";
import { MARKER, MealsCalendar, addMinutes, eventFor } from "../src/meals-sync.js";
import { aggregateIngredients, formatAmount, onList, parseAmount, stepTimer, tonight, weeksFrom } from "../web/js/lib/meals.js";

const silent = { warn() {}, info() {}, debug() {}, error() {} };
const MON = "2026-10-26"; // a Monday

test("dates: weekday index and day arithmetic", () => {
  assert.equal(weekdayIndex(MON), 0);
  assert.equal(weekdayIndex("2026-11-01"), 6);
  assert.equal(addDays(MON, 7), "2026-11-02");
  assert.equal(addDays("2026-10-31", 1), "2026-11-01");
  assert.deepEqual(weeksFrom("2026-10-28", 2).map((w) => w.monday), [MON, "2026-11-02"]);
});

test("normalizeEntry shortens, checks and defaults", () => {
  const e = normalizeEntry({ kind: "dinner", title: "  Laks  ", minutes: "35", servings: 99, ingredients: [{ name: "Laks", amount: "400 g" }, { name: "" }, "Løg"], steps: ["Steg", "  ", { text: "Server" }] }, MON);
  assert.deepEqual([e.title, e.minutes, e.servings, e.ingredients.length, e.steps], ["Laks", 35, 20, 2, ["Steg", "Server"]]);
  assert.equal(normalizeEntry({ kind: "dinner", title: "" }, MON), null);
  assert.equal(normalizeEntry({ kind: "skip" }, MON).kind, "skip");
  assert.equal(normalizeEntry({ title: "x" }, "not a date"), null);
  assert.equal(normalizeEntry({ title: "x", kind: "weird" }, MON).kind, "dinner");
});

test("normalizePrefs limits what it keeps", () => {
  const p = normalizePrefs({ vegetarian_days: 12, max_minutes_weekday: -5, fixed_days: { fri: " pizza ", xyz: "no" }, favourites: [{ name: "Lasagne", every: "month" }, { name: "Suppe", every: "bogus" }, { name: "" }], notes: ["a", ""] });
  assert.deepEqual([p.vegetarian_days, p.max_minutes_weekday, p.fixed_days, p.favourites, p.notes], [7, 0, { fri: "pizza" }, [{ name: "Lasagne", every: "month" }, { name: "Suppe", every: "inspiration" }], ["a"]]);
});

test("MealsStore saves, reloads, rates and emits changes", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dasher-meals-"));
  try {
    const store = new MealsStore({ dir, logger: silent });
    let changes = 0;
    store.on("change", () => changes++);
    store.setDay(MON, { kind: "dinner", title: "Pasta", minutes: 30 });
    store.setPrefs({ vegetarian_days: 2 });
    assert.equal(store.rate("Pasta", "favourite"), true);
    assert.equal(store.rate("Pasta", "meh"), false);
    assert.equal(changes, 3);
    store.flush();
    const again = new MealsStore({ dir, logger: silent });
    assert.equal(again.days.get(MON).title, "Pasta");
    assert.equal(again.prefs.vegetarian_days, 2);
    assert.equal(again.ratingOf("pasta"), "favourite");
    again.setDay(MON, null);
    assert.equal(again.days.size, 0);
    fs.writeFileSync(path.join(dir, "meals.json"), "{{{");
    assert.equal(new MealsStore({ dir, logger: silent }).days.size, 0, "an unreadable file means an empty plan");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("extractJson reads fenced and padded answers", () => {
  assert.deepEqual(extractJson('{"a":1}'), { a: 1 });
  assert.deepEqual(extractJson('Here:\n```json\n{"a":[1,2]}\n```\nDone'), { a: [1, 2] });
  assert.deepEqual(extractJson({ a: 1 }), { a: 1 });
  assert.throws(() => extractJson("no json here"), /JSON/);
  assert.throws(() => extractJson("{broken"), /JSON/);
});

const dish = (date, over = {}) => normalizeEntry({ kind: "dinner", title: `Dish ${date}`, minutes: 30, main_ingredient: `m${date}`, vegetarian: false, source: "ai", ...over }, date);
const week = (over = {}) => Array.from({ length: 7 }, (_, i) => dish(addDays(MON, i), over[i] ?? {}));
const prefs = (over = {}) => normalizePrefs(over);
const dates = Array.from({ length: 7 }, (_, i) => addDays(MON, i));

test("validatePlan accepts a clean plan", () => {
  assert.deepEqual(validatePlan({ days: week(), dates, prefs: prefs() }), []);
});

test("validatePlan finds missing, skipped, repeated, disliked, avoided, slow and fixed days", () => {
  const ratings = new Map([["lasagne", { name: "Lasagne", rating: "dislike" }]]);
  const history = [{ date: addDays(MON, -3), title: "Gammel ret", key: "gammel ret", main: "kylling" }];
  const days = week({ 0: { title: "Lasagne med salat" }, 1: { title: "Gammel ret" }, 2: { title: "Torsk i ovn" }, 3: { minutes: 90 }, 4: { title: "Fisk" }, 5: { main_ingredient: `m${addDays(MON, 3)}` } }).filter((d) => d.date !== addDays(MON, 6));
  const v = validatePlan({ days, dates, skip: [addDays(MON, 4)], prefs: prefs({ allergies: "torsk", max_minutes_weekday: 45, fixed_days: { thu: "suppe" } }), ratings, history });
  const codes = v.map((x) => `${x.code}:${x.date ?? ""}`);
  for (const expected of [`missing:${addDays(MON, 6)}`, `skipped:${addDays(MON, 4)}`, `repeat:${addDays(MON, 1)}`, `disliked:${MON}`, `avoid:${addDays(MON, 2)}`, `time:${addDays(MON, 3)}`, `fixed:${addDays(MON, 3)}`, `main:${addDays(MON, 5)}`]) {
    assert.ok(codes.includes(expected), `${expected} in ${codes}`);
  }
});

test("validatePlan counts vegetarian dinners and checks leftovers", () => {
  const p = prefs({ vegetarian_days: 3, leftover_days: 1 });
  assert.ok(validatePlan({ days: week({ 0: { vegetarian: true } }), dates, prefs: p }).some((x) => x.code === "vegetarian"));
  assert.ok(!validatePlan({ days: week({ 0: { vegetarian: true }, 1: { vegetarian: true }, 2: { vegetarian: true } }), dates, prefs: p }).some((x) => x.code === "vegetarian"));
  const left = week({ 0: { double_portion: true }, 1: { kind: "leftovers", from: MON, title: "Rester" } });
  assert.deepEqual(validatePlan({ days: left, dates, prefs: p }).filter((x) => x.code.startsWith("leftover")), []);
  const bad = week({ 1: { kind: "leftovers", from: MON, title: "Rester" } });
  assert.ok(validatePlan({ days: bad, dates, prefs: p }).some((x) => x.code === "leftover_source"));
  assert.ok(validatePlan({ days: left, dates, prefs: prefs() }).some((x) => x.code === "leftovers"), "no leftover days allowed");
});

test("recentDishes and dueFavourites", () => {
  const days = new Map([[addDays(MON, -5), dish(addDays(MON, -5), { title: "Lasagne" })], [addDays(MON, -40), dish(addDays(MON, -40), { title: "Gammel" })]]);
  assert.deepEqual(recentDishes(days, MON, 28).map((d) => d.title), ["Lasagne"]);
  const favourites = [{ name: "Lasagne", every: "month" }, { name: "Suppe", every: "2weeks" }, { name: "Pandekager", every: "week" }, { name: "Sushi", every: "inspiration" }];
  assert.deepEqual(dueFavourites(favourites, days, MON).map((f) => f.name), ["Suppe", "Pandekager"]);
});

test("allergenWarnings looks at the ingredients", () => {
  const entry = dish(MON, { ingredients: [{ name: "Rejer" }, { name: "Ris" }] });
  assert.equal(allergenWarnings(entry, prefs({ allergies: "rejer, nødder" })).length, 1);
  assert.deepEqual(allergenWarnings(entry, prefs()), []);
});

/** A fake Home Assistant whose AI answers from a queue. */
function fakeHa(answers) {
  const calls = [];
  return {
    calls,
    async callServiceWithResponse(domain, service, data, target, options) {
      calls.push({ domain, service, data, options });
      const next = answers.shift();
      if (next instanceof Error) throw next;
      return { data: typeof next === "string" ? next : JSON.stringify(next) };
    },
  };
}
const aiFor = (ha, store) => new MealsAI({ ha, store, logger: silent, resolveEntity: () => "ai_task.x", settings: () => ({ language: "da", household: 4 }) });
const skeleton = (list) => ({ days: list.map((d) => ({ kind: "dinner", minutes: 30, vegetarian: false, double_portion: false, from: null, description: "", ...d })) });
const recipe = { servings: 4, minutes: 30, vegetarian: false, ingredients: [{ name: "Løg", amount: "2 stk" }], steps: ["Steg løget"], tip: "" };

test("generatePlan sends rule violations back to the AI and keeps the best try", async () => {
  const store = new MealsStore({ dir: null, logger: silent });
  const two = [MON, addDays(MON, 1)];
  const bad = skeleton([{ date: two[0], title: "A", main_ingredient: "a" }, { date: two[1], title: "B", main_ingredient: "b", minutes: 200 }]);
  const good = skeleton([{ date: two[0], title: "A", main_ingredient: "a" }, { date: two[1], title: "B", main_ingredient: "b" }]);
  store.setPrefs({ max_minutes_weekday: 60 });
  const ha = fakeHa([bad, good, recipe, recipe]);
  const ai = aiFor(ha, store);
  const result = await ai.generatePlan({ start: MON, days: 2, wishes: "mere fisk" });
  assert.equal(result.violations.length, 0);
  assert.equal(ha.calls.length, 4);
  assert.match(ha.calls[1].data.instructions, /broke these rules/);
  assert.match(ha.calls[0].data.instructions, /Wishes for this plan: mere fisk/);
  assert.equal(ha.calls[0].options.timeoutMs > 60_000, true);
  assert.deepEqual([store.days.get(two[1]).minutes, store.days.get(two[1]).steps.length], [30, 1]);
  assert.equal(store.job.status, "ready");
});

test("generatePlan keeps the plan with the fewest broken rules and shows what is left", async () => {
  const store = new MealsStore({ dir: null, logger: silent });
  store.setPrefs({ max_minutes_weekday: 30 });
  const slow = skeleton([{ date: MON, title: "Lang", main_ingredient: "x", minutes: 120 }]);
  const ha = fakeHa([slow, slow, slow, recipe]);
  const result = await aiFor(ha, store).generatePlan({ start: MON, days: 1 });
  assert.equal(result.violations.length > 0, true);
  assert.equal(store.job.message, "ready_with_warnings");
  assert.match(store.days.get(MON).warnings[0], /weekday limit/);
});

test("generatePlan marks skipped days, refuses a second run and reports errors", async () => {
  const store = new MealsStore({ dir: null, logger: silent });
  const ha = fakeHa([skeleton([{ date: MON, title: "A", main_ingredient: "a" }]), recipe]);
  await aiFor(ha, store).generatePlan({ start: MON, days: 2, skip: [addDays(MON, 1)] });
  assert.equal(store.days.get(addDays(MON, 1)).kind, "skip");
  store.setJob({ status: "running" });
  await assert.rejects(() => aiFor(fakeHa([]), store).generatePlan({ start: MON }), /already/);
  store.setJob({ status: "idle" });
  await assert.rejects(() => aiFor(fakeHa([new Error("boom")]), store).generatePlan({ start: MON, days: 1 }), /boom/);
  assert.equal(store.job.status, "error");
  await assert.rejects(() => aiFor(fakeHa([]), store).generatePlan({ start: "nope" }), /start day/);
  const none = new MealsAI({ ha: fakeHa([]), store, logger: silent, resolveEntity: () => null });
  await assert.rejects(() => none.generatePlan({ start: MON, days: 1 }), /AI Task/);
});

test("writeRecipe and alternatives", async () => {
  const store = new MealsStore({ dir: null, logger: silent });
  store.setDay(MON, { kind: "dinner", title: "Pasta" });
  const ai = aiFor(fakeHa([{ ...recipe, ingredients: [{ name: "Rejer" }, { name: "Pasta", amount: "400 g" }] }]), store);
  store.setPrefs({ allergies: "rejer" });
  await ai.writeRecipe(MON);
  assert.equal(store.days.get(MON).ingredients.length, 2);
  assert.match(store.days.get(MON).warnings[0], /Contains rejer/);
  await assert.rejects(() => aiFor(fakeHa([{ ingredients: [], steps: [] }]), store).writeRecipe(MON), /empty/);
  const alt = await aiFor(fakeHa([{ alternatives: [{ title: "A", minutes: 20 }, { title: "B" }, { title: "C" }, { title: "D" }] }]), store).alternatives(MON);
  assert.deepEqual(alt.map((a) => a.title), ["A", "B", "C"]);
  await assert.rejects(() => ai.writeRecipe("2030-01-01"), /no dinner/);
});

test("calendar events: content, times and the marker", () => {
  const entry = dish(MON, { title: "Pasta", minutes: 45, ingredients: [{ name: "Pasta", amount: "400 g" }, { name: "Salt", basic: true }] });
  const e = eventFor(entry, "18:00");
  assert.deepEqual([e.summary, e.start, e.end], ["Pasta", `${MON} 18:00:00`, `${MON} 18:45:00`]);
  assert.ok(e.description.startsWith(MARKER) && e.description.includes("- 400 g Pasta") && !e.description.includes("Salt"));
  assert.equal(eventFor(normalizeEntry({ kind: "skip" }, MON)), null);
  assert.equal(eventFor(undefined), null);
  assert.equal(addMinutes("23:30", 120), "23:59");
});

test("MealsCalendar replaces only its own events, and leaves a current one alone", async () => {
  const calls = [];
  let events = [{ uid: "mine", summary: "Old", description: `${MARKER}\nx`, recurrence_id: null }, { uid: "foreign", summary: "Dentist", description: "keep" }];
  const ha = {
    async callServiceWithResponse(domain, service, data, target) {
      calls.push([service, target.entity_id[0]]);
      return { "calendar.madplan": { events } };
    },
    async request(message) {
      calls.push([message.type, message.uid]);
      events = events.filter((e) => e.uid !== message.uid);
    },
    async callService(domain, service, data, ids) {
      calls.push([service, data.summary, ids[0]]);
      events = [...events, { uid: "new", summary: data.summary, description: data.description }];
    },
  };
  const cal = new MealsCalendar({ ha, logger: silent });
  const entry = dish(MON, { title: "Pasta" });
  assert.equal(await cal.syncDay("calendar.madplan", MON, entry, "18:00"), true);
  assert.deepEqual(calls.filter(([c]) => c === "calendar/event/delete" || c === "create_event").map((c) => c.slice(0, 2)), [["calendar/event/delete", "mine"], ["create_event", "Pasta"]]);
  assert.ok(events.some((e) => e.uid === "foreign"));
  calls.length = 0;
  await cal.syncDay("calendar.madplan", MON, entry, "18:00");
  assert.deepEqual(calls.map((c) => c[0]), ["get_events"], "an up-to-date day is not touched");
  await cal.syncDay("calendar.madplan", MON, null, "18:00");
  assert.equal(events.filter((e) => String(e.description).startsWith(MARKER)).length, 0);
  const failing = new MealsCalendar({ ha: { async callServiceWithResponse() { throw new Error("offline"); } }, logger: silent });
  assert.equal(await failing.syncDay("calendar.x", MON, entry, "18:00"), false);
  assert.equal(failing.error, "offline");
});

test("the meals: section is parsed and its entities tracked", () => {
  const { config, errors, entities } = parseConfig("pages:\n  - id: a\n    tiles: []\nmeals:\n  calendar_entity: calendar.madplan\n  shopping_list_entity: todo.indkob\n  ai_task_entity: light.nope\n  household: 5\n  dinner_time: '19:30'\n  auto: { weekday: sat, time: '08:00', days: 7 }\n");
  assert.deepEqual([config.meals.calendar_entity, config.meals.shopping_list_entity, config.meals.ai_task_entity, config.meals.household, config.meals.dinner_time], ["calendar.madplan", "todo.indkob", null, 5, "19:30"]);
  assert.equal(errors.length, 1);
  assert.deepEqual(config.meals.auto, { weekday: "sat", time: "08:00", days: 7 });
  assert.ok(entities.has("calendar.madplan") && entities.has("todo.indkob"));
  assert.deepEqual([parseConfig("pages:\n  - id: a\n    tiles: []\n").config.meals.enabled, parseConfig("pages:\n  - id: a\n    tiles:\n      - { type: dinner }\n").errors], ["auto", []]);
});

// ---- client helpers ----

test("parseAmount and formatAmount", () => {
  assert.deepEqual(parseAmount("400 g"), { value: 400, unit: "g", family: "mass" });
  assert.deepEqual(parseAmount("1,5 kg"), { value: 1500, unit: "g", family: "mass" });
  assert.deepEqual(parseAmount("2 dl"), { value: 200, unit: "ml", family: "volume" });
  assert.equal(parseAmount("½ tsk").value, 0.5);
  assert.equal(parseAmount("1/2 løg").value, 0.5);
  assert.deepEqual(parseAmount("3"), { value: 3, unit: "", family: "count" });
  assert.equal(parseAmount("lidt"), null);
  assert.deepEqual([formatAmount(1500, "g"), formatAmount(250, "ml"), formatAmount(1200, "ml"), formatAmount(2, "stk"), formatAmount(2.5, "fed")], ["1,5 kg", "2,5 dl", "1,2 l", "2 stk", "2,5 fed"]);
});

test("aggregateIngredients adds up the same kind of amount and keeps basics last", () => {
  const entries = [
    { kind: "dinner", date: MON, ingredients: [{ name: "Løg", amount: "2 stk" }, { name: "Hakket oksekød", amount: "400 g" }, { name: "Salt", amount: "1 tsk", basic: true }] },
    { kind: "dinner", date: addDays(MON, 1), ingredients: [{ name: "løg", amount: "1 stk" }, { name: "Hakket oksekød", amount: "0,5 kg" }, { name: "Salt", amount: "1 tsk", basic: true }, { name: "Persille", amount: "" }] },
    { kind: "leftovers", date: addDays(MON, 2), ingredients: [{ name: "Aldrig", amount: "1" }] },
  ];
  const rows = aggregateIngredients(entries);
  const by = Object.fromEntries(rows.map((r) => [r.name.toLowerCase(), r]));
  assert.deepEqual([by["løg"].amount, by["hakket oksekød"].amount, by.salt.amount, by.persille.amount], ["3 stk", "900 g", "2 tsk", ""]);
  assert.deepEqual([by.salt.basic, by["løg"].basic, by["løg"].dates.length], [true, false, 2]);
  assert.equal(rows.at(-1).name, "Salt");
  assert.ok(!rows.some((r) => r.name === "Aldrig"));
});

test("onList, stepTimer and tonight", () => {
  assert.equal(onList("Løg", [{ summary: "Løg (3 stk)" }]), true);
  assert.equal(onList("Rødløg", [{ summary: "Løg" }]), true);
  assert.equal(onList("Mælk", [{ summary: "Løg" }]), false);
  assert.equal(onList("Ål", [{ summary: "Ål" }]), false, "very short names are never matched");
  assert.deepEqual([stepTimer("Simre i 20 minutter."), stepTimer("Bag 1,5 time"), stepTimer("Steg 10-12 min"), stepTimer("Server")], [1200, 5400, 600, null]);
  const days = { "2026-10-25": { kind: "dinner", title: "A" }, "2026-10-26": { kind: "skip", title: "" } };
  assert.deepEqual(tonight(days, new Date(2026, 9, 25, 12)), { today: days["2026-10-25"], tomorrow: null });
});
