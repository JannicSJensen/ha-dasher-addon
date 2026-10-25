/*
 * Draws the built-in room pictures for the area pages (web/img/rooms/*.svg): quiet, dark scenes in the
 * look of the dashboard. They are original drawings, so they can be shipped freely.
 *
 *   node dev/make-room-images.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../web/img/rooms");
const W = 1600;
const H = 1000;

let uid = 0;
const id = (p) => `${p}${++uid}`;

/** Small drawing helpers; every function returns an SVG fragment. */
const rect = (x, y, w, h, fill, rx = 0, extra = "") => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${rx}" fill="${fill}" ${extra}/>`;
const circle = (cx, cy, r, fill, extra = "") => `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${fill}" ${extra}/>`;
const ellipse = (cx, cy, rx, ry, fill, extra = "") => `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="${fill}" ${extra}/>`;
const poly = (points, fill, extra = "") => `<polygon points="${points.map((p) => p.join(",")).join(" ")}" fill="${fill}" ${extra}/>`;
const path_ = (d, fill, extra = "") => `<path d="${d}" fill="${fill}" ${extra}/>`;
const line = (x1, y1, x2, y2, stroke, w = 2, extra = "") => `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${stroke}" stroke-width="${w}" stroke-linecap="round" ${extra}/>`;

/** A soft light: a radial gradient disc fading to nothing. */
function glow(cx, cy, r, color, opacity = 0.5) {
  const g = id("g");
  return `<defs><radialGradient id="${g}"><stop offset="0" stop-color="${color}" stop-opacity="${opacity}"/><stop offset="1" stop-color="${color}" stop-opacity="0"/></radialGradient></defs><circle cx="${cx}" cy="${cy}" r="${r}" fill="url(#${g})"/>`;
}

/** A soft shadow on the floor. */
const shadow = (cx, cy, rx, ry, opacity = 0.35) => ellipse(cx, cy, rx, ry, "#000", `opacity="${opacity}" filter="url(#blur)"`);

function vgrad(stops) {
  const g = id("v");
  return [`<defs><linearGradient id="${g}" x1="0" y1="0" x2="0" y2="1">${stops.map(([o, c, a = 1]) => `<stop offset="${o}" stop-color="${c}" stop-opacity="${a}"/>`).join("")}</linearGradient></defs>`, `url(#${g})`];
}

/** The window: a frame with a pane that glows. */
function windowFrame(x, y, w, h, { sky = ["#27465a", "#4f7d92"], frame = "#10151a", bars = 2 } = {}) {
  const [defs, fill] = vgrad([[0, sky[0]], [1, sky[1]]]);
  const panes = [];
  for (let i = 1; i < bars; i++) panes.push(rect(x + (w / bars) * i - 4, y, 8, h, frame));
  return `${defs}${rect(x - 10, y - 10, w + 20, h + 20, frame, 6)}${rect(x, y, w, h, fill, 2)}${panes.join("")}${rect(x, y + h / 2 - 4, w, 8, frame)}${rect(x - 18, y + h + 8, w + 36, 12, "#1b2228", 4)}`;
}

/** Light falling from a window onto the floor. */
function lightCone(x, y, w, floorY, spread, opacity = 0.09, color = "#cfe8f5") {
  const g = id("l");
  return `<defs><linearGradient id="${g}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${color}" stop-opacity="${opacity}"/><stop offset="1" stop-color="${color}" stop-opacity="0"/></linearGradient></defs>${poly([[x, y], [x + w, y], [x + w + spread, floorY + 260], [x - spread / 3, floorY + 260]], `url(#${g})`)}`;
}

function curtain(x, y, w, h, color) {
  const folds = [];
  for (let i = 1; i < 4; i++) folds.push(line(x + (w / 4) * i, y + 8, x + (w / 4) * i + 4, y + h, "#000", 3, 'opacity="0.2"'));
  return `${rect(x, y, w, h, color, 8)}${folds.join("")}`;
}

function frameArt(x, y, w, h, tone = "#2f4b57") {
  return `${rect(x - 8, y - 8, w + 16, h + 16, "#0f1418", 4)}${rect(x, y, w, h, tone, 2)}${circle(x + w * 0.35, y + h * 0.4, Math.min(w, h) * 0.22, "#d9b48a", 'opacity="0.55"')}${poly([[x, y + h], [x + w * 0.45, y + h * 0.55], [x + w, y + h]], "#12202a", 'opacity="0.7"')}`;
}

function plant(x, floorY, scale = 1, pot = "#3a2f2a") {
  const s = scale;
  const leaves = [[-50, -190], [10, -260], [58, -170], [-20, -140], [34, -120]]
    .map(([dx, dy], i) => path_(`M${x} ${floorY - 60 * s} Q${x + dx * s * 1.2} ${floorY + dy * s * 0.5} ${x + dx * s} ${floorY + dy * s} Q${x + dx * s * 0.2 + 20 * s} ${floorY + dy * s * 0.5} ${x} ${floorY - 60 * s}`, i % 2 ? "#2e6b52" : "#3b8466"))
    .join("");
  return `${shadow(x, floorY + 6, 70 * s, 12 * s, 0.4)}${leaves}${path_(`M${x - 38 * s} ${floorY - 70 * s} h${76 * s} l${-10 * s} ${70 * s} h${-56 * s}z`, pot)}`;
}

function floorLamp(x, floorY, h = 520, shade = "#e8c98f") {
  return `${glow(x, floorY - h + 30, 360, "#ffd9a0", 0.34)}${shadow(x, floorY + 6, 60, 10)}${line(x, floorY, x, floorY - h + 60, "#15191d", 8)}${ellipse(x, floorY, 46, 9, "#15191d")}${poly([[x - 70, floorY - h + 70], [x + 70, floorY - h + 70], [x + 44, floorY - h - 20], [x - 44, floorY - h - 20]], shade, 'opacity="0.95"')}`;
}

function pendant(x, topY, len, r = 60, color = "#e8c98f") {
  return `${glow(x, topY + len + 30, r * 4.5, "#ffd9a0", 0.4)}${line(x, topY, x, topY + len, "#0d1114", 4)}${path_(`M${x - r} ${topY + len + r * 0.6} Q${x} ${topY + len - r * 0.7} ${x + r} ${topY + len + r * 0.6}z`, color)}${ellipse(x, topY + len + r * 0.62, r * 0.78, 7, "#fff3d6", 'opacity="0.9"')}`;
}

function rug(cx, cy, rx, ry, fill = "#27343a") {
  return `${ellipse(cx, cy, rx, ry, fill, 'opacity="0.9"')}${ellipse(cx, cy, rx * 0.82, ry * 0.8, "none", 'stroke="#ffffff" stroke-opacity="0.07" stroke-width="3"')}`;
}

function books(x, y, count, tones = ["#6b4f3a", "#35525e", "#8a6b4a", "#2d4a3f", "#5a4560"]) {
  let out = "";
  let cx = x;
  for (let i = 0; i < count; i++) {
    const w = 18 + ((i * 7) % 14);
    const h = 70 + ((i * 13) % 34);
    out += rect(cx, y - h, w, h, tones[i % tones.length], 2);
    cx += w + 3;
  }
  return out;
}

function shelf(x, y, w, rows, rowH, content) {
  let out = rect(x - 8, y, 16, rows * rowH + 14, "#12171b") + rect(x + w - 8, y, 16, rows * rowH + 14, "#12171b");
  for (let r = 0; r <= rows; r++) out += rect(x - 8, y + r * rowH, w + 16, 14, "#12171b");
  if (content) out += content;
  return out;
}

/** The empty room: wall, floor, skirting and a vignette; `body` is drawn between floor and vignette. */
function scene({ wall, floor, floorY = 700, body, wallPattern = "", sky = null }) {
  const [wd, wf] = vgrad([[0, wall[0]], [1, wall[1]]]);
  const [fd, ff] = vgrad([[0, floor[0]], [1, floor[1]]]);
  const vignette = id("vg");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid slice">
<defs><filter id="blur" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="14"/></filter><radialGradient id="${vignette}" cx="0.5" cy="0.45" r="0.75"><stop offset="0.55" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity="0.62"/></radialGradient></defs>
${sky ?? `${wd}${rect(0, 0, W, floorY, wf)}`}
${wallPattern}
${fd}${rect(0, floorY, W, H - floorY, ff)}
${rect(0, floorY - 14, W, 14, "#0e1215", 0, 'opacity="0.7"')}
${rect(0, floorY, W, 3, "#fff", 0, 'opacity="0.06"')}
${body}
<rect width="${W}" height="${H}" fill="url(#${vignette})"/>
</svg>
`;
}

const tileWall = (color = "#ffffff", opacity = 0.05, size = 80, y0 = 0, y1 = 700) => {
  let out = "";
  for (let x = 0; x <= W; x += size) out += line(x, y0, x, y1, color, 2, `opacity="${opacity}"`);
  for (let y = y0; y <= y1; y += size) out += line(0, y, W, y, color, 2, `opacity="${opacity}"`);
  return out;
};

const ROOMS = {};

ROOMS.living = () =>
  scene({
    wall: ["#1a2630", "#27404b"],
    floor: ["#3b2f29", "#1f1815"],
    body: [
      lightCone(190, 150, 330, 700, 220),
      windowFrame(190, 150, 330, 400),
      curtain(110, 110, 90, 470, "#20323b"),
      curtain(510, 110, 90, 470, "#20323b"),
      frameArt(760, 200, 300, 200),
      frameArt(1110, 240, 160, 220, "#3b4f43"),
      rug(840, 830, 560, 110),
      shadow(860, 760, 440, 34),
      rect(560, 430, 620, 170, "#2c3d46", 46),
      rect(520, 540, 720, 190, "#34495a", 44),
      rect(560, 500, 280, 140, "#3e566a", 30),
      rect(860, 500, 280, 140, "#3e566a", 30),
      rect(560, 720, 40, 40, "#0f1316", 6),
      rect(1160, 720, 40, 40, "#0f1316", 6),
      circle(640, 540, 34, "#c9895a", 'opacity="0.85"'),
      rect(700, 770, 320, 56, "#241c18", 10),
      rect(720, 826, 14, 40, "#15110f"),
      rect(986, 826, 14, 40, "#15110f"),
      rect(730, 745, 110, 26, "#c8b79a", 6),
      circle(940, 758, 14, "#e8c98f", 'opacity="0.9"'),
      floorLamp(1360, 720),
      plant(150, 720, 1.1),
    ].join(""),
  });

ROOMS.kitchen = () => {
  const cab = "#26343c";
  const handle = "#a9b8bf";
  const upper = [0, 1, 2, 3, 4].map((i) => rect(560 + i * 200, 120, 190, 220, cab, 6) + rect(740 + i * 200 - 90, 300, 70, 8, handle, 4)).join("");
  const lower = [0, 1, 2, 3].map((i) => rect(60 + i * 270, 480, 260, 230, "#2d3d46", 6) + rect(120 + i * 270, 510, 140, 8, handle, 4)).join("");
  return scene({
    wall: ["#1b2830", "#2c4650"],
    floor: ["#34302d", "#1c1a19"],
    wallPattern: tileWall("#fff", 0.045, 70, 340, 480),
    body: [
      lightCone(110, 120, 320, 700, 200, 0.07),
      windowFrame(110, 110, 320, 240, { bars: 2 }),
      rect(520, 20, 520, 90, "#10161a", 10),
      rect(540, 100, 480, 12, "#0b0f12"),
      upper,
      rect(40, 460, 1100, 24, "#bdc7cc", 4),
      lower,
      rect(1160, 330, 260, 380, "#aab5ba", 14),
      rect(1160, 520, 260, 6, "#6f7b81"),
      rect(1180, 400, 12, 90, "#5e6a70", 6),
      rect(1180, 560, 12, 90, "#5e6a70", 6),
      shadow(1290, 722, 150, 14),
      glow(620, 460, 260, "#ffe2b0", 0.18),
      rect(290, 430, 140, 30, "#5d6c74", 8),
      line(360, 430, 360, 392, "#c6d0d4", 8),
      line(360, 392, 400, 392, "#c6d0d4", 8),
      circle(740, 440, 22, "#d98a4a", 'opacity="0.9"'),
      circle(784, 446, 18, "#78a45c", 'opacity="0.9"'),
      rect(840, 410, 90, 50, "#3c4b53", 8),
      shadow(700, 880, 480, 30),
      rect(380, 770, 680, 40, "#c7d0d4", 8),
      rect(420, 810, 600, 90, "#2d3d46", 10),
      ...[470, 650, 830].map((x) => rect(x, 840, 70, 20, "#15191c", 4) + rect(x + 28, 860, 14, 80, "#15191c") + rect(x - 10, 934, 90, 12, "#15191c", 4)),
      pendant(560, 0, 240, 56),
      pendant(880, 0, 240, 56),
    ].join(""),
  });
};

ROOMS.dining = () =>
  scene({
    wall: ["#1e2630", "#2f3f4c"],
    floor: ["#3a2c25", "#1d1613"],
    body: [
      lightCone(1160, 150, 300, 700, 200),
      windowFrame(1160, 150, 300, 420, { bars: 2 }),
      curtain(1090, 110, 80, 480, "#2a2f3a"),
      frameArt(220, 190, 360, 240, "#3a4a52"),
      frameArt(640, 220, 150, 190, "#4a4036"),
      rect(120, 560, 520, 170, "#2b221d", 8),
      rect(150, 590, 220, 120, "#33291f", 4),
      rect(390, 590, 220, 120, "#33291f", 4),
      rect(180, 520, 90, 40, "#c8b79a", 8),
      circle(540, 540, 26, "#e8c98f", 'opacity="0.8"'),
      rug(900, 860, 560, 100, "#2b3841"),
      shadow(900, 800, 440, 30),
      rect(600, 610, 600, 36, "#8a6a4a", 10),
      rect(630, 646, 22, 130, "#6f5439"),
      rect(1148, 646, 22, 130, "#6f5439"),
      ...[690, 860, 1030].flatMap((x) => [rect(x, 430, 110, 220, "#2e4450", 14), rect(x + 10, 660, 90, 24, "#223540", 10), rect(x + 8, 684, 12, 100, "#15191c"), rect(x + 90, 684, 12, 100, "#15191c")]),
      ellipse(900, 600, 90, 14, "#d9d4c6", 'opacity="0.55"'),
      rect(880, 560, 40, 50, "#3a7a62", 6),
      pendant(900, 0, 290, 90),
    ].join(""),
  });

ROOMS.bedroom = () =>
  scene({
    wall: ["#171f2b", "#25364a"],
    floor: ["#34302e", "#1a1816"],
    body: [
      lightCone(1180, 140, 280, 700, 190, 0.07, "#b9d3ee"),
      windowFrame(1180, 140, 280, 380, { sky: ["#1d3250", "#3b5f86"] }),
      curtain(1100, 100, 80, 450, "#26324a"),
      curtain(1470, 100, 80, 450, "#26324a"),
      rect(380, 250, 640, 330, "#2b3748", 24),
      frameArt(520, 120, 360, 100, "#2f4155"),
      shadow(700, 800, 560, 36),
      rect(360, 470, 680, 280, "#2a3340", 20),
      rect(350, 520, 700, 210, "#3c4b60", 28),
      rect(350, 600, 700, 130, "#51657f", 24),
      rect(350, 596, 700, 16, "#6d819b", 8),
      rect(420, 480, 220, 80, "#d9dde2", 30),
      rect(740, 480, 220, 80, "#d9dde2", 30),
      rect(350, 740, 24, 50, "#0f1316"),
      rect(1026, 740, 24, 50, "#0f1316"),
      rect(180, 560, 140, 170, "#2a2420", 10),
      rect(1090, 560, 140, 170, "#2a2420", 10),
      glow(250, 500, 260, "#ffd9a0", 0.38),
      glow(1160, 500, 260, "#ffd9a0", 0.34),
      ...[250, 1160].map((x) => rect(x - 4, 500, 8, 60, "#15191c") + poly([[x - 46, 506], [x + 46, 506], [x + 26, 440], [x - 26, 440]], "#e8c98f")),
      rug(700, 880, 560, 90, "#233039"),
      plant(1380, 720, 1),
    ].join(""),
  });

ROOMS.kids = () =>
  scene({
    wall: ["#1d2b3c", "#30506b"],
    floor: ["#3a352f", "#1f1c19"],
    body: [
      lightCone(1140, 150, 260, 700, 170, 0.08),
      windowFrame(1140, 150, 260, 340, { sky: ["#1a2d4d", "#3a5a8a"] }),
      circle(1270, 250, 44, "#f1e3a5", 'opacity="0.9"'),
      circle(1288, 240, 38, "#2b4a6e"),
      ...Array.from({ length: 9 }, (_, i) => circle(160 + i * 110, 120 + Math.sin(i * 1.3) * 26, 9, "#ffd36a", 'opacity="0.9"') + glow(160 + i * 110, 120 + Math.sin(i * 1.3) * 26, 50, "#ffd36a", 0.3)),
      line(120, 100, 1100, 100, "#0d1114", 2, 'opacity="0.5"'),
      rug(600, 840, 520, 120, "#a15b4a"),
      ellipse(600, 840, 330, 70, "#d1a05a", 'opacity="0.35"'),
      rect(120, 450, 640, 200, "#e8c98f", 20, 'opacity="0.85"'),
      rect(120, 450, 120, 260, "#d1a05a", 14, 'opacity="0.9"'),
      rect(120, 560, 640, 90, "#4b6f94", 20),
      rect(130, 520, 170, 60, "#e8ecef", 24),
      shadow(440, 735, 360, 24),
      rect(120, 650, 24, 80, "#6f5439"),
      rect(736, 650, 24, 80, "#6f5439"),
      ...[[380, 760, "#d96a5a"], [450, 780, "#5aa0d9"], [420, 726, "#e8c35a"], [540, 770, "#6ab87a"]].map(([x, y, c]) => rect(x, y, 56, 56, c, 8)),
      circle(900, 760, 40, "#e8c35a"),
      poly([[1000, 790], [1070, 700], [1140, 790]], "#d96a5a"),
      shelf(1280, 520, 240, 2, 100, [rect(1310, 440 + 100, 46, 60, "#d96a5a", 6), rect(1380, 560, 60, 50, "#5aa0d9", 6), rect(1440, 640, 50, 56, "#e8c35a", 6)].join("")),
      plant(1450, 720, 0.8),
    ].join(""),
  });

ROOMS.bathroom = () =>
  scene({
    wall: ["#18272e", "#2b4650"],
    floor: ["#2a3338", "#171d20"],
    wallPattern: tileWall("#fff", 0.06, 90, 0, 700),
    body: [
      glow(520, 280, 420, "#d6f0ff", 0.22),
      rect(380, 120, 280, 360, "#0e1316", 14),
      rect(394, 134, 252, 332, "#8fb3c2", 8, 'opacity="0.55"'),
      poly([[394, 134], [520, 134], [394, 330]], "#fff", 'opacity="0.12"'),
      rect(330, 560, 380, 60, "#d9dfe2", 10),
      rect(400, 620, 240, 110, "#c3cbcf", 12),
      path_("M470 560 q50 -70 100 0z", "#aeb7bc"),
      line(520, 520, 520, 560, "#9aa5aa", 10),
      shadow(520, 735, 200, 18),
      rect(1000, 520, 480, 200, "#e1e6e8", 40),
      rect(1020, 540, 440, 150, "#9cc1d0", 30, 'opacity="0.55"'),
      rect(960, 480, 40, 240, "#e1e6e8", 14),
      rect(1440, 470, 14, 250, "#aeb7bc"),
      line(1447, 470, 1447, 360, "#aeb7bc", 10),
      line(1447, 360, 1340, 360, "#aeb7bc", 10),
      circle(1340, 380, 26, "#aeb7bc"),
      shadow(1240, 738, 280, 18),
      rect(790, 220, 160, 14, "#aeb7bc", 6),
      rect(830, 234, 8, 220, "#aeb7bc"),
      rect(800, 250, 130, 190, "#d9e4e8", 10, 'opacity="0.85"'),
      rect(860, 250, 20, 190, "#c0ced3", 4, 'opacity="0.5"'),
      plant(780, 720, 0.7, "#cfd6d9"),
      rug(560, 840, 300, 50, "#3a4d55"),
    ].join(""),
  });

ROOMS.office = () =>
  scene({
    wall: ["#171f26", "#25353f"],
    floor: ["#2f2a27", "#181513"],
    body: [
      lightCone(150, 130, 300, 700, 200, 0.07),
      windowFrame(150, 130, 300, 360, { sky: ["#1f3a52", "#4a7088"] }),
      shelf(1180, 120, 340, 4, 150, [books(1200, 270, 11), books(1200, 420, 10), rect(1230, 440, 90, 100, "#d9dde2", 6, 'opacity="0.0"'), books(1200, 570, 9), plant(1400, 270, 0.4)].join("")),
      frameArt(560, 170, 300, 190, "#34505c"),
      shadow(800, 745, 420, 26),
      rect(480, 560, 640, 30, "#8a6a4a", 8),
      rect(500, 590, 22, 140, "#15191c"),
      rect(1078, 590, 22, 140, "#15191c"),
      rect(520, 600, 190, 130, "#2d3b44", 6),
      rect(870, 380, 230, 150, "#0c1115", 8),
      rect(882, 392, 206, 126, "#2f6f89", 4),
      poly([[882, 392], [1000, 392], [882, 470]], "#fff", 'opacity="0.1"'),
      glow(985, 455, 330, "#6fc3e6", 0.25),
      rect(970, 530, 30, 30, "#15191c"),
      rect(930, 552, 110, 10, "#15191c", 4),
      rect(1010, 540, 80, 20, "#d0d6da", 4),
      line(520, 560, 560, 470, "#15191c", 8),
      line(560, 470, 620, 440, "#15191c", 8),
      glow(630, 450, 150, "#ffd9a0", 0.55),
      poly([[600, 440], [670, 440], [640, 470]], "#e8c98f"),
      rect(660, 590, 130, 16, "#cbbfae", 4),
      path_("M700 640 h200 q22 0 22 22 v40 q0 22 -22 22 h-200 q-22 0 -22 -22 v-40 q0 -22 22 -22z", "#2e3f4a"),
      rect(722, 480, 150, 190, "#34495a", 40),
      rect(786, 720, 24, 60, "#15191c"),
      ellipse(798, 790, 110, 12, "#15191c"),
      rug(780, 890, 460, 80, "#26333b"),
    ].join(""),
  });

ROOMS.hallway = () =>
  scene({
    wall: ["#1b2229", "#2c3b46"],
    floor: ["#322b26", "#1a1614"],
    body: [
      rect(1000, 150, 380, 570, "#12181c", 6),
      rect(1020, 170, 340, 530, "#6b4f3a", 4),
      rect(1050, 200, 120, 200, "#5a4130", 4),
      rect(1210, 200, 120, 200, "#5a4130", 4),
      rect(1050, 430, 120, 230, "#5a4130", 4),
      rect(1210, 430, 120, 230, "#5a4130", 4),
      circle(1330, 440, 14, "#d9c28a"),
      glow(1190, 160, 400, "#ffd9a0", 0.2),
      rect(150, 230, 520, 24, "#12171b", 6),
      ...[210, 320, 430, 540].flatMap((x, i) => [line(x, 254, x, 280, "#aab5ba", 6), path_(`M${x - 44} 280 h88 l${i % 2 ? 14 : -10} ${300 - i * 20} h-110 z`, ["#34495a", "#6b3f3a", "#3a5a48", "#4a4660"][i], 'opacity="0.95"')]),
      shadow(380, 735, 300, 20),
      rect(140, 560, 560, 36, "#8a6a4a", 8),
      rect(170, 596, 20, 130, "#15191c"),
      rect(650, 596, 20, 130, "#15191c"),
      rect(180, 520, 120, 40, "#c8b79a", 10),
      rect(180, 640, 520, 14, "#12171b", 4),
      ...[220, 300, 520, 600].map((x) => rect(x, 670, 60, 24, "#2a2220", 10)),
      rect(780, 180, 160, 380, "#0e1316", 10),
      rect(792, 192, 136, 356, "#9cb7c4", 6, 'opacity="0.5"'),
      poly([[792, 192], [880, 192], [792, 340]], "#fff", 'opacity="0.14"'),
      glow(860, 380, 300, "#d6f0ff", 0.16),
      rug(500, 880, 700, 80, "#2a3a43"),
      plant(1470, 720, 0.9),
      pendant(540, 0, 150, 50),
    ].join(""),
  });

ROOMS.garage = () => {
  const slats = Array.from({ length: 10 }, (_, i) => rect(240, 150 + i * 56, 1120, 50, "#3a4650", 4) + rect(240, 196 + i * 56, 1120, 3, "#000", 0, 'opacity="0.3"')).join("");
  return scene({
    wall: ["#1c2227", "#2c353b"],
    floor: ["#2b2f31", "#17191a"],
    body: [
      rect(220, 130, 1160, 600, "#0e1215", 8),
      slats,
      glow(800, 700, 700, "#ffe2b0", 0.12),
      shadow(800, 842, 560, 36, 0.5),
      path_("M360 800 L420 650 Q440 610 500 604 L1100 604 Q1160 610 1190 650 L1260 780 Q1272 800 1250 812 L400 812 Q348 812 360 800z", "#2b4150"),
      path_("M520 612 L580 532 Q596 516 640 516 L980 516 Q1030 516 1050 540 L1110 612z", "#1a2a35"),
      path_("M560 604 L610 548 L790 548 L790 604z", "#8ab0c2", 'opacity="0.55"'),
      path_("M810 604 L810 548 L970 548 Q1000 548 1020 580 L1040 604z", "#8ab0c2", 'opacity="0.55"'),
      circle(500, 812, 62, "#0b0e10"),
      circle(500, 812, 30, "#6f7d86"),
      circle(1120, 812, 62, "#0b0e10"),
      circle(1120, 812, 30, "#6f7d86"),
      ellipse(1230, 700, 22, 14, "#ffe2b0", 'opacity="0.95"'),
      glow(1230, 700, 120, "#ffe2b0", 0.4),
      shelf(1430, 300, 140, 3, 130, rect(1450, 190 + 130, 100, 100, "#8a6a4a", 4) + rect(1450, 190 + 260, 100, 100, "#4a5a64", 4)),
      rect(40, 260, 120, 12, "#12171b"),
      rect(60, 272, 8, 140, "#aab5ba"),
      rect(120, 272, 8, 90, "#aab5ba"),
      poly([[1000, 0], [1060, 0], [1040, 40], [1020, 40]], "#0e1215"),
      glow(1030, 50, 300, "#ffe2b0", 0.18),
    ].join(""),
  });
};

ROOMS.garden = () => {
  const [sd, sf] = vgrad([[0, "#0f1b2d"], [0.6, "#233f5c"], [1, "#4a6f84"]]);
  const sky = `${sd}${rect(0, 0, W, 760, sf)}${circle(1240, 220, 80, "#f1e3a5", 'opacity="0.9"')}${glow(1240, 220, 300, "#f1e3a5", 0.2)}`;
  const stars = Array.from({ length: 26 }, (_, i) => circle(40 + ((i * 257) % 1500), 30 + ((i * 131) % 260), i % 3 ? 1.6 : 2.4, "#fff", 'opacity="0.6"')).join("");
  const tree = (x, y, r, c) => rect(x - 12, y, 24, 200, "#1a1612") + circle(x, y, r, c) + circle(x - r * 0.5, y + r * 0.4, r * 0.7, c) + circle(x + r * 0.55, y + r * 0.35, r * 0.65, c);
  return scene({
    wall: ["#000", "#000"],
    floor: ["#2a4a33", "#142418"],
    floorY: 740,
    sky,
    body: [
      stars,
      path_("M0 740 L0 560 Q300 470 620 560 T1220 540 T1600 560 L1600 740z", "#183024"),
      tree(260, 470, 130, "#1f4a38"),
      tree(1380, 430, 150, "#245a42"),
      tree(1500, 520, 100, "#1c4434"),
      rect(0, 640, 1600, 18, "#2b2118"),
      ...Array.from({ length: 28 }, (_, i) => rect(i * 60 + 10, 560, 14, 120, "#3a2c20", 2)),
      rect(0, 580, 1600, 10, "#3a2c20"),
      rect(0, 640, 1600, 10, "#3a2c20"),
      rect(380, 760, 840, 240, "#6b5f54", 6),
      ...[0, 1, 2, 3, 4, 5].map((i) => line(380 + i * 168, 760, 380 + i * 168, 1000, "#000", 3, 'opacity="0.25"')),
      shadow(800, 872, 330, 24, 0.45),
      rect(540, 820, 520, 28, "#8a6a4a", 8),
      rect(580, 848, 18, 100, "#2b2118"),
      rect(1006, 848, 18, 100, "#2b2118"),
      ...[500, 1100].map((x) => rect(x, 800, 70, 150, "#3a2c20", 10)),
      path_("M0 150 Q400 280 800 190 T1600 220", "none", 'stroke="#0d1114" stroke-width="3"'),
      ...Array.from({ length: 12 }, (_, i) => {
        const x = 60 + i * 134;
        const y = 200 + Math.sin(i * 0.9) * 40 + (i % 2) * 12;
        return circle(x, y, 8, "#ffd9a0", 'opacity="0.95"') + glow(x, y, 54, "#ffd9a0", 0.4);
      }),
    ].join(""),
  });
};

ROOMS.laundry = () =>
  scene({
    wall: ["#1a2630", "#2c4351"],
    floor: ["#2d3236", "#171a1c"],
    wallPattern: tileWall("#fff", 0.04, 100, 0, 700),
    body: [
      lightCone(1180, 150, 240, 700, 150, 0.07),
      windowFrame(1180, 150, 240, 280, { bars: 1 }),
      shelf(120, 150, 520, 2, 130, [rect(150, 180, 150, 100, "#8a6a4a", 10), rect(330, 190, 120, 90, "#aab5ba", 10), rect(480, 180, 120, 100, "#c8b79a", 10), rect(160, 310, 200, 100, "#4b6f94", 10), rect(400, 320, 180, 90, "#d9dde2", 10)].join("")),
      shadow(520, 740, 470, 26),
      ...[[260, "#d9dfe2"], [620, "#cfd6d9"]].map(([x, c]) => rect(x - 130, 430, 260, 300, c, 14) + rect(x - 130, 430, 260, 50, "#b8c1c5", 14) + circle(x - 80, 455, 10, "#4b6f94") + circle(x, 590, 100, "#6f7d86") + circle(x, 590, 82, "#10181d") + circle(x, 590, 62, "#4a7d96", 'opacity="0.55"') + poly([[x - 60, 560], [x - 10, 540], [x - 40, 600]], "#fff", 'opacity="0.18"')),
      rect(300, 480, 70, 8, "#4b6f94", 4),
      rect(760, 480, 520, 250, "#2d3d46", 8),
      rect(760, 460, 520, 24, "#bdc7cc", 4),
      ...[0, 1, 2].map((i) => rect(790 + i * 160, 510, 140, 190, "#33454f", 6) + rect(840 + i * 160, 530, 40, 8, "#a9b8bf", 4)),
      line(780, 200, 1100, 200, "#aab5ba", 6),
      ...[820, 920, 1010].map((x, i) => path_(`M${x} 200 l-34 20 v150 h120 v-150z`, ["#4b6f94", "#c8b79a", "#6b3f3a"][i], 'opacity="0.9"')),
      rug(900, 880, 700, 80, "#2a3a43"),
    ].join(""),
  });

ROOMS.storage = () =>
  scene({
    wall: ["#171c20", "#252e34"],
    floor: ["#2a2c2d", "#151617"],
    wallPattern: Array.from({ length: 12 }, (_, i) => line(0, 60 + i * 56, W, 60 + i * 56, "#fff", 2, 'opacity="0.03"')).join(""),
    body: [
      glow(800, 80, 700, "#ffe2b0", 0.2),
      line(800, 0, 800, 130, "#0d1114", 4),
      circle(800, 150, 22, "#ffe2b0"),
      glow(800, 150, 160, "#ffe2b0", 0.6),
      shelf(120, 160, 560, 4, 140, ["#8a6a4a", "#6b4f3a", "#a38864", "#4a5a64", "#8a6a4a", "#5a6a74", "#6b4f3a"].map((c, i) => rect(150 + (i % 3) * 170, 160 + 140 * Math.floor(i / 3) + 140 - 96, 140, 96, c, 6) + rect(170 + (i % 3) * 170, 160 + 140 * Math.floor(i / 3) + 140 - 70, 100, 6, "#000", 3, 'opacity="0.25"')).join("")),
      shelf(1000, 200, 460, 3, 160, [rect(1030, 200 + 160 - 90, 160, 90, "#4a5a64", 6), rect(1220, 200 + 160 - 120, 120, 120, "#8a6a4a", 6), rect(1060, 200 + 320 - 100, 200, 100, "#6b4f3a", 6), rect(1290, 200 + 320 - 80, 130, 80, "#a38864", 6), rect(1040, 200 + 480 - 80, 380, 80, "#34495a", 6)].join("")),
      shadow(800, 760, 620, 30),
      rect(660, 600, 220, 120, "#8a6a4a", 8),
      rect(680, 640, 180, 8, "#000", 3, 'opacity="0.25"'),
      rect(690, 520, 160, 80, "#6b4f3a", 8),
      rect(900, 640, 150, 80, "#4a5a64", 8),
      line(1500, 230, 1500, 700, "#12171b", 10),
      circle(1500, 740, 34, "#2b3238"),
    ].join(""),
  });

ROOMS.room = () =>
  scene({
    wall: ["#1b2530", "#2c414f"],
    floor: ["#34302d", "#1b1917"],
    body: [
      lightCone(210, 150, 320, 700, 200),
      windowFrame(210, 150, 320, 400),
      curtain(130, 110, 90, 470, "#22323d"),
      curtain(520, 110, 90, 470, "#22323d"),
      frameArt(800, 200, 320, 210),
      rug(960, 850, 520, 100),
      shadow(1000, 745, 380, 26),
      rect(760, 520, 520, 180, "#2f4350", 18),
      rect(790, 700, 22, 40, "#0f1316"),
      rect(1230, 700, 22, 40, "#0f1316"),
      rect(800, 560, 440, 12, "#000", 6, 'opacity="0.18"'),
      rect(840, 460, 120, 60, "#3e566a", 14),
      floorLamp(1400, 720, 480),
      plant(170, 720, 1.1),
    ].join(""),
  });

fs.mkdirSync(OUT, { recursive: true });
for (const [name, make] of Object.entries(ROOMS)) {
  fs.writeFileSync(path.join(OUT, `${name}.svg`), make().replace(/\n{2,}/g, "\n").replace(/ {2,}/g, " "));
  console.log("wrote", name);
}
