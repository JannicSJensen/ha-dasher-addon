# Dasher

The front-page hero shows locally animated current HA weather with day/night scenes, while keeping its clock, reminders and buttons. Disable **Animated weather background** in the app configuration to restore the original picture; see [Animated weather](DOCS.md#animated-weather-background).

A wall-tablet dashboard for Home Assistant, served as a plain web page that any tablet can open.

* Open `http://<home-assistant>:8099/` on the tablet. No Home Assistant login is needed on the tablet.
* Describe your dashboard in one `dashboard.yaml`; it reloads as soon as you save.
* Tiles for lights (with brightness slider), electricity price, vehicle, "now playing", heating and more, plus a page per Home Assistant area.
* A music page for Music Assistant: radio, discover, albums, artists, podcasts and search, played on any speaker, also several in sync.
* A calendar tile with the next days and the weather, a Car page (charging, smart charging, remote climate), a Climate overview of your climate helpers, and a Media page for Plex (continue watching, recently added) that plays on Cast, Plex clients, Apple TVs and DLNA players.
* Missing entities can be mapped from the tablet.
* Configure visibility, labels, icons and ordering for all menu items in the app's **Configuration** tab.
* An Energy overview reuses Home Assistant's configured grid, solar, battery and device statistics, with date navigation and consumption charts.

Open the **Documentation** tab for setup and all options.
