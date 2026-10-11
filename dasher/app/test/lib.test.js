import assert from "node:assert/strict";
import { test } from "node:test";
import { evaluate, pickFirst } from "../web/js/lib/conditions.js";
import { makeTranslator, translateState } from "../web/js/lib/i18n.js";
import { currentSlot, makeClassifier, normalizeSlots, priceRange } from "../web/js/lib/price.js";

const states = {
  "light.a": { state: "on", attributes: { brightness: 200 } },
  "sun.sun": { state: "below_horizon", attributes: {} },
  "sensor.n": { state: "12.5", attributes: {} },
};
const get = (id) => states[id];

test("conditions: state, list of states, attribute, numeric and negation", () => {
  assert.equal(evaluate({ entity: "light.a", state: "on" }, get), true);
  assert.equal(evaluate({ entity: "light.a", state: ["off", "on"] }, get), true);
  assert.equal(evaluate({ entity: "light.a", attribute: "brightness", above: 100 }, get), true);
  assert.equal(evaluate({ entity: "sensor.n", below: 10 }, get), false);
  assert.equal(evaluate({ entity: "light.a", state: "on", not: true }, get), false);
  assert.equal(evaluate({ entity: "light.missing", state: "on" }, get), false);
  assert.equal(evaluate([{ entity: "light.a", state: "on" }, { entity: "sun.sun", state: "above_horizon" }], get), false);
  assert.equal(evaluate({ any: [{ entity: "light.a", state: "off" }, { entity: "sun.sun", state: "below_horizon" }] }, get), true);
});

test("pickFirst returns the first match and treats missing `when` as default", () => {
  const list = [{ when: { entity: "light.a", state: "off" }, image: "1" }, { when: { entity: "sun.sun", state: "below_horizon" }, image: "2" }, { image: "3" }];
  assert.equal(pickFirst(list, get).image, "2");
  assert.equal(pickFirst([{ image: "x" }], get).image, "x");
  assert.equal(pickFirst([], get), null);
});

test("price slots: Nordpool style objects", () => {
  const now = new Date(2026, 5, 1, 10, 30);
  const mk = (h, v) => ({ start: new Date(2026, 5, 1, h).toISOString(), end: new Date(2026, 5, 1, h + 1).toISOString(), value: v });
  const slots = normalizeSlots({ raw_today: [mk(0, 1), mk(1, 2), mk(10, 3)] }, { now });
  assert.equal(slots.length, 3);
  assert.equal(currentSlot(slots, now.getTime()).value, 3);
  assert.deepEqual(priceRange(slots), { min: 1, max: 3 });
});

test("price slots: Energi Data Service style (hour/price) and missing ends", () => {
  const now = new Date(2026, 5, 1, 10, 30);
  const raw = [0, 1, 2].map((h) => ({ hour: new Date(2026, 5, 1, h).toISOString(), price: h + 1 }));
  const slots = normalizeSlots({ raw_today: raw }, { now });
  assert.equal(slots[0].end, slots[1].start);
  assert.equal(slots[2].end - slots[2].start, 3600_000);
});

test("price slots: plain number arrays cover the day evenly", () => {
  const now = new Date(2026, 5, 1, 13, 0);
  const slots = normalizeSlots({ today: Array.from({ length: 24 }, (_, i) => i) }, { now });
  assert.equal(slots.length, 24);
  assert.equal(currentSlot(slots, now.getTime()).value, 13);
  assert.deepEqual(normalizeSlots({}, { now }), []);
});

test("price classifier splits the day in thirds unless thresholds are given", () => {
  const slots = Array.from({ length: 9 }, (_, i) => ({ start: i, end: i + 1, value: i }));
  const classify = makeClassifier(slots);
  assert.equal(classify(0), "low");
  assert.equal(classify(4), "mid");
  assert.equal(classify(8), "high");
  assert.equal(makeClassifier(slots, { low: 5, high: 6 })(2), "low");
});

test("i18n falls back to English and prettifies unknown states", () => {
  const da = makeTranslator("da");
  assert.equal(translateState(da, "on"), "Til");
  assert.equal(translateState(makeTranslator("xx"), "on"), "On");
  assert.equal(translateState(da, "some_odd_state"), "Some odd state");
});

import { areaIcon, areaStats, cropFor, lightsOn, visibleAreaEntities } from "../web/js/lib/areas.js";
import { throttle } from "../web/js/lib/throttle.js";

const stateMap = (obj) => (id) => obj[id];
const mk = (state, attributes = {}) => ({ state, attributes });

test("area tiles: group members are hidden and unavailable entities move last", () => {
  const getState = stateMap({
    "light.group": mk("on", { entity_id: ["light.a", "light.b"] }),
    "light.a": mk("on"),
    "light.b": mk("off"),
    "light.c": mk("unavailable"),
    "light.d": mk("off"),
  });
  const area = { entities: ["light.a", "light.b", "light.c", "light.d", "light.group"] };
  assert.deepEqual(visibleAreaEntities(area, getState), ["light.d", "light.group", "light.c"]);
  assert.equal(lightsOn(area, getState), 1);
});

test("area stats use the median and ignore unavailable sensors", () => {
  const getState = stateMap({
    "sensor.t1": mk("20", { unit_of_measurement: "°C" }),
    "sensor.t2": mk("22", { unit_of_measurement: "°C" }),
    "sensor.t3": mk("60", { unit_of_measurement: "°C" }),
    "sensor.t4": mk("unavailable"),
    "sensor.h1": mk("40", { unit_of_measurement: "%" }),
    "binary_sensor.w1": mk("off"),
    "binary_sensor.w2": mk("on"),
    "binary_sensor.w3": mk("unavailable"),
  });
  const stats = areaStats(
    { temperature: ["sensor.t1", "sensor.t2", "sensor.t3", "sensor.t4"], humidity: ["sensor.h1"], windows: ["binary_sensor.w1", "binary_sensor.w2", "binary_sensor.w3"] },
    getState,
  );
  assert.deepEqual(stats.temperature, { value: 22, unit: "°C" });
  assert.deepEqual(stats.humidity, { value: 40, unit: "%" });
  assert.deepEqual(stats.windows, { open: 1, total: 2 });
  assert.deepEqual(areaStats({ temperature: [], humidity: [], windows: [] }, getState), { temperature: null, humidity: null, windows: null });
});

test("area icons: explicit icon first, then guessed from the name", () => {
  assert.equal(areaIcon({ id: "x", name: "Y", icon: "mdi:tv" }), "tv");
  assert.equal(areaIcon({ id: "stuen", name: "Stue" }), "sofa");
  assert.equal(areaIcon({ id: "udestue", name: "Udestue" }), "tree");
  assert.equal(areaIcon({ id: "sovevaerelse", name: "Soveværelse" }), "bed");
  assert.equal(areaIcon({ id: "q", name: "Something" }), "home-outline");
  assert.notEqual(cropFor(0), cropFor(1));
});

test("throttle sends the first value at once and the last one after the delay", async () => {
  const seen = [];
  const send = throttle((v) => seen.push(v), 40);
  send(1);
  send(2);
  send(3);
  assert.deepEqual(seen, [1]);
  await new Promise((r) => setTimeout(r, 70));
  assert.deepEqual(seen, [1, 3]);
  await new Promise((r) => setTimeout(r, 40));
  send(4); // sent at once because the window has passed
  send(5);
  send.cancel(); // 5 must never be sent
  await new Promise((r) => setTimeout(r, 70));
  assert.deepEqual(seen, [1, 3, 4]);
});

import { formatDuration, formatTotal, neighbourTab, playRequest, swipeStep } from "../web/js/lib/music.js";

test("durations: m:ss, h:mm:ss and totals", () => {
  assert.equal(formatDuration(201), "3:21");
  assert.equal(formatDuration(59.6), "1:00");
  assert.equal(formatDuration(3725), "1:02:05");
  assert.equal(formatDuration(undefined), "0:00");
  assert.equal(formatTotal(1500), "25 min");
  assert.equal(formatTotal(4980), "1 h 23 min");
});

test("tab neighbours do not wrap around", () => {
  const tabs = ["discover", "radio", "albums"];
  assert.equal(neighbourTab(tabs, "radio", 1), "albums");
  assert.equal(neighbourTab(tabs, "radio", -1), "discover");
  assert.equal(neighbourTab(tabs, "albums", 1), null);
  assert.equal(neighbourTab(tabs, "discover", -1), null);
});

test("swipes must be long, mostly horizontal and quick", () => {
  assert.equal(swipeStep(-150, 10, 200), 1);
  assert.equal(swipeStep(150, -20, 300), -1);
  assert.equal(swipeStep(-40, 0, 100), 0, "too short");
  assert.equal(swipeStep(-120, 100, 200), 0, "mostly vertical");
  assert.equal(swipeStep(-200, 0, 1200), 0, "too slow, a drag");
});

test("playRequest starts albums, playlists and podcasts at the tapped item", () => {
  const album = { type: "album", uri: "library://album/1" };
  const track = { type: "track", uri: "library://track/9" };
  assert.deepEqual(playRequest(track, { container: album }), { uri: "library://album/1", type: "album", startItem: "library://track/9", enqueue: "replace" });
  const podcast = { type: "podcast", uri: "library://podcast/2" };
  const episode = { type: "podcast_episode", uri: "library://podcast_episode/5" };
  assert.equal(playRequest(episode, { container: podcast }).startItem, "library://podcast_episode/5");
  // artists are not queues, and "add" queues only the tapped item
  assert.deepEqual(playRequest(track, { container: { type: "artist", uri: "library://artist/3" } }), { uri: "library://track/9", type: "track", enqueue: "replace" });
  assert.deepEqual(playRequest(track, { container: album, enqueue: "add" }), { uri: "library://track/9", type: "track", enqueue: "add" });
  assert.deepEqual(playRequest(album), { uri: "library://album/1", type: "album", enqueue: "replace" });
});

import { chooseNowPlaying, describeMedia, lastPlayedFor, timeAgo, trackPosition } from "../web/js/lib/nowplaying.js";

const np = (state, changed, attributes = {}) => ({ state, last_changed: changed, attributes });

test("now playing: playing beats paused, the newest wins, and the current one sticks", () => {
  const states = {
    "media_player.a": np("playing", "2026-10-11T10:00:00Z"),
    "media_player.b": np("playing", "2026-10-11T11:00:00Z"),
    "media_player.c": np("paused", "2026-10-11T12:00:00Z"),
    "media_player.d": np("idle", "2026-10-11T12:30:00Z"),
  };
  const get = (id) => states[id];
  const ids = Object.keys(states);
  const first = chooseNowPlaying({ ids, getState: get });
  assert.deepEqual([first.id, first.mode, first.active.sort()], ["media_player.b", "playing", ["media_player.a", "media_player.b"]]);
  assert.equal(chooseNowPlaying({ ids, getState: get, current: "media_player.a" }).id, "media_player.a");
  assert.equal(chooseNowPlaying({ ids, getState: get, current: "media_player.d" }).id, "media_player.b", "an inactive current speaker is ignored");

  states["media_player.a"] = np("idle", "x");
  states["media_player.b"] = np("off", "x");
  assert.deepEqual([chooseNowPlaying({ ids, getState: get }).id, chooseNowPlaying({ ids, getState: get }).mode], ["media_player.c", "paused"]);

  states["media_player.c"] = np("idle", "x");
  assert.equal(chooseNowPlaying({ ids, getState: get }), null);
});

test("now playing: a sync group counts once, as its leader", () => {
  const members = ["media_player.lead", "media_player.kid"];
  const states = {
    "media_player.lead": np("playing", "2026-10-11T10:00:00Z", { group_members: members }),
    "media_player.kid": np("playing", "2026-10-11T11:00:00Z", { group_members: members }),
  };
  const result = chooseNowPlaying({ ids: members, getState: (id) => states[id] });
  assert.deepEqual([result.id, result.active], ["media_player.lead", ["media_player.lead"]]);
});

test("last played: the most recent entry among the candidate speakers", () => {
  const last = { "media_player.a": { at: 100, title: "A" }, "media_player.b": { at: 300, title: "B" }, "media_player.z": { at: 900, title: "Z" } };
  assert.equal(lastPlayedFor(["media_player.a", "media_player.b"], last).id, "media_player.b");
  assert.equal(lastPlayedFor(["media_player.q"], last), null);
  assert.equal(lastPlayedFor([], undefined), null);
});

test("describeMedia names the station when the URI matches one", () => {
  const stations = [{ id: "1", name: "DR P3", uri: "library://radio/2" }];
  const media = describeMedia({ media_title: "Song", media_artist: "Band", media_content_id: "library://radio/2" }, stations);
  assert.deepEqual([media.title, media.artist, media.subtitle], ["Song", "Band", "Band · DR P3"]);
  assert.equal(describeMedia({ media_title: "Song", media_artist: "Band" }, stations).subtitle, "Band");
  assert.equal(describeMedia({ media_content_id: "library://radio/2" }, stations).title, "DR P3", "falls back to the station name");
  assert.equal(describeMedia({}, []).title, "");
});

test("timeAgo and trackPosition", () => {
  const now = Date.parse("2026-10-11T12:00:00Z");
  assert.match(timeAgo(now - 10_000, { now, locale: "en" }), /now/);
  assert.equal(timeAgo(now - 5 * 60_000, { now, locale: "en" }), "5 minutes ago");
  assert.equal(timeAgo(now - 3 * 3600_000, { now, locale: "en" }), "3 hours ago");
  assert.equal(timeAgo(now - 2 * 86_400_000, { now, locale: "en" }), "2 days ago");

  const attrs = { media_duration: 200, media_position: 50, media_position_updated_at: "2026-10-11T11:59:50Z" };
  assert.equal(trackPosition(attrs, "playing", now).position, 60);
  assert.equal(trackPosition(attrs, "paused", now).position, 50);
  assert.equal(trackPosition({ ...attrs, media_position: 195 }, "playing", now).position, 200, "never past the end");
  assert.equal(trackPosition({ media_position: 5 }, "playing", now), null);
});

import { batteryOf, chargeAction, hoursOf, isCharging, isPluggedIn, minutesOf, parseTimeOptions, plannedWindow, serviceFor } from "../web/js/lib/ev.js";

const evGet = (states) => (id) => states[id];

test("ev: battery comes from the battery sensor, else from EV Smart Charging", () => {
  const roles = { battery_entity: "sensor.soc", smart_info_entity: "sensor.info" };
  const info = { state: "off", attributes: { ev_soc: "55.0", ev_target_soc: "80.0" } };
  assert.deepEqual(batteryOf(roles, evGet({ "sensor.soc": { state: "67.0" }, "sensor.info": info })), { percent: 67, target: 80 });
  assert.deepEqual(batteryOf(roles, evGet({ "sensor.soc": { state: "unavailable" }, "sensor.info": info })), { percent: 55, target: 80 });
  assert.deepEqual(batteryOf({}, evGet({})), { percent: null, target: null });
  assert.equal(batteryOf({ battery_entity: "sensor.soc" }, evGet({ "sensor.soc": { state: "unknown" } })).percent, null);
});

test("ev: charging and plug state from whatever entities exist", () => {
  assert.equal(isCharging({ smart_info_entity: "a" }, evGet({ a: { state: "on" } })), true);
  assert.equal(isCharging({ smart_info_entity: "a" }, evGet({ a: { state: "off" } })), false);
  assert.equal(isCharging({ charge_switch_entity: "sw" }, evGet({ sw: { state: "unavailable" } })), null);
  assert.equal(isCharging({ charging_entity: "c", smart_info_entity: "a" }, evGet({ c: { state: "Charging" }, a: { state: "off" } })), true, "the explicit entity wins");
  assert.equal(isCharging({}, evGet({})), null);

  for (const [state, expected] of [["CONNECTED", true], ["on", true], ["DISCONNECTED", false], ["NOT_PLUGGED_IN", false], ["off", false], ["weird", null], ["unavailable", null]]) {
    assert.equal(isPluggedIn({ plug_entity: "p" }, evGet({ p: { state } })), expected, state);
  }
  assert.equal(isPluggedIn({}, evGet({})), null);
});

test("ev: start and stop use the dedicated entity, else the charger switch", () => {
  assert.deepEqual(serviceFor("button.go", "start"), { domain: "button", service: "press" });
  assert.deepEqual(serviceFor("switch.c", "stop"), { domain: "switch", service: "turn_off" });
  assert.deepEqual(serviceFor("automation.go", "start"), { domain: "automation", service: "trigger", data: { skip_condition: true } });
  assert.equal(serviceFor("light.x", "start"), null);

  const roles = { start_entity: "button.start", stop_entity: "button.stop", charge_switch_entity: "switch.charge" };
  assert.deepEqual(chargeAction(roles, "start"), { id: "button.start", domain: "button", service: "press" });
  assert.deepEqual(chargeAction({ charge_switch_entity: "switch.charge" }, "stop"), { id: "switch.charge", domain: "switch", service: "turn_off" });
  assert.deepEqual(chargeAction({ start_entity: "button.start", charge_switch_entity: "switch.charge" }, "stop"), { id: "switch.charge", domain: "switch", service: "turn_off" });
  assert.equal(chargeAction({}, "start"), null);
});

test("ev: time options are split into times and the off option", () => {
  const { times, off } = parseTimeOptions(["None", "00:00", "00:15", "08:00", "08:30", "23:45"]);
  assert.equal(off, "None");
  assert.deepEqual(hoursOf(times), [0, 8, 23]);
  assert.deepEqual(minutesOf(times, 8), [0, 30]);
  assert.deepEqual(parseTimeOptions(["a", "b"]), { times: [], off: "a" });
  assert.deepEqual(parseTimeOptions(undefined), { times: [], off: null });
  assert.equal(parseTimeOptions(["07:05:00"]).times[0].minute, 5);
});

test("ev: the planned window from the charging sensor", () => {
  const attrs = { charging_start_time: "2026-10-11T01:00:00+02:00", charging_stop_time: "2026-10-11T04:30:00+02:00" };
  assert.deepEqual(plannedWindow(attrs, { timeZone: "Europe/Copenhagen" }), { start: "01:00", end: "04:30" });
  assert.equal(plannedWindow({ charging_start_time: null, charging_stop_time: null }), null);
  assert.equal(plannedWindow({ charging_start_time: "nonsense", charging_stop_time: "x" }), null);
  assert.equal(plannedWindow(undefined), null);
});

test("screenDecision opens when playing starts, not on load, and not after a dismissal until the music stops", async () => {
  const { screenDecision, nextRepeat, clock } = await import("../web/js/lib/nowplaying.js");
  const base = { prevMode: null, open: false, dismissed: false, ready: true, enabled: true };
  assert.equal(screenDecision({ ...base, mode: "playing" }).shouldOpen, true);
  assert.equal(screenDecision({ ...base, mode: "playing", prevMode: "playing" }).shouldOpen, false, "already playing");
  assert.equal(screenDecision({ ...base, mode: "playing", prevMode: "paused" }).shouldOpen, true, "resumed");
  assert.equal(screenDecision({ ...base, mode: "playing", ready: false }).shouldOpen, false, "page just loaded");
  assert.equal(screenDecision({ ...base, mode: "playing", enabled: false }).shouldOpen, false);
  assert.equal(screenDecision({ ...base, mode: "playing", dismissed: true }).shouldOpen, false);
  assert.equal(screenDecision({ ...base, mode: "paused", dismissed: true }).dismissed, true, "still dismissed while paused");
  assert.equal(screenDecision({ ...base, mode: null, dismissed: true }).dismissed, false, "music stopped");
  assert.equal(screenDecision({ ...base, mode: null, open: true }).closeSoon, true);
  assert.equal(screenDecision({ ...base, mode: "paused", open: true }).closeSoon, false);
  assert.deepEqual(["off", "all", "one"].map(nextRepeat), ["all", "one", "off"]);
  assert.equal(nextRepeat(undefined), "all");
  assert.deepEqual([clock(75), clock(165), clock(5), clock(-3)], ["1:15", "2:45", "0:05", "0:00"]);
});
