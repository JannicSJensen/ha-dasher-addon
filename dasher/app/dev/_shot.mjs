import puppeteer from "puppeteer-core";
const [hash, ready, out, w = "1280", h = "800"] = process.argv.slice(2);
const b = await puppeteer.launch({ executablePath: "/usr/bin/brave-browser", headless: true, args: ["--no-sandbox", "--disable-gpu", "--hide-scrollbars"] });
const p = await b.newPage(); await p.setViewport({ width: +w, height: +h });
await p.goto(`http://localhost:8098/?t=${Date.now()}${hash}`, { waitUntil: "load" });
await p.waitForSelector(ready, { timeout: 20000 });
await p.waitForFunction(() => [...document.querySelectorAll(".icon")].every((i) => i.querySelector("svg")), { timeout: 20000 }).catch(() => {});
await new Promise((r) => setTimeout(r, 2500));
await p.screenshot({ path: out }); await b.close();
