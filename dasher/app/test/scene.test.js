import assert from "node:assert/strict";
import { test } from "node:test";
import { assetUrl } from "../web/js/core/api.js";

test("scene: pictures are the built-in room pictures", () => {
  assert.equal(assetUrl("scene:kitchen"), "./img/rooms/kitchen.svg");
  assert.ok(!assetUrl("scene:../x").startsWith("./img/"), "only plain room names are accepted");
  assert.equal(assetUrl("living.jpg"), "./assets/living.jpg");
});
