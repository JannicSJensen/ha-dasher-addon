import assert from "node:assert/strict";
import { test } from "node:test";
import { RadioService, radioPlayers, validateGroupRequest } from "../src/radio.js";
import { canGroup, findActiveStation, groupOf, initials, pickPlayer } from "../web/js/lib/radio.js";

const silent = { info() {}, warn() {}, error() {}, debug() {} };

function fakeHa({ entries = [{ entry_id: "E1", state: "loaded" }], items, fail } = {}) {
  const calls = [];
  return {
    calls,
    connected: true,
    async request(msg) {
      calls.push(msg);
      if (msg.type === "config_entries/get") return entries;
      throw new Error(`unexpected ${msg.type}`);
    },
    async callServiceWithResponse(domain, service, data) {
      calls.push({ domain, service, data });
      if (fail) throw new Error(fail);
      return { items };
    },
    async callService(domain, service, data, entityIds) {
      calls.push({ domain, service, data, entityIds });
    },
  };
}

const ITEMS = [
  { uri: "library://radio/2", name: "DR P3", image: "http://ma.local:8095/imageproxy?path=a" },
  { uri: "library://radio/1", name: "DR P1", image: null },
  { uri: "library://radio/1", name: "duplicate" },
  { uri: "library://radio/9", name: "Bad image", image: "javascript:alert(1)" },
  { name: "no uri" },
];

const make = (ha, fetchImpl) => {
  const radio = new RadioService({ ha, logger: silent, fetchImpl });
  radio.configure({ enabled: true });
  return radio;
};

test("loads stations through music_assistant.get_library and publishes them", async () => {
  const ha = fakeHa({ items: ITEMS });
  const radio = make(ha);
  let changes = 0;
  radio.on("change", () => changes++);
  await radio.refresh();

  assert.deepEqual(ha.calls[0], { type: "config_entries/get", domain: "music_assistant" });
  assert.equal(ha.calls[1].service, "get_library");
  assert.equal(ha.calls[1].data.config_entry_id, "E1");
  assert.equal(ha.calls[1].data.media_type, "radio");

  const { stations, error } = radio.payload();
  assert.equal(error, null);
  assert.deepEqual(stations.map((s) => s.name), ["DR P3", "DR P1", "Bad image"]);
  assert.match(stations[0].image, /^api\/radio\/image\/[0-9a-f]{10}\?v=/);
  assert.equal(stations[1].image, null);
  assert.equal(stations[2].image, null, "non-http image URLs are dropped");
  assert.equal(changes, 1);

  await radio.refresh();
  assert.equal(changes, 1, "an unchanged list does not publish again");
  assert.equal(ha.calls.filter((c) => c.type === "config_entries/get").length, 1, "entry id is remembered");
});

test("an explicit config_entry_id skips the lookup", async () => {
  const ha = fakeHa({ items: [] });
  const radio = new RadioService({ ha, logger: silent });
  radio.configure({ enabled: true, config_entry_id: "FIXED" });
  await radio.refresh();
  assert.ok(!ha.calls.some((c) => c.type === "config_entries/get"));
  assert.equal(ha.calls[0].data.config_entry_id, "FIXED");
});

test("failures are reported in the payload instead of throwing", async () => {
  const none = make(fakeHa({ entries: [], items: [] }));
  await none.refresh();
  assert.match(none.payload().error, /not set up/);

  const broken = make(fakeHa({ items: [], fail: "boom" }));
  await broken.refresh();
  assert.equal(broken.payload().error, "boom");
  assert.deepEqual(broken.payload().stations, []);
});

test("does nothing when disabled or while Home Assistant is disconnected", async () => {
  const ha = fakeHa({ items: ITEMS });
  const off = new RadioService({ ha, logger: silent });
  off.configure({ enabled: false });
  await off.refresh();
  ha.connected = false;
  await make(ha).refresh();
  assert.equal(ha.calls.length, 0);
});

test("play() uses the stored URI and replaces the queue; unknown stations are rejected", async () => {
  const ha = fakeHa({ items: ITEMS });
  const radio = make(ha);
  await radio.refresh();
  const id = radio.payload().stations[1].id;
  await radio.play("media_player.kitchen", id);
  assert.deepEqual(ha.calls.at(-1), {
    domain: "music_assistant",
    service: "play_media",
    data: { media_id: "library://radio/1", media_type: "radio", enqueue: "replace" },
    entityIds: ["media_player.kitchen"],
  });
  await assert.rejects(radio.play("media_player.kitchen", "nope"), { status: 404 });
});

test("logos are fetched only for known stations, only as images, and cached", async () => {
  const ha = fakeHa({ items: ITEMS });
  let fetched = [];
  const fetchImpl = async (url) => {
    fetched.push(url);
    return {
      ok: true,
      status: 200,
      headers: { get: () => (url.includes("html") ? "text/html" : "image/png") },
      arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
    };
  };
  const radio = make(ha, fetchImpl);
  await radio.refresh();
  const [first] = radio.payload().stations;

  const a = await radio.image(first.id);
  const b = await radio.image(first.id);
  assert.equal(a.type, "image/png");
  assert.deepEqual([...a.body], [1, 2, 3]);
  assert.equal(a, b);
  assert.deepEqual(fetched, ["http://ma.local:8095/imageproxy?path=a"]);
  assert.equal(await radio.image("unknown"), null);

  const htmlRadio = make(fakeHa({ items: [{ uri: "library://radio/5", name: "X", image: "http://ma.local/html" }] }), fetchImpl);
  await htmlRadio.refresh();
  await assert.rejects(htmlRadio.image(htmlRadio.payload().stations[0].id), /Not an image/);
});

test("radioPlayers: explicit list, else Music Assistant entities from the registry", () => {
  const registries = {
    entities: [
      { ei: "media_player.b", pl: "music_assistant" },
      { ei: "media_player.a", pl: "music_assistant" },
      { ei: "media_player.hidden", pl: "music_assistant", hb: true },
      { ei: "media_player.diag", pl: "music_assistant", ec: 2 },
      { ei: "media_player.tv", pl: "lg_netcast" },
      { ei: "sensor.x", pl: "music_assistant" },
      { ei: "media_player.skip", pl: "music_assistant" },
    ],
  };
  const base = { enabled: true, players: [], exclude: ["media_player.skip"] };
  assert.deepEqual(radioPlayers(base, registries), ["media_player.a", "media_player.b"]);
  assert.deepEqual(radioPlayers({ ...base, players: ["media_player.tv", "media_player.skip"] }, registries), ["media_player.tv"]);
  assert.deepEqual(radioPlayers({ ...base, enabled: false }, registries), []);
  assert.deepEqual(radioPlayers(base, null), []);
});

test("findActiveStation matches by URI, then by name, and only while playing", () => {
  const stations = [
    { id: "1", name: "DR P1", uri: "library://radio/1" },
    { id: "2", name: "NOVA", uri: "library://radio/2" },
  ];
  const player = (state, attributes) => ({ state, attributes });
  assert.equal(findActiveStation(stations, player("playing", { media_content_id: "library://radio/2" })).id, "2");
  assert.equal(findActiveStation(stations, player("paused", { media_content_id: "library://radio/1" })).id, "1");
  assert.equal(findActiveStation(stations, player("playing", { media_content_id: "x://other", media_album_name: "nova" })).id, "2");
  assert.equal(findActiveStation(stations, player("playing", { media_title: "Some song" })), null);
  assert.equal(findActiveStation(stations, player("idle", { media_content_id: "library://radio/1" })), null);
  assert.equal(findActiveStation(stations, null), null);
});

test("pickPlayer prefers saved, then default, then a playing speaker, ignoring unavailable ones", () => {
  const states = {
    "media_player.a": { state: "idle" },
    "media_player.b": { state: "playing" },
    "media_player.c": { state: "unavailable" },
  };
  const get = (id) => states[id];
  const players = ["media_player.a", "media_player.b", "media_player.c"];
  assert.equal(pickPlayer({ players, getState: get, saved: "media_player.a" }), "media_player.a");
  assert.equal(pickPlayer({ players, getState: get, saved: "media_player.c", defaultPlayer: "media_player.a" }), "media_player.a");
  assert.equal(pickPlayer({ players, getState: get, saved: null, defaultPlayer: null }), "media_player.b");
  assert.equal(pickPlayer({ players: ["media_player.c"], getState: get }), null);
});

test("initials for stations without a logo", () => {
  assert.equal(initials("DR P4 København"), "DP");
  assert.equal(initials("NOVA"), "NOV");
});

test("group(): removals use unjoin first, additions one join on the leader", async () => {
  const ha = fakeHa({ items: [] });
  const radio = make(ha);
  await radio.group("media_player.lead", { add: ["media_player.a", "media_player.b"], remove: ["media_player.c"] });
  assert.deepEqual(ha.calls, [
    { domain: "media_player", service: "unjoin", data: {}, entityIds: ["media_player.c"] },
    { domain: "media_player", service: "join", data: { group_members: ["media_player.a", "media_player.b"] }, entityIds: ["media_player.lead"] },
  ]);
  ha.calls.length = 0;
  await radio.group("media_player.lead", { remove: ["media_player.a"] });
  assert.equal(ha.calls.length, 1);
});

test("validateGroupRequest only accepts the radio page's speakers", () => {
  const players = ["media_player.a", "media_player.b", "media_player.c"];
  const ok = validateGroupRequest({ leader: "media_player.a", add: ["media_player.b", "media_player.b"], remove: ["media_player.c"] }, players);
  assert.deepEqual(ok, { ok: true, leader: "media_player.a", add: ["media_player.b"], remove: ["media_player.c"] });

  for (const body of [
    null,
    { leader: "media_player.x", add: ["media_player.b"] },
    { leader: "media_player.a", add: ["media_player.x"] },
    { leader: "media_player.a", add: "media_player.b" },
    { leader: "media_player.a" },
    { leader: "media_player.a", add: ["media_player.a"] },
    { leader: "media_player.a", remove: ["media_player.a"] },
    { leader: "media_player.a", add: [42] },
  ]) {
    assert.equal(validateGroupRequest(body, players).ok, false, JSON.stringify(body));
  }
});

test("groupOf reads the leader and members from group_members; canGroup needs the feature flag", () => {
  const states = {
    "media_player.lead": { state: "playing", attributes: { group_members: ["media_player.lead", "media_player.kid"], supported_features: 524288 } },
    "media_player.kid": { state: "playing", attributes: { group_members: ["media_player.lead", "media_player.kid"], supported_features: 524288 } },
    "media_player.solo": { state: "idle", attributes: { group_members: [], supported_features: 4 } },
    "media_player.single": { state: "idle", attributes: { group_members: ["media_player.single"] } },
    "media_player.party": { state: "playing", attributes: { group_members: ["media_player.a", "media_player.b"], mass_player_type: "group", supported_features: 524288 } },
    "media_player.gone": { state: "unavailable", attributes: { supported_features: 524288 } },
  };
  const get = (id) => states[id];
  assert.deepEqual(groupOf("media_player.kid", get), { leader: "media_player.lead", members: ["media_player.lead", "media_player.kid"], grouped: true });
  assert.equal(groupOf("media_player.lead", get).leader, "media_player.lead");
  assert.deepEqual(groupOf("media_player.solo", get), { leader: "media_player.solo", members: ["media_player.solo"], grouped: false });
  assert.equal(groupOf("media_player.single", get).grouped, false);
  assert.equal(groupOf("media_player.party", get).grouped, false, "universal group players are not sync groups");
  assert.equal(groupOf("media_player.unknown", get).leader, "media_player.unknown");

  assert.equal(canGroup(states["media_player.lead"]), true);
  assert.equal(canGroup(states["media_player.solo"]), false);
  assert.equal(canGroup(states["media_player.party"]), false);
  assert.equal(canGroup(states["media_player.gone"]), false);
  assert.equal(canGroup(undefined), false);
});
