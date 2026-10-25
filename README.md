# Dasher – Home Assistant app repository

[![Add repository to my Home Assistant](https://my.home-assistant.io/badges/supervisor_add_addon_repository.svg)](https://my.home-assistant.io/redirect/supervisor_add_addon_repository/?repository_url=https%3A%2F%2Fgithub.com%2FJannicSJensen%2Fha-dasher-addon)

This repository contains the **Dasher** app (add-on) for Home Assistant: a dark, card-based wall-tablet dashboard that is served as a plain web page. The visual style is inspired by [ruudmens/home-assistant-dashboard](https://github.com/ruudmens/home-assistant-dashboard) (MIT).

* Tablets just open `http://<home-assistant>:8099/`; no Home Assistant login, no HACS cards.
* Dashboards are described in one `dashboard.yaml` and hot-reload on save.
* Tiles: area hero with clock, status messages (like waste pick-up reminders) and quick buttons, lights/switches (with brightness slider), electricity price timeline, calendar agenda with weather, vehicle, "now playing", heat pump/AC and button grids.
* **Area pages:** every Home Assistant area as a clickable picture card; each opens a sub-page with its temperature, humidity, windows and a picture tile for every light, player and thermostat (unavailable devices are left out). Devices you do not want can be removed from the overview with the pencil, and restored.
* **Now playing tile and full-screen player:** the tile follows whichever speaker is playing, with controls, volume and progress; when everything is stopped it shows the last track that played (remembered by the app). When music starts, a full-screen player opens with big artwork, seeking, shuffle/repeat and volume.
* **Music page:** swipeable tabs for Discover, Radio, Albums, Artists, Podcasts (with episodes), Party (QR code and live queue of Music Assistant's Party plugin) and Search, a speaker picker with Music Assistant grouping and a now-playing bar. Browsing uses Music Assistant's API with a read-only token in the app options; playback goes through Home Assistant.
* **Car page:** battery and range, start/stop charging, smart charging with its times, a charger restart, and remote climate (start, temperature, window heat); EV Smart Charging, Peblar and FordPass are recognised automatically.
* **Media page:** Plex through Home Assistant's Plex integration: continue watching and recently added movies and series. Plays on Cast devices and Plex clients, and, with a Plex address and token in the app options, on Apple TVs and DLNA players with stream links.
* **To-do lists page (Huskelister):** every to-do list of Home Assistant; add, tick off, edit and delete items, and create, rename and delete Local To-do lists.
* **Meal plan page (Madplan):** a week of dinners planned by Home Assistant's AI Task with your rules (vegetarian days, allergies, cooking time, fixed days), recipes with step timers, ingredients added to a shopping list, dinners written to a calendar, and a *tonight* tile. Inspired by [ha-middagsro](https://github.com/Dinnsen/ha-middagsro), without the REMA 1000 parts.
* **Devices page:** robot vacuums with controls, and washing machines, dryers, dishwashers and clothes heaters (LG ThinQ found automatically, others listed in `dashboard.yaml`); cards you do not want can be removed with the pencil, and restored.
* **Climate page:** a card per room with temperature, setpoint and power, built from your climate helpers.
* **Missing entities:** when `dashboard.yaml` uses entities your Home Assistant does not have, the tablet shows a notice and the app log suggests the likely ones; you choose the replacements in the app configuration (*Entity mapping*), and `dashboard.yaml` stays unchanged.
* **Updates:** an unedited `dashboard.yaml` follows new versions of the example (the old one is saved as `dashboard.yaml.bak`); an edited one is never touched. The current example is always written to `dashboard.example.yaml`.
* Vanilla JavaScript front end, one small Node.js server, no build step.
* Commands from tablets are restricted to the entities in `dashboard.yaml`, the area pages, the climate page, the devices page, the to-do page, the media page and the music page, and to a fixed list of services.

## Screenshots

All screenshots show the built-in fake Home Assistant and Music Assistant (see [Development](#development)), so the names, tracks and posters are made up. Click an image for full size.

| | |
| :---: | :---: |
| [![Front page](docs/screenshots/home.png)](docs/screenshots/home.png) | [![Climate](docs/screenshots/climate.png)](docs/screenshots/climate.png) |
| **Front page**<br>Clock, status messages (waste pick-up and a vacuum that needs water), calendar with weather, now playing, car with the electricity price, and quick buttons. | **Climate**<br>A card per room, built from your climate helpers. |
| [![Areas](docs/screenshots/areas.png)](docs/screenshots/areas.png) | [![An area](docs/screenshots/area.png)](docs/screenshots/area.png) |
| **Areas**<br>Every Home Assistant area as a clickable picture. | **An area**<br>Temperature, humidity and windows over the area's picture; swipe up for the devices. |
| [![An area, devices](docs/screenshots/area-devices.png)](docs/screenshots/area-devices.png) | [![Editing an area](docs/screenshots/area-edit.png)](docs/screenshots/area-edit.png) |
| **An area, devices**<br>A picture tile for every light, player and thermostat; unavailable devices are left out. | **Editing an area**<br>Remove the devices you do not want in the overview, and bring them back. |
| [![Music: Discover](docs/screenshots/music-discover.png)](docs/screenshots/music-discover.png) | [![Music: Radio](docs/screenshots/music-radio.png)](docs/screenshots/music-radio.png) |
| **Music: Discover**<br>Music Assistant's recommendations, with a speaker picker and grouping. | **Music: Radio**<br>One button per radio station. |
| [![Music: Party](docs/screenshots/music-party.png)](docs/screenshots/music-party.png) | [![Full-screen player](docs/screenshots/now-playing.png)](docs/screenshots/now-playing.png) |
| **Music: Party**<br>The guest QR code and live queue of Music Assistant's Party plugin. | **Full-screen player**<br>Opens when music starts: big artwork, seeking, shuffle/repeat and volume. |
| [![Media (Plex)](docs/screenshots/media.png)](docs/screenshots/media.png) | [![To-do lists](docs/screenshots/todo.png)](docs/screenshots/todo.png) |
| **Media (Plex)**<br>Continue watching and recently added movies and series, played on Cast, Plex, Apple TV or DLNA players. | **To-do lists**<br>Every to-do list of Home Assistant (Huskelister). |
| [![A to-do list](docs/screenshots/todo-list.png)](docs/screenshots/todo-list.png) | [![Devices](docs/screenshots/devices.png)](docs/screenshots/devices.png) |
| **A to-do list**<br>Add, tick off, edit and delete items; rename or delete Local To-do lists. | **Devices**<br>Robot vacuums, dishwashers, dryers, clothes heaters and washing machines. |
| [![Editing the devices page](docs/screenshots/devices-edit.png)](docs/screenshots/devices-edit.png) | |
| **Editing the devices page**<br>Remove the cards you do not want, and bring them back. | |
| [![Meal plan](docs/screenshots/meals.png)](docs/screenshots/meals.png) | [![A dinner](docs/screenshots/meals-recipe.png)](docs/screenshots/meals-recipe.png) |
| **Meal plan**<br>A week of dinners planned by AI Task within your rules; each dinner is a calendar event. | **Recipe**<br>Ingredients and steps to tick off, with timers. |
| [![Shopping](docs/screenshots/meals-shopping.png)](docs/screenshots/meals-shopping.png) | [![Rules](docs/screenshots/meals-rules.png)](docs/screenshots/meals-rules.png) |
| **Shopping**<br>The ingredients added up and put on a Home Assistant shopping list. | **Rules**<br>Vegetarian days, allergies, cooking time, fixed days and favourites. |
| [![Car](docs/screenshots/car.png)](docs/screenshots/car.png) | |
| **Car**<br>Charging, smart charging with its times, remote climate and a charger restart. | |

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

`npm run dev` starts all three at once. The screenshots above are made by `dev/screenshots.mjs` (see the top of that file). The first start copies `examples/dashboard.yaml` to `dev/config/`; edit that copy and the page reloads.

Against a real Home Assistant, create a long-lived access token (Profile → Security), keep it in your shell rather than in a file, and set `HA_URL` and `HA_TOKEN`. For the Music Assistant tabs also set `MA_URL` and `MA_TOKEN`. Entities in `dashboard.yaml` that Home Assistant does not know are logged as a warning and shown in a banner on the tablet.

| Variable | Meaning |
| --- | --- |
| `HA_URL`, `HA_TOKEN` | Home Assistant address and long-lived token (inside the app the Supervisor token is used instead). |
| `ENTITY_MAP` | The entity mapping for local runs, as `from=to,from=to` (the app option `entity_map`). |
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
