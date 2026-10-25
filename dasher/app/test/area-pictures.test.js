import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { AreaPictures } from "../src/area-pictures.js";
import { ROOM_TYPES } from "../src/room-images.js";

const silent = { warn() {}, info() {}, debug() {}, error() {} };

function setup({ existing = () => true, failUpload = false, failUpdate = false } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dasher-areapics-"));
  const imageDir = path.join(dir, "rooms");
  fs.mkdirSync(imageDir);
  for (const type of ROOM_TYPES) fs.writeFileSync(path.join(imageDir, `${type}.jpg`), `jpeg-${type}`);
  const uploads = [];
  const updates = [];
  const pictures = new AreaPictures({
    ha: {
      async request(message) {
        if (failUpdate) throw new Error("registry says no");
        updates.push(message);
      },
    },
    upload: async (name, buffer, type) => {
      if (failUpload) throw new Error("HTTP 403");
      uploads.push({ name, text: buffer.toString(), type });
      return `id${uploads.length}`;
    },
    exists: async (url) => existing(url),
    dir,
    imageDir,
    logger: silent,
  });
  return { pictures, uploads, updates, dir, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

const areas = [
  { area_id: "stuen", name: "Stue", picture: null },
  { area_id: "koekken", name: "Køkken", picture: null },
  { area_id: "stue2", name: "Stue 2", picture: null },
  { area_id: "bad", name: "Bad", picture: "/api/image/serve/own/512x512" },
];

test("areas without a picture get one; each room picture is uploaded once and shared", async () => {
  const t = setup();
  try {
    assert.equal(await t.pictures.sync(areas), 3);
    assert.deepEqual(t.uploads.map((u) => [u.name, u.text, u.type]), [["dasher-living.jpg", "jpeg-living", "image/jpeg"], ["dasher-kitchen.jpg", "jpeg-kitchen", "image/jpeg"]]);
    assert.deepEqual(t.updates.map((u) => [u.type, u.area_id, u.picture]), [
      ["config/area_registry/update", "stuen", "/api/image/serve/id1/original"],
      ["config/area_registry/update", "koekken", "/api/image/serve/id2/original"],
      ["config/area_registry/update", "stue2", "/api/image/serve/id1/original"],
    ]);
    assert.deepEqual([...t.pictures.appliedAreas].sort(), ["koekken", "stue2", "stuen"]);
    // a second run, also from a new instance reading the saved file, has nothing to do
    assert.equal(await t.pictures.sync(areas), 0);
    assert.equal(t.uploads.length, 2);
  } finally {
    t.cleanup();
  }
});

test("an area that lost its Dasher picture is left alone, and a missing upload is uploaded again", async () => {
  let alive = true;
  const t = setup({ existing: () => alive });
  try {
    await t.pictures.sync([areas[0]]);
    assert.equal(t.uploads.length, 1);
    assert.equal(await t.pictures.sync([{ ...areas[0], picture: null }]), 0, "someone removed it on purpose");
    alive = false;
    assert.equal(await t.pictures.sync([areas[1], { area_id: "stue3", name: "Stue 3", picture: null }]), 2);
    assert.equal(t.uploads.length, 3, "the stored living picture was gone: uploaded again");
  } finally {
    t.cleanup();
  }
});

test("rooms from dashboard.yaml choose the picture; the first problem stops the pass and nothing is recorded", async () => {
  const t = setup();
  try {
    await t.pictures.sync([{ area_id: "stuen", name: "Stue", picture: null }], { rooms: { stuen: "garden" } });
    assert.equal(t.uploads[0].name, "dasher-garden.jpg");
  } finally {
    t.cleanup();
  }
  for (const options of [{ failUpload: true }, { failUpdate: true }]) {
    const f = setup(options);
    try {
      assert.equal(await f.pictures.sync(areas), 0);
      assert.equal(f.pictures.appliedAreas.size, 0);
    } finally {
      f.cleanup();
    }
  }
});
