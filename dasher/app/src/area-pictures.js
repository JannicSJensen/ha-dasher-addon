import fs from "node:fs";
import path from "node:path";
import { roomImage, roomType } from "./room-images.js";

/*
 * Puts a built-in room picture on the areas of Home Assistant that have no picture yet, so the picture lives in
 * Home Assistant's own area settings (Settings, Areas) and the dashboard just reads it from there. Each room
 * picture is uploaded once (Home Assistant's image upload) and shared by the areas that use it. An area that
 * once got a picture from here and later lost it is left alone: someone removed it on purpose.
 */

const FILE = "area-pictures.json";
const serveUrl = (id) => `/api/image/serve/${id}/original`;

export class AreaPictures {
  /**
   * `ha`: the Home Assistant client (websocket requests); `upload(name, buffer, type)` resolves to the new image's
   * id; `exists(url)` tells whether an image URL still works; `imageDir` holds the JPEG files (web/img/rooms).
   */
  constructor({ ha, upload, exists, dir, imageDir, logger }) {
    this.ha = ha;
    this.upload = upload;
    this.exists = exists;
    this.file = dir ? path.join(dir, FILE) : null;
    this.imageDir = imageDir;
    this.log = logger;
    this.running = false;
    this.state = this._load();
  }

  _load() {
    const empty = { images: {}, applied: {} };
    if (!this.file) return empty;
    try {
      const data = JSON.parse(fs.readFileSync(this.file, "utf8"));
      return { images: data.images && typeof data.images === "object" ? data.images : {}, applied: data.applied && typeof data.applied === "object" ? data.applied : {} };
    } catch {
      return empty;
    }
  }

  _save() {
    if (!this.file) return;
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      fs.writeFileSync(this.file, JSON.stringify(this.state, null, 2));
    } catch (err) {
      this.log.warn(`Could not save ${FILE}: ${err.message}`);
    }
  }

  /** The areas Dasher put a picture on (ids), to tell its own pictures from the ones people chose. */
  get appliedAreas() {
    return new Set(Object.keys(this.state.applied));
  }

  /** The URL of the uploaded picture for a room type, uploading it when it is not there (any more). */
  async _imageFor(type) {
    const cached = this.state.images[type];
    if (cached && (await this.exists(serveUrl(cached)))) return serveUrl(cached);
    const rel = roomImage(type).replace(/\.svg$/, ".jpg");
    const buffer = fs.readFileSync(path.join(this.imageDir, path.basename(rel)));
    const id = await this.upload(`dasher-${type}.jpg`, buffer, "image/jpeg");
    if (!id) throw new Error("Home Assistant did not return an image id.");
    this.state.images[type] = id;
    this._save();
    return serveUrl(id);
  }

  /**
   * One pass over the area registry. `rooms` maps an area id or name to a room type chosen in dashboard.yaml.
   * Resolves to the number of areas that got a picture; never throws (a problem is logged and tried again next time).
   */
  async sync(areas, { rooms = {} } = {}) {
    if (this.running) return 0;
    this.running = true;
    let count = 0;
    try {
      for (const area of areas ?? []) {
        if (area.picture || this.state.applied[area.area_id]) continue;
        const slug = String(area.name ?? "").toLowerCase();
        const type = rooms[area.area_id] ?? rooms[slug] ?? roomType(area.name, area.area_id);
        try {
          const picture = await this._imageFor(type);
          await this.ha.request({ type: "config/area_registry/update", area_id: area.area_id, picture });
          this.state.applied[area.area_id] = type;
          this._save();
          count += 1;
          this.log.info(`Area "${area.name}": picture set (${type})`);
        } catch (err) {
          this.log.warn(`Area "${area.name}": could not set a picture (${err.message})`);
          break; // the same problem would hit every area; try again later
        }
      }
    } finally {
      this.running = false;
    }
    return count;
  }
}
