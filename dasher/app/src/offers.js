import { EventEmitter } from "node:events";
import fs from "node:fs";
import path from "node:path";

/*
 * Offers (Tilbud): the cheapest offers per litre / kilo for products you follow, one per store, read from the
 * public product pages of tilbudsugen.dk (the page carries its data as JSON). Nothing is fetched until a product is
 * followed, each product is read about twice a day, and the last good answer is kept when the site does not answer.
 */

export const OFFERS_BASE = "https://www.tilbudsugen.dk";
const USER_AGENT = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const SLUG_RE = /^[a-z0-9æøå]+(?:-[a-z0-9æøå]+){0,5}$/;
const MAX_WATCH = 12;
const MAX_KEPT = 120; // offers kept per product
const MAX_BYTES = 4 * 1024 * 1024;
const STALE_MS = 11 * 3600_000; // about twice a day
const MANUAL_GAP_MS = 5 * 60_000;
const PAGE_GAP_MS = 1500;
const FILE = "offers.json";

const text = (value, max) => String(value ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
const words = (value) => (Array.isArray(value) ? value : String(value ?? "").split(/[,;\n]/)).map((w) => text(w, 30).toLowerCase()).filter(Boolean).slice(0, 10);

/** "Pepsi Max" -> "pepsi-max"; a tilbudsugen.dk address -> its product name; null when it is not a usable name. */
export function slugFrom(input) {
  let value = String(input ?? "").trim();
  if (/^https?:\/\//i.test(value)) {
    try {
      const url = new URL(value);
      if (url.hostname.replace(/^www\./, "") !== "tilbudsugen.dk") return null;
      const match = /^\/offer\/([^/]+)\/?$/.exec(url.pathname);
      value = match ? decodeURIComponent(match[1]) : "";
    } catch {
      return null;
    }
  }
  if (/[/\\.:]/.test(value)) return null;
  const slug = value.toLowerCase().replace(/[\s_]+/g, "-").replace(/[^a-z0-9æøå-]/g, "").replace(/-+/g, "-").replace(/^-|-$/g, "");
  return SLUG_RE.test(slug) && slug.length <= 60 ? slug : null;
}

const titleCase = (slug) => slug.replace(/-/g, " ").replace(/^./, (c) => c.toLocaleUpperCase("da"));

/** One offer from the page's data, reduced to what is shown; null when it has no usable price. */
export function normalizeOffer(item) {
  const id = Number(item?.id);
  const price = Number.parseFloat(item?.price);
  const unitPrice = Number.parseFloat(item?.pricePerFullUnitOfQuantityType);
  if (!Number.isInteger(id) || !(price > 0) || !(unitPrice > 0)) return null;
  const quantityType = text(item?.quantityType, 10).replace(/\.$/, "").toLowerCase();
  const date = (value) => (/^\d{4}-\d{2}-\d{2}/.test(String(value)) ? String(value).slice(0, 10) : null);
  const thumb = String(item?.imageThumbnailUrl ?? "");
  return {
    id,
    chain: text(item?.chain?.name, 40),
    brand: text(item?.brand?.name, 60),
    name: text(item?.productName?.productName, 80),
    units: Math.max(1, Number(item?.units) || 1),
    quantity: Number.parseFloat(item?.quantity) || 0,
    unit: quantityType === "ltr" ? "l" : quantityType,
    price,
    unit_price: unitPrice,
    start: date(item?.startDate),
    end: date(item?.endDate),
    border: Boolean(item?.isBorderShop),
    image: thumb.startsWith("https://static.tilbudsugen.dk/") ? thumb : null,
    url: `${OFFERS_BASE}/single/${id}`,
  };
}

/** A stored offer checked again (the file may have been edited or come from an older version). */
const restoreOffer = (o) =>
  normalizeOffer({
    id: o?.id,
    price: o?.price,
    pricePerFullUnitOfQuantityType: o?.unit_price,
    units: o?.units,
    quantity: o?.quantity,
    quantityType: o?.unit === "l" ? "ltr." : `${o?.unit}.`,
    startDate: o?.start,
    endDate: o?.end,
    isBorderShop: o?.border,
    imageThumbnailUrl: o?.image,
    chain: { name: o?.chain },
    brand: { name: o?.brand },
    productName: { productName: o?.name },
  });

const haystack = (o) => `${o.brand} ${o.name}`.toLowerCase();

/**
 * The offers to show for a followed product: valid offers (not a border shop, not over) that contain every word of
 * `watch.must` and none of `watch.not`, in the unit that most of them use (so litres are not mixed with pieces),
 * not from a hidden store, the cheapest per unit first, one per store, at most `count`.
 */
export function selectOffers(offers, watch, { today, hiddenChains = [], count = 5 }) {
  const must = watch.must ?? [];
  const not = watch.not ?? [];
  const hidden = hiddenChains.map((c) => c.toLowerCase());
  const valid = offers.filter((o) => {
    if (o.border || (o.end && o.end < today)) return false;
    const hay = haystack(o);
    if (must.some((w) => !hay.includes(w)) || not.some((w) => hay.includes(w))) return false;
    return !hidden.some((c) => c && o.chain.toLowerCase().includes(c));
  });
  const tally = new Map();
  for (const o of valid) tally.set(o.unit, (tally.get(o.unit) ?? 0) + 1);
  const unit = [...tally].sort((a, b) => b[1] - a[1])[0]?.[0];
  const seen = new Set();
  const out = [];
  for (const o of valid.filter((x) => x.unit === unit).sort((a, b) => a.unit_price - b.unit_price || a.price - b.price)) {
    if (seen.has(o.chain)) continue;
    seen.add(o.chain);
    out.push(o);
    if (out.length >= count) break;
  }
  return out;
}

/** The offers on a product page's HTML: { items, lastPage }. */
export function parsePage(html) {
  const match = /<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/.exec(html);
  if (!match) throw new Error("The page has no data (the site may have changed).");
  let data;
  try {
    data = JSON.parse(match[1]);
  } catch {
    throw new Error("The page data could not be read.");
  }
  const page = data?.props?.pageProps?.data?.pageOfOrganicProductOffers;
  if (!page || !Array.isArray(page.items)) throw new Error("The page has no offers section (the site may have changed).");
  return { items: page.items, lastPage: Number(page.lastValidPageNumber) || 1 };
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export class OffersService extends EventEmitter {
  /** `fetchImpl` and `baseUrl` can be replaced for tests and the fake site of the development servers. */
  constructor({ dir, logger, fetchImpl = fetch, baseUrl = OFFERS_BASE, now = () => new Date(), gapMs = PAGE_GAP_MS }) {
    super();
    this.dir = dir;
    this.log = logger;
    this.fetchImpl = fetchImpl;
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.now = now;
    this.gapMs = gapMs;
    this.watch = []; // { slug, name, must, not }
    this.hidden = []; // store names the person does not want to see
    this.results = {}; // slug -> { offers, fetched_at, error }
    this.lastManual = 0;
    this.busy = false;
    this._timer = null;
    this._load();
  }

  get file() {
    return this.dir ? path.join(this.dir, FILE) : null;
  }

  _load() {
    if (!this.file) return;
    try {
      const data = JSON.parse(fs.readFileSync(this.file, "utf8"));
      for (const w of Array.isArray(data.watch) ? data.watch : []) {
        const slug = slugFrom(w?.slug);
        if (slug && !this.watch.some((x) => x.slug === slug)) this.watch.push({ slug, name: text(w.name, 40) || titleCase(slug), must: words(w.must), not: words(w.not) });
      }
      this.hidden = (Array.isArray(data.hidden) ? data.hidden : []).map((c) => text(c, 40)).filter(Boolean).slice(0, 40);
      for (const [slug, r] of Object.entries(data.results ?? {})) {
        if (!this.watch.some((w) => w.slug === slug)) continue;
        this.results[slug] = { offers: (Array.isArray(r?.offers) ? r.offers : []).map(restoreOffer).filter(Boolean), fetched_at: typeof r?.fetched_at === "string" ? r.fetched_at : null, error: null };
      }
    } catch {
      // first start or an unreadable file
    }
  }

  _save() {
    if (!this.file) return;
    try {
      fs.mkdirSync(this.dir, { recursive: true });
      const tmp = `${this.file}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify({ watch: this.watch, hidden: this.hidden, results: this.results }));
      fs.renameSync(tmp, this.file);
    } catch (err) {
      this.log?.warn(`Could not save ${FILE}: ${err.message}`);
    }
  }

  _changed() {
    this._save();
    this.emit("change");
  }

  async _get(url) {
    const response = await this.fetchImpl(url, { headers: { "User-Agent": USER_AGENT, "Accept-Language": "da,en;q=0.5" }, signal: AbortSignal.timeout(20_000) });
    if (response.url && !response.url.startsWith(this.baseUrl)) throw new Error("The site sent us somewhere else.");
    if (!response.ok) throw new Error(`The site answered ${response.status}.`);
    const declared = Number(response.headers?.get?.("content-length") ?? 0);
    if (declared > MAX_BYTES) throw new Error("The page is too large.");
    const html = await response.text();
    if (html.length > MAX_BYTES) throw new Error("The page is too large.");
    return html;
  }

  /** All the offers of a product page (`?page=N` gives the offers of the pages up to N, so one more request is enough). */
  async fetchProduct(slug) {
    const base = `${this.baseUrl}/offer/${encodeURIComponent(slug)}`;
    let page = parsePage(await this._get(base));
    if (page.lastPage > 1) {
      await sleep(this.gapMs);
      page = parsePage(await this._get(`${base}?page=${Math.min(page.lastPage, 4)}`));
    }
    const seen = new Set();
    return page.items
      .map(normalizeOffer)
      .filter((o) => o && !seen.has(o.id) && seen.add(o.id))
      .sort((a, b) => a.unit_price - b.unit_price)
      .slice(0, MAX_KEPT);
  }

  async _refresh(watch) {
    try {
      const offers = await this.fetchProduct(watch.slug);
      this.results[watch.slug] = { offers, fetched_at: this.now().toISOString(), error: null };
      return true;
    } catch (err) {
      this.log?.warn(`Offers for "${watch.slug}": ${err.message}`);
      this.results[watch.slug] = { offers: this.results[watch.slug]?.offers ?? [], fetched_at: this.results[watch.slug]?.fetched_at ?? null, error: err.message };
      return false;
    }
  }

  /** Read the products whose offers are older than about half a day (all of them with `force`). */
  async refresh({ force = false } = {}) {
    if (this.busy) return;
    this.busy = true;
    try {
      let first = true;
      for (const watch of [...this.watch]) {
        const at = this.results[watch.slug]?.fetched_at;
        if (!force && at && this.now() - new Date(at) < STALE_MS) continue;
        if (!first) await sleep(this.gapMs);
        first = false;
        await this._refresh(watch);
        this._changed();
      }
    } finally {
      this.busy = false;
    }
  }

  get canRefreshNow() {
    return !this.busy && Date.now() - this.lastManual >= MANUAL_GAP_MS;
  }

  /** The refresh button: allowed now and then, not in a loop. Resolves to false when it was too soon. */
  async refreshNow() {
    if (Date.now() - this.lastManual < MANUAL_GAP_MS) return false;
    this.lastManual = Date.now();
    await this.refresh({ force: true });
    return true;
  }

  /** Follow a product: `input` is a name or a tilbudsugen.dk address. Reads it at once so a wrong name is noticed. */
  async add({ input, name, must, not }) {
    const slug = slugFrom(input);
    if (!slug) throw Object.assign(new Error("Write the name of a product, for instance pepsi-max or laks."), { status: 400 });
    if (this.watch.some((w) => w.slug === slug)) throw Object.assign(new Error("You already follow that product."), { status: 409 });
    if (this.watch.length >= MAX_WATCH) throw Object.assign(new Error(`You can follow up to ${MAX_WATCH} products.`), { status: 400 });
    let offers;
    try {
      offers = await this.fetchProduct(slug);
    } catch (err) {
      throw Object.assign(new Error(err.message), { status: 502 });
    }
    const typed = /^https?:/i.test(String(input).trim()) ? "" : text(input, 40);
    this.watch.push({ slug, name: text(name, 40) || (typed ? typed.replace(/^./, (c) => c.toLocaleUpperCase("da")) : titleCase(slug)), must: words(must), not: words(not) });
    this.results[slug] = { offers, fetched_at: this.now().toISOString(), error: null };
    this._changed();
    return slug;
  }

  remove(slug) {
    const before = this.watch.length;
    this.watch = this.watch.filter((w) => w.slug !== slug);
    delete this.results[slug];
    if (this.watch.length === before) return false;
    this._changed();
    return true;
  }

  /** Hide or show a store in the lists. */
  setChain(chain, hidden) {
    const name = text(chain, 40);
    if (!name) return false;
    this.hidden = hidden ? [...new Set([...this.hidden, name])].slice(0, 40) : this.hidden.filter((c) => c !== name);
    this._changed();
    return true;
  }

  /** Check about every half hour whether something is due. */
  start() {
    const tick = () => this.refresh().catch((err) => this.log?.warn(`Offers refresh failed: ${err.message}`));
    setTimeout(tick, 20_000).unref?.();
    this._timer = setInterval(tick, 30 * 60_000);
    this._timer.unref?.();
  }

  stop() {
    clearInterval(this._timer);
  }

  payload({ count = 5 } = {}) {
    const today = new Date(this.now().getTime() - this.now().getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
    const chains = new Set();
    const products = this.watch.map((w) => {
      const r = this.results[w.slug] ?? { offers: [], fetched_at: null, error: null };
      for (const o of r.offers) chains.add(o.chain);
      return { ...w, offers: selectOffers(r.offers, w, { today, hiddenChains: this.hidden, count }), updated: r.fetched_at, error: r.error, total: r.offers.length };
    });
    return { products, hidden: this.hidden, chains: [...chains].filter(Boolean).sort((a, b) => a.localeCompare(b, "da")), busy: this.busy, source: "tilbudsugen.dk" };
  }
}
