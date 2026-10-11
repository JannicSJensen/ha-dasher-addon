import assert from "node:assert/strict";
import { test } from "node:test";
import { MAError } from "../src/ma-api.js";
import { PartyReader, buildParty, isMissingPlugin, qrSvg, queueEntry } from "../src/party.js";

const options = { baseUrl: "http://ma:8095", registerImage: (source) => `api/music/image/${source.length}` };
const track = (id, name, extra = {}) => ({
  queue_item_id: `q${id}`,
  name,
  duration: 200,
  media_item: { name, media_type: "track", artists: [{ name: "Dua Lipa" }], album: { name: "Future Nostalgia" }, image: { type: "thumb", path: "x", provider: "p", proxy_id: "abc" } },
  extra_attributes: extra,
});

test("queueEntry maps a queue item and its guest marks", () => {
  const entry = queueEntry(track(1, "We're Good", { party_guest: true, party_boosted: true }), options);
  assert.deepEqual([entry.id, entry.title, entry.artist, entry.album, entry.duration, entry.requested, entry.boosted], ["q1", "We're Good", "Dua Lipa", "Future Nostalgia", 200, true, true]);
  assert.ok(entry.image.startsWith("api/music/image/"));
  const plain = queueEntry(track(2, "Plain"), options);
  assert.deepEqual([plain.requested, plain.boosted], [false, false]);
  assert.equal(queueEntry({ queue_item_id: "x" }, options), null);
  assert.equal(queueEntry(null, options), null);
  assert.equal(queueEntry({ queue_item_id: "r", name: "Radio X", media_item: { media_type: "radio", name: "Radio X" } }, options).artist, "");
});

test("buildParty: the first item from the current index is what is playing, the rest is up next", () => {
  const items = [track(1, "Now"), track(2, "Next", { party_guest: true }), track(3, "After")];
  const party = buildParty({ url: "http://ma/join/abc", config: { mode: "remote", party_name: "Fri", qr_text: "Scan", request_badge_color: "#fff", boost_badge_color: "red" }, playerId: "media_player.x", queue: { state: "playing", current_index: 4, elapsed_time: 12.4 }, items }, options);
  assert.equal(party.enabled, true);
  assert.equal(party.now.title, "Now");
  assert.deepEqual(party.next.map((e) => e.title), ["Next", "After"]);
  assert.equal(party.next[0].requested, true);
  assert.deepEqual([party.mode, party.name, party.qrText, party.elapsed, party.requestColor, party.boostColor], ["remote", "Fri", "Scan", 12, "#fff", null]);
  const idle = buildParty({ url: null, config: null, playerId: null, queue: null, items: [] }, options);
  assert.deepEqual([idle.enabled, idle.mode, idle.now, idle.next, idle.name], [false, "venue", null, [], null]);
  const noCurrent = buildParty({ url: "u", config: {}, playerId: "p", queue: { current_index: null }, items }, options);
  assert.equal(noCurrent.now, null);
  assert.equal(noCurrent.next.length, 3);
});

test("qrSvg makes a scannable SVG", async () => {
  const svg = await qrSvg("http://192.168.3.50:8095/join/abc");
  assert.match(svg, /^<\?xml|^<svg/);
  assert.match(svg, /<path/);
});

test("PartyReader reads the plugin and the queue, caches, and explains a missing plugin", async () => {
  const calls = [];
  const answers = {
    "party/url": "http://ma/join/abc123",
    "party/config": { mode: "venue" },
    "party/player": "media_player.x",
    "player_queues/get": { state: "playing", current_index: 1 },
    "player_queues/items": [track(1, "Prev"), track(2, "Now")],
  };
  const client = { async call(command, args) { calls.push([command, args]); if (!(command in answers)) throw new MAError("Music Assistant: Command not found: x"); return answers[command]; } };
  let now = 0;
  const reader = new PartyReader({ client, options, now: () => now });
  const party = await reader.read();
  assert.equal(party.now.title, "Prev");
  assert.deepEqual(calls.find(([c]) => c === "player_queues/items")[1], { queue_id: "media_player.x", limit: 30, offset: 1 });
  assert.match(party.qr, /^api\/music\/party\/qr\?v=/);
  const before = calls.length;
  await reader.read();
  assert.equal(calls.length, before);
  const qr = await reader.qr();
  assert.equal(qr.type, "image/svg+xml");
  now = 10_000;
  const missing = new PartyReader({ client: { async call() { throw new MAError("Music Assistant: Command not found: party/url"); } }, options });
  await assert.rejects(() => missing.read(), /Party plugin is not enabled/);
  assert.equal(isMissingPlugin(new MAError("Music Assistant: Command not found: party/url")), true);
  assert.equal(isMissingPlugin(new MAError("Music Assistant refused the access token.")), false);
});
