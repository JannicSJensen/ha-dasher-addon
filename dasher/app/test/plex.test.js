import assert from "node:assert/strict";
import { test } from "node:test";
import { parseConfig } from "../src/config.js";
import { PlexService, buildSections, classifyHub, normalizeItem, plexConfigured, plexPlayers, splitTitle, validBrowse, validatePlay } from "../src/plex.js";
import { choosePlayer, fromStart } from "../web/js/lib/plex.js";

const SRV = "abc123";
const uri = (key, resume = false) => `plex://${SRV}/${key}${resume ? "?resume=1" : ""}`;
const raw = (key, type, title, extra = {}) => ({ title, media_content_id: uri(key, extra.resume), media_content_type: type, can_play: true, can_expand: Boolean(extra.expand), thumbnail: "/x" });
const silent = { warn() {}, info() {}, debug() {}, error() {} };
const settings = (over = {}) => ({ enabled: "auto", players: [], exclude: [], ...over });

test("splitTitle breaks Home Assistant's Plex titles into title, subtitle and meta", () => {
  assert.deepEqual(splitTitle("Lanterns - S01E01 - Pilot", "episode"), { title: "Lanterns", subtitle: "Pilot", meta: "S1 · E1" });
  assert.deepEqual(splitTitle("S02E10 - The End", "episode"), { title: "The End", subtitle: "", meta: "S2 · E10" });
  assert.deepEqual(splitTitle("The Boys - Season 5", "season"), { title: "The Boys", subtitle: "Season 5", meta: "" });
  assert.deepEqual(splitTitle("The Grand Tour (2016)", "movie"), { title: "The Grand Tour", subtitle: "", meta: "2016" });
  assert.deepEqual(splitTitle("Silo", "show"), { title: "Silo", subtitle: "", meta: "" });
  assert.equal(splitTitle("Movie - With - Dashes", "movie").title, "Movie - With - Dashes");
});

test("normalizeItem keeps Plex items and drops everything else", () => {
  const item = normalizeItem(raw(2001, "episode", "Lanterns - S01E01 - Pilot", { resume: true }));
  assert.deepEqual([item.id, item.type, item.resume, item.playable, item.expandable, item.image], [uri(2001, true), "episode", true, true, false, `api/plex/image/${SRV}/2001`]);
  assert.equal(normalizeItem(raw(1001, "show", "Silo", { expand: true })).expandable, true);
  assert.equal(normalizeItem({ title: "x", media_content_id: "http://evil/1", media_content_type: "movie" }), null);
  assert.equal(normalizeItem({ title: "x", media_content_id: `plex://${SRV}/server/Recommended`, media_content_type: "server" }), null);
  assert.equal(normalizeItem(raw(1, "movie", "No thumb")).image !== null, true);
  assert.equal(normalizeItem({ ...raw(1, "movie", "No thumb"), thumbnail: undefined }).image, null);
});

test("classifyHub recognises continue watching and recently added hubs in several languages", () => {
  const hub = (id, title) => ({ media_content_id: `plex://${SRV}/server/${id}`, title });
  assert.equal(classifyHub(hub("home.continue", "Continue Watching")), "continue");
  assert.equal(classifyHub(hub("home.ondeck", "On Deck")), "continue");
  assert.equal(classifyHub(hub("x.y", "Fortsæt med at se")), "continue");
  assert.equal(classifyHub(hub("home.movies.recent", "Recently Added Movies")), "recent");
  assert.equal(classifyHub(hub("movie.recentlyadded", "Senest tilføjede film")), "recent");
  assert.equal(classifyHub(hub("home.recommended", "Recommended For You")), null);
});

test("buildSections sorts items into continue, movies and series and drops music", () => {
  const items = (list) => list.map((r) => normalizeItem(r));
  const sections = buildSections([
    { kind: "continue", items: items([raw(1, "episode", "A - S01E01 - B", { resume: true }), raw(2, "movie", "M (2020)", { resume: true }), raw(9, "album", "Alb")]) },
    { kind: "recent", items: items([raw(3, "movie", "N (2021)"), raw(4, "show", "S", { expand: true }), raw(5, "episode", "S - S01E02 - T"), raw(6, "artist", "Art"), raw(3, "movie", "N (2021)")]) },
  ]);
  assert.deepEqual(sections.map((s) => s.kind), ["continue", "recent_movies", "recent_series"]);
  assert.deepEqual(sections[0].items.map((i) => i.type), ["episode", "movie"]);
  assert.equal(sections[1].items.length, 1);
  assert.deepEqual(sections[2].items.map((i) => i.type), ["show", "episode"]);
});

test("plexPlayers: Plex and Cast players by default, music-only clients left out, explicit lists win", () => {
  const registries = {
    entities: [
      { ei: "media_player.living_room_tv", pl: "cast" },
      { ei: "media_player.plex_ipad", pl: "plex" },
      { ei: "media_player.plex_music_assistant_part", pl: "plex" },
      { ei: "media_player.hidden_cast", pl: "cast", hb: true },
      { ei: "media_player.stuen_tv", pl: "apple_tv" },
      { ei: "light.x", pl: "cast" },
    ],
  };
  assert.deepEqual(plexPlayers({ settings: settings(), registries }).map((p) => p.id), ["media_player.living_room_tv", "media_player.plex_ipad"]);
  assert.deepEqual(plexPlayers({ settings: settings({ exclude: ["media_player.plex_ipad"] }), registries }).map((p) => p.id), ["media_player.living_room_tv"]);
  assert.deepEqual(plexPlayers({ settings: settings({ players: ["media_player.stuen_tv"] }), registries }), [{ id: "media_player.stuen_tv", platform: "apple_tv" }]);
  assert.deepEqual(plexPlayers({ settings: settings({ enabled: false }), registries }), []);
  assert.equal(plexConfigured(registries), true);
  assert.equal(plexConfigured({ entities: [{ ei: "media_player.x", pl: "cast" }] }), false);
});

test("validatePlay and validBrowse only accept Plex items, known types and configured players", () => {
  const players = [{ id: "media_player.tv", platform: "cast" }];
  assert.equal(validatePlay({ entity_id: "media_player.tv", id: uri(2001, true), type: "episode" }, players).ok, true);
  assert.equal(validatePlay({ entity_id: "media_player.other", id: uri(1), type: "movie" }, players).ok, false);
  assert.equal(validatePlay({ entity_id: "media_player.tv", id: "http://x/1", type: "movie" }, players).ok, false);
  assert.equal(validatePlay({ entity_id: "media_player.tv", id: `plex://${SRV}/1?x=1`, type: "movie" }, players).ok, false);
  assert.equal(validatePlay({ entity_id: "media_player.tv", id: uri(1), type: "album" }, players).ok, false);
  assert.equal(validBrowse({ id: uri(1001), type: "show" }), true);
  assert.equal(validBrowse({ id: uri(1001), type: "movie" }), false);
  assert.equal(validBrowse({ id: "plex://a/server/b", type: "show" }), false);
});

function fakeHa(tree) {
  const calls = [];
  return {
    calls,
    states: new Map([
      ["media_player.tv", { state: "idle" }],
      ["media_player.plex_ipad", { state: "unavailable" }],
    ]),
    async request(message) {
      calls.push(message);
      const key = `${message.media_content_type ?? ""}|${message.media_content_id ?? ""}`;
      if (!(key in tree)) throw new Error(`not found: ${key}`);
      return tree[key];
    },
    async callService(domain, service, data, ids) {
      calls.push({ domain, service, data, ids });
    },
  };
}

const server = { title: "Home", media_content_type: "server", children: [{ title: "Recommended (Home)", media_content_type: "server", media_content_id: uri("server/Recommended") }, { title: "Movies", media_content_type: "library", media_content_id: uri(1) }] };
const tree = {
  "|": { title: "Cast", media_content_type: "app", children: [{ title: "Plex", media_content_type: "plex", media_content_id: "" }] },
  "plex|": server,
  [`server|${uri("server/Recommended")}`]: {
    children: [
      { title: "Continue Watching", media_content_type: "hub", media_content_id: uri("server/home.continue") },
      { title: "Recently Added Movies", media_content_type: "hub", media_content_id: uri("server/home.movies.recent") },
      { title: "Recommended", media_content_type: "hub", media_content_id: uri("server/home.recommended") },
    ],
  },
  [`hub|${uri("server/home.continue")}`]: { children: [raw(2001, "episode", "Lanterns - S01E01 - Pilot", { resume: true })] },
  [`hub|${uri("server/home.movies.recent")}`]: { children: [raw(3001, "movie", "Mutiny (2026)")] },
};

test("PlexService.home browses through a Cast player, finds the hubs and caches the result", async () => {
  const ha = fakeHa(tree);
  const service = new PlexService({ ha, logger: silent, fetchImage: async () => null });
  service.configure([{ id: "media_player.tv", platform: "cast" }, { id: "media_player.plex_ipad", platform: "plex" }]);
  const home = await service.home();
  assert.equal(home.sections.length, 2);
  assert.deepEqual(home.sections.map((s) => s.kind), ["continue", "recent_movies"]);
  assert.ok(ha.calls.every((c) => c.entity_id === "media_player.tv"), "the unavailable player is not used");
  const before = ha.calls.length;
  await service.home();
  assert.equal(ha.calls.length, before);
});

test("PlexService.home explains when no player is available", async () => {
  const ha = fakeHa(tree);
  ha.states.set("media_player.tv", { state: "unavailable" });
  const service = new PlexService({ ha, logger: silent, fetchImage: async () => null });
  service.configure([{ id: "media_player.tv", platform: "cast" }]);
  await assert.rejects(() => service.home(), /No Plex or Cast player is available/);
});

test("PlexService.play calls media_player.play_media and image() caches", async () => {
  const ha = fakeHa(tree);
  let fetched = 0;
  const service = new PlexService({ ha, logger: silent, fetchImage: async () => ((fetched += 1), { type: "image/png", body: Buffer.from("x") }) });
  await service.play("media_player.tv", uri(2001, true), "episode");
  assert.deepEqual(ha.calls.at(-1), { domain: "media_player", service: "play_media", data: { media_content_id: uri(2001, true), media_content_type: "episode" }, ids: ["media_player.tv"] });
  await service.image(SRV, "2001");
  await service.image(SRV, "2001");
  assert.equal(fetched, 1);
});

test("the plex: section is parsed", () => {
  const { config, errors, entities } = parseConfig(
    "pages:\n  - id: a\n    tiles: []\nplex:\n  title: Film\n  players: [media_player.tv, light.nope]\n  exclude: [media_player.x]\n",
  );
  assert.equal(config.plex.title, "Film");
  assert.deepEqual(config.plex.players, ["media_player.tv"]);
  assert.ok(errors.some((e) => e.includes("light.nope")));
  assert.ok(entities.has("media_player.tv"));
  assert.deepEqual([parseConfig("pages:\n  - id: a\n    tiles: []\n").config.plex.enabled], ["auto"]);
});

test("choosePlayer prefers the remembered player while it is online", () => {
  const states = { "media_player.a": { state: "idle" }, "media_player.b": { state: "unavailable" }, "media_player.c": { state: "playing" } };
  const get = (id) => states[id];
  const ids = ["media_player.a", "media_player.b", "media_player.c"];
  assert.equal(choosePlayer(ids, get, "media_player.c"), "media_player.c");
  assert.equal(choosePlayer(ids, get, "media_player.b"), "media_player.a");
  assert.equal(choosePlayer(ids, get, null), "media_player.a");
  assert.equal(choosePlayer([], get, null), null);
  assert.equal(fromStart({ id: uri(1, true) }).id, uri(1));
});
