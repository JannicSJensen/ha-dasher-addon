import assert from "node:assert/strict";
import { test } from "node:test";
import { parseConfig } from "../src/config.js";
import { validateServiceCall } from "../src/policy.js";
import { TodoService, cleanListName, discoverTodoLists, normalizeItem, resolveTodo, tidyListName } from "../src/todo.js";
import { describeDue, dueInputValue, listFeatures, openCount, updateData } from "../web/js/lib/todo.js";

const silent = { warn() {}, info() {}, debug() {}, error() {} };
const registries = {
  entities: [
    { ei: "todo.indkobsliste", pl: "shopping_list" },
    { ei: "todo.garage", pl: "local_todo" },
    { ei: "todo.family", pl: "caldav" },
    { ei: "todo.hidden", pl: "local_todo", hb: true },
    { ei: "light.x", pl: "hue" },
  ],
};
const index = new Map([
  ["todo.indkobsliste", { name: "Indkøbsliste" }],
  ["todo.garage", { name: "Garage chores" }],
  ["todo.family", { name: "Family ⚠️" }],
  ["todo.hidden", { name: "Hidden" }],
  ["todo.only_in_states", { name: "Extra" }],
]);
const settings = (over = {}) => ({ enabled: "auto", lists: [], exclude: [], ...over });

test("discoverTodoLists lists every visible todo entity, sorted, with its source and whether it can be changed", () => {
  const lists = discoverTodoLists({ settings: settings(), registries, index });
  assert.deepEqual(lists.map((l) => l.id), ["todo.only_in_states", "todo.family", "todo.garage", "todo.indkobsliste"].sort((a, b) => (index.get(a).name ?? a).localeCompare(index.get(b).name ?? b)));
  const garage = lists.find((l) => l.id === "todo.garage");
  assert.deepEqual([garage.name, garage.platform, garage.managed], ["Garage chores", "local_todo", true]);
  assert.equal(lists.find((l) => l.id === "todo.family").name, "Family");
  assert.equal(lists.find((l) => l.id === "todo.family").managed, false);
  assert.equal(lists.find((l) => l.id === "todo.hidden"), undefined);
});

test("explicit lists and exclude; the page shows itself when there is a list", () => {
  assert.deepEqual(discoverTodoLists({ settings: settings({ lists: ["todo.garage", "todo.family"], exclude: ["todo.family"] }), registries, index }).map((l) => l.id), ["todo.garage"]);
  assert.equal(resolveTodo({ settings: settings(), registries, index, manage: true }).enabled, true);
  assert.equal(resolveTodo({ settings: settings(), registries: { entities: [] }, index: new Map(), manage: true }).enabled, false);
  assert.equal(resolveTodo({ settings: settings({ enabled: true }), registries: { entities: [] }, index: new Map() }).enabled, true);
  assert.equal(resolveTodo({ settings: settings({ enabled: false }), registries, index }).enabled, false);
  assert.equal(resolveTodo({ settings: settings(), registries, index, manage: false }).manage, false);
});

test("names are tidied and validated", () => {
  assert.equal(tidyListName("Påmindelser ⚠️"), "Påmindelser");
  assert.equal(cleanListName("  Weekend   chores "), "Weekend chores");
  assert.equal(cleanListName(""), null);
  assert.equal(cleanListName("x".repeat(61)), null);
  assert.equal(cleanListName(42), null);
  assert.equal(cleanListName("a\u0000b"), "a b");
});

test("normalizeItem", () => {
  assert.deepEqual(normalizeItem({ uid: "u1", summary: " Milk ", status: "completed", due: "2026-10-18", description: "2 l" }), { uid: "u1", summary: "Milk", done: true, due: "2026-10-18", description: "2 l" });
  assert.deepEqual(normalizeItem({ summary: "No uid", status: "needs_action" }), { uid: "No uid", summary: "No uid", done: false, due: null, description: "" });
  assert.equal(normalizeItem({ summary: "  " }), null);
});

test("the todo services are allowed for listed lists only", () => {
  const watched = new Set(["todo.garage"]);
  for (const service of ["add_item", "update_item", "remove_item", "remove_completed_items"]) {
    assert.equal(validateServiceCall({ domain: "todo", service, entity_id: "todo.garage", data: { item: "x" } }, watched).ok, true, service);
  }
  assert.equal(validateServiceCall({ domain: "todo", service: "add_item", entity_id: "todo.other", data: {} }, watched).ok, false);
  assert.equal(validateServiceCall({ domain: "todo", service: "get_items", entity_id: "todo.garage" }, watched).ok, false);
  assert.equal(validateServiceCall({ domain: "todo", service: "add_item", entity_id: "todo.garage", data: { entity_id: "todo.other" } }, watched).ok, false);
});

function fakeService({ flow, rest } = {}) {
  const calls = [];
  const ha = {
    async request(message) {
      calls.push(message);
      if (message.type === "todo/item/list") return { items: [{ uid: "1", summary: "A", status: "needs_action" }, { uid: "2", summary: "B", status: "completed" }] };
      if (message.type === "config/entity_registry/get") return { config_entry_id: "entry9" };
      return {};
    },
  };
  const restCalls = [];
  const service = new TodoService({
    ha,
    logger: silent,
    rest: async (method, path, body) => {
      restCalls.push([method, path, body]);
      if (rest) return rest(method, path, body);
      if (method === "POST" && path.endsWith("/flow")) return flow ?? { type: "form", flow_id: "f1", data_schema: [{ name: "todo_list_name" }] };
      if (method === "POST") return { type: "create_entry", result: { entry_id: "e1" } };
      return {};
    },
  });
  return { service, calls, restCalls };
}

test("items splits open and completed items", async () => {
  const { service, calls } = fakeService();
  const result = await service.items("todo.garage");
  assert.deepEqual([result.items.map((i) => i.summary), result.completed.map((i) => i.summary)], [["A"], ["B"]]);
  assert.deepEqual(calls[0], { type: "todo/item/list", entity_id: "todo.garage" });
});

test("createList runs the local_todo config flow", async () => {
  const { service, restCalls } = fakeService();
  assert.deepEqual(await service.createList("Weekend"), { entryId: "e1" });
  assert.deepEqual(restCalls[0], ["POST", "/api/config/config_entries/flow", { handler: "local_todo", show_advanced_options: false }]);
  assert.deepEqual(restCalls[1], ["POST", "/api/config/config_entries/flow/f1", { todo_list_name: "Weekend" }]);
});

test("createList explains a missing integration, unknown form fields and a refusal, and cleans up its flow", async () => {
  const missing = fakeService({ rest: async () => { throw new Error("Invalid handler specified"); } });
  await assert.rejects(() => missing.service.createList("X"), /Local To-do integration is not available/);
  const odd = fakeService({ flow: { type: "form", flow_id: "f2", data_schema: [{ name: "todo_list_name" }, { name: "storage_key" }] } });
  await assert.rejects(() => odd.service.createList("X"), /cannot fill in/);
  assert.equal(odd.restCalls.at(-1)[0], "DELETE");
  const refused = fakeService({ rest: async (method, path) => (method === "POST" && path.endsWith("/flow") ? { type: "form", flow_id: "f3", data_schema: [{ name: "todo_list_name" }] } : { type: "abort", reason: "already_configured" }) });
  await assert.rejects(() => refused.service.createList("X"), /already_configured/);
});

test("deleteList removes the config entry of the list, renameList updates the registry", async () => {
  const { service, calls, restCalls } = fakeService();
  await service.deleteList("todo.garage");
  assert.deepEqual(calls[0], { type: "config/entity_registry/get", entity_id: "todo.garage" });
  assert.deepEqual(restCalls[0], ["DELETE", "/api/config/config_entries/entry/entry9", undefined]);
  await service.renameList("todo.garage", "Garage");
  assert.deepEqual(calls.at(-1), { type: "config/entity_registry/update", entity_id: "todo.garage", name: "Garage" });
});

test("the todo: section is parsed and its lists are tracked", () => {
  const { config, errors, entities } = parseConfig("pages:\n  - id: a\n    tiles: []\ntodo:\n  title: Huskelister\n  lists: [todo.a, light.x]\n  exclude: [todo.b]\n");
  assert.equal(config.todo.title, "Huskelister");
  assert.deepEqual([config.todo.lists, config.todo.exclude], [["todo.a"], ["todo.b"]]);
  assert.equal(errors.length, 1);
  assert.ok(entities.has("todo.a"));
  assert.deepEqual([parseConfig("pages:\n  - id: a\n    tiles: []\n").config.todo.enabled], ["auto"]);
});

test("client helpers: features, counts, due dates and edits", () => {
  assert.deepEqual(listFeatures({ attributes: { supported_features: 1 | 2 | 4 } }), { create: true, remove: true, update: true, due: false, description: false });
  assert.deepEqual(listFeatures({ attributes: { supported_features: 1 | 16 | 64 } }), { create: true, remove: false, update: false, due: true, description: true });
  assert.equal(listFeatures(undefined).update, true);
  assert.deepEqual([openCount({ state: "3" }), openCount({ state: "unavailable" }), openCount(undefined)], [3, null, null]);
  const now = new Date(2026, 9, 17, 12, 0);
  assert.equal(describeDue("2026-10-16", { locale: "en-GB", now }).overdue, true);
  assert.equal(describeDue("2026-10-17", { locale: "en-GB", now }).overdue, false);
  assert.equal(describeDue("2026-10-17T08:00:00", { locale: "en-GB", now }).overdue, true);
  assert.match(describeDue("2026-10-20", { locale: "en-GB", now }).label, /20/);
  assert.equal(describeDue(null, { now }), null);
  assert.equal(dueInputValue("2026-10-20"), "2026-10-20");
  assert.equal(dueInputValue("2026-10-20T08:00:00"), "2026-10-20");
  assert.equal(dueInputValue(null), "");
  const item = { uid: "u", summary: "Milk", description: "", due: "2026-10-20" };
  const all = { update: true, due: true, description: true, remove: true, create: true };
  assert.equal(updateData(item, { summary: "Milk", description: "", due: "2026-10-20" }, all), null);
  assert.deepEqual(updateData(item, { summary: " Oat milk ", description: "2 l", due: "" }, all), { item: "u", rename: "Oat milk", description: "2 l", due_date: null });
  assert.deepEqual(updateData(item, { summary: "Milk", description: "x", due: "2026-10-21" }, { ...all, due: false, description: false }), null);
});
