import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { FamilyStore, nextOpening, normalizeChore, normalizeRepeat, normalizeReward } from "../src/family.js";

const silent = { warn() {}, info() {}, debug() {}, error() {} };
const PEOPLE = [
  { id: "mor", name: "Mor", role: "adult", pin: "1234" },
  { id: "far", name: "Far", role: "adult" },
  { id: "emil", name: "Emil", role: "child" },
  { id: "ida", name: "Ida", role: "child" },
];
let clock = new Date("2026-10-26T10:00:00"); // a Monday
const make = (over = {}) => new FamilyStore({ dir: over.dir ?? null, logger: silent, people: () => PEOPLE, allowNegative: () => over.negative ?? false, now: () => clock });
const MOR = { id: "mor", pin: "1234" };
const FAR = { id: "far" };

test("nextOpening: daily, every N days and chosen weekdays", () => {
  assert.equal(nextOpening({ type: "none" }, "2026-10-26"), null);
  assert.equal(nextOpening({ type: "daily" }, "2026-10-26"), "2026-10-27");
  assert.equal(nextOpening({ type: "every", every: 3 }, "2026-10-26"), "2026-10-29");
  assert.equal(nextOpening({ type: "weekdays", days: [0, 3] }, "2026-10-26"), "2026-10-29", "Monday -> Thursday");
  assert.equal(nextOpening({ type: "weekdays", days: [0] }, "2026-10-26"), "2026-11-02", "the same weekday is a week later");
  assert.deepEqual(normalizeRepeat({ type: "weekdays", days: [] }), { type: "none", days: [], every: 1 });
  assert.deepEqual(normalizeRepeat({ type: "weekdays", days: [6, 2, 2, 9] }).days, [2, 6]);
});

test("chore normalisation: stars, rotation and people that exist", () => {
  const ids = PEOPLE.map((p) => p.id);
  const c = normalizeChore({ title: "  Tag opvasken ", stars: 500, mode: "rotation", rotation: ["emil", "ida", "ghost"], assignee: "ghost" }, ids);
  assert.deepEqual([c.title, c.stars, c.mode, c.rotation, c.assignee], ["Tag opvasken", 100, "rotation", ["emil", "ida"], "emil"]);
  assert.equal(normalizeChore({ title: "x", mode: "rotation", rotation: ["emil"] }, ids).mode, "direct", "one person is no rotation");
  assert.equal(normalizeChore({ title: "" }, ids), null);
  assert.equal(normalizeChore({ title: "x", assignee: "ghost" }, ids).assignee, null);
});

test("the star flow: done, approval, stars in the log, a grown-up's own chore needs no approval", () => {
  const s = make();
  const chore = s.saveChore({ title: "Ryd op", stars: 3, assignee: "emil" }, MOR);
  assert.throws(() => s.done(chore.id, "ida"), /belongs to someone else/);
  s.done(chore.id, "emil");
  assert.equal(s.chores[0].status, "awaiting");
  assert.equal(s.balance("emil"), 0);
  assert.throws(() => s.approve(chore.id, { id: "emil" }), /grown-up/);
  assert.throws(() => s.approve(chore.id, { id: "mor", pin: "0000" }), /Wrong PIN/);
  s.approve(chore.id, MOR);
  assert.equal(s.balance("emil"), 3);
  assert.equal(s.chores[0].status, "done");
  assert.throws(() => s.approve(chore.id, MOR), /not waiting/);
  const own = s.saveChore({ title: "Betal regning", stars: 2, assignee: "far" }, MOR);
  s.done(own.id, "far");
  assert.equal(s.chores.find((c) => c.id === own.id).status, "done");
  assert.equal(s.balance("far"), 2);
});

test("rejecting sends a chore back with a note; undo takes the claim of being done back", () => {
  const s = make();
  const c = s.saveChore({ title: "Støvsug", stars: 2, assignee: "ida" }, MOR);
  s.done(c.id, "ida");
  s.reject(c.id, "Under sofaen også", MOR);
  assert.deepEqual([s.chores[0].status, s.chores[0].note_back, s.chores[0].done_by], ["open", "Under sofaen også", null]);
  s.done(c.id, "ida");
  s.undo(c.id, "ida");
  assert.equal(s.chores[0].status, "open");
  assert.equal(s.balance("ida"), 0);
});

test("the chore bin: claim first, then done; only one can claim", () => {
  const s = make();
  const c = s.saveChore({ title: "Tøm skraldet", mode: "first", stars: 1 }, FAR);
  assert.throws(() => s.done(c.id, "emil"), /Take the chore first/);
  s.claim(c.id, "emil");
  assert.throws(() => s.claim(c.id, "ida"), /already/);
  s.done(c.id, "emil");
  s.approve(c.id, FAR);
  assert.equal(s.balance("emil"), 1);
});

test("repeating chores wait, then open again on the day, and rotate", () => {
  const s = make();
  const c = s.saveChore({ title: "Dæk bord", stars: 1, mode: "rotation", rotation: ["emil", "ida"], repeat: { type: "daily" } }, FAR);
  assert.equal(c.assignee, "emil");
  s.done(c.id, "emil");
  s.approve(c.id, FAR);
  assert.deepEqual([s.chores[0].status, s.chores[0].opens_on], ["waiting", "2026-10-27"]);
  s.tick();
  assert.equal(s.chores[0].status, "waiting", "not before the day");
  clock = new Date("2026-10-27T07:00:00");
  s.tick();
  assert.deepEqual([s.chores[0].status, s.chores[0].assignee, s.chores[0].due], ["open", "ida", "2026-10-27"]);
  clock = new Date("2026-10-26T10:00:00");
});

test("streaks grow on time and reset when late", () => {
  const s = make();
  const c = s.saveChore({ title: "Børst tænder", stars: 1, assignee: "emil", due: "2026-10-26", repeat: { type: "daily" } }, FAR);
  s.done(c.id, "emil");
  s.approve(c.id, FAR);
  assert.equal(s.chores[0].streak, 1);
  clock = new Date("2026-10-27T07:00:00");
  s.tick();
  s.chores[0].due = "2026-10-27";
  clock = new Date("2026-10-28T07:00:00"); // done a day late
  s.done(c.id, "emil");
  s.approve(c.id, FAR);
  assert.equal(s.chores[0].streak, 0);
  clock = new Date("2026-10-26T10:00:00");
});

test("done chores are cleared after a week", () => {
  const s = make();
  const c = s.saveChore({ title: "Engang", assignee: "far" }, FAR);
  s.done(c.id, "far");
  assert.equal(s.chores.length, 1);
  clock = new Date("2026-11-04T10:00:00");
  s.tick();
  assert.equal(s.chores.length, 0);
  clock = new Date("2026-10-26T10:00:00");
});

test("rewards: spend stars, no spending beyond the balance unless allowed, once and bank rewards", () => {
  const s = make();
  const task = s.saveChore({ title: "Stor opgave", stars: 11, assignee: "emil" }, FAR);
  s.done(task.id, "emil");
  s.approve(task.id, FAR);
  const film = s.saveReward({ title: "Filmaften", cost: 6 }, FAR);
  const once = s.saveReward({ title: "Biograftur", cost: 3, kind: "once" }, FAR);
  const tv = s.saveReward({ title: "Skærmtid", cost: 1, kind: "bank", amount: 30, unit: "min" }, FAR);
  assert.throws(() => s.redeem(film.id, "emil", "ida"), /only spend your own/);
  s.redeem(film.id, "emil", "emil");
  assert.equal(s.balance("emil"), 5);
  assert.throws(() => s.redeem(film.id, "emil", "emil"), /Not enough/);
  s.redeem(once.id, "emil", "emil");
  assert.ok(!s.rewards.some((r) => r.id === once.id), "a one-time reward is gone");
  s.redeem(tv.id, "emil", "emil");
  s.redeem(tv.id, "emil", "far");
  assert.equal(s.banks.emil[tv.id], 60);
  assert.deepEqual(s.use(tv.id, "emil", 45, "emil"), { left: 15 });
  assert.deepEqual(s.use(tv.id, "emil", 999, "emil"), { left: 0 });
  assert.throws(() => s.use(tv.id, "emil", 5, "emil"), /Nothing saved/);
  assert.equal(s.balance("emil"), 0);
  assert.throws(() => s.redeem(film.id, "emil", "emil"), /Not enough/);
  const loose = make({ negative: true });
  const r = loose.saveReward({ title: "Is", cost: 2 }, FAR);
  loose.redeem(r.id, "ida", "ida");
  assert.equal(loose.balance("ida"), -2, "may owe stars when allowed");
});

test("suggestions are priced by a grown-up or turned down; children cannot price", () => {
  const s = make();
  const r = s.suggest("Lego", "emil");
  assert.deepEqual([r.status, r.cost, r.suggested_by], ["suggested", null, "emil"]);
  assert.throws(() => s.redeem(r.id, "emil", "emil"), /no price/);
  assert.throws(() => s.priceSuggestion(r.id, 5, true, { id: "emil" }), /grown-up/);
  s.priceSuggestion(r.id, 8, true, FAR);
  assert.deepEqual([s.rewards[0].status, s.rewards[0].cost], ["active", 8]);
  const no = s.suggest("Pony", "ida");
  s.priceSuggestion(no.id, 0, false, FAR);
  assert.equal(s.rewards.length, 1);
});

test("adjust by hand and reverse a log line (also a saved-up bank)", () => {
  const s = make();
  s.adjust("ida", 5, "Bonus", FAR);
  assert.equal(s.balance("ida"), 5);
  assert.throws(() => s.adjust("ida", 0, "", FAR), /number of stars/);
  assert.throws(() => s.adjust("ida", 5, "", { id: "ida" }), /grown-up/);
  const tv = s.saveReward({ title: "TV", cost: 2, kind: "bank", amount: 20 }, FAR);
  s.redeem(tv.id, "ida", "ida");
  assert.equal(s.balance("ida"), 3);
  const entry = s.ledger.find((l) => l.kind === "reward");
  s.reverse(entry.id, FAR);
  assert.equal(s.balance("ida"), 5);
  assert.equal(s.banks.ida?.[tv.id], undefined);
});

test("a wrong PIN five times locks the grown-up for a while", () => {
  const s = make();
  for (let i = 0; i < 5; i++) assert.throws(() => s.saveChore({ title: "x" }, { id: "mor", pin: "0" }), /Wrong PIN/);
  assert.throws(() => s.saveChore({ title: "x" }, MOR), /Too many/);
});

test("everything is saved and read back; unknown people are refused", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dasher-family-"));
  try {
    const s = make({ dir });
    const c = s.saveChore({ title: "Gem mig", stars: 2, assignee: "emil" }, FAR);
    s.done(c.id, "emil");
    s.approve(c.id, FAR);
    s.saveReward({ title: "Is", cost: 1 }, FAR);
    s.flush();
    const again = make({ dir });
    assert.deepEqual([again.chores.length, again.rewards.length, again.balance("emil")], [1, 1, 2]);
    assert.throws(() => again.done(c.id, "ghost"), /who you are/);
    const p = again.payload();
    assert.deepEqual([p.people.find((x) => x.id === "mor").has_pin, p.people[0].pin], [true, undefined], "the PIN never leaves the app");
    assert.equal(p.people.find((x) => x.id === "emil").balance, 2);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  assert.equal(normalizeReward({ title: "" }), null);
});

import { parseConfig } from "../src/config.js";
import { calendarScope } from "../src/calendar.js";

test("the family: section: off by default, people checked, PINs validated", () => {
  const base = "pages:\n  - id: a\n    tiles: []\n";
  assert.equal(parseConfig(base).config.family.enabled, false);
  assert.equal(parseConfig(`${base}family: false\n`).config.family.enabled, false);
  const auto = parseConfig(`${base}family: true\n`).config.family;
  assert.deepEqual([auto.enabled, auto.people.length, auto.icon], [true, 0, "account-group"]);
  const yaml = `${base}family:\n  allow_negative: true\n  people:\n    - { entity: person.mor, name: Mor, pin: "1234", calendar_entity: calendar.mor }\n    - { entity: person.emil, role: child, color: "#4ade80", pin: "12" }\n    - { entity: light.nope }\n    - { avatar: "x" }\n    - { name: Mor }\n`;
  const r = parseConfig(yaml);
  const f = r.config.family;
  assert.deepEqual(f.people.map((p) => [p.id, p.role, p.pin, p.calendar]), [["mor", "adult", "1234", "calendar.mor"], ["emil", "child", null, null], ["mor-x", "adult", null, null]]);
  assert.equal(f.allow_negative, true);
  assert.equal(r.errors.length, 3, r.errors.join(" | "));
  assert.ok(r.entities.has("person.mor"));
  assert.ok(calendarScope(r.config).calendars.has("calendar.mor"), "a person's calendar may be read");
});

test("the app option switches the family page on without a family: section; the file still wins", () => {
  const base = "pages:\n  - id: a\n    tiles: []\n";
  const on = { family: { enabled: true, children: ["person.emil", "light.nope"] } };
  const auto = parseConfig(base, on).config.family;
  assert.deepEqual([auto.enabled, auto.people.length, auto.children], [true, 0, ["person.emil"]]);
  assert.equal(parseConfig(base, { family: { enabled: false } }).config.family.enabled, false);
  assert.equal(parseConfig(`${base}family: false\n`, on).config.family.enabled, false, "family: false in the file switches it off");
  const own = parseConfig(`${base}family:\n  children: [person.ida]\n  people:\n    - { entity: person.ida, role: child }\n`, on).config.family;
  assert.deepEqual([own.children, own.people.length], [["person.ida"], 1], "the section's own children win");
  assert.deepEqual(parseConfig(`${base}family: true\n`, on).config.family.children, ["person.emil"], "a bare family: true takes the option's children");
});
