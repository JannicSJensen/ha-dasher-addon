/*
 * A fake tilbudsugen.dk for the offers page: GET /offer/<product> answers with a page that carries its data as
 * JSON (__NEXT_DATA__), from the fixtures in dev/fixtures (pepsi-max, laks); other products have no offers.
 *
 *   PORT=8199 node dev/mock-tilbudsugen.js        then start Dasher with OFFERS_BASE_URL=http://127.0.0.1:8199
 */
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");
const page = (items) => `<!DOCTYPE html><html><body><script id="__NEXT_DATA__" type="application/json">${JSON.stringify({ props: { pageProps: { data: { pageOfOrganicProductOffers: { items, totalNumberOfItems: items.length, pageNumber: 1, lastValidPageNumber: 1 } } } } })}</script></body></html>`;

http
  .createServer((req, res) => {
    const url = new URL(req.url, "http://localhost");
    const match = /^\/offer\/([^/]+)$/.exec(url.pathname);
    if (!match) {
      res.writeHead(404);
      return res.end();
    }
    const slug = decodeURIComponent(match[1]);
    const file = path.join(dir, `offers-${slug}.json`);
    const items = /^[a-z0-9-]+$/.test(slug) && fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : [];
    console.log(`[mock-tilbudsugen] ${slug}: ${items.length} offers`);
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(page(items));
  })
  .listen(Number(process.env.PORT ?? 8199), () => console.log("[mock-tilbudsugen] listening"));
