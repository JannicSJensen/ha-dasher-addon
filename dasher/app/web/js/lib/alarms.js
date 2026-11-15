export const ALARM_STORAGE_KEY = "dasher.alarms.v1";
export const ALARM_MAX_SECONDS = 24 * 60 * 60;
export const ALARM_PRESETS = [
  { id: "soft", seconds: 6 * 60, image: "img/alarms/soft-egg.svg" },
  { id: "hard", seconds: 10 * 60, image: "img/alarms/hard-egg.svg" },
  { id: "tea", seconds: 4 * 60, image: "img/alarms/tea.svg" },
  { id: "pizza", seconds: 12 * 60, image: "img/alarms/pizza.svg" },
];

export function alarmTime(seconds) {
  const remaining = Math.max(0, Math.ceil(seconds));
  const h = Math.floor(remaining / 3600);
  const m = Math.floor(remaining % 3600 / 60);
  const s = remaining % 60;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${m}:${String(s).padStart(2, "0")}`;
}

export class AlarmTimers {
  constructor({ storage, now = Date.now, id = () => Array.from(globalThis.crypto.getRandomValues(new Uint8Array(16)), (n) => n.toString(16).padStart(2, "0")).join(""), onError = console.error }) {
    this.storage = storage;
    this.now = now;
    this.id = id;
    this.onError = onError;
    this.listeners = new Set();
    this.items = [];
    this.available = false;
    this.load();
  }

  load() {
    try {
      const raw = this.storage.getItem(ALARM_STORAGE_KEY);
      const data = raw == null ? [] : JSON.parse(raw);
      if (!Array.isArray(data) || data.some((item) => !item || typeof item.id !== "string"
        || typeof item.name !== "string" || !item.name.trim() || !Number.isFinite(item.end)
        || !Number.isInteger(item.seconds) || item.seconds < 1 || item.seconds > ALARM_MAX_SECONDS
        || typeof item.preset !== "string")) throw new Error("Invalid saved timers");
      this.items = data;
      this.available = true;
      this.emit();
    } catch (error) {
      this.available = false;
      this.onError(error);
    }
  }

  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit() { for (const listener of this.listeners) listener(this.items); }

  save(items) {
    if (!this.available) {
      this.onError(new Error("Timer storage could not be read"));
      return false;
    }
    try {
      this.storage.setItem(ALARM_STORAGE_KEY, JSON.stringify(items));
    } catch (error) {
      this.onError(error);
      return false;
    }
    this.items = items;
    this.emit();
    return true;
  }

  start({ name, seconds, preset = "" }) {
    if (typeof name !== "string" || !name.trim() || name.trim().length > 80
      || !Number.isInteger(seconds) || seconds < 1 || seconds > ALARM_MAX_SECONDS
      || typeof preset !== "string") throw new Error("Invalid alarm");
    const item = { id: this.id(), name: name.trim(), seconds, end: this.now() + seconds * 1000, preset };
    return this.save([...this.items, item]);
  }

  remove(id) {
    if (!this.items.some((item) => item.id === id)) return false;
    return this.save(this.items.filter((item) => item.id !== id));
  }

  due() { return this.items.filter((item) => item.end <= this.now()); }
}
