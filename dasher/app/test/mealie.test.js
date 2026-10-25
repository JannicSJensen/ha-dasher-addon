import assert from "node:assert/strict";
import { test } from "node:test";
import { parseConfig } from "../src/config.js";
import { MealsAI } from "../src/meals-ai.js";
import { MealsStore, addDays } from "../src/meals.js";
import { Mealie, isPublicHttpUrl, mapIngredient, recipeToEntry, summarize } from "../src/mealie.js";

const silent = { warn() {}, info() {}, debug() {}, error() {} };
const MON = "2026-10-26";

const recipe = {
  slug: "carbonara",
  name: "Carbonara",
  description: "Pasta",
  recipe_servings: 2,
  total_time_seconds: 1800,
  tags: [{ name: "Vegetar" }],
  categories: [],
  ingredients: [
    { quantity: 200, unit: { name: "gram", abbreviation: "g" }, food: { name: "Spaghetti" }, note: "" },
    { quantity: 2, unit: null, food: { name: "Æg", plural_name: "Æg" }, note: "" },
    { quantity: 1, unit: { name: "teaspoon", abbreviation: "" }, food: { name: "Salt" }, note: "" },
    { quantity: null, unit: null, food: null, note: "Peber efter smag" },
    { quantity: null, unit: null, food: null, note: "", display: "" },
  ],
  instructions: [{ title: "", text: "Kog pasta." }, { title: "Server", text: "Hæld op." }],
  notes: [{ title: "", text: "Brug guanciale." }],
};

test("isPublicHttpUrl accepts web pages and refuses the home network", () => {
  for (const ok of ["https://example.com/a?b=1", "http://recipes.dk/x", "https://8.8.8.8/x"]) assert.equal(isPublicHttpUrl(ok), true, ok);
  for (const bad of ["ftp://example.com", "javascript:alert(1)", "http://localhost/x", "http://192.168.1.5/", "http://10.0.0.1", "http://172.20.1.1", "http://127.0.0.1", "http://169.254.169.254/latest", "http://[::1]/", "http://nas/x", "http://printer.local/", "https://user:pw@example.com/", "nonsense", ""]) assert.equal(isPublicHttpUrl(bad), false, bad);
});

test("mapIngredient: amount, plural and basics", () => {
  assert.deepEqual(mapIngredient(recipe.ingredients[0], 2), { name: "Spaghetti", amount: "400 g" });
  assert.deepEqual(mapIngredient(recipe.ingredients[1], 1.5), { name: "Æg", amount: "3" });
  assert.deepEqual(mapIngredient(recipe.ingredients[2], 1), { name: "Salt", amount: "1 teaspoon", basic: true });
  assert.deepEqual(mapIngredient(recipe.ingredients[3]), { name: "Peber efter smag", amount: "", basic: true });
  assert.equal(mapIngredient(recipe.ingredients[4]), null);
  assert.equal(mapIngredient({ quantity: 0.25, unit: { name: "l", abbreviation: "l" }, food: { name: "Mælk" } }, 1).amount, "0,25 l");
});

test("recipeToEntry scales to the household and reads time, steps and tags", () => {
  const e = recipeToEntry(recipe, 4);
  assert.deepEqual([e.title, e.minutes, e.servings, e.vegetarian, e.source, e.mealie_slug, e.tip], ["Carbonara", 30, 4, true, "mealie", "carbonara", "Brug guanciale."]);
  assert.deepEqual(e.steps, ["Kog pasta.", "Server: Hæld op."]);
  assert.equal(e.ingredients[0].amount, "400 g");
  const plain = recipeToEntry({ ...recipe, recipe_servings: null, total_time_seconds: null, prep_time_seconds: 600, perform_time_seconds: 900, tags: [] }, 4);
  assert.deepEqual([plain.minutes, plain.vegetarian, plain.ingredients[0].amount], [25, false, "200 g"]);
});

test("summarize keeps what the list shows", () => {
  assert.deepEqual(summarize({ slug: "a", name: "A", description: "d", total_time_seconds: 600, tags: [{ name: "x" }], rating: 4 }), { slug: "a", name: "A", description: "d", minutes: 10, tags: ["x"], rating: 4 });
});

function fakeHa({ entries = [{ entry_id: "ENTRYID12345", state: "loaded" }], respond } = {}) {
  const calls = [];
  return {
    calls,
    async request(message) {
      calls.push(message);
      return entries;
    },
    async callServiceWithResponse(domain, service, data) {
      calls.push({ domain, service, data });
      return respond(service, data);
    },
  };
}

test("Mealie finds the integration and searches", async () => {
  const ha = fakeHa({ respond: (service, data) => ({ recipes: { items: [{ slug: "a", name: "A" }, { slug: "", name: "B" }] } }) });
  const mealie = new Mealie({ ha, logger: silent });
  assert.equal(mealie.available, false);
  assert.equal(await mealie.refresh(), true);
  assert.deepEqual((await mealie.search("sup")).map((r) => r.slug), ["a"]);
  const call = ha.calls.find((c) => c.service === "get_recipes");
  assert.deepEqual([call.domain, call.data.config_entry_id, call.data.search_terms, call.data.result_limit], ["mealie", "ENTRYID12345", "sup", 60]);
  assert.equal(new Mealie({ ha: fakeHa({ entries: [] }), logger: silent }).available, false);
  const off = new Mealie({ ha, logger: silent, settings: () => ({ enabled: false }) });
  assert.equal(await off.refresh(), false);
  const fixed = new Mealie({ ha: fakeHa({ respond: () => ({}) }), logger: silent, settings: () => ({ config_entry_id: "FIXEDENTRY123" }) });
  await fixed.refresh();
  assert.equal(fixed.entryId, "FIXEDENTRY123");
  await assert.rejects(() => new Mealie({ ha: fakeHa({ entries: [] }), logger: silent }).search(""), /not set up/);
});

test("Mealie recipe and import", async () => {
  const ha = fakeHa({ respond: (service) => (service === "get_recipe" ? { recipe } : service === "import_recipe" ? { recipe: { slug: "new-one" } } : {}) });
  const mealie = new Mealie({ ha, logger: silent });
  assert.equal((await mealie.recipe("carbonara", 4)).title, "Carbonara");
  await assert.rejects(() => mealie.recipe("../x", 4), /Unknown recipe/);
  assert.equal(await mealie.importUrl("https://example.com/r"), "new-one");
  await assert.rejects(() => mealie.importUrl("http://192.168.1.2/r"), /internet/);
  const failing = new Mealie({ ha: { request: async () => [{ entry_id: "ENTRYID12345", state: "loaded" }], callServiceWithResponse: async () => { throw new Error("Recipe not found"); } }, logger: silent });
  await assert.rejects(() => failing.recipe("x", 4), (err) => err.status === 502 && /not found/.test(err.message));
});

const aiHa = (answers) => ({
  async callServiceWithResponse(domain, service, data) {
    assert.equal(domain, "ai_task");
    const next = answers.shift();
    return { data: JSON.stringify(typeof next === "function" ? next(data.instructions) : next) };
  },
});
const skeleton = (list) => ({ days: list.map((d) => ({ kind: "dinner", minutes: 30, vegetarian: false, double_portion: false, from: null, description: "", ...d })) });

test("a plan can use the Mealie collection: the recipes come from Mealie, not the AI", async () => {
  const store = new MealsStore({ dir: null, logger: silent });
  const mealie = { refresh: async () => true, search: async () => [{ slug: "carbonara", name: "Carbonara", minutes: 30 }], recipe: async (slug, servings) => recipeToEntry(recipe, servings) };
  let planPrompt = "";
  const ha = aiHa([
    (prompt) => ((planPrompt = prompt), skeleton([{ date: MON, title: "Whatever", main_ingredient: "pasta", mealie_slug: "carbonara" }, { date: addDays(MON, 1), title: "Laks", main_ingredient: "laks", mealie_slug: "invented" }])),
    { servings: 4, minutes: 20, vegetarian: false, ingredients: [{ name: "Laks", amount: "500 g" }], steps: ["Steg laksen"], tip: "" },
  ]);
  const ai = new MealsAI({ ha, store, logger: silent, resolveEntity: () => "ai_task.x", settings: () => ({ language: "da", household: 4 }), mealie });
  await ai.generatePlan({ start: MON, days: 2, cookbook: true });
  assert.match(planPrompt, /carbonara \| Carbonara \| 30/);
  const first = store.days.get(MON);
  assert.deepEqual([first.title, first.source, first.mealie_slug, first.ingredients[0].amount], ["Carbonara", "mealie", "carbonara", "400 g"]);
  const second = store.days.get(addDays(MON, 1));
  assert.deepEqual([second.source, second.mealie_slug], ["ai", undefined], "an invented slug is not trusted");
});

test("without the cookbook flag the collection is not asked for", async () => {
  const store = new MealsStore({ dir: null, logger: silent });
  let asked = false;
  const mealie = { refresh: async () => true, search: async () => ((asked = true), []) };
  const ha = aiHa([(prompt) => (assert.doesNotMatch(prompt, /recipe collection/), skeleton([{ date: MON, title: "Laks", main_ingredient: "laks" }])), { servings: 4, ingredients: [{ name: "Laks" }], steps: ["Steg"] }]);
  await new MealsAI({ ha, store, logger: silent, resolveEntity: () => "ai_task.x", settings: () => ({}), mealie }).generatePlan({ start: MON, days: 1 });
  assert.equal(asked, false);
});

test("writeRecipe re-reads a Mealie dinner, and falls back to the AI when Mealie fails", async () => {
  const store = new MealsStore({ dir: null, logger: silent });
  store.setDay(MON, { kind: "dinner", title: "Carbonara", source: "mealie", mealie_slug: "carbonara" });
  const good = { recipe: async () => recipeToEntry(recipe, 4) };
  await new MealsAI({ ha: aiHa([]), store, logger: silent, resolveEntity: () => null, mealie: good }).writeRecipe(MON);
  assert.equal(store.days.get(MON).steps.length, 2);
  const bad = { recipe: async () => { throw new Error("offline"); } };
  await assert.rejects(() => new MealsAI({ ha: aiHa([]), store, logger: silent, resolveEntity: () => null, mealie: bad }).writeRecipe(MON), /offline/);
  const ha = aiHa([{ servings: 4, ingredients: [{ name: "Pasta" }], steps: ["Kog"], tip: "" }]);
  await new MealsAI({ ha, store, logger: silent, resolveEntity: () => "ai_task.x", mealie: bad }).writeRecipe(MON);
  assert.deepEqual([store.days.get(MON).source, store.days.get(MON).mealie_slug], ["ai", undefined]);
});

test("the meals.mealie options are parsed", () => {
  const base = "pages:\n  - id: a\n    tiles: []\nmeals:\n";
  assert.deepEqual(parseConfig(`${base}  mealie: { config_entry_id: 01ABCDEFGHJKMNPQ }\n`).config.meals.mealie, { enabled: "auto", config_entry_id: "01ABCDEFGHJKMNPQ" });
  assert.deepEqual(parseConfig(`${base}  mealie: false\n`).config.meals.mealie, { enabled: false, config_entry_id: null });
  assert.deepEqual(parseConfig(`${base}  mealie: { config_entry_id: "../x" }\n`).config.meals.mealie, { enabled: "auto", config_entry_id: null });
  assert.deepEqual(parseConfig("pages:\n  - id: a\n    tiles: []\n").config.meals.mealie, { enabled: "auto", config_entry_id: null });
});
