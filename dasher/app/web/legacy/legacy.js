(function () {
  "use strict";

  var models = {};
  var states = {};
  var status = { ha: false, readOnly: true };
  var config = null;
  var menu = [];
  var energy = { period: "day", date: null, key: null, data: null, error: null, request: 0 };
  var calendar = { data: null, error: null, loading: false };
  var agendas = {};
  var pending = {};
  var musicFocus = null;
  var notice = document.getElementById("notice");
  var content = document.getElementById("content");
  var menuElement = document.getElementById("menu");
  var labels = {
    en: { climate: "Climate", areas: "Areas", music: "Music", media: "Media", calendar: "Calendar", ev: "Car", energy: "Energy",
      connecting: "Connecting", connected: "Connected", disconnected: "Disconnected from Home Assistant", readonly: "Read-only",
      unavailable: "Unavailable", unknown: "Unknown", empty: "Nothing to show.", unsupported: "This item is not available in legacy mode.",
      loading: "Loading...", power: "Power", current: "Current", target: "Target", previous: "Previous", next: "Next",
      day: "Day", week: "Week", month: "Month", year: "Year", retry: "Refresh", start: "Start charging", stop: "Stop charging",
      remote: "Remote climate", smart: "Smart charging", front: "Front defrost", rear: "Rear defrost", open: "Open", close: "Close", halt: "Stop",
      play: "Play / pause", back: "Previous track", forward: "Next track", volumeDown: "Volume −", volumeUp: "Volume +",
      home: "Home", battery: "Battery", grid_import: "Grid consumption", grid_export: "Returned to grid", solar: "Solar", battery_charge: "Battery charging",
      battery_discharge: "Battery discharging", net_cost: "Net cost", noenergy: "Energy is not configured in Home Assistant.",
      calendarPartial: "Some calendars could not be loaded", calendarReadOnly: "Upcoming events (read-only)", nothingPlaying: "Nothing playing" },
    da: { climate: "Klima", areas: "Områder", music: "Musik", media: "Medier", calendar: "Kalender", ev: "Bil", energy: "Energi",
      connecting: "Forbinder", connected: "Forbundet", disconnected: "Ingen forbindelse til Home Assistant", readonly: "Skrivebeskyttet",
      unavailable: "Ikke tilgængelig", unknown: "Ukendt", empty: "Intet at vise.", unsupported: "Dette element er ikke tilgængeligt i legacy-tilstand.",
      loading: "Indlæser...", power: "Tænd/sluk", current: "Aktuel", target: "Mål", previous: "Forrige", next: "Næste",
      day: "Dag", week: "Uge", month: "Måned", year: "År", retry: "Opdater", start: "Start opladning", stop: "Stop opladning",
      remote: "Fjernklima", smart: "Smart opladning", front: "Forrudevarme", rear: "Bagrudevarme", open: "Åbn", close: "Luk", halt: "Stop",
      play: "Afspil / pause", back: "Forrige nummer", forward: "Næste nummer", volumeDown: "Lydstyrke −", volumeUp: "Lydstyrke +",
      home: "Hjem", battery: "Batteri", grid_import: "Fra elnet", grid_export: "Til elnet", solar: "Solenergi", battery_charge: "Batteriopladning",
      battery_discharge: "Batteriafladning", net_cost: "Nettopris", noenergy: "Energi er ikke konfigureret i Home Assistant.",
      calendarPartial: "Nogle kalendere kunne ikke indlæses", calendarReadOnly: "Kommende begivenheder (skrivebeskyttet)", nothingPlaying: "Intet spiller" }
  };
  var weatherLabels = {
    en: { sunny: "Sunny", "clear-night": "Clear night", partlycloudy: "Partly cloudy", cloudy: "Cloudy", fog: "Fog",
      rainy: "Rain", pouring: "Heavy rain", snowy: "Snow", "snowy-rainy": "Sleet", hail: "Hail",
      lightning: "Lightning", "lightning-rainy": "Thunderstorm", windy: "Windy", "windy-variant": "Windy and cloudy", exceptional: "Exceptional weather" },
    da: { sunny: "Solskin", "clear-night": "Klar nat", partlycloudy: "Delvist skyet", cloudy: "Skyet", fog: "Tåge",
      rainy: "Regn", pouring: "Kraftig regn", snowy: "Sne", "snowy-rainy": "Slud", hail: "Hagl",
      lightning: "Lyn", "lightning-rainy": "Tordenvejr", windy: "Blæsende", "windy-variant": "Blæsende og skyet", exceptional: "Usædvanligt vejr" }
  };
  function t(key) {
    var lang = config && config.language === "da" ? "da" : "en";
    return labels[lang][key] || key;
  }
  function el(tag, text, cls) {
    var node = document.createElement(tag);
    if (text !== null && text !== undefined) node.textContent = String(text);
    if (cls) node.className = cls;
    return node;
  }
  function card(title) {
    var node = el("section", null, "card");
    node.appendChild(el("h2", title));
    return node;
  }
  function line(node, text) { node.appendChild(el("p", text, "muted")); }
  function fail(text) { notice.textContent = text; }
  function request(method, url, body, callback) {
    var xhr = new XMLHttpRequest();
    xhr.open(method, "../api/" + url, true);
    xhr.timeout = 20000;
    if (body) xhr.setRequestHeader("Content-Type", "application/json");
    xhr.onload = function () {
      var data;
      try { data = JSON.parse(xhr.responseText); }
      catch (err) { callback("Invalid response from Dasher."); return; }
      if (xhr.status < 200 || xhr.status >= 300) callback(data.error || "Request failed (" + xhr.status + ").");
      else callback(null, data);
    };
    xhr.onerror = function () { callback("Network request failed."); };
    xhr.ontimeout = function () { callback("Network request timed out."); };
    xhr.send(body ? JSON.stringify(body) : null);
  }
  function available(id) {
    var e = states[id];
    return !!e && e.state !== "unknown" && e.state !== "unavailable";
  }
  function canControl(id) {
    var domain = id.split(".")[0], e = states[id];
    return available(id) || ((domain === "button" || domain === "input_button" || domain === "scene") && e && e.state !== "unavailable");
  }
  function name(id) {
    return states[id] && states[id].attributes && states[id].attributes.friendly_name || id;
  }
  function stateText(id) {
    if (states[id] && states[id].state === "unknown" && canControl(id)) return t("unknown");
    if (!available(id)) return t("unavailable");
    var e = states[id], unit = e.attributes && e.attributes.unit_of_measurement;
    return String(e.state) + (unit ? " " + unit : "");
  }
  function call(domain, service, id, data, callback) {
    if (status.readOnly || !status.ha) {
      var error = status.readOnly ? t("readonly") : t("disconnected");
      fail(error);
      if (callback) callback(error);
      return;
    }
    request("POST", "service", { domain: domain, service: service, entity_id: id, data: data || {} }, function (err) {
      if (err) fail(err);
      if (callback) callback(err);
    });
  }
  function button(parent, text, action, enabled) {
    var b = el("button", text);
    b.type = "button";
    b.disabled = enabled === false;
    b.onclick = action;
    parent.appendChild(b);
    return b;
  }
  function control(parent, label, id, service, data, enabled) {
    var domain = id.split(".")[0];
    button(parent, label, function () { call(domain, service, id, data); }, enabled !== false && !status.readOnly && status.ha && canControl(id));
  }
  function navigate(target) { window.location.hash = "#/" + target; }
  function quickAction(parent, cfg, fallback) {
    var action = cfg.tap || "toggle", id = cfg.entity || fallback, service, domain, data = {};
    if (typeof action === "string") action = { action: action };
    if (action.action === "none") return;
    if (action.action === "navigate") {
      button(parent, cfg.name || action.page, function () { navigate(action.page); });
      return;
    }
    id = action.entity || id;
    if (!id) { line(parent, t("unsupported")); return; }
    domain = id.split(".")[0];
    if (action.action === "service") {
      var parts = String(action.service || "").split(".");
      domain = parts[0]; service = parts[1]; data = action.data || {};
    } else {
      service = { light: "toggle", switch: "toggle", fan: "toggle", input_boolean: "toggle", automation: "toggle",
        cover: "toggle", script: "turn_on", scene: "turn_on", button: "press", input_button: "press",
        media_player: states[id] && states[id].state === "off" ? "turn_on" : "media_play_pause" }[domain];
    }
    if (!service) { line(parent, (cfg.name || id) + ": " + t("unsupported")); return; }
    button(parent, (cfg.name || name(id)) + " · " + stateText(id), function () { call(domain, service, id, data); },
      !status.readOnly && status.ha && canControl(id));
  }
  function menuItems() {
    var result = [], overrides = {}, builtins = [
      ["climate", "climate"], ["areas", "areas"], ["music", "music"], ["calendar", "calendar"],
      ["media", "plex"], ["ev", "ev"], ["energy", "energy"]
    ];
    (config.menu_items || []).forEach(function (item) { overrides[item.id] = item; });
    (config.pages || []).forEach(function (page, index) {
      var override = overrides["page:" + page.id] || {};
      if (override.visible !== false) result.push({ key: "page:" + page.id, id: page.id, page: page, title: page.title,
        order: override.order == null ? index : override.order, index: index });
    });
    builtins.forEach(function (entry) {
      var id = entry[0], section = entry[1], settings = config[section] || {}, model = models[section];
      var index = (config.pages || []).length + ["climate", "areas", "music", "calendar", "family", "meals", "todo", "devices", "media", "ev", "energy", "alarms"].indexOf(id);
      var override = overrides[id] || {};
      if (override.visible === false || settings.enabled === false) return;
      if (id === "calendar" ? !settings.enabled : !(model && model.enabled)) return;
      result.push({ key: id, id: id, title: settings.title || t(id), order: override.order == null ? index : override.order, index: index });
    });
    result.sort(function (a, b) { return a.order - b.order || a.index - b.index; });
    return result;
  }
  function currentItem() {
    var raw = window.location.hash.replace(/^#\/?/, ""), chosen = null;
    menu.forEach(function (item) { if (!item.page && item.id === raw) chosen = item; });
    if (!chosen) menu.forEach(function (item) { if (!chosen && item.page && item.id === raw) chosen = item; });
    return chosen || menu[0];
  }
  function renderMenu(active) {
    menuElement.textContent = "";
    menu.forEach(function (item) {
      var a = el("a", item.title, item === active ? "active" : "");
      a.href = "#/" + item.id;
      menuElement.appendChild(a);
    });
  }
  function upcoming(events) {
    var now = new Date(), today = now.getFullYear() + "-" + ("0" + (now.getMonth() + 1)).slice(-2) + "-" + ("0" + now.getDate()).slice(-2);
    return (events || []).filter(function (event) {
      if (event.allDay) return event.end && event.end !== event.start ? event.end > today : event.start >= today;
      var end = new Date(event.end || event.start).getTime();
      return !isFinite(end) || end >= now.getTime();
    }).sort(function (a, b) { return String(a.start).localeCompare(String(b.start)); });
  }
  function eventText(event) {
    var date = event.start;
    if (!event.allDay) {
      var parsed = new Date(date);
      if (isFinite(parsed.getTime())) date = parsed.toLocaleString();
    }
    return date + " · " + event.summary + (event.location ? " · " + event.location : "");
  }
  function updateClock(clock, now) {
    var hours = now.getHours(), minutes = now.getMinutes(), twelve = clock.getAttribute("data-format") === "12h";
    var key = now.getFullYear() + "-" + now.getMonth() + "-" + now.getDate() + "-" + hours + "-" + minutes;
    if (clock.getAttribute("data-minute") === key) return;
    clock.setAttribute("data-minute", key);
    var suffix = twelve ? (hours < 12 ? " AM" : " PM") : "";
    if (twelve) hours = hours % 12 || 12;
    var hour = ("0" + hours).slice(-2), minute = ("0" + minutes).slice(-2);
    clock.querySelector(".clock-hour").textContent = hour;
    clock.querySelector(".clock-minute").textContent = minute;
    clock.querySelector(".clock-suffix").textContent = suffix;
    clock.setAttribute("aria-label", hour + ":" + minute + suffix);
    var locale = config.locale || config.language || "en", options = {
      weekday: "long", day: "numeric", month: "long", year: "numeric"
    }, date;
    try { date = now.toLocaleDateString(locale, options); }
    catch (err) {
      if (err.name !== "RangeError") throw err;
      fail("Invalid dashboard locale: " + locale);
      date = now.toLocaleDateString();
    }
    clock.querySelector(".clock-date").textContent = date;
  }
  function updateClocks() {
    var clocks = document.querySelectorAll("[data-legacy-clock]"), now = new Date(), i;
    for (i = 0; i < clocks.length; i++) updateClock(clocks[i], now);
  }
  function clockPanel(tile) {
    var panel = el("div", null, "clock-panel"), digits = el("div", null, "clock-digits");
    panel.setAttribute("data-legacy-clock", "");
    panel.setAttribute("data-format", tile.time_format || "24h");
    panel.appendChild(el("div", null, "clock-date"));
    digits.appendChild(el("span", null, "clock-hour clock-block"));
    digits.appendChild(el("span", ":", "clock-colon"));
    digits.appendChild(el("span", null, "clock-minute clock-block"));
    digits.appendChild(el("span", null, "clock-suffix"));
    panel.appendChild(digits);
    updateClock(panel, new Date());
    return panel;
  }
  function weatherPanel(id) {
    var panel = el("div", null, "weather-panel"), e = states[id], attrs = e && e.attributes || {};
    if (!available(id)) {
      line(panel, name(id) + ": " + t("unavailable"));
      return panel;
    }
    var condition = String(e.state), lang = config.language === "da" ? "da" : "en";
    var glyphs = { sunny: "☀", "clear-night": "☾", partlycloudy: "⛅", cloudy: "☁", fog: "☁", rainy: "☂",
      pouring: "☂", snowy: "❄", "snowy-rainy": "❄", hail: "❄", lightning: "ϟ", "lightning-rainy": "ϟ",
      windy: "≋", "windy-variant": "≋", exceptional: "!" };
    var glyph = Object.prototype.hasOwnProperty.call(glyphs, condition) ? glyphs[condition] : "·";
    var symbol = el("span", glyph, "weather-symbol");
    symbol.setAttribute("aria-hidden", "true");
    panel.appendChild(symbol);
    if (typeof attrs.temperature === "number" && isFinite(attrs.temperature)) {
      panel.appendChild(el("span", attrs.temperature + (typeof attrs.temperature_unit === "string" ? attrs.temperature_unit : "°"), "weather-temperature"));
    }
    var weatherName = Object.prototype.hasOwnProperty.call(weatherLabels[lang], condition) ? weatherLabels[lang][condition] : condition;
    panel.appendChild(el("span", weatherName, "weather-condition"));
    return panel;
  }
  function agenda(tile, key, box) {
    var entry = agendas[key], days = Math.min(31, Math.max(1, Number(tile.days) || 7));
    if (!entry) {
      entry = agendas[key] = { loading: true };
      var from = new Date();
      from.setHours(0, 0, 0, 0);
      var end = new Date(from);
      end.setDate(end.getDate() + days);
      var ids = Array.isArray(tile.entities) && tile.entities.length ? tile.entities.join(",") : "all";
      request("GET", "calendar?start=" + encodeURIComponent(from.toISOString()) + "&end=" + encodeURIComponent(end.toISOString()) +
        "&entities=" + encodeURIComponent(ids), null, function (err, data) {
        entry.loading = false; entry.error = err; entry.data = data; render();
      });
    }
    if (entry.loading) line(box, t("loading"));
    else if (entry.error) line(box, entry.error);
    else {
      var events = upcoming(entry.data.events);
      if (!events.length) line(box, t("empty"));
      events.forEach(function (event) { line(box, eventText(event)); });
    }
  }
  function renderPage(page) {
    (page.tiles || []).forEach(function (tile, index) {
      var box, id = tile.entity;
      if (tile.type === "hero") {
        box = el("section", null, "card hero-card");
        if (tile.show_clock !== false) box.appendChild(clockPanel(tile));
        if (tile.weather_entity) box.appendChild(weatherPanel(tile.weather_entity));
        var quick = el("div", null, "hero-actions");
        (tile.buttons || []).forEach(function (b) { quickAction(quick, b); });
        box.appendChild(quick);
        content.appendChild(box);
      } else if (tile.type === "toggle" && id) {
        box = card(tile.name || name(id));
        quickAction(box, tile, id);
        content.appendChild(box);
      } else if (tile.type === "buttons") {
        box = card(tile.title || tile.name || t("home"));
        (tile.buttons || []).forEach(function (b) { quickAction(box, b); });
        content.appendChild(box);
      } else if (tile.type === "vehicle" && id) {
        box = card(tile.name || name(id)); line(box, stateText(id));
        (tile.rows || []).forEach(function (row) { if (row.entity) line(box, name(row.entity) + ": " + stateText(row.entity)); });
        content.appendChild(box);
      } else if (tile.type === "calendar") {
        box = card(tile.name || t("calendar"));
        agenda(tile, page.id + ":" + index, box);
        content.appendChild(box);
      } else if (tile.type === "media") {
        box = card(tile.name || t("media"));
        var ids = tile.entities === "music" ? (models.music && models.music.players || []) : (tile.entities || []);
        if (!Array.isArray(ids)) ids = [];
        ids.forEach(function (player) {
          var attrs = states[player] && states[player].attributes || {};
          line(box, name(player) + ": " + stateText(player) + (attrs.media_title ? " · " + attrs.media_title : ""));
          playerControls(box, player);
        });
        if (!ids.length) line(box, t("empty"));
        content.appendChild(box);
      } else {
        box = card(tile.name || tile.type);
        line(box, t("unsupported"));
        content.appendChild(box);
      }
    });
  }
  function climate(id, parent) {
    var e = states[id], attrs = e && e.attributes || {}, box = card(name(id));
    line(box, t("current") + ": " + (attrs.current_temperature == null ? t("unavailable") : attrs.current_temperature + "°"));
    var target = pending[id] ? pending[id].value : attrs.temperature;
    line(box, t("target") + ": " + (target == null ? t("unavailable") : target + "°"));
    function nudge(direction) {
      var item = pending[id] || {}, now = item.value == null ? Number(attrs.temperature) : item.value;
      item.value = Math.max(attrs.min_temp == null ? 5 : Number(attrs.min_temp),
        Math.min(attrs.max_temp == null ? 35 : Number(attrs.max_temp), Math.round((now + direction * 0.5) * 100) / 100));
      clearTimeout(item.timer);
      item.timer = setTimeout(function () {
        var sent = item.value;
        item.timer = null;
        call("climate", "set_temperature", id, { temperature: sent }, function (err) {
          if (err && pending[id] === item && item.value === sent && !item.timer) { delete pending[id]; render(); }
        });
      }, 600);
      pending[id] = item;
      render();
    }
    var enabled = !status.readOnly && status.ha && available(id);
    var validTarget = target != null && target !== "" && isFinite(Number(target));
    button(box, "− 0.5°", function () { nudge(-1); }, enabled && validTarget);
    button(box, "+ 0.5°", function () { nudge(1); }, enabled && validTarget);
    button(box, t("power"), function () {
      var modes = attrs.hvac_modes || [], mode = null;
      if (e.state !== "off") {
        if (modes.indexOf("off") !== -1) call("climate", "set_hvac_mode", id, { hvac_mode: "off" });
        else call("climate", "turn_off", id);
      } else {
        ["heat_cool", "auto", "heat", "cool"].some(function (m) { if (modes.indexOf(m) !== -1) { mode = m; return true; } return false; });
        if (!mode) modes.some(function (m) { if (m !== "off") { mode = m; return true; } return false; });
        if (mode) call("climate", "set_hvac_mode", id, { hvac_mode: mode });
        else call("climate", "turn_on", id);
      }
    }, enabled);
    parent.appendChild(box);
  }
  function device(id, parent) {
    var domain = id.split(".")[0], box = card(name(id));
    line(box, stateText(id));
    if (domain === "climate") { climate(id, parent); return; }
    if (domain === "cover") {
      control(box, t("open"), id, "open_cover"); control(box, t("halt"), id, "stop_cover"); control(box, t("close"), id, "close_cover");
    } else if (domain === "media_player") {
      playerControls(box, id);
    } else if (["light", "switch", "fan", "input_boolean"].indexOf(domain) !== -1) {
      control(box, t("power"), id, "toggle");
    } else line(box, t("unsupported"));
    parent.appendChild(box);
  }
  function playerControls(box, id) {
    control(box, t("play"), id, "media_play_pause");
    control(box, t("back"), id, "media_previous_track");
    control(box, t("forward"), id, "media_next_track");
    control(box, t("volumeDown"), id, "volume_down");
    control(box, t("volumeUp"), id, "volume_up");
  }
  function artworkUrl(picture) {
    if (typeof picture !== "string" || !picture) return null;
    if (/^https?:\/\//i.test(picture)) return picture;
    return picture.charAt(0) === "/" && picture.charAt(1) !== "/" ? "../api/proxy?path=" + encodeURIComponent(picture) : null;
  }
  function players(model, turntable) {
    var ids = model.players || [];
    if (turntable) {
      var playing = ids.filter(function (id) { return states[id] && states[id].state === "playing"; });
      if (playing.length && playing.indexOf(musicFocus) === -1) musicFocus = playing[0];
      else if (!playing.length && ids.indexOf(musicFocus) === -1) musicFocus = null;
      if (musicFocus) ids = [musicFocus].concat(ids.filter(function (id) { return id !== musicFocus; }));
    }
    ids.forEach(function (id) {
      var box = card(name(id)), attrs = states[id] && states[id].attributes || {};
      if (turntable) {
        box.className += " music-card";
        var deck = el("div", null, "turntable");
        deck.setAttribute("aria-hidden", "true");
        var record = el("div", null, "record" + (states[id] && states[id].state === "playing" ? " is-playing" : ""));
        // Keep the rotation continuous when live events rebuild the card.
        var delay = -(Date.now() % 9000) / 1000 + "s";
        record.style.animationDelay = delay;
        record.style.webkitAnimationDelay = delay;
        var label = el("div", null, "record-label"), picture = artworkUrl(attrs.entity_picture);
        if (picture) {
          var img = el("img", null, "record-art");
          img.alt = "";
          img.onerror = function () { this.style.display = "none"; };
          img.src = picture;
          label.appendChild(img);
        }
        record.appendChild(label);
        deck.appendChild(record);
        deck.appendChild(el("div", null, "tonearm"));
        box.appendChild(deck);
        box.appendChild(el("div", attrs.media_title || t("nothingPlaying"), "track-title"));
        if (attrs.media_artist || attrs.media_album_name) {
          box.appendChild(el("div", attrs.media_artist || attrs.media_album_name, "track-artist"));
        }
      }
      line(box, stateText(id));
      if (!turntable && attrs.media_title) line(box, attrs.media_title + (attrs.media_artist ? " — " + attrs.media_artist : ""));
      var controls = el("div", null, "player-controls");
      playerControls(controls, id);
      box.appendChild(controls);
      content.appendChild(box);
    });
    if (!ids.length) line(content, t("empty"));
  }
  function evAction(roles, action, enabled) {
    var id = roles[action === "stop" ? "stop_entity" : "start_entity"] || roles.charge_switch_entity;
    if (!id) return;
    var domain = id.split(".")[0], service = {
      button: "press", input_button: "press", switch: action === "stop" ? "turn_off" : "turn_on",
      input_boolean: action === "stop" ? "turn_off" : "turn_on", script: "turn_on", scene: "turn_on", automation: "trigger"
    }[domain];
    if (service) control(content, t(action), id, service, domain === "automation" ? { skip_condition: true } : {}, enabled);
  }
  function renderEv(model) {
    var roles = model.roles || {}, box = card(model.name || t("ev"));
    var smart = roles.smart_info_entity && states[roles.smart_info_entity];
    if ((!roles.battery_entity || !available(roles.battery_entity)) && smart && smart.attributes && smart.attributes.ev_soc != null) {
      line(box, t("battery") + ": " + smart.attributes.ev_soc + " %");
    }
    ["battery_entity", "range_entity", "plug_entity", "charging_entity", "smart_status_entity", "smart_info_entity"].forEach(function (key) {
      if (roles[key]) line(box, name(roles[key]) + ": " + stateText(roles[key]));
    });
    content.appendChild(box);
    var chargeId = roles.charging_entity || roles.smart_info_entity || roles.charge_switch_entity;
    var charging = chargeId && available(chargeId) ? ["on", "true", "yes", "charging"].indexOf(String(states[chargeId].state).toLowerCase()) !== -1 : null;
    evAction(roles, charging ? "stop" : "start", charging !== null);
    [["smart_switch_entity", "smart"], ["remote_start_entity", "remote"], ["defrost_front_entity", "front"], ["defrost_rear_entity", "rear"]].forEach(function (pair) {
      if (roles[pair[0]]) {
        var id = roles[pair[0]], domain = id.split(".")[0];
        if (domain === "switch" || domain === "input_boolean") control(content, t(pair[1]) + " · " + stateText(id), id, "toggle");
      }
    });
  }
  function loadCalendar() {
    if (calendar.loading) return;
    calendar.loading = true; calendar.error = null; calendar.data = null; render();
    var current = calendar;
    var from = new Date(), end = new Date(from.getTime() + 7 * 86400000);
    request("GET", "calendar/view?start=" + encodeURIComponent(from.toISOString()) + "&end=" + encodeURIComponent(end.toISOString()), null, function (err, data) {
      if (calendar !== current) return;
      calendar.loading = false; calendar.error = err; calendar.data = data || null; render();
    });
  }
  function renderCalendar() {
    var box = card(t("calendarReadOnly"));
    button(box, t("retry"), loadCalendar, !calendar.loading);
    if (calendar.loading) line(box, t("loading"));
    else if (calendar.error) line(box, calendar.error);
    else if (!calendar.data) { content.appendChild(box); loadCalendar(); return; }
    else {
      if ((calendar.data.failed || []).length) line(box, t("calendarPartial") + ": " + calendar.data.failed.join(", "));
      var events = upcoming(calendar.data.events);
      if (!events.length) line(box, t("empty"));
      events.forEach(function (event) { line(box, eventText(event)); });
    }
    content.appendChild(box);
  }
  function loadEnergy() {
    var key = energy.period + ":" + (energy.date || "");
    var requestId = ++energy.request;
    energy.key = key; energy.data = null; energy.error = null;
    request("GET", "energy?period=" + energy.period + (energy.date ? "&date=" + energy.date : ""), null, function (err, data) {
      if (energy.request !== requestId) return;
      energy.error = err; energy.data = data || null;
      if (data && !energy.date) energy.date = data.today;
      render();
    });
  }
  function shiftEnergy(direction) {
    var date = new Date(energy.date + "T12:00:00Z");
    if (energy.period === "week") date.setUTCDate(date.getUTCDate() - (date.getUTCDay() + 6) % 7);
    if (energy.period === "month" || energy.period === "year") date.setUTCDate(1);
    if (energy.period === "year") date.setUTCMonth(0);
    if (energy.period === "day" || energy.period === "week") date.setUTCDate(date.getUTCDate() + direction * (energy.period === "day" ? 1 : 7));
    if (energy.period === "month") date.setUTCMonth(date.getUTCMonth() + direction);
    if (energy.period === "year") date.setUTCFullYear(date.getUTCFullYear() + direction);
    energy.date = date.toISOString().slice(0, 10);
    if (energy.data && energy.data.today && energy.date > energy.data.today) energy.date = energy.data.today;
    loadEnergy(); render();
  }
  function energyPeriodStart(value, period) {
    var date = new Date(value + "T12:00:00Z");
    if (period === "week") date.setUTCDate(date.getUTCDate() - (date.getUTCDay() + 6) % 7);
    if (period === "month" || period === "year") date.setUTCDate(1);
    if (period === "year") date.setUTCMonth(0);
    return date.toISOString().slice(0, 10);
  }
  function renderEnergy() {
    var box = card(t("energy"));
    ["day", "week", "month", "year"].forEach(function (period) {
      button(box, t(period), function () { energy.period = period; loadEnergy(); render(); }, period !== energy.period);
    });
    button(box, t("previous"), function () { shiftEnergy(-1); }, !!energy.date);
    button(box, t("next"), function () { shiftEnergy(1); }, !!energy.date && !!energy.data && !!energy.data.today &&
      energyPeriodStart(energy.date, energy.period) < energyPeriodStart(energy.data.today, energy.period));
    button(box, t("retry"), function () { loadEnergy(); render(); });
    if (energy.error) line(box, energy.error);
    else if (!energy.data) line(box, t("loading"));
    else if (!energy.data.configured) line(box, t("noenergy"));
    else {
      line(box, energy.date + " · " + t(energy.period));
      ["home", "grid_import", "grid_export", "solar", "battery_charge", "battery_discharge", "net_cost"].forEach(function (key) {
        var value = energy.data.totals && energy.data.totals[key];
        line(box, t(key) + ": " + (typeof value === "number" && isFinite(value) ? Math.round(value * 100) / 100 + " " + (key === "net_cost" ? energy.data.currency || "" : "kWh") : t("unavailable")));
      });
      (energy.data.sources || []).concat(energy.data.devices || [], energy.data.water_devices || []).forEach(function (source) {
        var value = source.value;
        line(box, source.name + ": " + (typeof value === "number" && isFinite(value) ? Math.round(value * 100) / 100 + (source.unit ? " " + source.unit : "") : t("unavailable")));
      });
      (energy.data.warnings || []).forEach(function (warning) { line(box, JSON.stringify(warning)); });
    }
    content.appendChild(box);
    if (!energy.key) loadEnergy();
  }
  function render() {
    if (!config) return;
    menu = menuItems();
    var item = currentItem();
    renderMenu(item);
    content.textContent = "";
    document.getElementById("title").textContent = config.title || "Dasher";
    document.getElementById("connection").textContent = (status.ha ? t("connected") : t("disconnected")) + (status.readOnly ? " · " + t("readonly") : "");
    if (!item) { line(content, t("empty")); return; }
    content.appendChild(el("h1", item.title));
    if (item.page) renderPage(item.page);
    else if (item.id === "climate") (models.climate.entities || []).forEach(function (id) { climate(id, content); });
    else if (item.id === "areas") (models.areas.areas || []).forEach(function (area) {
      var box = card(area.name);
      (area.temperature || []).concat(area.humidity || [], area.windows || []).forEach(function (id) { line(box, name(id) + ": " + stateText(id)); });
      content.appendChild(box);
      (area.entities || []).forEach(function (id) { device(id, content); });
    });
    else if (item.id === "music") players(models.music, true);
    else if (item.id === "media") players(models.plex);
    else if (item.id === "ev") renderEv(models.ev);
    else if (item.id === "calendar") renderCalendar();
    else if (item.id === "energy") renderEnergy();
  }
  function connect() {
    var source = new EventSource("../api/events");
    source.onerror = function () {
      status.ha = false; render();
      if (source.readyState === EventSource.CLOSED) { source.close(); setTimeout(connect, 3000); }
    };
    ["status", "config", "areas", "music", "plex", "ev", "climate", "energy", "snapshot", "state"].forEach(function (type) {
      source.addEventListener(type, function (event) {
        var data;
        try { data = JSON.parse(event.data); }
        catch (err) { fail("Invalid " + type + " update from Dasher."); return; }
        if (type === "status") status = data;
        else if (type === "config") {
          config = data.config;
          agendas = {};
          calendar = { data: null, error: null, loading: false };
          energy.request++;
          energy.key = null;
          if (data.errors && data.errors.length) fail(data.errors.join("; "));
        } else if (type === "snapshot") states = data;
        else if (type === "state") {
          states[data.entity_id] = data;
          if (pending[data.entity_id] && !pending[data.entity_id].timer && data.attributes && data.attributes.temperature === pending[data.entity_id].value) delete pending[data.entity_id];
        } else models[type] = data;
        render();
      });
    });
  }
  window.addEventListener("hashchange", render);
  setInterval(updateClocks, 1000);
  setInterval(function () {
    agendas = {};
    calendar.data = null;
    if (currentItem() && currentItem().id === "energy" && energy.key) loadEnergy();
    else render();
  }, 300000);
  connect();
}());
