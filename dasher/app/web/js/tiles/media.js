import { pictureUrl } from "../core/api.js";
import { h } from "../core/h.js";
import { icon, setIcon } from "../core/icons.js";
import { createSlider } from "../core/slider.js";
import { isUnavailable } from "../lib/format.js";
import { chooseNowPlaying, describeMedia, lastPlayedFor, timeAgo, trackPosition } from "../lib/nowplaying.js";
import { groupOf } from "../lib/radio.js";
import { throttle } from "../lib/throttle.js";
import { pressable, runAction } from "./common.js";

const PREVIOUS_TRACK = 16;
const NEXT_TRACK = 32;
const bg = (url) => `url("${String(url).replace(/"/g, "%22")}")`;
const volumeIcon = (level) => (level === 0 ? "volume-off" : level < 0.34 ? "volume-low" : level < 0.67 ? "volume-medium" : "volume-high");
const supports = (attrs, flag) => attrs.supported_features == null || (Number(attrs.supported_features) & flag) !== 0;

/**
 * "What's playing" tile. It follows whichever speaker is playing (or paused), lets you control it,
 * and when nothing is active shows the last track that played, which the add-on remembers.
 *
 * Config: `entities` (a list, or `music` for every Music Assistant speaker) or a single `entity`;
 * `name` (title for a single speaker), `volume: false`, `tap` (default: open the music page).
 */
export function createMediaTile(cfg, ctx) {
  const { t, getState } = ctx;
  const candidates = () => (cfg.entities === "music" ? ctx.musicPlayers() : Array.isArray(cfg.entities) ? cfg.entities : cfg.entity ? [cfg.entity] : []);
  let current = null; // the speaker being shown, kept while it stays active
  let view = { mode: "none", id: null, active: [], entry: null };
  let touchedVolumeAt = 0;

  const art = h("div", { class: "media__art" });
  const chipIcon = icon("speaker");
  const chipName = h("span", { class: "npchip__name" });
  const chipMore = h("span", { class: "npchip__more" });
  const bars = h("span", { class: "eq", "aria-hidden": "true" }, h("i"), h("i"), h("i"));
  const chip = h("button", { class: "npchip", type: "button" }, chipIcon, chipName, chipMore, bars);
  const status = h("div", { class: "np__status" });

  const prev = h("button", { class: "media__skip", type: "button", "aria-label": "Previous" }, icon("skip-previous"));
  const playIcon = icon("play");
  const play = h("button", { class: "media__play", type: "button", "aria-label": "Play/Pause" }, playIcon);
  const next = h("button", { class: "media__skip", type: "button", "aria-label": "Next" }, icon("skip-next"));
  const controls = h("div", { class: "media__controls" }, prev, play, next);

  const title = h("div", { class: "media__title" });
  const sub = h("div", { class: "media__sub" });

  const volIcon = icon("volume-medium");
  const sendVolume = throttle((v) => view.id && ctx.call("media_player", "volume_set", view.id, { volume_level: v / 100 }), 250);
  const volume = createSlider({
    orientation: "horizontal",
    variant: "line",
    min: 0,
    max: 100,
    step: 1,
    value: 0,
    onInput: (v) => {
      touchedVolumeAt = Date.now();
      sendVolume(v);
    },
    onCommit: (v) => {
      touchedVolumeAt = Date.now();
      sendVolume.cancel();
      if (view.id) ctx.call("media_player", "volume_set", view.id, { volume_level: v / 100 });
    },
  });
  const volumeRow = h("div", { class: "npvol" }, volIcon, h("div", { class: "npvol__slider" }, volume.el));
  // The slider must not open the music page underneath it.
  volumeRow.addEventListener("pointerdown", (e) => e.stopPropagation());

  const progress = h("i");
  const progressBar = h("div", { class: "npprogress" }, progress);

  const el = h(
    "div",
    { class: "tile tile--media tile--nowplaying" },
    art,
    h("div", { class: "media__shade" }),
    h("div", { class: "np__top" }, chip, status),
    controls,
    h("div", { class: "media__info" }, title, sub),
    volumeRow,
    progressBar,
  );

  // ---- actions --------------------------------------------------------------------
  pressable(chip, {
    onTap: () => {
      const list = view.active ?? [];
      if (list.length > 1) {
        current = list[(list.indexOf(view.id) + 1) % list.length];
        update();
      }
    },
  });

  pressable(play, {
    onTap: () => {
      if (!view.id) return;
      if (view.mode === "last") {
        // Start the remembered track again on a Music Assistant speaker, else just press play.
        if (view.entry?.uri && ctx.musicPlayers().includes(view.id)) ctx.playMusic(view.id, { uri: view.entry.uri, enqueue: "replace" });
        else ctx.call("media_player", "media_play", view.id);
      } else ctx.call("media_player", "media_play_pause", view.id);
    },
  });
  pressable(prev, { onTap: () => view.id && ctx.call("media_player", "media_previous_track", view.id) });
  pressable(next, { onTap: () => view.id && ctx.call("media_player", "media_next_track", view.id) });

  pressable(el, {
    onTap: () => {
      if (cfg.tap) return runAction(cfg.tap, ctx, view.id ?? cfg.entity);
      if ((view.mode === "playing" || view.mode === "paused") && ctx.openNowPlaying?.()) return;
      if (ctx.musicEnabled()) ctx.navigate("music");
    },
  });

  // ---- progress line -----------------------------------------------------------------
  function paintProgress() {
    const state = view.id ? getState(view.id) : null;
    const live = view.mode === "playing" || view.mode === "paused";
    const pos = live && state ? trackPosition(state.attributes, state.state) : null;
    progressBar.classList.toggle("is-on", Boolean(pos));
    if (pos) progress.style.width = `${(pos.position / pos.duration) * 100}%`;
  }
  const timer = setInterval(paintProgress, 1000);

  // ---- rendering ----------------------------------------------------------------------
  function update() {
    const ids = candidates();
    const choice = chooseNowPlaying({ ids, getState, current });
    const nameOf = (id, attrs) => (ids.length === 1 && cfg.name ? cfg.name : (attrs?.friendly_name ?? id.replace(/^media_player\./, "")));
    let pictureSrc = "";
    let titleText = "";
    let subText = "";
    let statusText = "";
    let nameText = "";
    let more = "";
    let playing = false;
    let attrs = {};

    if (choice) {
      current = choice.id;
      attrs = getState(choice.id).attributes ?? {};
      const grp = groupOf(choice.id, getState);
      const media = describeMedia(attrs, ctx.stations());
      view = { mode: choice.mode, id: choice.id, active: choice.active, entry: null };
      playing = choice.mode === "playing";
      titleText = media.title;
      subText = media.subtitle;
      statusText = t(playing ? "np_playing" : "np_paused");
      nameText = nameOf(choice.id, attrs);
      more = grp.grouped ? `+${grp.members.length - 1}` : choice.active.length > 1 ? String(choice.active.length) : "";
      pictureSrc = attrs.entity_picture ? pictureUrl(attrs.entity_picture) : media.station?.image ? `./${media.station.image}` : "";
    } else {
      const last = lastPlayedFor(ids, ctx.lastPlayed());
      current = null;
      if (last) {
        view = { mode: "last", id: last.id, active: [], entry: last.entry };
        const media = describeMedia({ media_title: last.entry.title, media_artist: last.entry.artist, media_content_id: last.entry.uri }, ctx.stations());
        titleText = media.title;
        subText = media.subtitle;
        statusText = `${t("np_last")} · ${timeAgo(last.entry.at, { locale: ctx.locale })}`;
        nameText = nameOf(last.id, getState(last.id)?.attributes);
        pictureSrc = last.entry.art ? `./${last.entry.art}` : "";
      } else {
        view = { mode: "none", id: null, active: [], entry: null };
        titleText = t("np_nothing");
      }
    }

    const mode = view.mode;
    const live = mode === "playing" || mode === "paused";
    el.classList.toggle("is-playing", mode === "playing");
    el.classList.toggle("is-active", live);
    el.classList.toggle("is-last", mode === "last");
    el.classList.toggle("is-empty", mode === "none");
    el.classList.toggle("has-art", Boolean(pictureSrc));
    el.classList.toggle("is-unavailable", live && isUnavailable(getState(view.id)));
    art.style.backgroundImage = pictureSrc ? bg(pictureSrc) : "";

    chip.hidden = mode === "none";
    chipName.textContent = nameText;
    chipMore.textContent = more;
    chip.classList.toggle("is-switchable", view.active.length > 1);
    bars.style.display = playing ? "" : "none";
    status.textContent = statusText;
    title.textContent = titleText;
    sub.textContent = subText;

    prev.hidden = next.hidden = !live;
    prev.disabled = !supports(attrs, PREVIOUS_TRACK);
    next.disabled = !supports(attrs, NEXT_TRACK);
    play.hidden = mode === "none";
    setIcon(playIcon, playing ? "pause" : "play");

    const level = Number(attrs.volume_level);
    const showVolume = live && Number.isFinite(level) && cfg.volume !== false;
    volumeRow.classList.toggle("is-hidden", !showVolume);
    el.classList.toggle("no-volume", !showVolume);
    if (showVolume) {
      setIcon(volIcon, volumeIcon(level));
      if (Date.now() - touchedVolumeAt > 1200) volume.setValue(Math.round(level * 100));
    }
    paintProgress();
  }

  return {
    el,
    get entities() {
      return candidates();
    },
    update,
    destroy() {
      clearInterval(timer);
      sendVolume.cancel();
    },
  };
}
