import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { OffersService, normalizeOffer, parsePage, selectOffers, slugFrom } from "../src/offers.js";

const silent = { warn() {}, info() {}, debug() {}, error() {} };
const fixture = (name) => JSON.parse(fs.readFileSync(new URL(`../dev/fixtures/offers-${name}.json`, import.meta.url), "utf8"));
const pageHtml = (items, lastPage = 1) => `<html><script id="__NEXT_DATA__" type="application/json">${JSON.stringify({ props: { pageProps: { data: { pageOfOrganicProductOffers: { items, lastValidPageNumber: lastPage } } } } })}</script></html>`;

const raw = (over = {}) => ({
  id: 1, price: "9.95", units: 1, quantity: "1.500", quantityType: "ltr.", pricePerFullUnitOfQuantityType: "6.63", startDate: "2026-10-23", endDate: "2026-10-29", isBorderShop: false,
  imageThumbnailUrl: "https://static.tilbudsugen.dk/a_thumb.jpg", productName: { productName: "Cola" }, brand: { name: "Pepsi Max" }, chain: { name: "Meny" }, ...over,
});

test("slugFrom: names and addresses", () => {
  assert.equal(slugFrom("Pepsi Max"), "pepsi-max");
  assert.equal(slugFrom("  Hakket oksekød "), "hakket-oksekød");
  assert.equal(slugFrom("https://www.tilbudsugen.dk/offer/pepsi-max"), "pepsi-max");
  assert.equal(slugFrom("https://www.tilbudsugen.dk/offer/m%C3%A6lk"), "mælk");
  assert.equal(slugFrom("https://evil.example/offer/pepsi-max"), null);
  assert.equal(slugFrom("https://www.tilbudsugen.dk/single/123"), null);
  for (const bad of ["", "../etc/passwd", "a/b", "---", "x".repeat(80), null]) assert.equal(slugFrom(bad), null, String(bad));
});

test("normalizeOffer keeps what is shown and drops what is unusable", () => {
  const o = normalizeOffer(raw());
  assert.deepEqual([o.id, o.chain, o.brand, o.name, o.unit, o.price, o.unit_price, o.end, o.url, o.image], [1, "Meny", "Pepsi Max", "Cola", "l", 9.95, 6.63, "2026-10-29", "https://www.tilbudsugen.dk/single/1", "https://static.tilbudsugen.dk/a_thumb.jpg"]);
  assert.equal(normalizeOffer(raw({ pricePerFullUnitOfQuantityType: "0" })), null);
  assert.equal(normalizeOffer(raw({ id: "abc" })), null);
  assert.equal(normalizeOffer(raw({ imageThumbnailUrl: "https://evil.example/x.jpg" })).image, null);
  assert.equal(normalizeOffer(raw({ quantityType: "kg." })).unit, "kg");
});

test("parsePage reads the JSON of the page and complains when the site changed", () => {
  assert.deepEqual(parsePage(pageHtml([{ id: 1 }], 3)), { items: [{ id: 1 }], lastPage: 3 });
  assert.throws(() => parsePage("<html></html>"), /no data/);
  assert.throws(() => parsePage('<script id="__NEXT_DATA__">{broken</script>'), /could not be read/);
  assert.throws(() => parsePage('<script id="__NEXT_DATA__">{"props":{}}</script>'), /no offers/);
});

const offers = (list) => list.map((o) => normalizeOffer(raw(o)));

test("selectOffers: cheapest per unit, one per store, valid and wanted only", () => {
  const list = offers([
    { id: 1, chain: { name: "Meny" }, pricePerFullUnitOfQuantityType: "6.63" },
    { id: 2, chain: { name: "Meny" }, pricePerFullUnitOfQuantityType: "5.50" },
    { id: 3, chain: { name: "Netto" }, pricePerFullUnitOfQuantityType: "7.00" },
    { id: 4, chain: { name: "Bilka" }, pricePerFullUnitOfQuantityType: "4.00", endDate: "2026-10-01" },
    { id: 5, chain: { name: "Lidl" }, pricePerFullUnitOfQuantityType: "3.00", isBorderShop: true },
    { id: 6, chain: { name: "Fakta" }, pricePerFullUnitOfQuantityType: "3.50", productName: { productName: "Koncentrat" } },
    { id: 7, chain: { name: "Rema 1000" }, pricePerFullUnitOfQuantityType: "6.00", brand: { name: "Coca-Cola" } },
    { id: 8, chain: { name: "Spar" }, pricePerFullUnitOfQuantityType: "5.00" },
    { id: 9, chain: { name: "Kvickly" }, pricePerFullUnitOfQuantityType: "9.00", quantityType: "stk." },
  ]);
  const base = { must: ["pepsi"], not: ["koncentrat"] };
  const pick = (extra = {}, watch = base) => selectOffers(list, watch, { today: "2026-10-25", ...extra }).map((o) => o.id);
  assert.deepEqual(pick(), [8, 2, 3], "cheapest first, Meny once, expired / border / koncentrat / other brand / other unit left out");
  assert.deepEqual(pick({ hiddenChains: ["spar"] }), [2, 3]);
  assert.deepEqual(pick({ count: 1 }), [8]);
  assert.equal(pick({}, { must: [], not: [] }).length, 5, "without words every store of the usual unit shows, up to five");
});

test("OffersService: add, select, hide a store, remove, and keep working when the site fails", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dasher-offers-"));
  try {
    let fail = false;
    const calls = [];
    const fetchImpl = async (url) => {
      calls.push(url);
      if (fail) return { ok: false, status: 503, url, text: async () => "" };
      const slug = decodeURIComponent(new URL(url).pathname.split("/").pop());
      const items = slug === "pepsi-max" ? fixture("pepsi-max") : slug === "laks" ? fixture("laks") : [];
      return { ok: true, status: 200, url, headers: new Map(), text: async () => pageHtml(items) };
    };
    const now = () => new Date("2026-10-25T12:00:00Z");
    const service = new OffersService({ dir, logger: silent, fetchImpl, baseUrl: "https://www.tilbudsugen.dk", now, gapMs: 0 });
    let changes = 0;
    service.on("change", () => changes++);

    await assert.rejects(() => service.add({ input: "../x" }), /name of a product/);
    assert.equal(await service.add({ input: "Pepsi Max", must: "pepsi", not: "sodastream, koncentrat" }), "pepsi-max");
    await assert.rejects(() => service.add({ input: "pepsi-max" }), /already/);
    const first = service.payload();
    assert.equal(first.products[0].name, "Pepsi Max");
    assert.ok(first.products[0].offers.length > 0 && first.products[0].offers.length <= 5);
    const chains = first.products[0].offers.map((o) => o.chain);
    assert.equal(new Set(chains).size, chains.length, "one offer per store");
    const prices = first.products[0].offers.map((o) => o.unit_price);
    assert.deepEqual(prices, [...prices].sort((a, b) => a - b));

    service.setChain(chains[0], true);
    assert.ok(!service.payload().products[0].offers.some((o) => o.chain === chains[0]));
    assert.ok(service.payload().hidden.includes(chains[0]));
    service.setChain(chains[0], false);

    // a restart reads everything back
    const again = new OffersService({ dir, logger: silent, fetchImpl, baseUrl: "https://www.tilbudsugen.dk", now, gapMs: 0 });
    assert.deepEqual(again.payload().products[0].offers.map((o) => o.id), service.payload().products[0].offers.map((o) => o.id));

    // fresh data is not fetched again, stale or forced data is, and a failing site keeps the last good answer
    const before = calls.length;
    await service.refresh();
    assert.equal(calls.length, before);
    fail = true;
    await service.refresh({ force: true });
    const after = service.payload().products[0];
    assert.match(after.error, /503/);
    assert.ok(after.offers.length > 0);
    await assert.rejects(() => service.add({ input: "laks" }), /503/);
    assert.equal(service.payload().products.length, 1, "a product that cannot be read is not added");

    fail = false;
    assert.equal(await service.add({ input: "https://www.tilbudsugen.dk/offer/laks", name: "Laks" }), "laks");
    assert.equal(service.payload().products.length, 2);
    assert.equal(service.remove("pepsi-max"), true);
    assert.equal(service.remove("pepsi-max"), false);
    assert.ok(changes > 3);
    assert.equal(await service.refreshNow(), true);
    assert.equal(await service.refreshNow(), false, "not again right away");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("OffersService refuses a site that redirects somewhere else and reads the second page for the full list", async () => {
  const service = new OffersService({ dir: null, logger: silent, baseUrl: "https://www.tilbudsugen.dk", gapMs: 0, fetchImpl: async (url) => ({ ok: true, status: 200, url: "https://evil.example/x", headers: new Map(), text: async () => "" }) });
  await assert.rejects(() => service.fetchProduct("laks"), /somewhere else/);
  const urls = [];
  const paged = new OffersService({
    dir: null,
    logger: silent,
    baseUrl: "https://www.tilbudsugen.dk",
    gapMs: 0,
    fetchImpl: async (url) => {
      urls.push(url);
      return { ok: true, status: 200, url, headers: new Map(), text: async () => pageHtml([raw({ id: urls.length })], 2) };
    },
  });
  await paged.fetchProduct("laks");
  assert.deepEqual(urls, ["https://www.tilbudsugen.dk/offer/laks", "https://www.tilbudsugen.dk/offer/laks?page=2"]);
});
