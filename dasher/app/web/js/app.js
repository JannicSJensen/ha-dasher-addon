import { callService, connect, groupRadio, playMusic, playRadio } from "./core/api.js";
import { h, setChildren } from "./core/h.js";
import { icon } from "./core/icons.js";
import { Store } from "./core/store.js";
import { collectEntities } from "./lib/entities.js";
import { makeTranslator } from "./lib/i18n.js";
import { createAreaPage } from "./pages/area.js";
import { createAreasPage } from "./pages/areas.js";
import { createEvPage } from "./pages/ev.js";
import { createMappingPage } from "./pages/mapping.js";
import { createMusicPage } from "./pages/music.js";
import { TILE_FACTORIES } from "./tiles/index.js";

const store = new Store({
  link: "connecting", // connecting | online | offline
  ha: null,
  missing: [],
  mapping: { enabled: false, mapped: 0 },
  readOnly: false,
  version: null,
  config: null,
  areas: null,
  music: null,
  ev: null,
  lastPlayed: {},
  errors: [],
  entities: {},
});

let loadedVersion = null;
let t = makeTranslator("en");
let mounted = []; // { tile, entities: string[], last: object[] }
let route = { kind: "page", id: null };
let idleTimer;

const root = document.getElementById("app");
const sidebar = h("nav", { class: "sidebar", "aria-label": "Pages" });
const stage = h("main", { class: "stage" });
const banner = h("div", { class: "banner", hidden: true });
const toasts = h("div", { class: "toasts", "aria-live": "polite" });
root.append(sidebar, stage, banner, toasts);

// ---- helpers ------------------------------------------------------------------

function toast(message) {
  const el = h("div", { class: "toast" }, message);
  toasts.append(el);
  setTimeout(() => el.remove(), 4000);
}

const getState = (id) => store.getState().entities[id];

function makeContext(config) {
  return {
    t,
    language: config.language,
    locale: config.locale ?? config.language,
    getState,
    get readOnly() {
      return store.getState().readOnly;
    },
    toast,
    musicPlayers: () => store.getState().music?.players ?? [],
    stations: () => store.getState().music?.stations ?? [],
    musicEnabled: () => Boolean(store.getState().music?.enabled),
    lastPlayed: () => store.getState().lastPlayed,
    navigate: (target) => (location.hash = `#/${target}`),
    /** Add and/or remove speakers of a sync group; resolves to true on success. */
    async groupRadio(leader, change) {
      if (store.getState().readOnly) return void toast(t("read_only"));
      try {
        await groupRadio(leader, change);
        return true;
      } catch (err) {
        toast(err.message);
        return false;
      }
    },
    /** Play or queue something from the music library; resolves to true on success. */
    async playMusic(entityId, request) {
      if (store.getState().readOnly) return void toast(t("read_only"));
      try {
        await playMusic(entityId, request);
        return true;
      } catch (err) {
        toast(err.message);
        return false;
      }
    },
    /** Start a radio station on a speaker; resolves to true on success. */
    async playRadio(entityId, stationId) {
      if (store.getState().readOnly) return void toast(t("read_only"));
      try {
        await playRadio(entityId, stationId);
        return true;
      } catch (err) {
        toast(err.message);
        return false;
      }
    },
    async call(domain, service, entityId, data) {
      if (store.getState().readOnly) return toast(t("read_only"));
      try {
        await callService(domain, service, entityId, data);
      } catch (err) {
        toast(err.message);
      }
    },
  };
}

// ---- rendering ----------------------------------------------------------------

function destroyTiles() {
  for (const { tile } of mounted) tile.destroy?.();
  mounted = [];
}

function parseRoute(config) {
  const raw = location.hash.replace(/^#\/?/, "");
  const { areas } = store.getState();
  const areasOff = areas !== null && !areas.enabled; // known to be disabled, as opposed to not loaded yet
  const { music } = store.getState();
  const musicOff = music !== null && !music.enabled;
  const { ev } = store.getState();
  if (raw === "ev" && ev?.enabled) return { kind: "ev", id: null };
  if (raw === "entities" && store.getState().mapping.enabled) return { kind: "entities", id: null };
  if ((raw === "music" || raw === "radio") && !musicOff) return { kind: "music", id: null };
  if (raw === "areas" && !areasOff) return { kind: "areas", id: null };
  if (raw.startsWith("area/") && !areasOff) return { kind: "area", id: decodeURIComponent(raw.slice(5)) };
  const page = config.pages.find((p) => p.id === raw) ?? config.pages[0];
  return { kind: "page", id: page.id };
}

const musicEnabled = () => Boolean(store.getState().music?.enabled);

const areasEnabled = () => {
  const { areas } = store.getState();
  return Boolean(areas?.enabled);
};

function renderSidebar(config) {
  const items = config.pages.map((page) => ({
    href: `#/${page.id}`,
    title: page.title,
    icon: page.icon,
    active: route.kind === "page" && route.id === page.id,
  }));
  if (areasEnabled()) {
    const { areas } = store.getState();
    items.push({
      href: "#/areas",
      title: areas.title ?? t("areas"),
      icon: areas.icon,
      active: route.kind === "areas" || route.kind === "area",
    });
  }
  if (musicEnabled()) {
    const { music } = store.getState();
    items.push({ href: "#/music", title: music.title ?? t("music"), icon: music.icon, active: route.kind === "music" });
  }
  const { ev } = store.getState();
  if (ev?.enabled) items.push({ href: "#/ev", title: ev.title ?? t("ev_car"), icon: ev.icon, active: route.kind === "ev" });
  const { mapping, missing } = store.getState();
  if (mapping.enabled && (missing.length || mapping.mapped)) {
    items.push({ href: "#/entities", title: t("map_entities"), icon: "swap-horizontal", active: route.kind === "entities" });
  }
  setChildren(
    sidebar,
    items.map((item) =>
      h("a", { class: `sidebar__item${item.active ? " is-active" : ""}`, href: item.href, title: item.title, "aria-label": item.title }, icon(item.icon)),
    ),
  );
  sidebar.hidden = items.length < 2;
}

function mountSingle(page) {
  stage.style.gridTemplateColumns = stage.style.gridTemplateRows = "minmax(0, 1fr)";
  stage.style.gap = stage.style.padding = "0";
  setChildren(stage, page.el);
  mounted.push({ tile: page, entities: page.entities, last: null });
}

function renderRoute() {
  const { config, areas, music, ev } = store.getState();
  destroyTiles();
  document.querySelectorAll(".modal").forEach((m) => m.remove());
  route = parseRoute(config);
  renderSidebar(config);
  stage.dataset.page = route.kind === "page" ? route.id : route.kind;
  const ctx = makeContext(config);

  if (route.kind === "ev") {
    mountSingle(createEvPage(ev, ctx));
  } else if (route.kind === "entities") {
    mountSingle(createMappingPage(ctx));
  } else if (route.kind === "music") {
    if (music) mountSingle(createMusicPage(music, ctx));
    else setChildren(stage); // the music data has not arrived yet
  } else if (route.kind === "areas") {
    mountSingle(createAreasPage(areas ?? { areas: [] }, ctx));
  } else if (route.kind === "area") {
    if (!areas) {
      setChildren(stage); // the area list has not arrived yet
    } else {
      const area = areas.areas.find((a) => a.id === route.id);
      if (!area) return void (location.hash = "#/areas");
      mountSingle(createAreaPage(area, ctx));
    }
  } else {
    renderConfigPage(config.pages.find((p) => p.id === route.id), ctx);
  }
  refreshTiles(true);
  renderBanner();
}

function renderConfigPage(page, ctx) {
  stage.style.gridTemplateColumns = `repeat(${page.columns}, minmax(0, 1fr))`;
  stage.style.gridTemplateRows = `repeat(${page.rows}, minmax(0, 1fr))`;
  stage.style.gap = stage.style.padding = `${page.gap}px`;

  const els = page.tiles.map((cfg) => {
    let tile;
    try {
      tile = TILE_FACTORIES[cfg.type](cfg, ctx);
    } catch (err) {
      console.error(err);
      tile = { el: h("div", { class: "tile tile--error" }, `${cfg.type}: ${err.message}`) };
    }
    tile.el.style.gridColumn = `${cfg.col ?? "auto"} / span ${cfg.w}`;
    tile.el.style.gridRow = `${cfg.row ?? "auto"} / span ${cfg.h}`;
    // Tiles that follow a changing set of entities (e.g. every music speaker) list them themselves.
    mounted.push({ tile, entities: [...new Set([...collectEntities(cfg), ...(tile.entities ?? [])])], last: null });
    return tile.el;
  });
  setChildren(stage, els);
}

function refreshTiles(force = false) {
  const { entities } = store.getState();
  for (const record of mounted) {
    const now = record.entities.map((id) => entities[id]);
    const changed = force || !record.last || now.some((s, i) => s !== record.last[i]);
    if (!changed) continue;
    record.last = now;
    try {
      record.tile.update?.();
    } catch (err) {
      console.error(err);
    }
  }
}

function renderConfigError(errors) {
  setChildren(
    stage,
    h(
      "div",
      { class: "notice" },
      icon("alert-circle-outline"),
      h("h2", null, t("config_error")),
      h("p", null, t("config_hint")),
      h("ul", null, errors.map((e) => h("li", null, e))),
    ),
  );
  sidebar.hidden = true;
  stage.style.gridTemplateColumns = stage.style.gridTemplateRows = "1fr";
}

function renderBanner() {
  const { link, ha, errors, config, missing, mapping } = store.getState();
  let message = "";
  let canMap = false;
  if (link === "offline") message = t("reconnecting");
  else if (link === "online" && ha === false) message = t("ha_offline");
  else if (config && errors.length) message = `${t("config_error")}: ${errors[0]}`;
  else if (config && missing.length) {
    const shown = missing.slice(0, 3).join(", ");
    message = `${t("unknown_entities")}: ${shown}${missing.length > 3 ? ` +${missing.length - 3}` : ""}`;
    // On the mapping screen itself the banner would only be in the way.
    if (route.kind === "entities") message = "";
    canMap = mapping.enabled && Boolean(message);
  }
  banner.hidden = !message;
  banner.replaceChildren(message);
  if (canMap) {
    const fix = h("button", { class: "banner__btn", type: "button" }, t("map_entities"));
    fix.addEventListener("click", () => (location.hash = "#/entities"));
    banner.append(fix);
  }
  banner.classList.toggle("banner--warn", Boolean(message) && link === "online" && ha !== false);
}

function applyConfig() {
  const { config, errors } = store.getState();
  if (!config) {
    t = makeTranslator("en");
    destroyTiles();
    return renderConfigError(errors.length ? errors : ["No configuration loaded."]);
  }
  t = makeTranslator(config.language);
  document.documentElement.lang = config.language;
  document.documentElement.style.setProperty("--accent", config.accent);
  document.title = config.title;
  renderRoute();
  resetIdle();
}

// ---- idle return --------------------------------------------------------------

function resetIdle() {
  clearTimeout(idleTimer);
  const { config } = store.getState();
  if (!config?.idle_return || (config.pages.length < 2 && !areasEnabled() && !musicEnabled())) return;
  idleTimer = setTimeout(() => {
    if (route.kind !== "page" || route.id !== config.pages[0].id) location.hash = `#/${config.pages[0].id}`;
  }, config.idle_return * 1000);
}

for (const ev of ["pointerdown", "keydown"]) document.addEventListener(ev, resetIdle, { passive: true });

// ---- wiring -------------------------------------------------------------------

store.subscribe((s) => s.entities, () => refreshTiles());
store.subscribe((s) => s.config, applyConfig);
store.subscribe((s) => s.errors, () => {
  if (!store.getState().config) applyConfig();
});
for (const key of ["link", "ha", "errors", "config", "missing", "mapping"]) store.subscribe((s) => s[key], renderBanner);
for (const key of ["missing", "mapping"]) store.subscribe((s) => s[key], () => store.getState().config && renderSidebar(store.getState().config));

store.subscribe((s) => s.areas, () => {
  const { config } = store.getState();
  if (!config) return;
  if (route.kind === "page") renderSidebar(config);
  else renderRoute();
});

const followsMusic = (config) => config.pages.find((p) => p.id === route.id)?.tiles.some((tile) => tile.entities === "music");

store.subscribe((s) => s.music, () => {
  const { config } = store.getState();
  if (!config) return;
  if (route.kind === "music" || ["#/music", "#/radio"].includes(location.hash)) renderRoute();
  else if (route.kind === "page" && followsMusic(config)) renderRoute(); // its tile needs the speaker list
  else renderSidebar(config);
});

store.subscribe((s) => s.ev, () => {
  const { config } = store.getState();
  if (!config) return;
  if (route.kind === "ev" || location.hash === "#/ev") renderRoute();
  else renderSidebar(config);
});

store.subscribe((s) => s.lastPlayed, () => refreshTiles(true));

window.addEventListener("hashchange", () => {
  if (store.getState().config) {
    renderRoute();
    resetIdle();
  }
});

/** Set a store field only when its content really changed, so pages are not rebuilt for nothing. */
const lastSeen = {};
function setIfChanged(key, value) {
  const signature = JSON.stringify(value);
  if (lastSeen[key] === signature) return;
  lastSeen[key] = signature;
  store.setState({ [key]: value });
}

connect({
  onConnection: (online) => store.setState({ link: online ? "online" : "offline" }),
  hello: ({ version }) => {
    if (loadedVersion && loadedVersion !== version) location.reload();
    loadedVersion = version;
    store.setState({ version });
  },
  status: ({ ha, readOnly, missing, mapping }) => store.setState({ ha, readOnly, missing: missing ?? [], mapping: mapping ?? { enabled: false, mapped: 0 } }),
  config: ({ config, errors }) => store.setState({ config, errors }),
  areas: (areas) => setIfChanged("areas", areas),
  music: (music) => setIfChanged("music", music),
  ev: (ev) => setIfChanged("ev", ev),
  lastplayed: (lastPlayed) => setIfChanged("lastPlayed", lastPlayed),
  snapshot: (states) => store.setState({ entities: states }),
  state: (state) => store.setState((s) => ({ ...s, entities: { ...s.entities, [state.entity_id]: state } })),
});
