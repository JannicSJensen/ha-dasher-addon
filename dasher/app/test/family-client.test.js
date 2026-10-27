import assert from "node:assert/strict";
import { test } from "node:test";
import { afford, choresFor, currentEvent, initial, isOverdue, openCount } from "../web/js/lib/family.js";

const chore = (over) => ({ id: "x", title: "A", status: "open", assignee: "emil", due: null, ...over });

test("chores of a person are sorted by need and split by status", () => {
  const chores = [chore({ id: "1", title: "B" }), chore({ id: "2", title: "A", due: "2026-10-20" }), chore({ id: "3", status: "awaiting" }), chore({ id: "4", status: "done" }), chore({ id: "5", assignee: null }), chore({ id: "6", status: "waiting" })];
  const mine = choresFor(chores, "emil", "2026-10-26");
  assert.deepEqual(mine.open.map((c) => c.id), ["2", "1"], "the overdue one first");
  assert.deepEqual([mine.awaiting.length, mine.finished.length], [1, 2]);
  assert.deepEqual(choresFor(chores, null, "2026-10-26").open.map((c) => c.id), ["5"]);
  assert.equal(openCount(chores, "emil"), 3);
  assert.equal(isOverdue(chore({ due: "2026-10-25" }), "2026-10-26"), true);
  assert.equal(isOverdue(chore({ due: "2026-10-26" }), "2026-10-26"), false);
  assert.equal(isOverdue(chore({ due: "2026-10-01", status: "done" }), "2026-10-26"), false);
});

test("afford: enough, missing, no price, and owing allowed", () => {
  assert.deepEqual(afford(5, { cost: 3 }), { ok: true, missing: 0 });
  assert.deepEqual(afford(1, { cost: 3 }), { ok: false, missing: 2 });
  assert.deepEqual(afford(1, { cost: 3 }, true), { ok: true, missing: 2 });
  assert.equal(afford(9, { cost: null }).ok, false);
});

test("currentEvent: what is on now and what is next today", () => {
  const now = new Date(2026, 9, 26, 12, 0);
  const at = (h, m = 0) => new Date(2026, 9, 26, h, m).toISOString();
  const events = [
    { summary: "Morgen", start: at(8), end: at(9) },
    { summary: "Frokost", start: at(11, 30), end: at(12, 30) },
    { summary: "Fodbold", start: at(16), end: at(17) },
    { summary: "Aften", start: at(19), end: at(20) },
    { summary: "I morgen", start: new Date(2026, 9, 27, 9).toISOString(), end: new Date(2026, 9, 27, 10).toISOString() },
  ];
  const r = currentEvent(events, now);
  assert.equal(r.now.summary, "Frokost");
  assert.equal(r.next.summary, "Fodbold");
  assert.equal(currentEvent([{ summary: "Fridag", allDay: true, start: "2026-10-26", end: "2026-10-27" }], now).now.summary, "Fridag");
  assert.deepEqual(currentEvent([], now), { now: null, next: null });
  assert.equal(initial("emil"), "E");
  assert.equal(initial(""), "?");
});
