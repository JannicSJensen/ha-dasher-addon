# Dasher

Dasher serves a touch-friendly dashboard as a plain web page. Point any tablet's browser (or a kiosk app such as Fully Kiosk) at it. Tablets never log in to Home Assistant: the app talks to Home Assistant for them using its own Supervisor token.

* Direct address for tablets: `http://<home-assistant-ip>:8099/`
* In Home Assistant: the **Dasher** entry in the sidebar (ingress).

## Setup

1. Install and start the app. On first start it creates `dashboard.yaml` and an `assets/` folder in the app's configuration folder (`/addon_configs/<id>_dasher/`, reachable with the *Samba* or *File editor* apps; mapped to `/config` inside the container).
2. Edit `dashboard.yaml`, replacing the example entities with your own. Every save is picked up within a couple of seconds, and open tablets update by themselves.
3. Put background pictures, car/lamp images etc. in `assets/` and refer to them by file name. Pictures for the area pages go in `assets/areas/` (see [Areas](#areas)).

If the file has a mistake, the page shows what is wrong instead of failing silently. Tiles with problems are skipped; the rest keeps working.

## App options

| Option | Default | Description |
| --- | --- | --- |
| `log_level` | `info` | `debug`, `info`, `warning` or `error`. |
| `read_only` | `false` | Show states but refuse every command from tablets. |
| `allow_entity_mapping` | `true` | Lets people at a tablet [map missing entities](#missing-entities) to entities of your Home Assistant. Turn off to forbid it. Always off in read-only mode. |
| `music_assistant_url` | empty | Address of your Music Assistant server, e.g. `http://192.168.1.10:8095`. **Leave it empty when Music Assistant runs as a Home Assistant app**: Dasher then finds it through the Supervisor (and keeps looking if Music Assistant starts later). Only needed for the browsing tabs of the [Music page](#music). |
| `music_assistant_token` | empty | A long-lived access token from Music Assistant (*Settings → Profile → Long-lived access tokens*). Needed for the browsing tabs, also when Music Assistant runs as an app. Only used to read the library. |

## Security

The tablet page needs no login. Anyone who can reach port 8099 can use the entities that appear in `dashboard.yaml` **and the entities of the area pages** (lights, fans, covers and media players in your areas by default; set `areas.enabled: false` or narrow `areas.domains` to restrict this), and the Music Assistant players of the music page (play/pause, volume, grouping, and starting radio stations or music from your library), and nothing else: the server rejects any other entity, any service outside a fixed allow-list (lights, switches, fans, covers, scenes, scripts, media players, climate and similar; never locks, alarms or `homeassistant.restart`), and any attempt to retarget a call through `data`. Anyone who can reach the port can also browse your Music Assistant library through the add-on; the access token itself never leaves the add-on, and the add-on only reads with it. Keep the port on your trusted LAN, remove the port mapping under *Network* if you only use the sidebar entry, or enable `read_only`.

## `dashboard.yaml`

The first start creates `dashboard.yaml` from the example. **Your file is never changed by an update**, with one exception: if it is still exactly the unedited example of an older version, it is replaced by the new example (the old copy is saved as `dashboard.yaml.bak`). Every start also writes the current example to `dashboard.example.yaml` next to it, so you can compare and copy new tiles from it.

```yaml
title: Home
language: en          # en | da
locale: en-GB         # optional, number/date formatting
accent: "#2dd4bf"
idle_return: 120      # seconds until a tablet returns to the first page (0 = off)
columns: 4            # defaults for every page
rows: 2
gap: 8
pages:
  - id: home
    title: Home
    icon: home        # any Material Design Icon name
    tiles: [ ... ]
```

Each page is a grid of `columns` x `rows` equally sized cells that fills the screen. A tile is placed with `col`/`row` (starting at 1) and covers `w` x `h` cells (default 1 x 1). Omit `col`/`row` to let tiles flow automatically. With a single page the sidebar is hidden.

Icons: use names from <https://pictogrammers.com/library/mdi/>, with or without the `mdi:` prefix.

Images: a bare file name (`car.png`) is loaded from `assets/`; full `https://` URLs work as well.

### Conditions

Used by `when` (hero backgrounds) and `active_when` (buttons).

```yaml
when: { entity: light.lamp, state: "on" }          # or a list: state: [home, "on"]
when: { entity: sensor.lux, below: 50 }            # above / below for numbers
when: { entity: climate.hp, attribute: hvac_action, state: heating }
when: { entity: sun.sun, state: below_horizon, not: true }
when: [ {...}, {...} ]                             # all must match
when: { any: [ {...}, {...} ] }                    # at least one must match
```

### Actions

`tap` (and `hold` on toggle tiles) accept:

```yaml
tap: toggle                                      # default: toggles / presses / runs the entity
tap: none
tap: { action: navigate, page: garage }
tap: { action: service, service: scene.turn_on, entity: scene.cozy, data: {} }
```

### Tile types

#### `hero`
Large area picture with clock, date and quick buttons.

| Key | Description |
| --- | --- |
| `image` | Default background. |
| `backgrounds` | List of `{ when, image }`; the first match wins, an entry without `when` is the fallback. |
| `buttons` | List of `{ icon, name, entity, tap, active_when }`. A button with `entity` toggles it and is highlighted while it is `on`. |
| `show_clock` | `false` to hide clock and date. |
| `time_format` | `24h` (default) or `12h`. |

#### `toggle`
Light, switch, fan, cover, input_boolean or media player. Tap toggles (a switched-off media player is turned on). Long-press on a dimmable light opens a brightness dialog, long-press on a media player turns it off.

Dimmable lights get a thin vertical **brightness slider** on the right while they are on. Dragging it changes the brightness live; `slider: false` removes it.

| Key | Description |
| --- | --- |
| `entity` | Required. |
| `layout` | `card` (default: icon header with a picture below) or `photo` (full-bleed picture that is dimmed while the device is off, with the status, e.g. "POWERED ON AT 77%", and the name over it). |
| `name`, `area` | Title and, in the `card` layout, the text before the state (`Garage \| Off`). |
| `icon` | Header icon. In the `photo` layout without a picture it is shown large instead. |
| `image_on`, `image_off`, `image` | Pictures shown for each state. Without pictures the `card` layout draws a glowing bulb (using the light's colour). |
| `zoom`, `image_position` | `photo` layout: enlarge the picture (`1.6` = 160 %) and choose which part is shown (`"100% 0%"`), so one room photo can serve several tiles. |
| `slider` | `false` hides the brightness slider. |
| `tap`, `hold` | Override the actions. |

#### `price`
Electricity price with a colour-coded 24 hour timeline.

| Key | Description |
| --- | --- |
| `entity` | Sensor whose attributes list today's prices (Nord Pool and Energi Data Service `raw_today`, or any list of numbers / `{start, value}` objects). |
| `attribute` | Attribute holding the list; detected automatically from `raw_today`, `today`, `prices_today`, `prices`, `data`. |
| `multiplier`, `unit`, `decimals`, `range_decimals` | e.g. `multiplier: 100`, `unit: øre` to show kr as øre. |
| `thresholds` | `{ low, high }` in the sensor's own unit. Default: the cheapest and most expensive third of the day. |
| `name`, `subtitle`, `icon` | Header. |

#### `calendar`
An agenda: the next days that have something planned, like the calendar card in Home Assistant. Each day shows the weekday, date and (optionally) the forecast; each event has a coloured bar for its calendar and its time. Events that are over for today disappear, days without events are skipped, and all-day events read "All day" (or "All day, ends today" for the last day of a longer one). The list scrolls if it is longer than the tile. It refreshes every five minutes.

| Key | Description |
| --- | --- |
| `entities` | Calendars to show, e.g. `[calendar.family, calendar.privat]`. Leave it out to show every calendar Home Assistant has. |
| `colors` | One colour per calendar, in the order of `entities` (e.g. `["#38bdf8", "#fb923c"]`). Otherwise a default palette is used. |
| `weather_entity` | A `weather.*` entity. Its daily forecast gives each day a temperature and icon; left out, no weather is shown. |
| `days` | How many days ahead to look (1-31, default 7). |
| `name`, `icon` | Title (default "Calendar") and icon. |

The tile reads calendars through the add-on, so tablets need no login to see them. List only the calendars you want on show.

#### `vehicle`

| Key | Description |
| --- | --- |
| `entity` | Headline value, usually the range. |
| `name`, `icon`, `image` | Header and picture. |
| `price` | Optional electricity price at the bottom of the tile: today's price, its range and the colour-coded 24 hour timeline. Takes the same keys as the `price` tile below (`entity`, `attribute`, `multiplier`, `unit`, `decimals`, `range_decimals`, `thresholds`). |
| `tap` | Tap action. By default the tile opens the Car page when it is available; use `none` to turn that off (see Actions). |
| `rows` | List of `{ icon, entity, label, label_entity, decimals }`. `label_entity`'s state is shown after the value (e.g. charging status), otherwise `label`. |

#### `media` ("Now playing")
Shows and controls what is playing right now, and when nothing is playing, what played last.

* **Playing now:** artwork, title, artist (and the radio station, if it is one), the speaker's name with moving bars, play/pause, previous/next, a volume slider and a thin progress line. If several speakers play at the same time the speaker button shows how many; tap it to switch between them. Speakers in a sync group count once, as the group leader (shown with `+2` for the members).
* **Paused:** a paused speaker is shown while nothing else is playing.
* **Nothing playing:** the last track that played, dimmed and marked "Last played · 2 hours ago", with its artwork. Play starts it again on a Music Assistant speaker (on other speakers it just presses play).
* Tapping the tile opens the Music page (change with `tap`).

| Key | Description |
| --- | --- |
| `entities` | The speakers to follow: a list of `media_player` entities, or `music` for every Music Assistant speaker of the music page. |
| `entity` | A single speaker, if you prefer (same as a list of one). |
| `name` | Title for the speaker when only one is followed. |
| `volume` | `false` hides the volume slider. |
| `tap` | Override what a tap on the tile does (`none`, `{ action: navigate, page: ... }`, ...). |

The last played track of each speaker is remembered by the add-on in its data folder (`/data`), so it survives restarts and is the same on every tablet. Only the title, artist, album, the item's address and the artwork are stored.

#### `climate`
Heat pump or air conditioner with a vertical target-temperature slider.

| Key | Description |
| --- | --- |
| `entity` | Required (climate). |
| `image` | Background picture. |
| `buttons` | Subset/order of `power`, `fan`, `swing` (default all three). Fan and swing buttons cycle through the modes the device offers and hide themselves if it has none. |
| `icons` | Override button icons, e.g. `{ fan: fan-speed-1 }`. |
| `on_mode` | HVAC mode used by the power button when switching on (default: first of `heat_cool`, `auto`, `heat`, `cool`). |

#### `buttons`
A grid of icon buttons (`buttons`, same format as in `hero`) with an optional `title`.

## Missing entities

When `dashboard.yaml` uses entities that your Home Assistant does not have (for example after copying a dashboard from somewhere else, or after renaming a device), the tablet shows a warning at the bottom with a **Map entities** button, and a **Map entities** entry appears in the sidebar.

* The screen lists every missing entity, the tiles that use it, and a **Choose** button. It offers the entities of your Home Assistant that look most alike (same kind, matching words in the name and in the tile's title) and a search box that also looks at names and areas. Tap one and the dashboard uses it from then on.
* **Show all** also lists the entities that were found, so you can point any entity somewhere else. **Remove mapping** undoes a choice.
* An entity can only be mapped to an entity of the **same kind** (a light to a light, a sensor to a sensor) that Home Assistant knows.
* The choices are saved in `entity-map.yaml` next to `dashboard.yaml`; `dashboard.yaml` itself is not changed, so you can keep sharing it. The file is plain YAML (`light.kitchen_lamp: light.my_real_lamp`) and can be edited by hand. A mapped entity counts as part of the dashboard, so tablets can use it like any other.
* A mapping can only point to an entity of the same kind, but it can point to any entity of that kind: anyone who can reach the tablet page can change it. Turn off the app option `allow_entity_mapping` to prevent that.

## Car

A **Car** entry (icon of an electric car; title and icon can be changed) appears in the sidebar when there is something to control. The page is deliberately small:

* **The car:** name, a picture (`image`, otherwise a symbol), the battery level with the charging target as a marker, the range, and whether the car is plugged in and charging.
* **Charging:** one big button, **Start charging** or **Stop charging** depending on the state.
* **Smart charging:** an on/off switch, what the smart charging is doing (e.g. "No charging planned", "Waiting for charging to begin") with the planned window, and two times you set here: **Earliest start** and **Ready by**. Tap one and pick the hour, then the minute, or **Off**.
* **Charger:** **Restart charger**, with a confirmation first.
* Cards whose entities do not exist are left out.

### Entities

The page recognises **EV Smart Charging** (HACS) and **Peblar** entities on its own, by integration and entity type, so nothing needs to be set for them: the smart charging switch, status and schedule sensor, the start/completion time selects, the manual start and stop buttons, the charger's charge switch and its restart button. Everything can be set or overridden in an `ev:` section of `dashboard.yaml`:

```yaml
ev:
  enabled: auto               # auto (default): only when something can be controlled; true; false
  title: Bil                  # menu title
  icon: car-electric
  name: Direktøren            # heading of the car card
  image: car.jpg              # picture in the assets folder
  battery_entity: sensor.my_car_battery          # default: the level EV Smart Charging reports
  range_entity: sensor.my_car_range
  plug_entity: sensor.my_car_plug_status         # on/off or connected/disconnected
  charging_entity: sensor.my_car_charging        # default: EV Smart Charging's charging sensor
  charge_switch_entity: switch.charger_charge    # used for start/stop when there are no dedicated entities
  start_entity: button.start_now                 # also: automation.x, script.x, switch.x, input_button.x
  stop_entity: button.stop_now
  smart_switch_entity: switch.ev_smart_charging_smart_charging_activated
  smart_status_entity: sensor.ev_smart_charging_status
  smart_info_entity: sensor.ev_smart_charging_charging
  start_time_entity: select.ev_smart_charging_charge_start_time
  ready_time_entity: select.ev_smart_charging_charge_completion_time
  restart_entity: button.charger_restart
```

* **Start/stop** uses `start_entity` / `stop_entity` (EV Smart Charging's manual buttons by default), else the charger's `charge_switch_entity`. An `automation` is triggered, a `button` or `script` is pressed, a `switch` is turned on or off.
* A time select must have options like `08:00` (plus an "off" option such as `None`), as the EV Smart Charging ones do.
* Entities you list here take part in [entity mapping](#missing-entities), so a wrong id can be fixed from the tablet. The discovered entities become part of the dashboard, so tablets can control them.

## Areas

Every area in Home Assistant (Settings → Areas) gets a picture card on an **Areas** page, reachable from the extra entry at the bottom of the sidebar. A card shows the area name, its floor (or how many lights are on) and opens a sub-page with:

* a large picture with the area name and its **temperature**, **humidity** and **windows** (shown only when the area has such sensors),
* below it, a `photo` tile for every light, fan, cover and media player in the area. Lights have the brightness slider. Light group members are hidden behind their group, and unavailable devices are listed last.

Which entities appear follows Home Assistant: an entity belongs to the area it is assigned to, or to the area of its device. Hidden, disabled, configuration and diagnostic entities are skipped. Temperature, humidity and window sensors are recognised by their device class (window, door, garage door or opening for the latter; "on" means open). Several sensors are combined with the median, so one odd sensor does not skew the figure. An area's own temperature/humidity sensor (set in Home Assistant) is used if it has one.

### Pictures

Put pictures in the `assets/areas/` folder of the app's configuration folder and name them after the area id (`living_room.jpg`) or area name (`living-room.jpg`). `jpg`, `jpeg`, `png`, `webp`, `avif`, `gif` and `svg` work. New files are picked up within a few seconds. Without a file, the picture uploaded to the area in Home Assistant is used, and otherwise a symbol.

Tiles inside an area use the area picture, cropped differently for each device. To give a device its own picture, save it as `assets/entities/<entity_id>.jpg` (e.g. `assets/entities/light.floor_lamp.jpg`).

### Options

```yaml
areas:
  enabled: true             # false removes the menu entry and the area pages
  title: Areas              # label of the menu entry
  icon: floor-plan
  hide: [home, "Fridge"]    # area ids or names to leave out
  domains: [light, fan, cover, media_player]   # also allowed: switch, input_boolean
  overrides:
    living_room:
      name: Lounge
      icon: mdi:sofa
      image: lounge.jpg                       # file in assets/ (or assets/areas/ by bare name)
      temperature_entity: sensor.lounge_temp  # replaces the detected sensors
      humidity_entity: sensor.lounge_humidity
      window_entities: [binary_sensor.lounge_window]
      hide: false
```

Areas without any matching entity are not listed. If the app cannot read the area registry (for example when started outside Home Assistant with a restricted token) the Areas page stays empty and a warning is logged.

## Music

If the Music Assistant integration is set up in Home Assistant, a **Music** entry appears in the sidebar (the title and icon can be changed). The page has these parts:

* **Speakers** at the top: one button for every Music Assistant player. Pick the one to listen on; the choice is remembered on that tablet. Speakers that are playing show moving bars, unavailable ones are hidden.
* **Tabs** below: **Discover**, **Radio**, **Albums**, **Artists**, **Podcasts** and **Search**. Tap a tab or swipe the content sideways to move between them (swipes inside a scrolling row of covers scroll the row instead).
* **Now playing** at the bottom: artwork, title and speaker, a play/pause button and a volume slider for the chosen speaker. Whatever you start shows up here at once.

### Radio

One button with the logo for every radio station in your Music Assistant library (Library → Radio). Tap one to play it on the chosen speaker, replacing its queue. The playing station is outlined in the accent colour. The Radio tab works through Home Assistant alone, without a Music Assistant token.

### Discover, Albums, Artists, Podcasts and Search

These tabs read your library through Music Assistant's own API (Home Assistant's integration cannot list podcast episodes or Discover recommendations), so they need [app options](#app-options): `music_assistant_token`, and `music_assistant_url` unless Music Assistant runs as a Home Assistant app (then Dasher finds the address itself; the log says "Music Assistant found as app ... at ..."). Without them only the Radio tab is shown, with a note about what is missing. To create the token open Music Assistant → *Settings → Profile → Long-lived access tokens → Create token*, and paste it into the app options. The add-on uses it only to read; playback always goes through Home Assistant.

* **Discover** shows the recommendation rows of Music Assistant (recently played, random albums, continue listening, ...), each a row of covers you can scroll sideways.
* **Albums**, **Artists**, **Podcasts** (and **Playlists**, off by default) are grids of covers. Sort by A–Z, newest or random, show only favourites, or type in the filter box. More covers load as you scroll.
* **Search** searches the library and the connected music services for artists, albums, tracks, playlists and podcasts. The last search is remembered when you switch tabs.
* Tap a cover to open it: an album or playlist lists its tracks, an artist its albums and tracks, a podcast its episodes (with played and resume information). The round play button on a cover plays it straight away.
* In an opened album, playlist or podcast, tapping a track or episode plays the whole thing starting there. The **+** at the end of a row, and **Add to queue** in the header, add to the end of the speaker's queue instead of replacing it.

### Playing on several speakers

Music Assistant can play on several speakers in sync. Press **Group** at the top right of the music page (the button is greyed out when the chosen speaker cannot lead a group). In group mode the speaker buttons turn into check boxes: tap a speaker to add it to the chosen speaker's group, tap it again to remove it. **Ungroup all** dissolves the group. Press **Group** again to leave group mode.

* The chosen speaker leads the group. Stations, music and play/pause always go to the group leader, so you can pick any member to control the whole group. The bar shows e.g. "on Kitchen +2".
* Grouped speakers are marked with a link symbol and a count appears on the **Group** button. Groups made elsewhere (Music Assistant, Home Assistant) show up too.
* The volume slider always belongs to the speaker you chose, so each speaker keeps its own volume.
* Which speakers can be combined is up to Music Assistant: speakers of different kinds (for example AirPlay and Chromecast) cannot join the same sync group and the error is shown on screen. Music Assistant's own group players (such as "Party") are ordinary speakers on this page and cannot be put into a sync group.

### Options

```yaml
music:                          # `radio:` still works as an alias
  enabled: true                 # false removes the menu entry
  title: Music
  icon: music
  tabs: [discover, radio, albums, artists, podcasts, search]   # order and choice; also: playlists
  players: [media_player.kitchen, media_player.living_room]   # default: every Music Assistant player
  exclude: [media_player.tv_airplay]
  default_player: media_player.living_room    # used until a speaker has been chosen on the tablet
  config_entry_id: 01J...       # only if the integration cannot be found automatically
```

Radio stations are read through Home Assistant (`music_assistant.get_library`) and everything is played with `music_assistant.play_media`. The station list is refreshed every 10 minutes and when the add-on starts. Covers and logos are fetched by the add-on from Music Assistant (and, for streaming services, from their image servers), so the add-on must be able to reach those.

A station is recognised as "playing" from the player's `media_content_id` (the station URI), or from the station name in the title fields. If a list stays empty or a tab shows an error, the page and the add-on log show the reason (for example a wrong address, a refused token, or Home Assistant refusing the registry or integration list).

## Tablet tips

* Add the page to the home screen for a full-screen view, or use a kiosk browser.
* Layouts are fluid. Design for your tablet's aspect ratio by choosing `columns` and `rows` (a 16:9 tablet suits 4 x 2).
* Portrait tablets automatically get the page navigation at the bottom.
* Area pages scroll: swipe up (or tap the arrow) from the picture to the devices.
* On the music page, swipe sideways to change tab.
