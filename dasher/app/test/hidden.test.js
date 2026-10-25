import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { HiddenDevices } from "../src/hidden.js";

const silent = { warn() {}, info() {}, debug() {}, error() {} };

test("HiddenDevices remembers removed devices on disk and ignores bad input", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dasher-hidden-"));
  try {
    const store = new HiddenDevices({ dir, logger: silent });
    assert.equal(store.set("light.a", true), true);
    assert.equal(store.set("light.a", true), false, "no change");
    assert.equal(store.set("climate.b", true), true);
    assert.equal(store.set("not an id", true), false);
    assert.equal(store.set(42, true), false);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, "hidden-devices.json"), "utf8")), { hidden: ["climate.b", "light.a"], devices: [] });
    assert.ok(!fs.existsSync(path.join(dir, "hidden-devices.json.tmp")));

    const again = new HiddenDevices({ dir, logger: silent });
    assert.deepEqual([...again.ids].sort(), ["climate.b", "light.a"]);
    assert.equal(again.set("light.a", false), true);
    assert.equal(again.set("light.a", false), false);
    assert.deepEqual([...new HiddenDevices({ dir, logger: silent }).ids], ["climate.b"]);

    // the Devices page has its own list
    assert.equal(again.set("sensor.vask_status", true, "devices"), true);
    assert.equal(again.set("sensor.vask_status", true, "devices"), false);
    assert.ok(!again.ids.has("sensor.vask_status"));
    assert.deepEqual([...new HiddenDevices({ dir, logger: silent }).devices], ["sensor.vask_status"]);
    assert.equal(again.set("sensor.vask_status", false, "devices"), true);

    fs.writeFileSync(path.join(dir, "hidden-devices.json"), "{{{");
    assert.equal(new HiddenDevices({ dir, logger: silent }).ids.size, 0, "an unreadable file means nothing is hidden");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("HiddenDevices works without a folder", () => {
  const store = new HiddenDevices({ dir: null, logger: silent });
  assert.equal(store.set("light.a", true), true);
  assert.ok(store.ids.has("light.a"));
});
