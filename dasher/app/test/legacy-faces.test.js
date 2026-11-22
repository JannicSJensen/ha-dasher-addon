import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { cameraList, LEGACY_FACES, legacyOptions, listPhotoAlbums, openPhoto } from "../src/legacy-faces.js";

test("legacy configuration is ordered, opt-in and reports invalid values", () => {
  const defaults = legacyOptions();
  assert.deepEqual(defaults.faces, LEGACY_FACES);
  assert.equal(defaults.photos, false);
  assert.equal(defaults.cameras, false);
  assert.equal(defaults.wallpaper, null);
  const options = legacyOptions({ legacy_faces: ["weather", "home", "weather"], legacy_photos: true,
    legacy_photo_albums: ["Family"], legacy_cameras: true, legacy_camera_interval: 60 });
  assert.deepEqual(options.faces, ["weather", "home"]);
  assert.equal(options.photos, true);
  assert.equal(options.cameras, true);
  assert.equal(options.camera_interval, 60);
  const bad = legacyOptions({ legacy_faces: ["bad"], legacy_photos: true, legacy_photo_albums: ["../secret"], legacy_photo_interval: 1 });
  assert.equal(bad.photos, false);
  assert.equal(bad.errors.length, 3);
  assert.deepEqual(legacyOptions({ legacy_faces: [] }).faces, []);
  assert.equal(legacyOptions({ legacy_wallpaper: "Home view.png" }).wallpaper, "Home view.png");
  for (const filename of ["../wallpaper.jpg", "wallpaper.svg", "https://example.com/image.jpg", 123]) {
    const invalid = legacyOptions({ legacy_wallpaper: filename });
    assert.equal(invalid.wallpaper, null);
    assert.match(invalid.errors.join(" "), /Invalid legacy wallpaper/);
  }
});

test("photo albums constrain selection, extensions, sizes and symlinks", async (t) => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "dasher-legacy-"));
  t.after(() => fs.rm(tmp, { recursive: true, force: true }));
  const assets = path.join(tmp, "assets"), root = path.join(assets, "photos");
  await fs.mkdir(path.join(root, "Family"), { recursive: true });
  await fs.mkdir(path.join(tmp, "outside"));
  await fs.writeFile(path.join(root, "root.jpg"), "root");
  await fs.writeFile(path.join(root, "Family", "one.png"), "one");
  await fs.writeFile(path.join(root, "Family", "notes.txt"), "not an image");
  await fs.writeFile(path.join(tmp, "outside", "secret.jpg"), "secret");
  await fs.symlink(path.join(tmp, "outside"), path.join(root, "Link"));
  await fs.symlink(path.join(tmp, "outside", "secret.jpg"), path.join(root, "Family", "link.jpg"));
  const all = await listPhotoAlbums(assets);
  assert.deepEqual(all.albums.map((album) => [album.id, album.photos]), [["", ["root.jpg"]], ["Family", ["one.png"]]]);
  const selected = await listPhotoAlbums(assets, ["Family"]);
  assert.deepEqual(selected.albums.map((album) => album.id), ["Family"]);
  const photo = await openPhoto(assets, "Family", "one.png", ["Family"]);
  assert.equal((await photo.handle.readFile()).toString(), "one");
  await photo.handle.close();
  await assert.rejects(openPhoto(assets, "", "root.jpg", ["Family"]), { status: 404 });
  await assert.rejects(openPhoto(assets, "../outside", "secret.jpg"), { status: 404 });
  await assert.rejects(openPhoto(assets, "Link", "secret.jpg"), { status: 404 });
  await assert.rejects(openPhoto(assets, "Family", "link.jpg"), { status: 404 });
  const large = await fs.open(path.join(root, "Family", "large.jpg"), "w");
  await large.truncate(10 * 1024 * 1024 + 1);
  await large.close();
  await assert.rejects(openPhoto(assets, "Family", "large.jpg"), { status: 413 });
  assert.deepEqual(await listPhotoAlbums(path.join(tmp, "missing")), { albums: [], missing: true });
});

test("camera discovery only returns valid camera entities when enabled", () => {
  const index = new Map([
    ["camera.front", { id: "camera.front", name: "Front", domain: "camera" }],
    ["camera.invalid/name", { id: "camera.invalid/name", domain: "camera" }],
    ["light.room", { id: "light.room", domain: "light" }],
  ]);
  assert.deepEqual(cameraList(index, false), []);
  assert.deepEqual(cameraList(index, true), [{ id: "camera.front", name: "Front" }]);
});
