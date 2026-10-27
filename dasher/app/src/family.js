import { EventEmitter } from "node:events";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { addDays, isDate, todayLocal, weekdayIndex } from "./meals.js";

/*
 * The family board: chores that earn stars, a catalog of rewards to spend them on, and a log of every change of
 * the stars. People come from the dashboard configuration; everything else is kept in the app's data folder
 * (family.json), shared by all tablets and included in Home Assistant's backups.
 *
 * Dasher has no logins: a tablet says who is acting (`actor`), and grown-ups can have a PIN. That keeps children
 * from approving their own chores, but it is not security against someone who wants to cheat.
 */

export const MODES = ["direct", "bin", "rotation", "first"];
export const REPEATS = ["none", "daily", "weekdays", "every"];
export const REWARD_KINDS = ["any", "once", "bank"];
const KEEP_DONE_DAYS = 7;
const LEDGER_LIMIT = 600;
const SAVE_DELAY_MS = 500;
const MAX_CHORES = 200;
const MAX_REWARDS = 80;
const MAX_TRIES = 5;
const LOCK_MS = 60_000;

const text = (value, max) => String(value ?? "").replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, " ").replace(/[ \t]+/g, " ").trim().slice(0, max);
const int = (value, min, max, fallback) => {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};
const id = () => crypto.randomBytes(6).toString("hex");

/** An error with an HTTP status for the API. */
export const fail = (message, status = 400) => Object.assign(new Error(message), { status });

/** The next day a repeating chore opens, counted from `from`; null when it does not repeat. */
export function nextOpening(repeat, from) {
  if (!repeat || repeat.type === "none") return null;
  if (repeat.type === "daily") return addDays(from, 1);
  if (repeat.type === "every") return addDays(from, Math.max(1, repeat.every || 1));
  if (repeat.type === "weekdays" && repeat.days?.length) {
    for (let i = 1; i <= 7; i++) {
      const date = addDays(from, i);
      if (repeat.days.includes(weekdayIndex(date))) return date;
    }
  }
  return null;
}

export function normalizeRepeat(raw) {
  const type = REPEATS.includes(raw?.type) ? raw.type : "none";
  const days = [...new Set((Array.isArray(raw?.days) ? raw.days : []).map((d) => int(d, 0, 6, -1)).filter((d) => d >= 0))].sort();
  if (type === "weekdays" && !days.length) return { type: "none", days: [], every: 1 };
  return { type, days: type === "weekdays" ? days : [], every: type === "every" ? int(raw?.every, 1, 60, 2) : 1 };
}

/** A chore as stored; `people` are the ids that exist. Returns null when it has no usable title. */
export function normalizeChore(raw, people, previous = null) {
  const title = text(raw?.title, 80);
  if (!title) return null;
  const known = new Set(people);
  const rotation = [...new Set((Array.isArray(raw?.rotation) ? raw.rotation : []).filter((p) => known.has(p)))];
  let mode = MODES.includes(raw?.mode) ? raw.mode : "direct";
  if (mode === "rotation" && rotation.length < 2) mode = "direct";
  let assignee = known.has(raw?.assignee) ? raw.assignee : null;
  if (mode === "rotation") assignee = previous?.assignee && rotation.includes(previous.assignee) ? previous.assignee : rotation[0];
  return {
    id: previous?.id ?? id(),
    title,
    icon: text(raw?.icon, 8) || "✅",
    stars: int(raw?.stars, 0, 100, 1),
    mode,
    assignee,
    rotation: mode === "rotation" ? rotation : [],
    repeat: normalizeRepeat(raw?.repeat),
    due: isDate(raw?.due) ? raw.due : null,
    notes: text(raw?.notes, 300),
    status: previous?.status ?? "open", // open | awaiting | waiting | done
    done_by: previous?.done_by ?? null,
    done_at: previous?.done_at ?? null,
    approved_at: previous?.approved_at ?? null,
    opens_on: previous?.opens_on ?? null,
    note_back: previous?.note_back ?? "",
    streak: previous?.streak ?? 0,
    created: previous?.created ?? new Date().toISOString(),
  };
}

export function normalizeReward(raw, previous = null) {
  const title = text(raw?.title, 60);
  if (!title) return null;
  const kind = REWARD_KINDS.includes(raw?.kind) ? raw.kind : "any";
  const status = previous?.status === "suggested" && raw?.status !== "active" ? "suggested" : "active";
  return {
    id: previous?.id ?? id(),
    title,
    icon: text(raw?.icon, 8) || "🎁",
    cost: raw?.cost == null || raw.cost === "" ? (status === "suggested" ? null : 1) : int(raw.cost, 0, 10_000, 1),
    kind,
    amount: kind === "bank" ? int(raw?.amount, 1, 10_000, 30) : 0,
    unit: kind === "bank" ? text(raw?.unit, 12) || "min" : "",
    note: text(raw?.note, 120),
    status,
    suggested_by: previous?.suggested_by ?? null,
  };
}

export class FamilyStore extends EventEmitter {
  /**
   * `people()` gives the people of the configuration: [{ id, role: "adult" | "child", pin }].
   * `now()` is the clock (tests replace it).
   */
  constructor({ dir, logger, people = () => [], allowNegative = () => false, now = () => new Date() }) {
    super();
    this.dir = dir;
    this.log = logger;
    this.people = people;
    this.allowNegative = allowNegative;
    this.now = now;
    this.chores = [];
    this.rewards = [];
    this.ledger = []; // { id, person, delta, reason, kind, ts, ref, meta }
    this.banks = {}; // person -> { rewardId: amount }
    this.tries = new Map(); // actor -> { count, until }
    this._timer = null;
    this._load();
  }

  get file() {
    return this.dir ? path.join(this.dir, "family.json") : null;
  }

  get today() {
    return todayLocal(this.now());
  }

  _ids() {
    return this.people().map((p) => p.id);
  }

  _load() {
    if (!this.file) return;
    try {
      const data = JSON.parse(fs.readFileSync(this.file, "utf8"));
      const ids = [...new Set([...this._ids(), ...(Array.isArray(data.chores) ? data.chores : []).flatMap((c) => [c?.assignee, ...(c?.rotation ?? [])]).filter(Boolean)])];
      this.chores = (Array.isArray(data.chores) ? data.chores : []).map((c) => normalizeChore(c, ids, c)).filter(Boolean).slice(0, MAX_CHORES);
      this.rewards = (Array.isArray(data.rewards) ? data.rewards : []).map((r) => normalizeReward(r, r)).filter(Boolean).slice(0, MAX_REWARDS);
      this.ledger = (Array.isArray(data.ledger) ? data.ledger : []).filter((l) => l && typeof l.person === "string" && Number.isFinite(l.delta)).slice(-LEDGER_LIMIT);
      this.banks = data.banks && typeof data.banks === "object" ? data.banks : {};
    } catch {
      // first start or an unreadable file: start empty
    }
  }

  _changed() {
    this._save();
    this.emit("change");
  }

  _save() {
    if (!this.file) return;
    clearTimeout(this._timer);
    this._timer = setTimeout(() => this.flush(), SAVE_DELAY_MS);
    this._timer.unref?.();
  }

  flush() {
    if (!this.file) return;
    clearTimeout(this._timer);
    try {
      fs.mkdirSync(this.dir, { recursive: true });
      const tmp = `${this.file}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify({ chores: this.chores, rewards: this.rewards, ledger: this.ledger, banks: this.banks }, null, 1));
      fs.renameSync(tmp, this.file);
    } catch (err) {
      this.log?.warn(`Could not save ${this.file}: ${err.message}`);
    }
  }

  // ---- who is acting ------------------------------------------------------------------------

  person(idOrNull) {
    return this.people().find((p) => p.id === idOrNull) ?? null;
  }

  /** The acting person, checked: known, and for grown-up actions an adult whose PIN (if any) is right. */
  actor(actorId, { adult = false, pin = "" } = {}) {
    const person = this.person(actorId);
    if (!person) throw fail("Choose who you are first.", 400);
    if (adult && person.role !== "adult") throw fail("Only a grown-up can do that.", 403);
    if (adult && person.pin) {
      const state = this.tries.get(person.id) ?? { count: 0, until: 0 };
      if (state.until > Date.now()) throw fail("Too many wrong PIN codes. Wait a minute.", 429);
      const a = Buffer.from(String(pin));
      const b = Buffer.from(String(person.pin));
      const ok = a.length === b.length && crypto.timingSafeEqual(a, b);
      if (!ok) {
        const count = state.count + 1;
        this.tries.set(person.id, { count: count >= MAX_TRIES ? 0 : count, until: count >= MAX_TRIES ? Date.now() + LOCK_MS : 0 });
        throw fail("Wrong PIN code.", 403);
      }
      this.tries.delete(person.id);
    }
    return person;
  }

  // ---- stars ----------------------------------------------------------------------------------

  balance(person) {
    return this.ledger.filter((l) => l.person === person).reduce((sum, l) => sum + l.delta, 0);
  }

  _log(person, delta, reason, kind, ref = null, meta = null) {
    this.ledger.push({ id: id(), person, delta, reason: text(reason, 100), kind, ts: this.now().toISOString(), ref, ...(meta ? { meta } : {}) });
    if (this.ledger.length > LEDGER_LIMIT) this.ledger.splice(0, this.ledger.length - LEDGER_LIMIT);
  }

  // ---- chores -------------------------------------------------------------------------------

  _chore(choreId) {
    const chore = this.chores.find((c) => c.id === choreId);
    if (!chore) throw fail("That chore does not exist any more.", 404);
    return chore;
  }

  saveChore(raw, actor) {
    this.actor(actor.id, { adult: true, pin: actor.pin });
    const previous = raw?.id ? this._chore(raw.id) : null;
    if (!previous && this.chores.length >= MAX_CHORES) throw fail("There are too many chores.", 400);
    const chore = normalizeChore(raw, this._ids(), previous);
    if (!chore) throw fail("A chore needs a name.", 400);
    if (previous) {
      this.chores[this.chores.indexOf(previous)] = chore;
      if (chore.mode !== previous.mode && chore.status === "awaiting") chore.status = "open";
    } else this.chores.push(chore);
    this._changed();
    return chore;
  }

  deleteChore(choreId, actor) {
    this.actor(actor.id, { adult: true, pin: actor.pin });
    const chore = this._chore(choreId);
    this.chores = this.chores.filter((c) => c !== chore);
    this._changed();
  }

  /** Take a chore that nobody has (the chore bin). */
  claim(choreId, actorId) {
    const person = this.actor(actorId);
    const chore = this._chore(choreId);
    if (chore.status !== "open" || chore.assignee) throw fail("Someone already has that chore.", 409);
    chore.assignee = person.id;
    this._changed();
    return chore;
  }

  /** The person says it is done; a grown-up's own chores need no approval. */
  done(choreId, actorId) {
    const person = this.actor(actorId);
    const chore = this._chore(choreId);
    if (chore.status !== "open") throw fail("That chore is not open.", 409);
    if (!chore.assignee) throw fail("Take the chore first.", 409);
    if (chore.assignee !== person.id && person.role !== "adult") throw fail("That chore belongs to someone else.", 403);
    chore.done_by = chore.assignee;
    chore.done_at = this.now().toISOString();
    chore.note_back = "";
    const owner = this.person(chore.assignee);
    if (owner?.role === "adult") return this._approve(chore);
    chore.status = "awaiting";
    this._changed();
    return chore;
  }

  /** Back to open when the person did not really finish. */
  undo(choreId, actorId) {
    const person = this.actor(actorId);
    const chore = this._chore(choreId);
    if (chore.status !== "awaiting") throw fail("That chore is not waiting for approval.", 409);
    if (chore.done_by !== person.id && person.role !== "adult") throw fail("That chore belongs to someone else.", 403);
    chore.status = "open";
    chore.done_by = chore.done_at = null;
    this._changed();
    return chore;
  }

  approve(choreId, actor) {
    this.actor(actor.id, { adult: true, pin: actor.pin });
    const chore = this._chore(choreId);
    if (chore.status !== "awaiting") throw fail("That chore is not waiting for approval.", 409);
    return this._approve(chore);
  }

  _approve(chore) {
    const today = this.today;
    const onTime = !chore.due || localDay(chore.done_at, this.now) <= chore.due;
    chore.streak = onTime ? chore.streak + 1 : 0;
    if (chore.stars > 0) this._log(chore.done_by ?? chore.assignee, chore.stars, chore.title, "chore", chore.id);
    chore.approved_at = this.now().toISOString();
    const next = nextOpening(chore.repeat, today);
    if (next) {
      chore.status = "waiting";
      chore.opens_on = next;
    } else chore.status = "done";
    this._changed();
    return chore;
  }

  reject(choreId, note, actor) {
    this.actor(actor.id, { adult: true, pin: actor.pin });
    const chore = this._chore(choreId);
    if (chore.status !== "awaiting") throw fail("That chore is not waiting for approval.", 409);
    chore.status = "open";
    chore.note_back = text(note, 200);
    chore.done_by = chore.done_at = null;
    this._changed();
    return chore;
  }

  /** Reopen repeating chores that are due again, rotate them, and clear what was finished a while ago. */
  tick() {
    const today = this.today;
    let changed = false;
    for (const chore of this.chores) {
      if (chore.status === "waiting" && chore.opens_on && chore.opens_on <= today) {
        chore.status = "open";
        chore.due = chore.opens_on;
        chore.done_by = chore.done_at = chore.approved_at = chore.opens_on = null;
        chore.note_back = "";
        if (chore.mode === "rotation" && chore.rotation.length) chore.assignee = chore.rotation[(chore.rotation.indexOf(chore.assignee) + 1) % chore.rotation.length];
        else if (chore.mode === "bin" || chore.mode === "first") chore.assignee = null;
        changed = true;
      }
    }
    const limit = addDays(today, -KEEP_DONE_DAYS);
    const before = this.chores.length;
    this.chores = this.chores.filter((c) => !(c.status === "done" && String(c.approved_at ?? "").slice(0, 10) < limit));
    if (this.chores.length !== before) changed = true;
    if (changed) this._changed();
    return changed;
  }

  // ---- rewards --------------------------------------------------------------------------------

  _reward(rewardId) {
    const reward = this.rewards.find((r) => r.id === rewardId);
    if (!reward) throw fail("That reward does not exist any more.", 404);
    return reward;
  }

  saveReward(raw, actor) {
    this.actor(actor.id, { adult: true, pin: actor.pin });
    const previous = raw?.id ? this._reward(raw.id) : null;
    if (!previous && this.rewards.length >= MAX_REWARDS) throw fail("There are too many rewards.", 400);
    const reward = normalizeReward({ ...raw, status: "active" }, previous);
    if (!reward) throw fail("A reward needs a name.", 400);
    if (previous) this.rewards[this.rewards.indexOf(previous)] = reward;
    else this.rewards.push(reward);
    this._changed();
    return reward;
  }

  deleteReward(rewardId, actor) {
    this.actor(actor.id, { adult: true, pin: actor.pin });
    const reward = this._reward(rewardId);
    this.rewards = this.rewards.filter((r) => r !== reward);
    this._changed();
  }

  /** Anyone can suggest a reward; a grown-up sets the price (or turns it down). */
  suggest(title, actorId) {
    const person = this.actor(actorId);
    if (this.rewards.length >= MAX_REWARDS) throw fail("There are too many rewards.", 400);
    const reward = normalizeReward({ title, cost: null, kind: "any" }, { status: "suggested", suggested_by: person.id });
    if (!reward) throw fail("Write what you would like.", 400);
    reward.status = "suggested";
    reward.suggested_by = person.id;
    reward.cost = null;
    this.rewards.push(reward);
    this._changed();
    return reward;
  }

  /** The person (or a grown-up for them) spends stars on a reward. */
  redeem(rewardId, personId, actorId) {
    const actor = this.actor(actorId);
    const person = this.person(personId ?? actorId);
    if (!person) throw fail("Choose who gets the reward.", 400);
    if (person.id !== actor.id && actor.role !== "adult") throw fail("You can only spend your own stars.", 403);
    const reward = this._reward(rewardId);
    if (reward.status !== "active" || reward.cost == null) throw fail("That reward has no price yet.", 409);
    if (!this.allowNegative() && this.balance(person.id) < reward.cost) throw fail("Not enough stars.", 409);
    this._log(person.id, -reward.cost, reward.title, "reward", reward.id, reward.kind === "bank" ? { amount: reward.amount, unit: reward.unit } : null);
    if (reward.kind === "bank") {
      this.banks[person.id] = { ...(this.banks[person.id] ?? {}), [reward.id]: (this.banks[person.id]?.[reward.id] ?? 0) + reward.amount };
    }
    if (reward.kind === "once") this.rewards = this.rewards.filter((r) => r !== reward);
    this._changed();
    return { balance: this.balance(person.id) };
  }

  /** Use (some of) what was saved up with a "bank" reward, for instance screen minutes. */
  use(rewardId, personId, amount, actorId) {
    const actor = this.actor(actorId);
    const person = this.person(personId ?? actorId);
    if (!person) throw fail("Choose who uses it.", 400);
    if (person.id !== actor.id && actor.role !== "adult") throw fail("You can only use your own.", 403);
    const have = this.banks[person.id]?.[rewardId] ?? 0;
    const used = Math.min(have, int(amount, 1, 100_000, have));
    if (used <= 0) throw fail("Nothing saved up.", 409);
    const reward = this.rewards.find((r) => r.id === rewardId);
    this.banks[person.id][rewardId] = have - used;
    if (this.banks[person.id][rewardId] <= 0) delete this.banks[person.id][rewardId];
    this._log(person.id, 0, `${reward?.title ?? "Saved"}: ${used} ${reward?.unit ?? ""}`.trim(), "use", rewardId);
    this._changed();
    return { left: have - used };
  }

  priceSuggestion(rewardId, cost, accept, actor) {
    this.actor(actor.id, { adult: true, pin: actor.pin });
    const reward = this._reward(rewardId);
    if (reward.status !== "suggested") throw fail("That reward is not a suggestion.", 409);
    if (!accept) this.rewards = this.rewards.filter((r) => r !== reward);
    else {
      reward.cost = int(cost, 0, 10_000, 1);
      reward.status = "active";
    }
    this._changed();
    return reward;
  }

  // ---- the log --------------------------------------------------------------------------------

  /** Give or take stars by hand. */
  adjust(personId, delta, reason, actor) {
    this.actor(actor.id, { adult: true, pin: actor.pin });
    const person = this.person(personId);
    if (!person) throw fail("Choose a person.", 400);
    const amount = int(delta, -1000, 1000, 0);
    if (!amount) throw fail("Give a number of stars.", 400);
    this._log(person.id, amount, text(reason, 100) || "Adjusted by hand", "adjust");
    this._changed();
    return { balance: this.balance(person.id) };
  }

  /** Take back a log line: the stars come back (or go away) and a saved-up bank is reduced. */
  reverse(entryId, actor) {
    this.actor(actor.id, { adult: true, pin: actor.pin });
    const entry = this.ledger.find((l) => l.id === entryId);
    if (!entry) throw fail("That line does not exist any more.", 404);
    if (entry.kind === "reward" && entry.meta?.amount) {
      const bank = this.banks[entry.person] ?? {};
      if (bank[entry.ref] != null) {
        bank[entry.ref] = Math.max(0, bank[entry.ref] - entry.meta.amount);
        if (!bank[entry.ref]) delete bank[entry.ref];
      }
    }
    this.ledger = this.ledger.filter((l) => l !== entry);
    this._changed();
  }

  // ---- what a tablet gets -------------------------------------------------------------------

  payload() {
    this.tick();
    const people = this.people().map((p) => ({ id: p.id, name: p.name, color: p.color, avatar: p.avatar, role: p.role, entity: p.entity ?? null, calendar: p.calendar ?? null, has_pin: Boolean(p.pin), balance: this.balance(p.id), bank: this.banks[p.id] ?? {} }));
    return {
      today: this.today,
      people,
      chores: this.chores,
      rewards: this.rewards,
      ledger: this.ledger.slice(-80).reverse(),
      allow_negative: Boolean(this.allowNegative()),
    };
  }
}

/** The local day ("YYYY-MM-DD") of an ISO time. */
function localDay(iso, now) {
  const d = iso ? new Date(iso) : now();
  return todayLocal(Number.isNaN(d.getTime()) ? now() : d);
}
