import assert from "node:assert/strict";
import { test } from "node:test";
import { candidateUrls, discoverMusicAssistant } from "../src/discovery.js";

const json = (data, status = 200) => ({ ok: status < 400, status, json: async () => data });

/** A fake Supervisor plus whatever answers the probe requests. */
function fakeFetch({ addons, infos = {}, alive = [] }) {
  const calls = [];
  const fn = async (url, init = {}) => {
    calls.push({ url, auth: init.headers?.Authorization });
    if (url === "http://supervisor/addons") return addons instanceof Error ? json({}, 500) : json({ data: { addons } });
    const info = url.match(/^http:\/\/supervisor\/addons\/([^/]+)\/info$/);
    if (info) return json({ data: infos[decodeURIComponent(info[1])] ?? {} });
    if (url.endsWith("/info")) {
      if (alive.some((base) => url === `${base}/info`)) return json({ server_version: "2.10.5" });
      throw new Error("connection refused");
    }
    return json({}, 404);
  };
  fn.calls = calls;
  return fn;
}

test("candidateUrls: host network apps are reached through the gateway, others by address and name", () => {
  assert.deepEqual(candidateUrls({ host_network: true, hostname: "x" }), ["http://172.30.32.1:8095"]);
  assert.deepEqual(candidateUrls({ host_network: false, ip_address: "172.30.33.5", hostname: "d5369777-music-assistant" }), ["http://172.30.33.5:8095", "http://d5369777-music-assistant:8095"]);
  assert.deepEqual(candidateUrls({ network: { "9000/tcp": 9000, "8095/tcp": 8100 }, ip_address: "172.30.33.5" }), ["http://172.30.33.5:8095"]);
  assert.deepEqual(candidateUrls({}), []);
});

test("finds a started Music Assistant app on the host network", async () => {
  const fetchImpl = fakeFetch({
    addons: [
      { slug: "core_samba", name: "Samba share", state: "started" },
      { slug: "d5369777_music_assistant", name: "Music Assistant Server", state: "started" },
    ],
    infos: { d5369777_music_assistant: { host_network: true, hostname: "d5369777-music-assistant" } },
    alive: ["http://172.30.32.1:8095"],
  });
  assert.deepEqual(await discoverMusicAssistant({ token: "sup", fetchImpl }), { url: "http://172.30.32.1:8095", slug: "d5369777_music_assistant" });
  assert.equal(fetchImpl.calls[0].auth, "Bearer sup");
});

test("prefers the stable app over a beta one, ignores stopped apps and tries the next address", async () => {
  const fetchImpl = fakeFetch({
    addons: [
      { slug: "d5369777_music_assistant_beta", name: "Music Assistant Server (beta)", state: "started" },
      { slug: "d5369777_music_assistant", name: "Music Assistant Server", state: "started" },
      { slug: "other_music_assistant", name: "Music Assistant", state: "stopped" },
    ],
    infos: {
      d5369777_music_assistant: { host_network: false, ip_address: "172.30.33.7", hostname: "d5369777-music-assistant" },
      d5369777_music_assistant_beta: { host_network: true },
    },
    alive: ["http://d5369777-music-assistant:8095", "http://172.30.32.1:8095"],
  });
  const found = await discoverMusicAssistant({ token: "t", fetchImpl });
  assert.deepEqual(found, { url: "http://d5369777-music-assistant:8095", slug: "d5369777_music_assistant" });
});

test("returns null when nothing is installed, nothing answers, or the Supervisor refuses", async () => {
  assert.equal(await discoverMusicAssistant({ token: "t", fetchImpl: fakeFetch({ addons: [{ slug: "core_ssh", name: "SSH", state: "started" }] }) }), null);
  assert.equal(await discoverMusicAssistant({ token: "t", fetchImpl: fakeFetch({ addons: [{ slug: "d_music_assistant", state: "started" }], infos: { d_music_assistant: { host_network: true } }, alive: [] }) }), null);
  assert.equal(await discoverMusicAssistant({ token: "t", fetchImpl: fakeFetch({ addons: new Error("nope") }) }), null);
  assert.equal(await discoverMusicAssistant({ token: "", fetchImpl: fakeFetch({ addons: [] }) }), null);
});
