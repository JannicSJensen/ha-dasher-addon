# Dasher

The front-page hero shows locally animated current HA weather with day/night scenes, while keeping its clock, reminders and buttons. Disable **Animated weather background** in the app configuration to restore the original picture; see [Animated weather](DOCS.md#animated-weather-background).

A wall-tablet dashboard for Home Assistant, served as a plain web page that any tablet can open.

* Open `http://<home-assistant>:8099/` on the tablet. No Home Assistant login is needed on the tablet.
* Older tablets can use the simplified [legacy interface](DOCS.md#legacy-mode-for-older-tablets) at `http://<home-assistant>:8099/legacy/`, with ten configurable dashboard faces, optional photos and camera snapshots, and a turntable-inspired music player. It targets iOS 12.5.8 (physical-device testing still needed); read the linked privacy notes before enabling images.
* Describe your dashboard in one `dashboard.yaml`; it reloads as soon as you save.
* Tiles for lights (with brightness slider), electricity price, vehicle, "now playing", heating and more, plus a page per Home Assistant area.
* A music page for Music Assistant: radio, discover, albums, artists, podcasts and search, played on any speaker, also several in sync.
* A calendar tile with the next days and the weather, a Car page (charging, smart charging, remote climate), a Climate overview of your climate helpers, and a Media page for Plex (continue watching, recently added) that plays on Cast, Plex clients, Apple TVs and DLNA players.
* Missing entities can be mapped from the tablet.
* Configure visibility, labels, icons and ordering for all menu items in the app's **Configuration** tab; rows for built-in and dashboard pages are added automatically.
* An Energy overview reuses Home Assistant's configured grid, solar, battery and device statistics, with date navigation and consumption charts.
* Daily electricity prices and cheapest-start advice for EV charging and two-hour dryer, washer and dishwasher runs, using existing HA price sensors.
* Local Alarms page with illustrated cooking presets, custom countdowns and tablet alerts.

Open the **Documentation** tab for setup and all options.
