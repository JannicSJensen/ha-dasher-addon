/**
 * Tiny fake Music Assistant API for development and screenshots.
 *   node dev/mock-ma.js      (listens on :8095, token "dev-token")
 * Serves a generated, fictional library through POST /api and covers at /imageproxy/<id>.
 */
import http from "node:http";

const PORT = Number(process.env.MA_PORT ?? 8095);
const TOKEN = process.env.MA_TOKEN ?? "dev-token";

const rnd = (seed) => {
  let s = seed;
  return () => ((s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296);
};
const rand = rnd(7);
const pick = (list) => list[Math.floor(rand() * list.length)];

const ADJ = ["Silver", "Quiet", "Neon", "Golden", "Hollow", "Velvet", "Paper", "Midnight", "Amber", "Crystal", "Wild", "Slow", "Northern", "Electric", "Faded"];
const NOUN = ["Fields", "Echoes", "Harbour", "Garden", "Lights", "Rivers", "Circuit", "Summer", "Mirrors", "Engines", "Sparrows", "Tides", "Canyons", "Letters", "Weather"];
const FIRST = ["Aurora", "Milo", "Nora", "Elias", "Saga", "Viggo", "Luna", "Otto", "Ida", "Felix", "Maja", "Anton", "Clara", "Jonas", "Freja", "Axel"];
const LAST = ["Holm", "Lund", "Berg", "Strand", "Vik", "Dahl", "Moen", "Skov", "Bruun", "Winther"];
const COLORS = ["#e4572e", "#17bebb", "#ffc914", "#76b041", "#6f4e7c", "#2e86ab", "#f18f01", "#c73e1d", "#3b8ea5", "#8d6a9f", "#ff6b6b", "#4ecdc4"];

const image = (id, kind) => ({ type: "thumb", path: `${kind}-${id}`, provider: "library", remotely_accessible: false, proxy_id: `${kind}${id}` });
const mapping = (item, kind, id) => ({ item_id: String(id), provider: "library", name: item.name, uri: `library://${kind}/${id}`, media_type: kind, image: image(id, kind) });

const artists = Array.from({ length: 28 }, (_, i) => {
  const id = i + 1;
  const name = `${pick(FIRST)} ${pick(LAST)}${i % 7 === 0 ? " Trio" : ""}`;
  return { item_id: String(id), provider: "library", name, uri: `library://artist/${id}`, media_type: "artist", favorite: i % 6 === 0, metadata: { images: [image(id, "artist")], description: `${name} is a fictional artist made up for development.` } };
});

const albums = Array.from({ length: 64 }, (_, i) => {
  const id = i + 1;
  const artist = artists[i % artists.length];
  const name = `${pick(ADJ)} ${pick(NOUN)}`;
  return { item_id: String(id), provider: "library", name, uri: `library://album/${id}`, media_type: "album", year: 1996 + (i % 29), favorite: i % 9 === 0, date_added: `2026-0${1 + (i % 9)}-1${i % 9}`, artists: [mapping(artist, "artist", artist.item_id)], metadata: { images: [image(id, "album")], description: `The fictional album ${name}.` } };
});

const tracks = [];
for (const album of albums) {
  const count = 6 + (Number(album.item_id) % 7);
  for (let n = 1; n <= count; n++) {
    const id = tracks.length + 1;
    tracks.push({ item_id: String(id), provider: "library", name: `${pick(ADJ)} ${pick(NOUN)} ${n % 3 === 0 ? "(Reprise)" : ""}`.trim(), uri: `library://track/${id}`, media_type: "track", duration: 150 + Math.floor(rand() * 160), track_number: n, favorite: false, artists: album.artists, album: { ...mapping(album, "album", album.item_id), name: album.name }, metadata: {} });
  }
}

const podcasts = ["The Slow Hour", "Code & Coffee", "Nordic Nights", "Kitchen Table Science", "Mapping the Unknown", "Small Talk Big Ideas", "Garden Radio", "History in Ten"].map((name, i) => {
  const id = i + 1;
  return { item_id: String(id), provider: "library", name, uri: `library://podcast/${id}`, media_type: "podcast", publisher: ["Fjord Audio", "Lamp Studio", "North Network"][i % 3], total_episodes: 12 + i * 3, favorite: i === 2, metadata: { images: [image(id, "podcast")], description: `<p>${name} is a <b>fictional</b> podcast for development.</p>` } };
});

const episodesOf = (podcast) =>
  Array.from({ length: podcast.total_episodes }, (_, n) => {
    const id = Number(podcast.item_id) * 1000 + n + 1;
    return { item_id: String(id), provider: "library", name: `Episode ${podcast.total_episodes - n}: ${pick(ADJ)} ${pick(NOUN)}`, uri: `library://podcast_episode/${id}`, media_type: "podcast_episode", duration: 900 + Math.floor(rand() * 2700), fully_played: n > 6, resume_position_ms: n === 1 ? 420000 : 0, podcast: mapping(podcast, "podcast", podcast.item_id), metadata: { release_date: `2026-09-${String(28 - n).padStart(2, "0")}T06:00:00`, description: "A fictional episode." } };
  });

const playlists = ["Morning Coffee", "Workout", "Focus", "Friday"].map((name, i) => ({ item_id: String(i + 1), provider: "library", name, uri: `library://playlist/${i + 1}`, media_type: "playlist", owner: "Demo", favorite: false, metadata: { images: [image(i + 1, "playlist")] } }));

const KIND = { album: albums, artist: artists, podcast: podcasts, playlist: playlists, track: tracks };

const sortBy = (list, order) => {
  const copy = [...list];
  if (order === "random") return copy.sort(() => rand() - 0.5);
  if (order === "timestamp_added_desc") return copy.reverse();
  return copy.sort((a, b) => a.name.localeCompare(b.name));
};

function libraryItems(kind, a) {
  let list = KIND[kind];
  if (a.favorite) list = list.filter((x) => x.favorite);
  if (a.search) list = list.filter((x) => x.name.toLowerCase().includes(String(a.search).toLowerCase()));
  list = sortBy(list, a.order_by);
  return list.slice(a.offset ?? 0, (a.offset ?? 0) + (a.limit ?? 25));
}

const find = (list, id) => list.find((x) => x.item_id === String(id));

const ROWS = [
  { item_id: "recently_played", provider: "library", name: "Recently played", pick: () => albums.slice(0, 12) },
  { item_id: "random_albums", provider: "library", name: "Random albums", pick: () => sortBy(albums, "random").slice(0, 14) },
  { item_id: "random_artists", provider: "library", name: "Random artists", pick: () => sortBy(artists, "random").slice(0, 14) },
  { item_id: "in_progress", provider: "library", name: "Continue listening", pick: () => episodesOf(podcasts[0]).slice(0, 3) },
  { item_id: "favorite_tracks", provider: "library", name: "Favourite tracks", pick: () => tracks.slice(0, 10) },
];

const commands = {
  "music/albums/library_items": (a) => libraryItems("album", a),
  "music/artists/library_items": (a) => libraryItems("artist", a),
  "music/podcasts/library_items": (a) => libraryItems("podcast", a),
  "music/playlists/library_items": (a) => libraryItems("playlist", a),
  "music/albums/get": (a) => find(albums, a.item_id),
  "music/artists/get": (a) => find(artists, a.item_id),
  "music/podcasts/get": (a) => find(podcasts, a.item_id),
  "music/playlists/get": (a) => find(playlists, a.item_id),
  "music/albums/album_tracks": (a) => tracks.filter((t) => t.album.item_id === String(a.item_id)),
  "music/artists/artist_albums": (a) => albums.filter((al) => al.artists[0].item_id === String(a.item_id)),
  "music/artists/artist_tracks": (a) => tracks.filter((t) => t.artists[0].item_id === String(a.item_id)).slice(0, 40),
  "music/podcasts/podcast_episodes": (a) => episodesOf(find(podcasts, a.item_id)),
  "music/playlists/playlist_tracks": (a) => tracks.slice(Number(a.item_id) * 5, Number(a.item_id) * 5 + 12),
  "music/recommendations": () => ROWS.map(({ pick: _pick, ...row }) => ({ ...row, media_type: "folder", enabled_by_default: true, items: [] })),
  "music/recommendations/items": (a) => ROWS.find((r) => r.item_id === a.item_id)?.pick() ?? [],
  "music/search": (a) => {
    const q = String(a.search_query).toLowerCase();
    const hit = (list) => list.filter((x) => x.name.toLowerCase().includes(q)).slice(0, a.limit ?? 5);
    return { artists: hit(artists), albums: hit(albums), tracks: hit(tracks), playlists: hit(playlists), podcasts: hit(podcasts), radio: [] };
  },
};

const cover = (proxyId) => {
  const label = proxyId.replace(/\d+$/, "").slice(0, 2).toUpperCase();
  const n = Number(proxyId.replace(/\D/g, ""));
  const a = COLORS[n % COLORS.length];
  const b = COLORS[(n * 3 + 5) % COLORS.length];
  const circle = proxyId.startsWith("artist");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 300"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs><rect width="300" height="300" fill="url(#g)"/>${circle ? '<circle cx="150" cy="115" r="48" fill="rgba(255,255,255,.35)"/><ellipse cx="150" cy="260" rx="95" ry="85" fill="rgba(255,255,255,.35)"/>' : `<circle cx="150" cy="150" r="90" fill="rgba(0,0,0,.18)"/><circle cx="150" cy="150" r="22" fill="rgba(255,255,255,.7)"/>`}<text x="20" y="48" font-family="Arial" font-weight="700" font-size="30" fill="rgba(255,255,255,.85)">${label}</text></svg>`;
};

const server = http.createServer((req, res) => {
  const url = new URL(req.url, "http://localhost");
  const imageMatch = url.pathname.match(/^\/imageproxy\/([a-z]+\d+)$/);
  if (imageMatch) {
    res.writeHead(200, { "Content-Type": "image/svg+xml" });
    return res.end(cover(imageMatch[1]));
  }
  if (req.method === "GET" && url.pathname === "/info") {
    res.writeHead(200, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ server_version: "mock", schema_version: 65, base_url: `http://127.0.0.1:${PORT}` }));
  }
  if (req.method === "POST" && url.pathname === "/api") {
    if (req.headers.authorization !== `Bearer ${TOKEN}`) {
      res.writeHead(401, { "Content-Type": "text/plain" });
      return res.end("Authentication required");
    }
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      let msg;
      try {
        msg = JSON.parse(body);
      } catch {
        res.writeHead(400);
        return res.end("bad json");
      }
      const handler = commands[msg.command];
      console.log(`[mock-ma] ${msg.command}`, JSON.stringify(msg.args ?? {}).slice(0, 120));
      if (!handler) {
        res.writeHead(404, { "Content-Type": "application/json" });
        return res.end(JSON.stringify({ error_code: 404, details: `Command not found: ${msg.command}` }));
      }
      setTimeout(() => {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(handler(msg.args ?? {})));
      }, Number(process.env.MA_DELAY ?? 40));
    });
    return;
  }
  res.writeHead(404);
  res.end();
});
server.listen(PORT, () => console.log(`[mock-ma] listening on :${PORT} (token ${TOKEN})`));
