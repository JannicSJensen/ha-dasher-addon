import net from "node:net";

/*
 * Mealie through Home Assistant's Mealie integration (the mealie.* actions): search the family's recipe
 * collection, get a recipe as a Dasher dinner and import a recipe from a web page. Nothing here talks to
 * Mealie directly; Home Assistant holds the address and the token.
 */

const CACHE_MS = 5 * 60_000;
const BASICS = /^(salt|peber|sort peber|pepper|black pepper|olie|oil|olivenolie|olive oil|rapsolie|smør|butter|vand|water|sukker|sugar)\b/i;
const VEGETARIAN = /vegetar|veggie|plantebaseret|vegan/i;

const text = (value, max) => String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
const round = (n) => Math.round(n * 100) / 100;
const num = (n) => String(round(n)).replace(".", ",");

/** Only web pages anywhere on the internet: Mealie must not be pointed at a device on the home network. */
export function isPublicHttpUrl(value) {
  let url;
  try {
    url = new URL(String(value));
  } catch {
    return false;
  }
  if (!["http:", "https:"].includes(url.protocol) || String(value).length > 2000 || url.username || url.password) return false;
  const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (!host.includes(".") && !net.isIP(host)) return false;
  if (/(^|\.)(local|localhost|internal|lan|home|home\.arpa)$/.test(host)) return false;
  const kind = net.isIP(host);
  if (kind === 4) {
    const [a, b] = host.split(".").map(Number);
    return !(a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224);
  }
  if (kind === 6) return !/^(::1?$|f[cd]|fe[89ab]|::ffff:)/.test(host);
  return true;
}

/** One line of a Mealie recipe as a Dasher ingredient: { name, amount, basic? }; `factor` scales the quantity. */
export function mapIngredient(raw, factor = 1) {
  const quantity = Number(raw?.quantity) > 0 ? Number(raw.quantity) * factor : 0;
  const food = text(raw?.food?.name, 80);
  const unit = raw?.unit ? text(raw.unit.abbreviation || raw.unit.name, 20) : "";
  const free = text(raw?.note || raw?.display || raw?.original_text, 80);
  const name = food ? (quantity > 1 && raw.food.plural_name && !unit ? text(raw.food.plural_name, 80) : food) : free;
  if (!name) return null;
  const amount = quantity ? `${num(quantity)}${unit ? ` ${unit}` : ""}` : "";
  return { name, amount, ...(BASICS.test(name) ? { basic: true } : {}) };
}

/** A Mealie recipe (mealie.get_recipe) as the fields of a dinner entry, for `servings` people. */
export function recipeToEntry(recipe, servings) {
  const base = Number(recipe?.recipe_servings) > 0 ? Number(recipe.recipe_servings) : Number(recipe?.recipe_yield_quantity) > 0 ? Number(recipe.recipe_yield_quantity) : 0;
  const factor = base && servings ? servings / base : 1;
  const seconds = Number(recipe?.total_time_seconds) || (Number(recipe?.prep_time_seconds) || 0) + (Number(recipe?.perform_time_seconds) || 0);
  const labels = [...(recipe?.tags ?? []), ...(recipe?.categories ?? [])].map((t) => t?.name ?? "");
  const steps = (recipe?.instructions ?? []).map((s) => [text(s?.title, 80), text(s?.text, 600)].filter(Boolean).join(": ")).filter(Boolean);
  const note = (recipe?.notes ?? []).map((n) => text(n?.text, 200)).find(Boolean) ?? "";
  return {
    title: text(recipe?.name, 120),
    description: text(recipe?.description, 400),
    minutes: seconds ? Math.max(1, Math.round(seconds / 60)) : 0,
    servings: servings || base || 4,
    vegetarian: labels.some((l) => VEGETARIAN.test(l)),
    ingredients: (recipe?.ingredients ?? []).map((i) => mapIngredient(i, factor)).filter(Boolean),
    steps,
    tip: note,
    source: "mealie",
    mealie_slug: text(recipe?.slug, 120),
  };
}

/** What the cookbook shows of a recipe in the list. */
export const summarize = (r) => ({
  slug: text(r?.slug, 120),
  name: text(r?.name, 120),
  description: text(r?.description, 200),
  minutes: Number(r?.total_time_seconds) ? Math.round(Number(r.total_time_seconds) / 60) : 0,
  tags: (r?.tags ?? []).map((t) => text(t?.name, 30)).filter(Boolean).slice(0, 4),
  rating: Number(r?.rating) || 0,
});

export class Mealie {
  /** `settings()` gives `{ enabled, config_entry_id }` from the dashboard. */
  constructor({ ha, logger, settings = () => ({}) }) {
    this.ha = ha;
    this.log = logger;
    this.settings = settings;
    this.entryId = null;
    this.checkedAt = 0;
    this.error = null;
  }

  /** True once the Mealie integration was found in Home Assistant (call `refresh()` to look). */
  get available() {
    return this.settings().enabled !== false && Boolean(this.entryId);
  }

  async refresh({ force = false } = {}) {
    const s = this.settings();
    if (s.enabled === false) return false;
    if (!force && Date.now() - this.checkedAt < CACHE_MS) return this.available;
    this.checkedAt = Date.now();
    try {
      if (s.config_entry_id) this.entryId = s.config_entry_id;
      else {
        const entries = await this.ha.request({ type: "config_entries/get", domain: "mealie" });
        const entry = (entries ?? []).find((e) => e.state === "loaded") ?? null;
        this.entryId = entry?.entry_id ?? null;
      }
      this.error = null;
    } catch (err) {
      this.entryId = null;
      this.error = err.message;
    }
    return this.available;
  }

  async _call(service, data, options) {
    if (!(await this.refresh())) throw Object.assign(new Error("The Mealie integration is not set up in Home Assistant."), { status: 503 });
    try {
      return await this.ha.callServiceWithResponse("mealie", service, { config_entry_id: this.entryId, ...data }, undefined, { timeoutMs: 60_000, ...options });
    } catch (err) {
      this.log.warn(`Mealie ${service} failed: ${err.message}`);
      throw Object.assign(new Error(err.message || "Mealie did not answer."), { status: 502 });
    }
  }

  /** Recipes matching `query` (all of them when empty), newest first as Mealie sorts them. */
  async search(query = "", limit = 60) {
    const response = await this._call("get_recipes", { ...(query ? { search_terms: text(query, 100) } : {}), result_limit: Math.min(200, Math.max(1, limit)) });
    return (response?.recipes?.items ?? []).map(summarize).filter((r) => r.slug && r.name);
  }

  /** The full recipe as dinner fields, for `servings` people. */
  async recipe(slug, servings) {
    if (!/^[\w-]{1,120}$/.test(String(slug))) throw Object.assign(new Error("Unknown recipe."), { status: 400 });
    const response = await this._call("get_recipe", { recipe_id: slug });
    if (!response?.recipe) throw Object.assign(new Error("Mealie has no such recipe."), { status: 404 });
    const entry = recipeToEntry(response.recipe, servings);
    if (!entry.title) throw Object.assign(new Error("The recipe has no name."), { status: 502 });
    return entry;
  }

  /** Import a web page into Mealie; resolves with the new recipe's slug. */
  async importUrl(url) {
    if (!isPublicHttpUrl(url)) throw Object.assign(new Error("Give the address of a recipe on the internet (https://...)."), { status: 400 });
    const response = await this._call("import_recipe", { url, include_tags: true }, { timeoutMs: 120_000 });
    const slug = text(response?.recipe?.slug, 120);
    if (!slug) throw Object.assign(new Error("Mealie could not read a recipe from that page."), { status: 502 });
    return slug;
  }
}
