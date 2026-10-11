import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { NowPlayingStore } from "../src/nowplaying.js";

const silent = { info() {}, warn() {}, error() {}, debug() {} };
const state = (entity_id, st, attributes = {}) => ({ entity_id, state: st, attributes });
const track = (title, extra = {}) => ({ media_title: title, media_artist: "Artist", media_album_name: "Album", media_content_id: `library://track/${title}`, ...extra });
const png = { type: "image/png", body: Buffer.from([1, 2, 3]) };

function make(over = {}) {
  let clock = 1000;
  const store = new NowPlayingStore({ dir: null, logger: silent, fetchPicture: async () => png, now: () => (clock += 10), ...over });
  return store;
}
const tick = () => new Promise((r) => setTimeout(r, 5));

test("records the track of a playing or paused speaker and ignores everything else", () => {
  const store = make();
  let changes = 0;
  store.on("change", () => changes++);

  store.observe(state("light.x", "on", { media_title: "no" }));
  store.observe(state("media_player.a", "idle", track("Idle")));
  store.observe(state("media_player.a", "playing", { friendly_name: "no title" }));
  assert.deepEqual(store.payload(), {});

  store.observe(state("media_player.a", "playing", track("One")));
  store.observe(state("media_player.b", "paused", track("Two")));
  const payload = store.payload();
  assert.equal(payload["media_player.a"].title, "One");
  assert.equal(payload["media_player.a"].artist, "Artist");
  assert.equal(payload["media_player.a"].uri, "library://track/One");
  assert.equal(payload["media_player.b"].title, "Two");
  assert.equal(changes, 2);
});

test("the same track does not publish again, a new track or a replay after stopping does", () => {
  const store = make();
  let changes = 0;
  store.on("change", () => changes++);
  store.observe(state("media_player.a", "playing", track("One")));
  const first = store.payload()["media_player.a"].at;
  store.observe(state("media_player.a", "playing", track("One", { media_position: 12 })));
  assert.equal(changes, 1);

  store.observe(state("media_player.a", "playing", track("Two")));
  assert.equal(changes, 2);

  store.observe(state("media_player.a", "idle"));
  store.observe(state("media_player.a", "playing", track("Two")));
  assert.equal(changes, 3, "playing the same track again refreshes the time");
  assert.ok(store.payload()["media_player.a"].at > first);
});

test("channel names count as titles (radio)", () => {
  const store = make();
  store.observe(state("media_player.a", "playing", { media_channel: "DR P3" }));
  assert.equal(store.payload()["media_player.a"].title, "DR P3");
});

test("artwork is fetched, kept and published as a URL; failures are ignored", async () => {
  const seen = [];
  const store = make({ fetchPicture: async (picture) => (seen.push(picture), picture.includes("bad") ? null : png) });
  store.observe(state("media_player.a", "playing", track("One", { entity_picture: "/api/media_player_proxy/media_player.a?token=t" })));
  assert.equal(store.payload()["media_player.a"].art, null);
  await tick();
  assert.match(store.payload()["media_player.a"].art, /^api\/nowplaying\/art\/media_player\.a\?v=\d+$/);
  assert.equal(store.art("media_player.a").type, "image/png");
  assert.equal(store.art("media_player.zzz"), null);

  store.observe(state("media_player.b", "playing", track("Two", { entity_picture: "/bad" })));
  await tick();
  assert.equal(store.payload()["media_player.b"].art, null);
  assert.deepEqual(seen.length, 2);
});

test("artwork that arrives after the track changed is dropped", async () => {
  let release;
  const store = make({ fetchPicture: () => new Promise((r) => (release = () => r(png))) });
  store.observe(state("media_player.a", "playing", track("One", { entity_picture: "/one" })));
  store.observe(state("media_player.a", "playing", track("Two")));
  release();
  await tick();
  assert.equal(store.payload()["media_player.a"].art, null);
});

test("state survives a restart, including the artwork", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dasher-np-"));
  try {
    const first = make({ dir });
    first.observe(state("media_player.a", "playing", track("One", { entity_picture: "/p" })));
    await tick();
    first.flush();
    assert.ok(fs.existsSync(path.join(dir, "nowplaying.json")));

    const second = make({ dir });
    assert.equal(second.payload()["media_player.a"].title, "One");
    assert.deepEqual([...second.art("media_player.a").body], [1, 2, 3]);

    fs.writeFileSync(path.join(dir, "nowplaying.json"), "{broken");
    assert.deepEqual(make({ dir }).payload(), {});
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("only the 40 most recent speakers are kept", () => {
  const store = make();
  for (let i = 0; i < 45; i++) store.observe(state(`media_player.s${i}`, "playing", track(`T${i}`)));
  const ids = Object.keys(store.payload());
  assert.equal(ids.length, 40);
  assert.ok(!ids.includes("media_player.s0"));
  assert.ok(ids.includes("media_player.s44"));
});
