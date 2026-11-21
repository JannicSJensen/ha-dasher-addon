import fs from "node:fs/promises";
import path from "node:path";
import { constants } from "node:fs";

export const LEGACY_FACES = ["home", "home_plus", "modular", "weather", "calendar", "clock", "analog", "flow", "photos", "cameras"];
const PHOTO_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".gif"]);
const MAX_PHOTO_BYTES = 10 * 1024 * 1024;
const safeName = (name) => typeof name === "string" && name.length > 0 && name !== "." && name !== ".." &&
  !name.includes("/") && !name.includes("\\") && !/[\u0000-\u001f]/.test(name);
const photoName = (name) => safeName(name) && PHOTO_EXTENSIONS.has(path.extname(name).toLowerCase());
const bad = (message, status = 400) => Object.assign(new Error(message), { status });

export function legacyOptions(options = {}) {
  const errors = [];
  let faces = LEGACY_FACES;
  if (options.legacy_faces != null) {
    if (!Array.isArray(options.legacy_faces) || options.legacy_faces.some((id) => !LEGACY_FACES.includes(id))) {
      errors.push("Invalid legacy face list; use the documented face IDs.");
    } else faces = [...new Set(options.legacy_faces)];
  }
  let albums = [];
  if (options.legacy_photo_albums != null) {
    if (!Array.isArray(options.legacy_photo_albums) || options.legacy_photo_albums.some((name) => !safeName(name))) {
      errors.push("Invalid legacy photo album list; use folder names only.");
    } else albums = [...new Set(options.legacy_photo_albums)];
  }
  const interval = (value, fallback, min, max, name) => {
    if (value == null) return fallback;
    if (Number.isInteger(value) && value >= min && value <= max) return value;
    errors.push(`Invalid ${name}; use ${min}–${max} seconds.`);
    return fallback;
  };
  return {
    faces,
    photos: options.legacy_photos === true && !errors.some((error) => error.startsWith("Invalid legacy photo album")),
    albums,
    photo_interval: interval(options.legacy_photo_interval, 120, 10, 3600, "legacy photo interval"),
    cameras: options.legacy_cameras === true,
    camera_interval: interval(options.legacy_camera_interval, 30, 10, 3600, "legacy camera interval"),
    errors,
  };
}

async function photoRoot(assetsDir) {
  const root = path.join(assetsDir, "photos");
  let stat;
  try { stat = await fs.lstat(root); }
  catch (err) {
    if (err.code === "ENOENT") return null;
    throw err;
  }
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw bad("The photo folder must be a real directory.", 403);
  return root;
}

const allowedAlbum = (album, selected) => !selected.length || selected.includes(album);

export async function listPhotoAlbums(assetsDir, selected = []) {
  const root = await photoRoot(assetsDir);
  if (!root) return { albums: [], missing: true };
  const entries = await fs.readdir(root, { withFileTypes: true });
  const albums = [];
  async function add(id, files) {
    const photos = files.filter((entry) => entry.isFile() && photoName(entry.name))
      .map((entry) => entry.name).sort((a, b) => a.localeCompare(b));
    if (photos.length) albums.push({ id, name: id || "default", photos });
  }
  if (allowedAlbum("", selected)) await add("", entries);
  for (const entry of entries) {
    if (!entry.isDirectory() || !safeName(entry.name) || !allowedAlbum(entry.name, selected)) continue;
    await add(entry.name, await fs.readdir(path.join(root, entry.name), { withFileTypes: true }));
  }
  albums.sort((a, b) => a.name.localeCompare(b.name));
  return { albums, missing: false };
}

export async function openPhoto(assetsDir, album, name, selected = []) {
  if ((album !== "" && !safeName(album)) || !photoName(name) || !allowedAlbum(album, selected)) throw bad("Invalid photo.", 404);
  const root = await photoRoot(assetsDir);
  if (!root) throw bad("Photo folder not found.", 404);
  if (album) {
    let stat;
    try { stat = await fs.lstat(path.join(root, album)); }
    catch (err) { if (err.code === "ENOENT") throw bad("Album not found.", 404); throw err; }
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw bad("Invalid album.", 404);
  }
  const file = path.join(root, album, name);
  let handle;
  try {
    handle = await fs.open(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const stat = await handle.stat();
    if (!stat.isFile()) throw bad("Invalid photo.", 404);
    if (stat.size > MAX_PHOTO_BYTES) throw bad("Photo is larger than 10 MB.", 413);
    return { handle, size: stat.size, extension: path.extname(name).toLowerCase() };
  } catch (err) {
    if (handle) await handle.close();
    if (["ENOENT", "ELOOP", "ENOTDIR"].includes(err.code)) throw bad("Photo not found.", 404);
    throw err;
  }
}

export function cameraList(index, enabled) {
  if (!enabled) return [];
  return [...index.values()].filter((item) => item.domain === "camera" && /^camera\.[a-z0-9_]+$/.test(item.id))
    .map((item) => ({ id: item.id, name: item.name || item.id })).sort((a, b) => a.name.localeCompare(b.name));
}
