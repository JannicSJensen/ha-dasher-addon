# Changelog

## 0.10.1

- An unedited `dashboard.yaml` from an older version is now replaced by the new example when the app starts (a backup is saved as `dashboard.yaml.bak`), so new tiles appear without editing anything. Edited files are never touched.
- The current example is written to `dashboard.example.yaml` in the configuration folder on every start, to compare or copy from.

## 0.10.0

- New **`calendar`** tile: an agenda of the next days with events from your Home Assistant calendars, coloured per calendar, with the daily forecast for each day. It replaces the electricity price tile on the example front page (the `price` tile is still available).
- The `vehicle` tile can show the electricity price and its 24 hour timeline (new `price:` option), so the car and the price share one tile.
- Tapping the `vehicle` tile opens the Car page (configurable with `tap`).

## 0.9.0

- New **Car** page: battery level with target, range, plugged-in and charging state; one button to start or stop charging; the smart charging switch with its status, planned window and the times it should charge (earliest start, ready by); and a charger restart with confirmation.
- EV Smart Charging and Peblar entities are recognised automatically; the rest is set in a new `ev:` section of `dashboard.yaml`, whose entities also take part in entity mapping. The menu entry only appears when something can be controlled.

## 0.8.0

- **Map missing entities from the tablet.** When `dashboard.yaml` uses entities that Home Assistant does not have, a warning with a *Map entities* button and a sidebar entry open a screen with suggestions and a search for each missing entity. The choices are saved in `entity-map.yaml`; `dashboard.yaml` stays unchanged.
- New app option `allow_entity_mapping` (default on) to forbid mapping from the tablets.
- The warning banner moved to the bottom of the screen so it no longer covers tile titles.

## 0.7.0

- The Music Assistant address is found automatically when Music Assistant runs as a Home Assistant app (new `hassio_api` permission, read-only use). `music_assistant_url` is only needed otherwise; the access token is still required for the browsing tabs.
- The music page says exactly what is missing (address, token or both) instead of a general hint.

## 0.6.0

- The `media` tile is now a "Now playing" tile: it follows whichever speaker plays (`entities: music` or a list), controls it (play/pause, previous/next, volume, progress), lets you switch between speakers that play at the same time, and shows the last played track, with artwork, when nothing is playing.
- The add-on remembers the last track per speaker in its data folder, so it survives restarts and is shared by all tablets.

## 0.5.0

- The Radio page is now a **Music** page with swipeable tabs: Discover, Radio, Albums, Artists, Podcasts (with episodes) and Search; Playlists can be added. Open a cover to see tracks, albums or episodes; tap a track or episode to play from there, or add to the queue.
- Browsing uses Music Assistant's own API. New add-on options `music_assistant_url` and `music_assistant_token` (read-only use); without them the page shows the Radio tab only, as before.
- The `radio:` section of `dashboard.yaml` is now `music:` (`radio:` keeps working); new `tabs` option.
- Speakers, groups and the now-playing bar are shared by all tabs.

## 0.4.0

- Radio page: play on several speakers. A **Group** mode turns the speaker buttons into check boxes that add or remove speakers from the chosen speaker's Music Assistant sync group, with **Ungroup all**. Stations and play/pause control the whole group through its leader; groups made elsewhere are shown too.

## 0.3.0

- Radio page: every radio station in Music Assistant as a button with its logo, a speaker picker for the Music Assistant players, and a now-playing bar with play/pause and volume. Uses Home Assistant's `music_assistant` actions, no extra credentials.
- New `radio:` section in `dashboard.yaml`.
- Area and radio data are only pushed to tablets when they change.

## 0.2.0

- Area pages: a menu entry lists every Home Assistant area as a picture card; each opens a sub-page with temperature, humidity, windows and a tile for every light, fan, cover and media player.
- Light tiles have a vertical brightness slider (live while dragging). New `photo` layout for toggle tiles, also usable for media players, fans and covers.
- Area pictures and per-device pictures from the `assets/areas/` and `assets/entities/` folders; options under `areas:` in `dashboard.yaml`.
- Warns about entities in `dashboard.yaml` that Home Assistant does not know.

## 0.1.0

- First release: tablet web page served by the app, tiles for hero/clock, lights and switches, electricity price, vehicle, media player, climate and button rows.
