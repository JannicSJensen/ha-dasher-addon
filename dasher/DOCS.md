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
| `entity_map` | empty | [Entity mapping](#missing-entities): a list of rows, each with the entity id as written in `dashboard.yaml` (*From*) and the entity of your Home Assistant to use instead (*To*). |
| `music_assistant_url` | empty | Address of your Music Assistant server, e.g. `http://192.168.1.10:8095`. **Leave it empty when Music Assistant runs as a Home Assistant app**: Dasher then finds it through the Supervisor (and keeps looking if Music Assistant starts later). Only needed for the browsing tabs of the [Music page](#music). |
| `music_assistant_token` | empty | A long-lived access token from Music Assistant (*Settings → Profile → Long-lived access tokens*). Needed for the browsing tabs, also when Music Assistant runs as an app. Only used to read the library. |
| `plex_url` | empty | Address of your Plex server **as your players reach it**, e.g. `http://192.168.1.10:32400`. Only needed to play Plex on Apple TVs and DLNA players with [stream links](#stream-links-apple-tv-dlna); the [Media page](#media) itself uses Home Assistant's Plex integration. |
| `plex_token` | empty | Your Plex `X-Plex-Token`. Used to read file information and put into the stream link sent to the player (so it is visible in Home Assistant's player attributes). |

| `allow_todo_management` | `true` | Lets people at a tablet create, rename and delete lists of the Local To-do integration on the [To-do page](#to-do-lists). Editing the items of a list is always possible. Turn off to forbid changing lists. Always off in read-only mode. |

| `allow_area_editing` | `true` | Lets people at a tablet remove devices from the [area pages](#areas) and cards from the [Devices page](#devices), and bring them back. Turn off to forbid it. Always off in read-only mode. |

Changes to the options take effect when the app is restarted.

## Security

The tablet page needs no login. Anyone who can reach port 8099 can use the entities that appear in `dashboard.yaml` **and the entities of the area pages, the climate page, the devices page and the to-do page** (lights, fans, covers and media players in your areas by default; set `areas.enabled: false` or narrow `areas.domains` to restrict this), the Music Assistant players of the music page (play/pause, volume, grouping, and starting radio stations or music from your library) and the players of the media page (starting Plex items on them), and nothing else: the server rejects any other entity, any service outside a fixed allow-list (lights, switches, fans, covers, scenes, scripts, media players, climate and similar; never locks, alarms or `homeassistant.restart`), and any attempt to retarget a call through `data`.

Anyone who can reach the port can also browse your Music Assistant library and the Plex home screen (titles and posters) through the add-on. The Music Assistant and Plex tokens never leave the add-on, with one exception: the Plex stream link sent to an Apple TV or DLNA player contains the Plex token (see [Stream links](#stream-links-apple-tv-dlna)). Keep the port on your trusted LAN, remove the port mapping under *Network* if you only use the sidebar entry, or enable `read_only`.

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

![Front page](https://raw.githubusercontent.com/JannicSJensen/ha-dasher-addon/main/docs/screenshots/home.png)
Large area picture with clock, date and quick buttons.

| Key | Description |
| --- | --- |
| `image` | Default background. |
| `backgrounds` | List of `{ when, image }`; the first match wins, an entry without `when` is the fallback. |
| `buttons` | List of `{ icon, name, entity, tap, active_when }`. A button with `entity` toggles it and is highlighted while it is `on`. |
| `messages` | [Status messages](#status-messages) shown under the clock while they apply. |
| `show_clock` | `false` to hide clock and date. |
| `time_format` | `24h` (default) or `12h`. |

##### Status messages
Short reminders on the front page that only appear while they apply, as cards between the clock and the buttons:

```yaml
- type: hero
  messages:
    - { entity: sensor.renoweb_240_l_rest_mad_spand }                 # waste pick-up
    - { entity: sensor.renoweb_pap, within_days: 2, title: Put out the paper }
    - { entity: binary_sensor.garage_door, text: The garage door is open, icon: garage-open }
```

* **Pick-up reminders:** an entity with a `next_pickup_date` attribute (the RenoWeb sensors, and others) shows *Empty the trash can* with the bin's name, the date and *Today* or *Tomorrow*. It appears when the pick-up is **today or within `within_days` days** (default `1`, so the evening before and the day itself; `0` means only on the day). The icon and colour follow the sensor's `icon` and `icon_color`. Other options: `name`, `title`, `icon`, `color`, `kind: pickup` for a sensor without the date attribute (it then counts the sensor's own number of days).
* **State messages:** any other entity shows `text` (default: its name) while `when` holds, e.g. `when: { entity: sensor.temp, above: 30 }`; without `when` while it is `on`. Options: `text`, `detail`, `icon`, `color`, `urgent: true`.
* **Vacuum water:** when a robot vacuum needs its water changed, a **Change the water** card with the vacuum's name appears: *Refill the clean water tank* when the clean tank is low or empty, *Empty the dirty water tank* when the dirty tank is full (both when both apply). It is read from the vacuum's own attributes (tank status, low-water flag, error and faults, as the Dreame integration reports them), for every vacuum of the [Devices page](#devices), and it is added **automatically to every hero tile that has a `messages:` list**. Turn it off with `vacuum_water: false` on the tile, or choose the vacuum and wording yourself with `- { kind: vacuum, entity: vacuum.robbie, title: Water for Robbie, color: "#38bdf8" }`. The Devices page shows the same hint on the vacuum's card.
* Pick-ups are re-checked every minute, so a message appears at midnight without a reload. The entities take part in entity mapping and are read-only (nothing is controlled).

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
* Tapping the tile opens the [full-screen player](#full-screen-player) while something plays or is paused, otherwise the Music page (change with `tap`).

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

When `dashboard.yaml` uses entities that your Home Assistant does not have (for example after copying a dashboard from somewhere else, or after renaming a device), the tablet shows a notice at the bottom with the names, and the app log lists each one with the tile that uses it and the entities that look most alike. You fix it in the **app configuration**, not on the tablet:

1. Open *Settings → Apps → Dasher → Configuration* and find **Entity mapping**.
2. Add a row for each entity: **Dashboard entity** (the id as written in `dashboard.yaml`, e.g. `sensor.car_range`) and **Home Assistant entity** (the one to use instead, e.g. `sensor.fordpass_elveh`).
3. Save and **restart the app**.

```yaml
entity_map:
  - from: sensor.car_range
    to: sensor.fordpass_wf0spcef3sry27604_elveh
  - from: input_boolean.good_night
    to: input_boolean.godnat
```

* Both entities must be of the **same kind** (a light for a light, a sensor for a sensor); rows that are not are reported in the log and skipped. Only entities used by the dashboard can be reached: a mapped entity counts as part of the dashboard.
* `dashboard.yaml` itself is not changed, so you can keep sharing it. The mapping also applies to the entities of the `ev:`, `climate:`, `devices:`, `todo:` and `plex:` sections.
* The log suggestion looks like: `sensor.my_car_range is not known to Home Assistant (used in: Home: Car). Maybe use: sensor.car_range (Volvo). Set it in the app option "Entity mapping".` It is repeated only when the set of missing entities changes.
* Mapping can no longer be done on the tablet, so nobody at a tablet can redirect entities.
* **Upgrading from an older version:** mappings made on the tablet were saved in `entity-map.yaml` next to `dashboard.yaml`. That file is still read (the app option wins when both name the same entity) and the log lists what is left in it. Copy those rows to the app option and delete the file.

## Car

![Car page](https://raw.githubusercontent.com/JannicSJensen/ha-dasher-addon/main/docs/screenshots/car.png)

A **Car** entry (icon of an electric car; title and icon can be changed) appears in the sidebar when there is something to control. The page is deliberately small:

* **The car:** name, a picture (`image`, otherwise a symbol), the battery level with the charging target as a marker, the range, and whether the car is plugged in and charging.
* **Charging:** one big button, **Start charging** or **Stop charging** depending on the state.
* **Smart charging:** an on/off switch, what the smart charging is doing (e.g. "No charging planned", "Waiting for charging to begin") with the planned window, and two times you set here: **Earliest start** and **Ready by**. Tap one and pick the hour, then the minute, or **Off**.
* **Remote climate:** a switch to start or stop the car's heating/cooling, a temperature with −/+, and buttons for the front and rear window heat. Shown when the car integration offers them.
* **Charger:** **Restart charger**, with a confirmation first.
* Cards whose entities do not exist are left out.

### Entities

The page recognises **EV Smart Charging** (HACS), **Peblar** and **FordPass** entities on its own, by integration and entity type, so nothing needs to be set for them: the smart charging switch, status and schedule sensor, the start/completion time selects, the manual start and stop buttons, the charger's charge switch and its restart button; from FordPass the battery level, range and the plug state (the car's own report is used for "plugged in" in preference to EV Smart Charging's *EV connected* switch, which only reflects its own input). Everything can be set or overridden in an `ev:` section of `dashboard.yaml`:

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
  remote_start_entity: switch.my_car_remote_start        # default: FordPass "ignition" switch
  remote_temp_entity: number.my_car_climate_temperature  # default: FordPass "rcctemperature"
  defrost_front_entity: switch.my_car_front_defrost
  defrost_rear_entity: switch.my_car_rear_defrost
```

* **Start/stop** uses `start_entity` / `stop_entity` (EV Smart Charging's manual buttons by default), else the charger's `charge_switch_entity`. An `automation` is triggered, a `button` or `script` is pressed, a `switch` is turned on or off.
* A time select must have options like `08:00` (plus an "off" option such as `None`), as the EV Smart Charging ones do.
* Entities you list here take part in [entity mapping](#missing-entities), so a wrong id can be fixed from the tablet. The discovered entities become part of the dashboard, so tablets can control them.

## Climate

![Climate page](https://raw.githubusercontent.com/JannicSJensen/ha-dasher-addon/main/docs/screenshots/climate.png)

A **Climate** entry in the menu gives an overview of the heating: one card per room with the temperature, whether it is heating, the setpoint with **−** / **+** buttons and a power button. A summary at the top shows how many are on and the average temperature.

By default it lists your **climate helpers** (Settings > Devices & services > Helpers: climate groups and generic thermostats), not every thermostat of every device, so rooms are not listed several times. Configure it in a `climate:` section of `dashboard.yaml`:

```yaml
climate:
  # enabled: false        # remove the menu entry
  # source: helpers       # helpers (default) | all (every climate entity)
  # entities: [climate.stue, climate.kontor]   # or choose exactly which ones
  # exclude: [climate.bryggers]
  # platforms: [better_thermostat]             # more integrations to count as helpers
  # title: Klima
  # icon: home-thermometer-outline
```

* Without a `climate:` section the page appears on its own when climate helpers exist.
* `entities` wins over `source`, and its entities take part in entity mapping.
* A change of the setpoint is sent half a second after the last tap. Cards of entities that are unavailable are dimmed.

## Media

![Media page](https://raw.githubusercontent.com/JannicSJensen/ha-dasher-addon/main/docs/screenshots/media.png)

A **Media** entry in the menu shows what Plex offers on its home screen and plays it on your player:

* **Continue watching**, **Recently added movies** and **Recently added series**, as rows of posters (episodes as wide pictures).
* Tap an item: **Play** (or **Resume** and **Start over** for something you have begun). Shows open as seasons and episodes, each with its own **Play**.
* **Play on** at the top (and in every item) chooses the player. The choice is remembered on that tablet; players that are off are dimmed.

It uses the **Plex integration** of Home Assistant, so no Plex address or token is needed here: the lists come from the integration's media browser (the hubs of the *Recommended* folder, for the Plex account the integration is signed in with), and playing is `media_player.play_media` with the Plex item. That works on the players the Plex integration supports: **Google Cast** devices (Chromecast, Google TV) and **Plex clients**. Other players, such as an Apple TV or a DLNA TV, cannot be told to play a Plex item this way; for them see *Stream links* below.

### Stream links (Apple TV, DLNA)

Set **Plex address** (`plex_url`) and **Plex token** (`plex_token`) in the app options and Dasher can play on players that only take a link. For such a player the app asks the Plex server for the file and calls `media_player.play_media` with a stream link:

* **Apple TV** (AirPlay): a direct link when the file is MP4/MOV with H.264 video and AAC/AC3/EAC3/MP3 audio, otherwise a Plex **HLS transcode** (Plex converts to H.264/AAC on the fly).
* **DLNA** (`dlna_dmr`): the file itself, whatever it is; set `transcode: always` under `plex:` if your TV cannot play it (it then gets HLS, which many DLNA TVs do not support).
* **Resume:** continuing something you have begun starts a transcode at the saved position (`Start over` plays from the beginning).
* **Shows and seasons** play the first unfinished episode.
* Apple TVs are added to the *Play on* list by default once the address and token are set. DLNA renderers and other players are only added through `players:`. Players of other kinds than Plex, Cast, Apple TV and DLNA may not accept a link.
* The address must be the one the **players** can reach (for example `http://192.168.1.10:32400`), not a name only Home Assistant knows.
* **The link contains your Plex token**, so it shows in the player's attributes in Home Assistant (history, logbook). The token is never sent to the tablets.
* Playing this way does **not report progress to Plex**, so *Continue watching* does not advance and the item is not marked watched. Subtitles are not switched on.
* Browsing (the rows) still needs the Plex integration and one Plex or Cast entity that is online.

To find the token: in Plex Web open any item, choose *Get Info*, *View XML*, and copy the value of `X-Plex-Token` from the address bar.

```yaml
plex:
  # enabled: false           # remove the menu entry
  # players: [media_player.living_room_tv]   # default: every Plex client and Cast device
  # exclude: [media_player.kitchen_speaker]  # e.g. Cast speakers that cannot show video
  # transcode: auto          # for stream links: auto | always | never
  # title: Medier
  # icon: movie-open-outline
```

* The page appears on its own when the Plex integration has entities and at least one such player exists. Music Assistant's own Plex client is left out.
* Browsing needs one player that is not `unavailable` (any Cast device, or a Plex client that is on); otherwise the page says so.
* A row is missing when Plex has no matching hub for it; the app log lists the hubs it found (`Plex: hubs ...`).
* Lists are cached for a minute, posters through the app for the session. Tablets can browse the titles and posters of your Plex home screen and start playback, so keep the port on your trusted network.

## Devices

![Devices page](https://raw.githubusercontent.com/JannicSJensen/ha-dasher-addon/main/docs/screenshots/devices.png)

A **Devices** entry in the menu collects the household machines, in sections for **Vacuums**, **Dishwashers**, **Dryers and clothes heaters** and **Washing machines**:

* **Vacuum cards:** name, battery, status (cleaning, docked, returning, paused, error with its message), a main button (*Start*, *Pause* or *Resume*), **Dock** and **Find**, and the fan speed as chips when the vacuum has them. Every `vacuum` entity is listed; ones that are unavailable are dimmed.
* **Appliance cards** (washer, dryer, dishwasher): name and status, the time left while it runs, a power switch, **Start**/**Stop** (when the appliance has a remote operation, as LG ThinQ's *Operation* select) and the **delayed end** in hours with −/+.
* **Clothes heaters** are simple cards with a power switch (a `switch`, or a `climate` entity), listed with the dryers.

**LG ThinQ** washers, dryers and dishwashers are found by their device and need no setup (the kind comes from the device name: *vask/wash*, *tørre/dryer*, *opvask/dish*). Everything else is listed in the `devices:` section:

```yaml
devices:
  # enabled: false                           # remove the menu entry
  # title: Enheder
  # vacuums: [vacuum.robbie, vacuum.overlord]   # default: every vacuum
  # exclude: [vacuum.old_robot]                # also removes a found appliance by any of its entities
  appliances:
    - kind: dishwasher                       # washer | dryer | dishwasher | heater
      name: Opvaskemaskine
      status_entity: sensor.dishwasher_status        # state is shown; running/rinsing/drying/... count as active
      remaining_entity: sensor.dishwasher_remaining  # a timestamp sensor or minutes
      power_entity: switch.dishwasher
      operation_entity: select.dishwasher_operation  # a select with the options start and stop
      delay_entity: number.dishwasher_delay          # hours
    - { kind: heater, name: Tøjvarmer, power_entity: switch.clothes_rack }
```

* An appliance needs at least a `status_entity` or a `power_entity`; the other entities are optional and their controls are left out when they are missing.
* An appliance in the list replaces a found one that uses the same entities.
* Starting a washing machine remotely only works when the machine allows it (LG: *remote start* enabled and a programme chosen on the machine).
* **Edit** (the pencil next to the title) lets you take cards off the page, like on the area pages: each card gets a **×**, the removed ones are listed under *Removed devices* with a **+**, and **Done** leaves edit mode. The choice is saved in the app (`hidden-devices.json`) and is the same on every tablet. An appliance is removed as a whole. Unavailable devices stay on the page, dimmed (an appliance that is switched off is often "unavailable"); remove one with **×** if you do not want it. The app option `allow_area_editing` switches the editing off here and on the area pages.
* The page appears on its own when there is a vacuum or an appliance. It uses the entities of the page only; their entities take part in entity mapping.

## To-do lists

![A to-do list](https://raw.githubusercontent.com/JannicSJensen/ha-dasher-addon/main/docs/screenshots/todo-list.png)

A **To-do lists** entry in the menu (call it *Huskelister* with `title:`) lists every `todo` entity of Home Assistant as a card: the name, how many items are open and where the list comes from (shopping list, Local, CalDAV, ...). Tap a list to work on it:

* **Add** an item with the field at the top (Enter works too).
* **Tick** an item off with the circle on the left; ticked items move to *Completed*, where you can untick them or **Clear completed**.
* **Edit** an item by tapping its text: change the text, and, when the list supports them, the description and the due date. Overdue items are shown in red. **Delete** an item in that sheet or with the **×** on the row.
* What you can do follows the list: a CalDAV list that cannot delete items has no delete buttons, a shopping list has no due dates, and so on.
* The list refreshes itself when it changes in Home Assistant (a voice command, another tablet).

**New, rename and delete lists** work for lists of the **Local To-do** integration, which is what Home Assistant offers for lists of your own: *New list* creates one (through the integration's setup, as *Settings → Devices & services → Add integration → Local To-do* would), and open Local lists have a pencil (rename) and a bin (delete, with a confirmation; the list and everything on it is removed). Lists of other integrations (the *Shopping list*, CalDAV, Google Tasks, Todoist, ...) cannot be created or removed from here: they belong to the service they come from, and only their items can be edited. If the Local To-do integration is not available in your Home Assistant, creating a list says so.

```yaml
todo:
  # enabled: false                       # remove the menu entry
  title: Huskelister
  # icon: format-list-checks
  # lists: [todo.indkobsliste, todo.chores]   # default: every to-do list
  # exclude: [todo.old_list]
```

* The page appears on its own when Home Assistant has a to-do list. The lists take part in entity mapping.
* Creating and deleting lists needs Home Assistant's admin API: the app does it with its own Supervisor token. **Anyone who can open the tablet page can add, tick off and delete items and create, rename and delete Local lists.** Turn it off with the app option `allow_todo_management` (items can still be edited), or `read_only`.
* Renaming a list changes the name of its entity in Home Assistant (the entity id stays).

## Areas

![Areas](https://raw.githubusercontent.com/JannicSJensen/ha-dasher-addon/main/docs/screenshots/areas.png)

Every area in Home Assistant (Settings → Areas) gets a picture card on an **Areas** page, reachable from the extra entry at the bottom of the sidebar. A card shows the area name, its floor (or how many lights are on) and opens a sub-page with:

* a large picture with the area name and its **temperature**, **humidity** and **windows** (shown only when the area has such sensors),
* below it, a `photo` tile for every light, fan, cover, media player and **thermostat** (`climate`) in the area. Lights have the brightness slider; a thermostat shows its status and temperature, switches on and off when tapped and has **+** / **−** for the setpoint. Members of a light group or thermostat group are hidden behind the group.
* **Unavailable devices are not shown** (they come back by themselves when they are available again).
* **Edit** (the pencil above the tiles) lets you take devices off the overview: each tile gets a **×**, and the removed ones are listed under *Removed devices* with a **+** to bring them back. Press **Done** to leave.

![Editing an area](https://raw.githubusercontent.com/JannicSJensen/ha-dasher-addon/main/docs/screenshots/area-edit.png)
 The choice is saved in the app and is the same on every tablet. Removing a group removes its members too.

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
  domains: [light, fan, cover, media_player, climate]   # the default; also allowed: switch, input_boolean
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

Areas without any matching entity are not listed. Removed devices (see *Edit* above) are remembered in `hidden-devices.json` in the app's data folder. Editing can be switched off with the app option `allow_area_editing` (or `read_only`); anyone who can open the tablet page can otherwise remove and restore devices, which only changes what the overview shows. If the app cannot read the area registry (for example when started outside Home Assistant with a restricted token) the Areas page stays empty and a warning is logged.

## Music

![Music page](https://raw.githubusercontent.com/JannicSJensen/ha-dasher-addon/main/docs/screenshots/music-discover.png)

If the Music Assistant integration is set up in Home Assistant, a **Music** entry appears in the sidebar (the title and icon can be changed). The page has these parts:

* **Speakers** at the top: one button for every Music Assistant player. Pick the one to listen on; the choice is remembered on that tablet. Speakers that are playing show moving bars, unavailable ones are hidden.
* **Tabs** below: **Discover**, **Radio**, **Albums**, **Artists**, **Podcasts** and **Search**. Tap a tab or swipe the content sideways to move between them (swipes inside a scrolling row of covers scroll the row instead).
* **Now playing** at the bottom: artwork, title and speaker, a play/pause button and a volume slider for the chosen speaker. Whatever you start shows up here at once.

### Radio

One button with the logo for every radio station in your Music Assistant library (Library → Radio). Tap one to play it on the chosen speaker, replacing its queue. The playing station is outlined in the accent colour. The Radio tab works through Home Assistant alone, without a Music Assistant token.

### Discover, Albums, Artists, Podcasts and Search

(The [Party tab](#party) uses the same token.)

These tabs read your library through Music Assistant's own API (Home Assistant's integration cannot list podcast episodes or Discover recommendations), so they need [app options](#app-options): `music_assistant_token`, and `music_assistant_url` unless Music Assistant runs as a Home Assistant app (then Dasher finds the address itself; the log says "Music Assistant found as app ... at ..."). Without them only the Radio tab is shown, with a note about what is missing. To create the token open Music Assistant → *Settings → Profile → Long-lived access tokens → Create token*, and paste it into the app options. The add-on uses it only to read; playback always goes through Home Assistant.

* **Discover** shows the recommendation rows of Music Assistant (recently played, random albums, continue listening, ...), each a row of covers you can scroll sideways.
* **Albums**, **Artists**, **Podcasts** (and **Playlists**, off by default) are grids of covers. Sort by A–Z, newest or random, show only favourites, or type in the filter box. More covers load as you scroll.
* **Search** searches the library and the connected music services for artists, albums, tracks, playlists and podcasts. The last search is remembered when you switch tabs.
* Tap a cover to open it: an album or playlist lists its tracks, an artist its albums and tracks, a podcast its episodes (with played and resume information). The round play button on a cover plays it straight away.
* In an opened album, playlist or podcast, tapping a track or episode plays the whole thing starting there. The **+** at the end of a row, and **Add to queue** in the header, add to the end of the speaker's queue instead of replacing it.

### Party

![Party tab](https://raw.githubusercontent.com/JannicSJensen/ha-dasher-addon/main/docs/screenshots/music-party.png)

The **Party** tab is the host dashboard of Music Assistant's [Party plugin](https://music-assistant.io/plugins/party/) (*Settings → Plugins → Add a plugin → Party* in Music Assistant). It shows:

* the **QR code** guests scan to add songs from their phones (with the party name and text you set in the plugin, and whether it is *Venue* or *Silent disco* mode), and
* the **live queue** of the party player: what plays now with its progress, and what is up next. Songs guests requested are marked with a person symbol, boosted ones with a rocket. It refreshes every few seconds.

It reads through the Music Assistant token like the other library tabs and changes nothing; guests add and boost songs on their own phones. If the plugin is not enabled the tab says so; if guest access is switched off in the plugin the QR code is replaced by a note. **The QR code contains the join link, so anyone who can open the tablet page can see it**, which is the point of a party; keep the port on your own network. The guests' phones must be able to reach Music Assistant (or use its remote access).

### Playing on several speakers

Music Assistant can play on several speakers in sync. Press **Group** at the top right of the music page (the button is greyed out when the chosen speaker cannot lead a group). In group mode the speaker buttons turn into check boxes: tap a speaker to add it to the chosen speaker's group, tap it again to remove it. **Ungroup all** dissolves the group. Press **Group** again to leave group mode.

* The chosen speaker leads the group. Stations, music and play/pause always go to the group leader, so you can pick any member to control the whole group. The bar shows e.g. "on Kitchen +2".
* Grouped speakers are marked with a link symbol and a count appears on the **Group** button. Groups made elsewhere (Music Assistant, Home Assistant) show up too.
* The volume slider always belongs to the speaker you chose, so each speaker keeps its own volume.
* Which speakers can be combined is up to Music Assistant: speakers of different kinds (for example AirPlay and Chromecast) cannot join the same sync group and the error is shown on screen. Music Assistant's own group players (such as "Party") are ordinary speakers on this page and cannot be put into a sync group.

### Full-screen player

![Full-screen player](https://raw.githubusercontent.com/JannicSJensen/ha-dasher-addon/main/docs/screenshots/now-playing.png)

When a Music Assistant speaker **starts playing**, the tablet shows a full-screen player: big artwork on a blurred background, title, album or station, artist, a progress bar you can tap to seek, shuffle, previous, play/pause, next and repeat, a volume slider and the speaker's name (tap it to switch between speakers when several play; a sync group shows `+2`).

* **Close** with the arrow at the top left. After that it stays away until the music has stopped and starts again. The button at the top right closes it and opens the music library.
* It closes by itself 15 seconds after nothing plays any more, and does not open when a tablet loads a page while music is already playing.
* Tap the *now playing* tile, or the **picture or title in the bar at the bottom of the Music page**, to open it yourself, also after you closed it (the speaker you chose there is shown). Shuffle and repeat are shown when the speaker supports them, and the progress bar only reacts when it supports seeking.
* Turn the automatic opening off with `fullscreen: false` under `music:` (the tile then goes to the Music page as before).

### Options

```yaml
music:                          # `radio:` still works as an alias
  enabled: true                 # false removes the menu entry
  title: Music
  icon: music
  tabs: [discover, radio, albums, artists, podcasts, party, search]   # order and choice; also: playlists
  players: [media_player.kitchen, media_player.living_room]   # default: every Music Assistant player
  exclude: [media_player.tv_airplay]
  default_player: media_player.living_room    # used until a speaker has been chosen on the tablet
  fullscreen: true              # false: the full-screen player does not open by itself
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
