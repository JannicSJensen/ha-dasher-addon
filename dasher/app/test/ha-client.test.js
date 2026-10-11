import assert from "node:assert/strict";
import { test } from "node:test";
import { WebSocketServer } from "ws";
import { HAClient } from "../src/ha-client.js";

const silent = { info() {}, warn() {}, error() {}, debug() {} };

function fakeHA(onMessage) {
  const wss = new WebSocketServer({ port: 0 });
  wss.on("connection", (ws) => {
    ws.send(JSON.stringify({ type: "auth_required" }));
    ws.on("message", (raw) => {
      const msg = JSON.parse(raw);
      if (msg.type === "auth") return ws.send(JSON.stringify({ type: msg.access_token === "good" ? "auth_ok" : "auth_invalid" }));
      onMessage(ws, msg);
    });
  });
  return { wss, url: `ws://127.0.0.1:${wss.address().port}` };
}

const once = (emitter, event) => new Promise((resolve) => emitter.once(event, resolve));

test("authenticates, snapshots only watched entities and streams state changes", async (t) => {
  const reply = (ws, msg, result) => ws.send(JSON.stringify({ id: msg.id, type: "result", success: true, result }));
  const { wss, url } = fakeHA((ws, msg) => {
    if (msg.type === "subscribe_events") reply(ws, msg, null);
    if (msg.type === "get_states") {
      reply(ws, msg, [
        { entity_id: "light.a", state: "on", attributes: {}, last_changed: "x", context: {} },
        { entity_id: "light.unwatched", state: "on", attributes: {} },
      ]);
      ws.send(JSON.stringify({ type: "event", event: { event_type: "state_changed", data: { entity_id: "light.a", new_state: { entity_id: "light.a", state: "off", attributes: {} } } } }));
      ws.send(JSON.stringify({ type: "event", event: { event_type: "state_changed", data: { entity_id: "light.unwatched", new_state: { entity_id: "light.unwatched", state: "off", attributes: {} } } } }));
    }
    if (msg.type === "call_service") reply(ws, msg, { ok: msg.domain });
  });
  const client = new HAClient({ wsUrl: url, token: "good", logger: silent });
  t.after(() => {
    client.stop();
    wss.close();
  });
  await client.setWatched(["light.a"]);

  const snapshot = once(client, "snapshot");
  const changed = once(client, "state");
  client.start();

  assert.deepEqual([...(await snapshot).keys()], ["light.a"]);
  assert.equal((await changed).state, "off");
  assert.deepEqual(await client.callService("light", "toggle", {}, ["light.a"]), { ok: "light" });
});

test("rejects requests while disconnected", async () => {
  const client = new HAClient({ wsUrl: "ws://127.0.0.1:1", token: "x", logger: silent });
  await assert.rejects(client.request({ type: "get_states" }), /Not connected/);
});

test("reports watched entities that Home Assistant does not know", async (t) => {
  const { wss, url } = fakeHA((ws, msg) => {
    const result = msg.type === "get_states" ? [{ entity_id: "light.a", state: "on", attributes: {} }] : null;
    ws.send(JSON.stringify({ id: msg.id, type: "result", success: true, result }));
  });
  const client = new HAClient({ wsUrl: url, token: "good", logger: silent });
  t.after(() => {
    client.stop();
    wss.close();
  });
  await client.setWatched(["light.a", "light.typo"]);
  const snapshot = once(client, "snapshot");
  client.start();
  await snapshot;
  assert.deepEqual(client.missing, ["light.typo"]);
});

test("loads registries and device classes, and reports only explicitly required entities as missing", async (t) => {
  const reply = (ws, msg, result) => ws.send(JSON.stringify({ id: msg.id, type: "result", success: true, result }));
  const subscribed = [];
  const { wss, url } = fakeHA((ws, msg) => {
    if (msg.type === "subscribe_events") subscribed.push(msg.event_type);
    if (msg.type === "get_states") {
      return reply(ws, msg, [
        { entity_id: "sensor.t", state: "21", attributes: { device_class: "temperature" } },
        { entity_id: "light.a", state: "on", attributes: {} },
        { entity_id: "switch.x", state: "on", attributes: { device_class: "outlet" } },
      ]);
    }
    if (msg.type === "config/area_registry/list") return reply(ws, msg, [{ area_id: "a", name: "A" }]);
    if (msg.type === "config/device_registry/list") return reply(ws, msg, [{ id: "d1", area_id: "a", disabled_by: null, name: "ignored" }]);
    if (msg.type === "config/entity_registry/list_for_display") return reply(ws, msg, { entity_categories: {}, entities: [{ ei: "light.a", ai: "a" }] });
    if (msg.type === "config/floor_registry/list") return ws.send(JSON.stringify({ id: msg.id, type: "result", success: false, error: { message: "nope" } }));
    reply(ws, msg, null);
  });
  const client = new HAClient({ wsUrl: url, token: "good", logger: silent });
  t.after(() => {
    client.stop();
    wss.close();
  });
  await client.setWatched(["light.a", "sensor.t", "light.in_area_only", "light.typo"], { required: ["light.a", "light.typo"] });

  const registries = once(client, "registries");
  const snapshot = once(client, "snapshot");
  client.start();
  const reg = await registries;
  await snapshot;

  assert.deepEqual(reg.areas, [{ area_id: "a", name: "A" }]);
  assert.deepEqual(reg.devices, [{ id: "d1", area_id: "a", disabled_by: null }]);
  assert.deepEqual(reg.floors, []);
  assert.deepEqual(reg.entities, [{ ei: "light.a", ai: "a" }]);
  assert.equal(client.deviceClasses.get("sensor.t"), "temperature");
  assert.equal(client.deviceClasses.has("switch.x"), false);
  assert.deepEqual(client.missing, ["light.typo"]);
  assert.ok(subscribed.includes("area_registry_updated") && subscribed.includes("entity_registry_updated"));
});

test("a failing registry read does not break state sync", async (t) => {
  const reply = (ws, msg, result) => ws.send(JSON.stringify({ id: msg.id, type: "result", success: true, result }));
  const { wss, url } = fakeHA((ws, msg) => {
    if (msg.type.startsWith("config/")) return ws.send(JSON.stringify({ id: msg.id, type: "result", success: false, error: { message: "unauthorized" } }));
    reply(ws, msg, msg.type === "get_states" ? [{ entity_id: "light.a", state: "on", attributes: {} }] : null);
  });
  const client = new HAClient({ wsUrl: url, token: "good", logger: silent });
  t.after(() => {
    client.stop();
    wss.close();
  });
  await client.setWatched(["light.a"]);
  const registries = once(client, "registries");
  const snapshot = once(client, "snapshot");
  client.start();
  assert.equal(await registries, null);
  assert.deepEqual([...(await snapshot).keys()], ["light.a"]);
});

test("registry change events trigger a debounced resync", async (t) => {
  const reply = (ws, msg, result) => ws.send(JSON.stringify({ id: msg.id, type: "result", success: true, result }));
  let areaReads = 0;
  const { wss, url } = fakeHA((ws, msg) => {
    if (msg.type === "config/area_registry/list") {
      areaReads += 1;
      return reply(ws, msg, []);
    }
    if (msg.type === "config/entity_registry/list_for_display") return reply(ws, msg, { entities: [] });
    if (msg.type === "config/device_registry/list" || msg.type === "get_states") return reply(ws, msg, []);
    if (msg.type === "subscribe_events") {
      reply(ws, msg, null);
      if (msg.event_type === "area_registry_updated") {
        setTimeout(() => {
          for (let i = 0; i < 3; i++) ws.send(JSON.stringify({ id: msg.id, type: "event", event: { event_type: "area_registry_updated", data: {} } }));
        }, 50);
      }
      return;
    }
    reply(ws, msg, null);
  });
  const client = new HAClient({ wsUrl: url, token: "good", logger: silent });
  t.after(() => {
    client.stop();
    wss.close();
  });
  client.start();
  await new Promise((resolve) => setTimeout(resolve, 1500));
  assert.equal(areaReads, 2); // initial load + one resync for three events
});

test("callServiceWithResponse asks for the response and returns it", async (t) => {
  let seen;
  const { wss, url } = fakeHA((ws, msg) => {
    if (msg.type === "call_service") {
      seen = msg;
      return ws.send(JSON.stringify({ id: msg.id, type: "result", success: true, result: { context: {}, response: { items: [1, 2] } } }));
    }
    ws.send(JSON.stringify({ id: msg.id, type: "result", success: true, result: msg.type === "get_states" ? [] : null }));
  });
  const client = new HAClient({ wsUrl: url, token: "good", logger: silent });
  t.after(() => {
    client.stop();
    wss.close();
  });
  const snapshot = once(client, "snapshot");
  client.start();
  await snapshot;
  const response = await client.callServiceWithResponse("music_assistant", "get_library", { media_type: "radio" });
  assert.deepEqual(response, { items: [1, 2] });
  assert.equal(seen.return_response, true);
  assert.equal(seen.domain, "music_assistant");
});

test("keeps an index of every entity Home Assistant knows, also the ones that are not watched", async (t) => {
  const { wss, url } = fakeHA((ws, msg) => {
    if (msg.type === "get_states") {
      ws.send(JSON.stringify({ id: msg.id, type: "result", success: true, result: [
        { entity_id: "light.a", state: "on", attributes: { friendly_name: "Lamp" } },
        { entity_id: "sensor.t", state: "21", attributes: { friendly_name: "Temp", device_class: "temperature", unit_of_measurement: "°C" } },
      ] }));
      return setTimeout(() => ws.send(JSON.stringify({ type: "event", event: { event_type: "state_changed", data: { entity_id: "sensor.new", new_state: { entity_id: "sensor.new", state: "1", attributes: { friendly_name: "New" } } } } })), 20);
    }
    ws.send(JSON.stringify({ id: msg.id, type: "result", success: true, result: null }));
  });
  const client = new HAClient({ wsUrl: url, token: "good", logger: silent });
  t.after(() => {
    client.stop();
    wss.close();
  });
  await client.setWatched(["light.a"]);
  const snapshot = once(client, "snapshot");
  client.start();
  await snapshot;
  await new Promise((r) => setTimeout(r, 60));
  assert.deepEqual(client.entityIndex.get("sensor.t"), { id: "sensor.t", name: "Temp", domain: "sensor", deviceClass: "temperature", unit: "°C" });
  assert.equal(client.entityIndex.get("sensor.new").name, "New");
  assert.equal(client.entityIndex.size, 3);
  assert.equal(client.states.has("sensor.t"), false, "only watched entities are kept as states");
});
