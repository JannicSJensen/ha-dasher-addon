import assert from "node:assert/strict";
import { test } from "node:test";
import { MAClient, MAError, imageSource, normalizeUrl, pickImage, toCard, toDetail, toSearchGroups } from "../src/ma-api.js";
import { MusicService, availableTabs, validPlayUri } from "../src/music.js";

const silent = { info() {}, warn() {}, error() {}, debug() {} };
const BASE = "http://ma.local:8095";

const jsonResponse = (body, status = 200) => ({
  ok: status < 400,
  status,
  headers: { get: (h) => (h.toLowerCase() === "content-type" ? "application/json" : null) },
  json: async () => body,
  text: async () => JSON.stringify(body),
});

function fakeFetch(handler) {
  const calls = [];
  const fn = async (url, init = {}) => {
    const call = { url, init, body: init.body ? JSON.parse(init.body) : null };
    calls.push(call);
    return handler(call);
  };
  fn.calls = calls;
  return fn;
}

const img = (over = {}) => ({ type: "thumb", path: "p", provider: "library", remotely_accessible: false, proxy_id: "abc", ...over });

test("MAClient posts the command with the Bearer token and returns the result", async () => {
  const fetchImpl = fakeFetch(() => jsonResponse([{ name: "x" }]));
  const client = new MAClient({ url: `${BASE}/`, token: "secret", fetchImpl });
  assert.equal(client.configured, true);
  assert.deepEqual(await client.call("music/albums/library_items", { limit: 5 }), [{ name: "x" }]);
  const [call] = fetchImpl.calls;
  assert.equal(call.url, `${BASE}/api`);
  assert.equal(call.init.method, "POST");
  assert.equal(call.init.headers.Authorization, "Bearer secret");
  assert.deepEqual(call.body, { message_id: "1", command: "music/albums/library_items", args: { limit: 5 } });
});

test("MAClient errors are readable and never contain the token", async () => {
  const unconfigured = new MAClient({ url: "", token: "" });
  await assert.rejects(unconfigured.call("x"), { status: 503 });

  const refused = new MAClient({ url: BASE, token: "TOPSECRET", fetchImpl: fakeFetch(() => jsonResponse("no", 401)) });
  await assert.rejects(refused.call("x"), (err) => err instanceof MAError && /refused the access token/.test(err.message) && !err.message.includes("TOPSECRET"));

  const failing = new MAClient({ url: BASE, token: "t", fetchImpl: fakeFetch(() => jsonResponse({ details: "Boom happened" }, 500)) });
  await assert.rejects(failing.call("x"), /Boom happened/);

  const down = new MAClient({ url: BASE, token: "TOPSECRET", fetchImpl: async () => { throw Object.assign(new Error("fetch failed"), { cause: { code: "ECONNREFUSED" } }); } });
  await assert.rejects(down.call("x"), (err) => /not reachable.*connection refused/.test(err.message) && !err.message.includes("TOPSECRET"));

  const aggregate = new MAClient({ url: BASE, token: "t", fetchImpl: async () => { throw Object.assign(new Error("fetch failed"), { cause: { errors: [{ code: "ENOTFOUND" }] } }); } });
  await assert.rejects(aggregate.call("x"), /unknown host/);
  const slow = new MAClient({ url: BASE, token: "t", fetchImpl: async () => { throw Object.assign(new Error("x"), { name: "TimeoutError" }); } });
  await assert.rejects(slow.call("x"), /timed out/);
});

test("normalizeUrl accepts only http(s) and strips trailing slashes", () => {
  assert.equal(normalizeUrl("http://192.168.1.10:8095/"), "http://192.168.1.10:8095");
  assert.equal(normalizeUrl(" https://ma.example/sub/ "), "https://ma.example/sub");
  assert.equal(normalizeUrl("ftp://x"), "");
  assert.equal(normalizeUrl("nonsense"), "");
  assert.equal(normalizeUrl(undefined), "");
});

test("pickImage: own thumb, album, metadata, artists, podcast, then landscape/any", () => {
  assert.equal(pickImage({ image: img({ path: "own" }) }).path, "own");
  assert.equal(pickImage({ album: { image: img({ path: "album" }) }, metadata: { images: [img({ path: "meta" })] } }).path, "album");
  assert.equal(pickImage({ metadata: { images: [img({ type: "fanart", path: "f" }), img({ path: "meta" })] } }).path, "meta");
  assert.equal(pickImage({ artists: [{ metadata: { images: [img({ path: "artist" })] } }] }).path, "artist");
  assert.equal(pickImage({ podcast: { image: img({ path: "pod" }) } }).path, "pod");
  assert.equal(pickImage({ metadata: { images: [img({ type: "landscape", path: "wide" })] } }).path, "wide");
  assert.equal(pickImage({ name: "none" }), null);
  assert.equal(pickImage(null), null);
});

test("imageSource: remote URL, proxy id, legacy double-encoded path", () => {
  assert.equal(imageSource(img({ remotely_accessible: true, path: "https://cdn.example/a.jpg" }), BASE), "https://cdn.example/a.jpg");
  assert.equal(imageSource(img({ remotely_accessible: true, path: "javascript:1" }), BASE), null);
  assert.equal(imageSource(img(), BASE, 300), `${BASE}/imageproxy/abc?size=300`);
  assert.equal(imageSource(img({ proxy_id: undefined, path: "a b/c", provider: "fs" }), BASE), `${BASE}/imageproxy?path=a%2520b%252Fc&provider=fs&size=300`);
  assert.equal(imageSource({}, BASE), null);
});

const options = { baseUrl: BASE, registerImage: (u) => `api/music/image/${Buffer.from(u).toString("hex").slice(0, 6)}` };

test("toCard builds subtitles per type and skips unsupported items", () => {
  const album = toCard({ item_id: "1", provider: "library", name: "Alb", media_type: "album", year: 2020, artists: [{ name: "A" }, { name: "B" }], metadata: { images: [img()] } }, options);
  assert.equal(album.subtitle, "A, B · 2020");
  assert.equal(album.uri, "library://album/1");
  assert.equal(album.container, true);
  assert.match(album.image, /^api\/music\/image\//);

  const track = toCard({ item_id: "2", name: "T", media_type: "track", uri: "spotify://track/9", duration: 201.4, track_number: 3, artists: [{ name: "A" }], album: { name: "Alb" } }, options);
  assert.deepEqual([track.subtitle, track.uri, track.duration, track.number, track.container], ["A · Alb", "spotify://track/9", 201, 3, false]);

  const episode = toCard({ item_id: "3", name: "Ep", media_type: "podcast_episode", podcast: { name: "Pod" }, fully_played: true, resume_position_ms: 90500, metadata: { release_date: "2026-09-27T06:00:00" } }, options);
  assert.deepEqual([episode.subtitle, episode.played, episode.resume, episode.date], ["Pod", true, 91, "2026-09-27"]);

  assert.equal(toCard({ item_id: "4", name: "Folder", media_type: "folder" }, options), null);
  assert.equal(toCard({ item_id: "5", media_type: "album" }, options), null);
  assert.equal(toCard({ name: "No id or uri", media_type: "album" }, options), null);
  assert.equal(toCard(null, options), null);
});

test("toDetail adds a tag-free description", () => {
  const detail = toDetail({ item_id: "1", name: "P", media_type: "podcast", publisher: "Pub", metadata: { description: "<p>Hello <b>world</b></p>", genres: ["a", "b"] } }, options);
  assert.equal(detail.description, "Hello world");
  assert.deepEqual(detail.genres, ["a", "b"]);
});

test("toSearchGroups sorts results into the groups the page shows", () => {
  const groups = toSearchGroups({ artists: [{ item_id: "1", name: "A", media_type: "artist" }], tracks: [{ item_id: "2", name: "T", media_type: "track" }], genres: [{ name: "ignored" }] }, options);
  assert.equal(groups.artists.length, 1);
  assert.equal(groups.tracks.length, 1);
  assert.deepEqual(groups.albums, []);
  assert.deepEqual(Object.keys(groups).sort(), ["albums", "artists", "playlists", "podcasts", "radio", "tracks"]);
});

function service(handler, ha = { calls: [], async callService(...args) { this.calls.push(args); } }) {
  const fetchImpl = fakeFetch(handler);
  return { svc: new MusicService({ ha, logger: silent, url: BASE, token: "tok", fetchImpl }), fetchImpl, ha };
}

test("library() maps the tab to a command, clamps paging and detects 'more'", async () => {
  const items = Array.from({ length: 3 }, (_, i) => ({ item_id: String(i), name: `A${i}`, media_type: "album" }));
  const { svc, fetchImpl } = service(() => jsonResponse(items));
  const result = await svc.library({ tab: "albums", q: "ab", limit: "3", offset: "-5", sort: "new", favorite: true });
  assert.equal(result.items.length, 3);
  assert.equal(result.more, true);
  assert.deepEqual(fetchImpl.calls[0].body.args, { limit: 3, offset: 0, order_by: "timestamp_added_desc", search: "ab", favorite: true });
  assert.equal(fetchImpl.calls[0].body.command, "music/albums/library_items");
  await assert.rejects(svc.library({ tab: "nope" }), { status: 400 });
});

test("library() retries without order_by when the server does not know the sort", async () => {
  let n = 0;
  const { svc, fetchImpl } = service(() => (++n === 1 ? jsonResponse({ details: "Invalid order_by" }, 500) : jsonResponse([])));
  const result = await svc.library({ tab: "artists", sort: "random" });
  assert.deepEqual(result, { items: [], more: false });
  assert.equal(fetchImpl.calls.length, 2);
  assert.ok(!("order_by" in fetchImpl.calls[1].body.args));
});

test("discover() loads every row's items, drops empty rows and is cached", async () => {
  const { svc, fetchImpl } = service(({ body }) => {
    if (body.command === "music/recommendations") {
      return jsonResponse([
        { item_id: "r1", provider: "library", name: "Recent", enabled_by_default: true },
        { item_id: "r2", provider: "library", name: "Empty" },
        { item_id: "r3", provider: "library", name: "Off", enabled_by_default: false },
        { item_id: "r4", provider: "library", name: "Broken" },
      ]);
    }
    if (body.args.item_id === "r1") return jsonResponse([{ item_id: "1", name: "Alb", media_type: "album" }, { name: "Folder", media_type: "folder" }]);
    if (body.args.item_id === "r4") return jsonResponse({ details: "x" }, 500);
    return jsonResponse([]);
  });
  const first = await svc.discover();
  assert.deepEqual(first.rows.map((r) => [r.name, r.items.length]), [["Recent", 1]]);
  const calls = fetchImpl.calls.length;
  await svc.discover();
  assert.equal(fetchImpl.calls.length, calls, "second call is served from the cache");
});

test("search() ignores very short queries and asks for the grouped media types", async () => {
  const { svc, fetchImpl } = service(() => jsonResponse({ albums: [{ item_id: "1", name: "Alb", media_type: "album" }] }));
  assert.deepEqual((await svc.search("a")).albums, []);
  assert.equal(fetchImpl.calls.length, 0);
  assert.equal((await svc.search("alb")).albums.length, 1);
  assert.equal(fetchImpl.calls[0].body.command, "music/search");
  assert.equal(fetchImpl.calls[0].body.args.search_query, "alb");
});

test("detail() reads the item and its children per type", async () => {
  const seen = [];
  const { svc } = service(({ body }) => {
    seen.push(body.command);
    if (body.command.endsWith("/get")) return jsonResponse({ item_id: "7", provider: "library", name: "Thing", media_type: body.command.split("/")[1].slice(0, -1) });
    return jsonResponse([{ item_id: "9", name: "Child", media_type: body.command.includes("album_tracks") ? "track" : "album" }]);
  });
  const album = await svc.detail("album", "library", "7");
  assert.equal(album.item.name, "Thing");
  assert.deepEqual(album.sections.map((s) => s.name), ["tracks"]);
  const artist = await svc.detail("artist", "library", "7");
  assert.deepEqual(artist.sections.map((s) => s.name), ["albums", "tracks"].slice(0, artist.sections.length));
  assert.ok(seen.includes("music/artists/artist_albums"));
  await assert.rejects(svc.detail("track", "library", "1"), { status: 400 });
  await assert.rejects(svc.detail("album", "", "1"), { status: 400 });
});

test("images are proxied only for registered sources; the token only goes to Music Assistant", async () => {
  const requests = [];
  const { svc } = service(({ url, init }) => {
    requests.push({ url, auth: init.headers?.Authorization });
    return { ok: true, status: 200, headers: { get: () => "image/jpeg" }, arrayBuffer: async () => new Uint8Array([1, 2]).buffer };
  });
  const own = svc.options.registerImage(`${BASE}/imageproxy/abc?size=300`).split("/").pop();
  const external = svc.options.registerImage("https://cdn.example/cover.jpg").split("/").pop();

  assert.equal((await svc.image(own)).type, "image/jpeg");
  await svc.image(external);
  await svc.image(own);
  assert.deepEqual(requests, [
    { url: `${BASE}/imageproxy/abc?size=300`, auth: "Bearer tok" },
    { url: "https://cdn.example/cover.jpg", auth: undefined },
  ]);
  assert.equal(await svc.image("unregistered"), null);
});

test("images that are not images are rejected", async () => {
  const { svc } = service(() => ({ ok: true, status: 200, headers: { get: () => "text/html" }, arrayBuffer: async () => new ArrayBuffer(1) }));
  const id = svc.options.registerImage("https://x.example/a").split("/").pop();
  await assert.rejects(svc.image(id), /Not an image/);
});

test("play() sends music_assistant.play_media with validated data", async () => {
  const { svc, ha } = service(() => jsonResponse({}));
  await svc.play("media_player.k", { uri: "library://album/5", type: "album", enqueue: "replace", startItem: "library://track/9" });
  await svc.play("media_player.k", { uri: "library://podcast_episode/3", type: "podcast_episode", enqueue: "add" });
  assert.deepEqual(ha.calls[0], ["music_assistant", "play_media", { media_id: "library://album/5", enqueue: "replace", media_type: "album", start_item: "library://track/9" }, ["media_player.k"]]);
  assert.deepEqual(ha.calls[1][2], { media_id: "library://podcast_episode/3", enqueue: "add" }, "episodes carry no media type");

  for (const bad of [
    { uri: "https://evil.example/stream.mp3", type: "track" },
    { uri: "javascript://track/1", type: "track" },
    { uri: "library://album/5", type: "album", enqueue: "explode" },
    { uri: "library://album/5", type: "album", startItem: "http://x/y" },
    { uri: "not a uri" },
    {},
  ]) {
    await assert.rejects(svc.play("media_player.k", bad), { status: 400 }, JSON.stringify(bad));
  }
  assert.equal(ha.calls.length, 2);
});

test("validPlayUri and availableTabs", () => {
  assert.equal(validPlayUri("spotify--abc://track/123"), true);
  assert.equal(validPlayUri("library://radio/4"), true);
  assert.equal(validPlayUri("http://x/y"), false);
  assert.equal(validPlayUri(5), false);
  assert.deepEqual(availableTabs({ tabs: ["discover", "radio", "albums", "search"] }, false), ["radio"]);
  assert.deepEqual(availableTabs({ tabs: ["discover", "radio", "albums", "search"] }, true), ["discover", "radio", "albums", "search"]);
  assert.deepEqual(availableTabs(undefined, true), ["discover", "radio", "albums", "artists", "podcasts", "search"]);
});

test("MAClient reports what is still missing for browsing", () => {
  assert.equal(new MAClient({ url: "", token: "" }).missing, "both");
  assert.equal(new MAClient({ url: "", token: "t" }).missing, "url");
  assert.equal(new MAClient({ url: BASE, token: "" }).missing, "token");
  const client = new MAClient({ url: BASE, token: "t" });
  assert.equal(client.missing, null);
  client.baseUrl = "";
  assert.equal(client.configured, false);
});
