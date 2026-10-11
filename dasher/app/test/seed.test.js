import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { ConfigStore } from "../src/config.js";
import { STOCK_EXAMPLE_HASHES, hashDashboard } from "../src/stock-examples.js";

const silent = { info() {}, warn() {}, error() {}, debug() {} };
const examplePath = fileURLToPath(new URL("../examples/dashboard.yaml", import.meta.url));

function setup(existing) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dasher-seed-"));
  if (existing != null) fs.writeFileSync(path.join(dir, "dashboard.yaml"), existing);
  const store = new ConfigStore({ dir, logger: silent, onChange() {} });
  store.seedIfMissing(examplePath);
  return { dir, read: (f) => fs.readFileSync(path.join(dir, f), "utf8"), exists: (f) => fs.existsSync(path.join(dir, f)) };
}

test("the shipped example is registered as a stock example (add its hash to src/stock-examples.js when it changes)", () => {
  const hash = hashDashboard(fs.readFileSync(examplePath, "utf8"));
  assert.ok(STOCK_EXAMPLE_HASHES.has(hash), `add this hash to STOCK_EXAMPLE_HASHES: ${hash}`);
});

test("a missing dashboard.yaml is created from the example, and a current copy is kept beside it", () => {
  const s = setup(null);
  const example = fs.readFileSync(examplePath, "utf8");
  assert.equal(s.read("dashboard.yaml"), example);
  assert.equal(s.read("dashboard.example.yaml"), example);
});

test("an edited dashboard.yaml is left alone", () => {
  const s = setup("title: Mine\npages: []\n");
  assert.equal(s.read("dashboard.yaml"), "title: Mine\npages: []\n");
  assert.ok(!s.exists("dashboard.yaml.bak"));
  assert.equal(s.read("dashboard.example.yaml"), fs.readFileSync(examplePath, "utf8"));
});

test("an unedited example of an older version is replaced, keeping a backup", () => {
  // Pick any stock example that is not the current one, by reconstructing it from a known old text.
  const old = fs.readFileSync(examplePath, "utf8").replace("type: calendar", "type: price");
  STOCK_EXAMPLE_HASHES.add(hashDashboard(old));
  try {
    const s = setup(old);
    assert.equal(s.read("dashboard.yaml"), fs.readFileSync(examplePath, "utf8"));
    assert.equal(s.read("dashboard.yaml.bak"), old);
  } finally {
    STOCK_EXAMPLE_HASHES.delete(hashDashboard(old));
  }
});

test("the example with Windows line endings still counts as unedited", () => {
  const current = fs.readFileSync(examplePath, "utf8");
  assert.equal(hashDashboard(current.replace(/\n/g, "\r\n")), hashDashboard(current));
});
