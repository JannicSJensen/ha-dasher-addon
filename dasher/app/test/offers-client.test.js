import assert from "node:assert/strict";
import { test } from "node:test";
import { chainColor, money, offerListText, packText, validityText } from "../web/js/lib/offers.js";

const offer = { brand: "Pepsi Max", name: "Cola", units: 1, quantity: 1.5, unit: "l", price: 9.95, chain: "Meny", start: "2026-10-23", end: "2026-10-29" };

test("money and package text", () => {
  assert.equal(money(9.95, "da"), "9,95");
  assert.equal(money(6.6, "en"), "6.60");
  assert.equal(packText(offer, "da"), "1,5 l");
  assert.equal(packText({ ...offer, units: 6, quantity: 0.33 }, "da"), "6 × 0,33 l");
  assert.equal(packText({ ...offer, quantity: 2, unit: "kg" }, "da"), "2 kg");
  assert.equal(packText({ ...offer, quantity: 0 }, "da"), "");
});

test("shopping list text names the product, the package, the store and the price", () => {
  assert.equal(offerListText(offer, "da"), "Pepsi Max Cola (Meny, 9,95 kr)".replace("Cola (", "Cola 1,5 l ("));
  assert.equal(offerListText({ ...offer, brand: "Danpo", name: "Kyllingebrystfilet", quantity: 0.4, unit: "kg" }, "da"), "Danpo Kyllingebrystfilet 0,4 kg (Meny, 9,95 kr)");
  assert.equal(offerListText({ ...offer, brand: "", name: "Laks" }, "da"), "Laks 1,5 l (Meny, 9,95 kr)");
});

test("validity text and store colours", () => {
  assert.match(validityText(offer, "2026-10-25", { locale: "da" }), /^until 29\. okt/);
  assert.match(validityText(offer, "2026-10-20", { locale: "da", from: "fra" }), /^fra 23\. okt/);
  assert.equal(validityText({ ...offer, end: null }, "2026-10-25"), "");
  assert.equal(chainColor("Meny"), chainColor("Meny"));
  assert.notEqual(chainColor("Meny"), chainColor("Netto"));
});
