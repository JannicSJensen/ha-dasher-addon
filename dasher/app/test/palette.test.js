import assert from "node:assert/strict";
import { test } from "node:test";
import { paletteFromPixels, rgbToHsl } from "../web/js/lib/palette.js";

const pixels = (...colors) => Uint8ClampedArray.from(colors.flatMap(([r, g, b, a = 255]) => [r, g, b, a]));

test("rgbToHsl", () => {
  const red = rgbToHsl(255, 0, 0);
  assert.deepEqual([Math.round(red.h), red.s, red.l], [0, 1, 0.5]);
  assert.equal(rgbToHsl(128, 128, 128).s, 0);
  assert.equal(Math.round(rgbToHsl(0, 0, 255).h), 240);
});

test("paletteFromPixels ranks colourful groups and ignores grey, dark, light and transparent pixels", () => {
  const data = pixels(...Array(10).fill([220, 40, 40]), ...Array(4).fill([30, 120, 230]), ...Array(50).fill([120, 120, 120]), ...Array(30).fill([5, 5, 5]), ...Array(30).fill([250, 250, 250]), ...Array(30).fill([0, 255, 0, 10]));
  const palette = paletteFromPixels(data, 3);
  assert.equal(palette.length, 2);
  assert.match(palette[0], /^hsl\((0|359|360|1) /);
  assert.match(palette[1], /^hsl\(2[0-3]\d /);
  assert.deepEqual(paletteFromPixels(pixels([120, 120, 120], [0, 0, 0]), 3), []);
});

test("paletteFromPixels keeps glowing, readable lightness", () => {
  const [dark] = paletteFromPixels(pixels(...Array(5).fill([60, 10, 10])), 1);
  const lightness = Number(/(\d+)%\)$/.exec(dark)[1]);
  assert.ok(lightness >= 45 && lightness <= 60, dark);
});
