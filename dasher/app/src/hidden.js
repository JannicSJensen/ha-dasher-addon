import fs from "node:fs";
import path from "node:path";

const ENTITY_RE = /^[a-z0-9_]+\.[a-z0-9_]+$/;

/**
 * What people removed from the overviews: devices of the area pages (scope "areas", by entity id) and cards of the
 * Devices page (scope "devices", by key). Kept on disk next to the other remembered state so every tablet sees the
 * same overview. `dir` null keeps it in memory.
 */
export class HiddenDevices {
  constructor({ dir, logger }) {
    this.dir = dir;
    this.log = logger;
    this.ids = new Set(); // area pages
    this.devices = new Set(); // the Devices page
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
      for (const id of Array.isArray(data?.devices) ? data.devices : []) if (typeof id === "string" && ENTITY_RE.test(id)) this.devices.add(id);
    } catch {
      // first start, or an unreadable file: nothing is hidden
    }
  }

  /** Hide or show an item of a scope ("areas" or "devices"); true when something changed. */
  set(id, hidden, scope = "areas") {
    if (typeof id !== "string" || !ENTITY_RE.test(id)) return false;
    const target = scope === "devices" ? this.devices : this.ids;
    if (hidden === target.has(id)) return false;
    if (hidden) target.add(id);
    else target.delete(id);
    this._save();
    return true;
  }

  _save() {
    if (!this.file) return;
    try {
      fs.mkdirSync(this.dir, { recursive: true });
      const tmp = `${this.file}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify({ hidden: [...this.ids].sort(), devices: [...this.devices].sort() }, null, 2));
      fs.renameSync(tmp, this.file);
    } catch (err) {
      this.log?.warn(`Could not save ${this.file}: ${err.message}`);
    }
  }
}
