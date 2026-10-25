import assert from "node:assert/strict";
import { test } from "node:test";
import { angleOf, arcPath, fractionFromPoint, fractionOf, pointAt, valueAt } from "../web/js/lib/dial.js";

const close = (a, b, eps = 0.01) => assert.ok(Math.abs(a - b) < eps, `${a} ~ ${b}`);

test("angles run from the lower left over the top to the lower right", () => {
  assert.equal(angleOf(0), -135);
  assert.equal(angleOf(0.5), 0);
  assert.equal(angleOf(1), 135);
  assert.equal(angleOf(2), 135);
  const top = pointAt(100, 100, 80, 0);
  close(top.x, 100);
  close(top.y, 20);
});

test("arcPath: large arc flag only past half the ring", () => {
  assert.match(arcPath(100, 100, 80, 0, 0.5), /A80 80 0 0 1 /);
  assert.match(arcPath(100, 100, 80, 0, 0.9), /A80 80 0 1 1 /);
});

test("fractionFromPoint reads a touch on the ring and snaps the gap to the nearer end", () => {
  close(fractionFromPoint(100, 100, 100, 20), 0.5); // straight up
  close(fractionFromPoint(100, 100, 20, 100), 0.167, 0.01); // left, 90 degrees after the start... 45/270
  close(fractionFromPoint(100, 100, 180, 100), 0.833, 0.01); // right
  assert.equal(fractionFromPoint(100, 100, 90, 190), 0, "bottom, slightly left of centre: start");
  assert.equal(fractionFromPoint(100, 100, 110, 190), 1, "bottom, slightly right of centre: end");
});

test("valueAt snaps to the step and stays in range; fractionOf is the inverse", () => {
  const range = { min: 5, max: 35, step: 0.5 };
  assert.equal(valueAt(0, range), 5);
  assert.equal(valueAt(1, range), 35);
  assert.equal(valueAt(0.5, range), 20);
  assert.equal(valueAt(0.4733, range), 19);
  assert.equal(valueAt(2, range), 35);
  assert.equal(fractionOf(20, range), 0.5);
  assert.equal(fractionOf(50, range), 1);
  assert.equal(fractionOf(1, { min: 5, max: 5 }), 0);
});
