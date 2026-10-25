import fs from "node:fs";
import path from "node:path";

const ENTITY_RE = /^[a-z0-9_]+\.[a-z0-9_]+$/;

/**
 * The devices people removed from the area pages ("edit devices" on an area). Kept on disk next to the other
 * remembered state so every tablet sees the same overview. `dir` null keeps it in memory.
 */
export class HiddenDevices {
  constructor({ dir, logger }) {
    this.dir = dir;
    this.log = logger;
    this.ids = new Set();
    this._load();
  }

  get file() {
    return this.dir ? path.join(this.dir, "hidden-devices.json") : null;
  }

  _load() {
    if (!this.file) return;
    try {
      const data = JSON.parse(fs.readFileSync(this.file, "utf8"));
      for (const id of Array.isArray(data?.hidden) ? data.hidden : []) if (typeof id === "string" && ENTITY_RE.test(id)) this.ids.add(id);
    } catch {
      // first start, or an unreadable file: nothing is hidden
    }
  }

  /** Hide or show a device; true when something changed. */
  set(id, hidden) {
    if (typeof id !== "string" || !ENTITY_RE.test(id)) return false;
    if (hidden === this.ids.has(id)) return false;
    if (hidden) this.ids.add(id);
    else this.ids.delete(id);
    this._save();
    return true;
  }

  _save() {
    if (!this.file) return;
    try {
      fs.mkdirSync(this.dir, { recursive: true });
      const tmp = `${this.file}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify({ hidden: [...this.ids].sort() }, null, 2));
      fs.renameSync(tmp, this.file);
    } catch (err) {
      this.log?.warn(`Could not save ${this.file}: ${err.message}`);
    }
  }
}
