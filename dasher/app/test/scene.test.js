import assert from "node:assert/strict";
import { test } from "node:test";
import { assetUrl } from "../web/js/core/api.js";

test("scene: pictures are the built-in room pictures", () => {
  assert.equal(assetUrl("scene:kitchen"), "./img/rooms/kitchen.svg");
  assert.ok(!assetUrl("scene:../x").startsWith("./img/"), "only plain room names are accepted");
  assert.equal(assetUrl("living.jpg"), "./assets/living.jpg");
});

import { parseConfig } from "../src/config.js";

test("ambient: off unless asked for, short and long form, buttons checked", () => {
  const base = "pages:\n  - id: a\n    tiles: []\n";
  assert.equal(parseConfig(base).config.ambient.enabled, false);
  assert.deepEqual([parseConfig(`${base}ambient: 300\n`).config.ambient.enabled, parseConfig(`${base}ambient: 300\n`).config.ambient.after], [true, 300]);
  assert.equal(parseConfig(`${base}ambient: false\n`).config.ambient.enabled, false);
  assert.equal(parseConfig(`${base}ambient: 3\n`).config.ambient.enabled, false, "too short to be meant");
  const full = parseConfig(`${base}ambient:\n  buttons:\n    - { icon: lightbulb, name: Lights, entity: light.x }\n    - { icon: moon, entity: nonsense }\n    - { name: no icon }\n`);
  assert.equal(full.config.ambient.after, 600);
  assert.deepEqual(full.config.ambient.buttons.map((b) => b.entity), ["light.x"]);
  assert.equal(full.errors.length, 2);
  assert.ok(full.entities.has("light.x"));
});
