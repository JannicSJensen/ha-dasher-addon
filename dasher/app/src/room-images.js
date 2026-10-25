/*
 * Built-in room pictures (web/img/rooms): chosen from the name of an area, in Danish or English, for areas
 * that have no picture of their own.
 */

export const ROOM_TYPES = ["living", "kitchen", "dining", "bedroom", "kids", "bathroom", "office", "hallway", "garage", "garden", "laundry", "storage", "room"];

// The first row that matches wins, so "spisestue" is a dining room before it is a "stue".
// A keyword matches at the start of a word; "*" in front lets it match inside one ("gæstetoilet", "dagligstue").
const RULES = [
  ["kids", ["børn", "born", "kids", "child", "nursery", "*legerum", "playroom", "baby", "teen"]],
  ["dining", ["spise", "dining", "madstue"]],
  ["kitchen", ["*køkken", "*kokken", "kitchen", "pantry", "madlavning"]],
  ["laundry", ["*bryggers", "*vaskerum", "*vaskehus", "tøjvask", "laundry", "utility"]],
  ["bathroom", ["bad", "*badeværelse", "bath", "*toilet", "wc", "shower", "*brusebad", "washroom"]],
  ["bedroom", ["sove", "*soveværelse", "bedroom", "gæst", "guest", "master"]],
  ["office", ["*kontor", "office", "arbejds", "studie", "study"]],
  ["garage", ["*garage", "*carport", "*værksted", "workshop"]],
  ["hallway", ["entré", "entre", "gang", "hall", "entrance", "forstue", "vindfang", "corridor", "stairs", "trappe"]],
  ["garden", ["have", "garden", "terrasse", "patio", "altan", "balcon", "udendørs", "outdoor", "outside", "indkørsel", "driveway", "gård", "yard", "drivhus"]],
  ["storage", ["*kælder", "basement", "depot", "storage", "loft", "attic", "skab", "closet", "teknik", "bod", "cellar"]],
  ["living", ["*stue", "living", "lounge", "opholds", "sofa", "tv", "biograf", "cinema", "family", "hobby", "spillerum"]],
];
const MATCHERS = RULES.map(([type, words]) => [type, new RegExp(words.map((w) => (w.startsWith("*") ? w.slice(1) : `(?:^| )${w}`)).join("|"))]);

const clean = (value) => String(value ?? "").toLowerCase().replace(/[_\-./]+/g, " ").replace(/\s+/g, " ").trim();

/** Which picture suits an area called `name` (and with id `id`): one of ROOM_TYPES. */
export function roomType(name, id = "") {
  for (const text of [clean(name), clean(id)]) {
    if (!text) continue;
    for (const [type, matcher] of MATCHERS) if (matcher.test(text)) return type;
  }
  return "room";
}

export const roomImage = (type) => `img/rooms/${ROOM_TYPES.includes(type) ? type : "room"}.svg`;
