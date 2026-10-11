import assert from "node:assert/strict";
import { test } from "node:test";
import { validateProxyPath, validateServiceCall } from "../src/policy.js";

const watched = new Set(["light.kitchen", "climate.hp", "script.go", "switch.plug"]);
const call = (over) => validateServiceCall({ domain: "light", service: "toggle", entity_id: "light.kitchen", ...over }, watched);

test("accepts an allowed call on a configured entity", () => {
  const r = call({});
  assert.equal(r.ok, true);
  assert.deepEqual(r.entityIds, ["light.kitchen"]);
});

test("rejects entities that are not on the dashboard", () => {
  assert.equal(call({ entity_id: "light.bedroom" }).ok, false);
});

test("rejects services outside the allow-list", () => {
  assert.equal(call({ domain: "lock", service: "unlock", entity_id: "lock.door" }).ok, false);
  assert.equal(call({ domain: "homeassistant", service: "restart" }).ok, false);
  assert.equal(call({ domain: "script", service: "go", entity_id: "script.go" }).ok, false);
});

test("entity domain must match the service domain", () => {
  assert.equal(call({ entity_id: "switch.plug" }).ok, false);
  assert.equal(call({ domain: "homeassistant", service: "turn_off", entity_id: "switch.plug" }).ok, true);
});

test("data cannot retarget the call", () => {
  assert.equal(call({ data: { entity_id: "light.other" } }).ok, false);
  assert.equal(call({ data: { area_id: "all" } }).ok, false);
  assert.equal(call({ data: { brightness_pct: 40 } }).ok, true);
});

test("malformed input is rejected", () => {
  assert.equal(validateServiceCall(null, watched).ok, false);
  assert.equal(call({ domain: "../x" }).ok, false);
  assert.equal(call({ entity_id: [] }).ok, false);
  assert.equal(call({ entity_id: undefined }).ok, false);
  assert.equal(call({ data: [] }).ok, false);
});

test("image proxy only allows HA image endpoints", () => {
  assert.equal(validateProxyPath("/api/media_player_proxy/media_player.x?token=a"), true);
  assert.equal(validateProxyPath("/api/image_proxy/image.x"), true);
  assert.equal(validateProxyPath("/api/image/serve/0123abcd/512x512"), true);
  assert.equal(validateProxyPath("/api/states"), false);
  assert.equal(validateProxyPath("//evil.example/api/image_proxy/x"), false);
  assert.equal(validateProxyPath("/api/image_proxy/../states"), false);
  assert.equal(validateProxyPath("https://evil.example/api/image_proxy/x"), false);
  assert.equal(validateProxyPath(undefined), false);
});
