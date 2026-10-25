import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { parseConfig } from "../src/config.js";
import { ROOM_TYPES, roomImage, roomType } from "../src/room-images.js";

test("room types from Danish and English area names", () => {
  const cases = {
    Stue: "living", "Living Room": "living", "TV-stue": "living", Dagligstue: "living", Spisestue: "dining", Køkken: "kitchen", Bikøkken: "kitchen",
    Soveværelse: "bedroom", "Master Bedroom": "bedroom", Gæsteværelse: "bedroom", Børneværelse: "kids", "Kids room": "kids",
    Badeværelse: "bathroom", Gæstetoilet: "bathroom", Bad: "bathroom", Kontor: "office", Entré: "hallway", Gang: "hallway", Garage: "garage",
    Have: "garden", Terrasse: "garden", Bryggers: "laundry", Kælder: "storage", Teknikrum: "storage", Loft: "storage", Værelse: "room", Mystery: "room",
  };
  for (const [name, type] of Object.entries(cases)) assert.equal(roomType(name), type, name);
  assert.equal(roomType("Rum 1", "living_room"), "living", "the area id is used when the name says nothing");
  assert.equal(roomType(""), "room");
});

test("every room type has a picture in the web folder", () => {
  for (const type of ROOM_TYPES) {
    const file = fileURLToPath(new URL(`../web/${roomImage(type)}`, import.meta.url));
    assert.ok(fs.statSync(file).size > 500, file);
    assert.match(fs.readFileSync(file, "utf8"), /^<svg /);
  }
  assert.equal(roomImage("nonsense"), "img/rooms/room.svg");
});

test("areas: room and default_images are parsed", () => {
  const base = "pages:\n  - id: a\n    tiles: []\nareas:\n";
  const ok = parseConfig(`${base}  default_images: false\n  overrides:\n    stuen: { room: kitchen }\n`);
  assert.equal(ok.config.areas.default_images, false);
  assert.equal(ok.config.areas.overrides.stuen.room, "kitchen");
  const bad = parseConfig(`${base}  overrides:\n    stuen: { room: garage2 }\n`);
  assert.equal(bad.errors.length, 1);
  assert.equal(parseConfig("pages:\n  - id: a\n    tiles: []\n").config.areas.default_images, true);
});
