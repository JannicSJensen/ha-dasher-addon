# Changelog

## 0.27.0

- **New look for the Climate page.** A big average temperature at the top with chips for what is on and heating, and a ring dial per room: the colour arc shows the setpoint (cool blue to warm orange), a small mark shows the measured temperature, and the room glows while it heats or cools. Drag the ring to set the temperature, or use the − and + buttons; the power button sits in the corner of the card.

## 0.26.0

- **Built-in room pictures for the areas.** Areas without a picture of their own now get a dark illustration of a living room, kitchen, dining room, bedroom, kids' room, bathroom, office, hallway, garage, garden, laundry room or storage room, chosen from the area's name (Danish or English). Your own pictures in `assets/areas/` and pictures uploaded in Home Assistant still come first. `areas: overrides: <area>: { room: kitchen }` picks another one and `areas: default_images: false` switches them off.

## 0.25.0

- **Mealie cookbook.** When Mealie and Home Assistant's Mealie integration are set up, the meal plan gets a **Cookbook** tab: search your Mealie recipes, plan one on a day (ingredients and steps are copied, scaled to your household) and import a recipe from a web page into Mealie. *New plan* can prefer your own Mealie recipes, which then need no AI call for the recipe. Nothing to configure; `meals: mealie:` can turn it off or pick the Mealie entry.
- **The family calendar is the default calendar for the dinners** (`calendar.family`, when it exists) unless `calendar_entity` says otherwise.

## 0.24.0

- **Meal plan (Madplan).** A new page that plans the week's dinners with Home Assistant's **AI Task**, following your rules (vegetarian days, left-overs, allergies, things to avoid, cooking time, fixed days, favourites). Recipes with ingredients and steps, tick-off lists and step timers; the ingredients of a period are added up and put on a Home Assistant **shopping list**; each dinner is written to a **calendar**. Plans are checked and the AI is asked again when it breaks a rule. Edit, rate and swap dishes by hand. A `dinner` tile shows tonight's dinner on the front page. Configure it in the new `meals:` section of `dashboard.yaml`; the app option `allow_meal_editing` controls whether tablets may change the plan.
- Based on the features of [ha-middagsro](https://github.com/Dinnsen/ha-middagsro), leaving out everything that needs the REMA 1000 app or offers (products, prices, sending the list, offers).

## 0.23.0

- **Edit the Devices page.** A pencil next to the title lets you remove vacuum and appliance cards you do not want and bring them back; saved in the app and shared by all tablets. It is governed by the same app option as the area pages, `allow_area_editing`.

## 0.22.0

- **Thermostats on the area pages.** `climate` entities of an area now get a picture tile with the status and temperature, a tap to switch on/off and **+** / **−** for the setpoint. Members of a thermostat group are hidden behind the group, like light groups. `climate` is part of the default `areas: domains`.
- **Edit the devices of an area.** A pencil on the area page lets you remove devices you do not want in the overview and bring them back; the choice is saved in the app (`hidden-devices.json`) and shared by all tablets. New app option `allow_area_editing` (default on) can forbid it.
- **Unavailable devices are no longer shown** on the area pages (they used to be listed last).

## 0.21.0

- **Entity mapping moved to the app configuration.** The *Map entities* screen and its sidebar entry are gone from the tablet; use the new app option **Entity mapping** (*Settings, Apps, Dasher, Configuration*): a list of rows with the entity id from `dashboard.yaml` and the entity of your Home Assistant to use instead. Restart the app after changing it.
- The tablet notice for unknown entities now just names them and points to the app configuration; the app log lists each one with where it is used and the closest matches in Home Assistant.
- Mappings made on the tablet earlier (`entity-map.yaml`) are still read and the log tells you which rows to copy to the option.
- Removed: the app option `allow_entity_mapping` (nothing can be mapped from a tablet any more) and the screen's suggestions for newer features (see the example `dashboard.example.yaml` and the documentation instead).

## 0.20.1

- Devices page: the appliance cards are a little wider so the *Delayed end* buttons no longer overflow.
- Documentation: screenshots of every page in the repository README and the app's documentation (`docs/screenshots`), made by `dev/screenshots.mjs` from the built-in fake servers.

## 0.20.0

- New **To-do lists** page (call it *Huskelister* with `todo: title:`): every to-do list of Home Assistant as a card with its open items. Open a list to add, tick off, edit (text, description, due date where supported) and delete items, and clear completed ones. Lists of the Local To-do integration can be created, renamed and deleted; the new app option `allow_todo_management` (default on) can forbid changing lists.

## 0.19.0

- A robot vacuum that needs its water changed now shows a **Change the water** status message on the front page: *Refill the clean water tank* and/or *Empty the dirty water tank*, with the vacuum's name. It appears automatically on a hero tile with `messages:` (`vacuum_water: false` turns it off) and is also shown on the vacuum's card on the Devices page. Doubled Dreame names such as "Robbie Robbie" are shown once.

## 0.18.1

- The picture and title in the Music page's now-playing bar open the full-screen player (marked with a small expand symbol), so it can be brought back after it was closed. It shows the speaker chosen in the bar.

## 0.18.0

- **Status messages** on the front page: the hero tile takes `messages:`, cards that only show while they apply. Waste pick-up sensors (RenoWeb and others with a `next_pickup_date`) show "Empty the trash can" today and tomorrow (`within_days` changes that); any entity can also show a message while a condition holds. The example front page has three pick-up messages.

## 0.17.1

- The example front page has **Good night** and **Vacation** buttons (input booleans that toggle and light up while on) instead of the *Cozy* and *Movie* scenes.

## 0.17.0

- New **Devices** page: robot vacuums (start/pause, dock, find, fan speed, battery), washing machines, dryers, dishwashers and clothes heaters (status, time left, power, remote start/stop, delayed end). Vacuums and LG ThinQ appliances are found automatically; others are listed under `devices:`.
- The device registry names are now read from Home Assistant (needed to name the appliances).

## 0.16.0

- New **Party** tab on the Music page for Music Assistant's Party plugin: the guest QR code (with the party name and text) and the live queue of the party player, with songs requested or boosted by guests marked. It appears with the other library tabs (add `party` to `tabs:` if you list them yourself) and says so if the plugin is not enabled.

## 0.15.0

- New **full-screen player**: it opens when a Music Assistant speaker starts playing, with big artwork, title, album/station and artist, a seekable progress bar, shuffle/previous/play-pause/next/repeat, volume and the speaker name. Close it with the arrow (it stays closed until the music has stopped and started again); the *now playing* tile opens it too. `fullscreen: false` under `music:` turns the automatic opening off.

## 0.14.0

- Car page: a **Remote climate** card with a start/stop switch, the temperature (−/+) and the front and rear window heat. The FordPass entities (`ignition`, `rcctemperature`, `rccdefrostfront`, `rccdefrostrear`) are found automatically; `remote_start_entity`, `remote_temp_entity`, `defrost_front_entity` and `defrost_rear_entity` in `ev:` set others.

## 0.13.0

- The Media page can play on **Apple TVs and DLNA players** with stream links. New app options **Plex address** and **Plex token** (optional); with them Apple TVs join the *Play on* list, and DLNA players and others can be added with `players:`. Direct links for compatible files, Plex HLS transcodes otherwise and when resuming; `plex: transcode: auto | always | never`. Plex is not told about the progress when played this way.
- Browsing the Plex rows now works through any Plex or Cast entity, also ones that are not in the *Play on* list.

## 0.12.0

- New **Media** page for Plex, through Home Assistant's Plex integration: continue watching, recently added movies and recently added series, with posters; items play on a Google Cast device or a Plex client chosen at the top, shows open as seasons and episodes, and continued items offer *Resume* or *Start over*. Configure with `plex:` in `dashboard.yaml`.

## 0.11.1

- The Car page and the Areas overview now have a page title like the other pages. On the Car page the card only shows a name when `name:` is set in `ev:`.
- Car page: the car card is as tall as the column next to it.

## 0.11.0

- New **Climate** page: an overview of the heating with a card per room (temperature, heating state, setpoint with −/+ and a power button). It lists your climate helpers by default instead of every thermostat; `climate:` in `dashboard.yaml` chooses `source`, `entities` or `exclude`.
- The example dashboard no longer has the *Garage* page (it only held demo entities); an unedited `dashboard.yaml` is updated automatically, edited ones are left alone.

## 0.10.3

- Car page: "plugged in" no longer sticks to *on*. When a FordPass car is present, its plug sensor is used (and its battery level and range), instead of EV Smart Charging's *EV connected* switch, which can say "on" while the car is unplugged. Set `plug_entity` in the `ev:` section to use another entity.

## 0.10.2

- The *Map entities* screen now also lists features your `dashboard.yaml` does not use yet (the `calendar` tile and the electricity price in the car tile). Pick the entities there and copy the ready-made YAML into `dashboard.yaml`.

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
