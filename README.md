# Dasher – Home Assistant app repository

[![Add repository to my Home Assistant](https://my.home-assistant.io/badges/supervisor_add_addon_repository.svg)](https://my.home-assistant.io/redirect/supervisor_add_addon_repository/?repository_url=https%3A%2F%2Fgithub.com%2FJannicSJensen%2Fha-dasher-addon)

This repository contains the **Dasher** app (add-on) for Home Assistant: a dark, card-based wall-tablet dashboard that is served as a plain web page. The visual style is inspired by [ruudmens/home-assistant-dashboard](https://github.com/ruudmens/home-assistant-dashboard) (MIT).

* Tablets just open `http://<home-assistant>:8099/`; no Home Assistant login, no HACS cards.
* Dashboards are described in one `dashboard.yaml` and hot-reload on save.
* Tiles: area hero with clock, status messages (like waste pick-up reminders) and quick buttons, lights/switches (with brightness slider), electricity price timeline, calendar agenda with weather, vehicle, "now playing", heat pump/AC and button grids.
* **Area pages:** every Home Assistant area as a clickable picture card; each opens a sub-page with its temperature, humidity, windows and a picture tile with brightness slider for every light and player.
* **Now playing tile and full-screen player:** the tile follows whichever speaker is playing, with controls, volume and progress; when everything is stopped it shows the last track that played (remembered by the app). When music starts, a full-screen player opens with big artwork, seeking, shuffle/repeat and volume.
* **Music page:** swipeable tabs for Discover, Radio, Albums, Artists, Podcasts (with episodes), Party (QR code and live queue of Music Assistant's Party plugin) and Search, a speaker picker with Music Assistant grouping and a now-playing bar. Browsing uses Music Assistant's API with a read-only token in the app options; playback goes through Home Assistant.
* **Car page:** battery and range, start/stop charging, smart charging with its times, a charger restart, and remote climate (start, temperature, window heat); EV Smart Charging, Peblar and FordPass are recognised automatically.
* **Media page:** Plex through Home Assistant's Plex integration: continue watching and recently added movies and series. Plays on Cast devices and Plex clients, and, with a Plex address and token in the app options, on Apple TVs and DLNA players with stream links.
* **Devices page:** robot vacuums with controls, and washing machines, dryers, dishwashers and clothes heaters (LG ThinQ found automatically, others listed in `dashboard.yaml`).
* **Climate page:** a card per room with temperature, setpoint and power, built from your climate helpers.
* **Missing entities:** when `dashboard.yaml` uses entities your Home Assistant does not have, a screen on the tablet suggests and lets you pick the right ones; the choices are kept in `entity-map.yaml`. The same screen offers the calendar tile and the car price from newer versions, with ready-made YAML to copy.
* **Updates:** an unedited `dashboard.yaml` follows new versions of the example (the old one is saved as `dashboard.yaml.bak`); an edited one is never touched. The current example is always written to `dashboard.example.yaml`.
* Vanilla JavaScript front end, one small Node.js server, no build step.
* Commands from tablets are restricted to the entities in `dashboard.yaml`, the area pages, the climate page, the devices page, the media page and the music page, and to a fixed list of services.

## Install

1. Click the button above, or in Home Assistant open **Settings → Apps → App store → ⋮ → Repositories** and add
   `https://github.com/JannicSJensen/ha-dasher-addon`.
2. Install **Dasher**, start it, and open its sidebar entry.
3. Edit `dashboard.yaml` in the app's configuration folder (reachable with the *Samba* or *File editor* apps).
4. Optional, under the app's *Configuration* tab: the Music Assistant address and token (browsing tabs), and the Plex address and token (stream links to Apple TVs and DLNA players). Restart the app after changing them.

You can also copy the [dasher/](dasher) folder into your `local_apps` share instead.

Full documentation: [dasher/DOCS.md](dasher/DOCS.md). Release notes: [dasher/CHANGELOG.md](dasher/CHANGELOG.md).

## Development

You need Node.js 18 or newer. Everything runs from `dasher/app`:

```sh
cd dasher/app
npm install
npm test                      # unit tests, no servers needed
```

Run the app against fake servers (three terminals; no Home Assistant needed):

```sh
node dev/mock-ha.js           # fake Home Assistant on :8123 (areas, lights, speakers, radio stations, Plex library, calendars, car, climate)
node dev/mock-ma.js           # fake Music Assistant on :8095 (fictional library, token "dev-token")

HA_URL=http://127.0.0.1:8123 HA_TOKEN=dev \
MA_URL=http://127.0.0.1:8095 MA_TOKEN=dev-token \
CONFIG_DIR=$PWD/dev/config DATA_DIR=$PWD/dev/data \
node src/index.js             # then open http://localhost:8099
```

`npm run dev` starts all three at once. The first start copies `examples/dashboard.yaml` to `dev/config/`; edit that copy and the page reloads.

Against a real Home Assistant, create a long-lived access token (Profile → Security), keep it in your shell rather than in a file, and set `HA_URL` and `HA_TOKEN`. For the Music Assistant tabs also set `MA_URL` and `MA_TOKEN`. Entities in `dashboard.yaml` that Home Assistant does not know are logged as a warning and shown in a banner on the tablet.

| Variable | Meaning |
| --- | --- |
| `HA_URL`, `HA_TOKEN` | Home Assistant address and long-lived token (inside the app the Supervisor token is used instead). |
| `MA_URL`, `MA_TOKEN` | Music Assistant address and token (app options `music_assistant_url` / `music_assistant_token`). |
| `PLEX_URL`, `PLEX_TOKEN` | Plex address and token for stream links (app options `plex_url` / `plex_token`); the mock Home Assistant also answers as a Plex server with token `tok`. |
| `CONFIG_DIR` | Folder with `dashboard.yaml` and `assets/` (the app uses `/config`). |
| `DATA_DIR` | Where the "last played" memory is saved (the app uses `/data`). |
| `PORT` | HTTP port, default 8099. |

```
dasher/                          the app (this folder is what Home Assistant builds)
  config.yaml, Dockerfile        app definition, see the Home Assistant app docs
  run.sh                         container entry point
  DOCS.md, README.md, CHANGELOG.md, icon.png, logo.png, translations/
  app/
    src/                         server: config, areas, radio, music, calendar, car, climate, Plex, now playing, HA client, policy, HTTP
    web/                         front end (index.html, css/, js/core, lib, tiles, pages, views, components)
    examples/dashboard.yaml      copied to the user's config folder on first start
    test/, dev/                  tests and the fake servers (not part of the image)
```

Keep the version in `dasher/config.yaml` and `dasher/app/package.json` identical (a test checks it), and add a line to `dasher/CHANGELOG.md` for every release: Home Assistant only offers an update when the version changes.

## License

[MIT](LICENSE). The bundled Poppins font is licensed under the SIL Open Font License 1.1.
