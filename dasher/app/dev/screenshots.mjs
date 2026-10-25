/*
 * Makes the screenshots in docs/screenshots from the fake servers.
 *
 *   npm install --no-save puppeteer-core          # once; a Chromium-based browser must be installed
 *   node dev/mock-ha.js & node dev/mock-ma.js &
 *   # one Dasher on the example dashboard (8098)
 *   CONFIG_DIR=/tmp/shots-a DATA_DIR=/tmp/shots-a-data PORT=8098 HA_URL=http://127.0.0.1:8123 HA_TOKEN=dev MA_URL=http://127.0.0.1:8095 MA_TOKEN=dev-token node src/index.js &
 *   BROWSER=/usr/bin/chromium node dev/screenshots.mjs
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";

const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../docs/screenshots") + path.sep;
const browser = await puppeteer.launch({ executablePath: process.env.BROWSER ?? "/usr/bin/chromium", headless: true, args: ["--no-sandbox", "--disable-gpu", "--hide-scrollbars", "--force-device-scale-factor=1"] });
const page = await browser.newPage();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const size = (height = 800) => page.setViewport({ width: 1280, height, deviceScaleFactor: 1 });
const go = async (port, hash, ready) => {
  await page.goto(`http://localhost:${port}/?t=${Date.now()}${hash}`, { waitUntil: "load" });
  await page.waitForSelector(ready, { timeout: 20000 });
  await page.waitForFunction(() => [...document.querySelectorAll(".icon")].every((i) => i.querySelector("svg")), { timeout: 20000 }).catch(() => {});
  await sleep(2500);
};
const shot = async (name) => {
  await page.screenshot({ path: `${OUT}${name}.png` });
  console.log("saved", name);
};
const press = (selector, text) =>
  page.evaluate(
    (sel, txt) =>
      new Promise((resolve) => {
        const el = [...document.querySelectorAll(sel)].find((e) => !txt || e.innerText.includes(txt));
        el.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, clientX: 5, clientY: 5 }));
        setTimeout(() => {
          el.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, clientX: 5, clientY: 5 }));
          resolve();
        }, 120);
      }),
    selector,
    text,
  );

await size();
await go(8098, "#/home", ".heromsg"); await shot("home");
await go(8098, "#/climate", ".clcard"); await shot("climate");
await go(8098, "#/areas", ".tile--area"); await shot("areas");
await press(".tile--area:nth-child(2)"); await page.waitForSelector(".area"); await sleep(2500); await shot("area");
await page.evaluate(() => document.querySelector(".area").scrollTo({ top: 1e5, behavior: "instant" })); await sleep(1500); await shot("area-devices");
await go(8098, "#/music", ".mtab"); await press(".mtab", "Discover"); await sleep(2500); await shot("music-discover");
await press(".mtab", "Radio"); await sleep(2000); await shot("music-radio");
await press(".mtab", "Party"); await page.waitForSelector(".party__code img"); await sleep(2000); await shot("music-party");
await press(".np__art"); await page.waitForSelector(".npscreen.is-open"); await sleep(2500); await shot("now-playing");
await go(8098, "#/media", ".plcard"); await shot("media");
await go(8098, "#/todo", ".tdcard"); await shot("todo");
await press(".tdcard", "Garage"); await page.waitForSelector(".tdrow"); await sleep(1500); await shot("todo-list");
await go(8098, "#/ev", ".evcar"); await shot("car");
await size(1180);
await go(8098, "#/devices", ".devcard"); await shot("devices");
await browser.close();
