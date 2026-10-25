import { pictureUrl } from "../core/api.js";
import { extractPalette } from "../lib/palette.js";
import { h } from "../core/h.js";
import { icon, setIcon } from "../core/icons.js";
import { createSlider } from "../core/slider.js";
import { isUnavailable } from "../lib/format.js";
import { chooseNowPlaying, clock, describeMedia, nextRepeat, screenDecision, trackPosition } from "../lib/nowplaying.js";
import { groupOf } from "../lib/radio.js";
import { throttle } from "../lib/throttle.js";
import { pressable } from "../tiles/common.js";

const SEEK = 2;
const PREVIOUS_TRACK = 16;
const NEXT_TRACK = 32;
const SHUFFLE_SET = 32768;
const REPEAT_SET = 262144;
const GRACE_MS = 15_000;
const STARTUP_MS = 3000;
const bg = (url) => `url("${String(url).replace(/"/g, "%22")}")`;
const supports = (attrs, flag) => attrs.supported_features == null || (Number(attrs.supported_features) & flag) !== 0;
const volumeIcon = (level) => (level === 0 ? "volume-off" : level < 0.34 ? "volume-low" : level < 0.67 ? "volume-medium" : "volume-high");

/**
 * Full-screen "now playing" view: big artwork, title, progress with seeking, transport controls, shuffle/repeat
 * and volume. It opens by itself when a music speaker starts playing, and by a tap on the now-playing tile.
 * `enabled()` says whether it may open by itself.
 */
export function createNowPlayingScreen(ctx, { enabled = () => true } = {}) {
  const { t, getState } = ctx;
  let isOpen = false;
  let dismissed = false;
  let prevMode = null;
  let current = null;
  let view = { id: null, mode: null, active: [] };
  let closeTimer = null;
  let touchedAt = 0;
  const readyAt = Date.now() + STARTUP_MS;

  const background = h("div", { class: "npscreen__bg" });
  // moving fields of the cover's colours on top of the blurred picture
  const fields = h("div", { class: "npscreen__fields" }, h("span", { class: "npscreen__field is-a" }), h("span", { class: "npscreen__field is-b" }), h("span", { class: "npscreen__field is-c" }));
  let paletteFor = null;
  const closeBtn = h("button", { class: "npscreen__icon", type: "button", "aria-label": t("close") }, icon("chevron-down"));
  const libraryBtn = h("button", { class: "npscreen__icon", type: "button", "aria-label": t("np_library") }, icon("music-box-multiple-outline"));
  const art = h("div", { class: "npscreen__art" }, icon("music"));
  const title = h("div", { class: "npscreen__title" });
  const line2 = h("div", { class: "npscreen__line" });
  const line3 = h("div", { class: "npscreen__line" });

  const sendSeek = (value) => view.id && ctx.call("media_player", "media_seek", view.id, { seek_position: value });
  const seekBar = createSlider({
    orientation: "horizontal",
    variant: "line",
    min: 0,
    max: 100,
    step: 1,
    value: 0,
    onInput: () => (touchedAt = Date.now()),
    onCommit: (v) => {
      touchedAt = Date.now();
      sendSeek(v);
    },
  });
  const elapsed = h("span");
  const remaining = h("span");
  const progress = h("div", { class: "npscreen__progress" }, seekBar.el, h("div", { class: "npscreen__times" }, elapsed, remaining));

  const shuffleIcon = icon("shuffle-variant");
  const shuffle = h("button", { class: "npscreen__btn", type: "button", "aria-label": "Shuffle" }, shuffleIcon);
  const prev = h("button", { class: "npscreen__btn", type: "button", "aria-label": "Previous" }, icon("skip-previous"));
  const playIcon = icon("play");
  const play = h("button", { class: "npscreen__play", type: "button", "aria-label": "Play/Pause" }, playIcon);
  const next = h("button", { class: "npscreen__btn", type: "button", "aria-label": "Next" }, icon("skip-next"));
  const repeatIcon = icon("repeat");
  const repeat = h("button", { class: "npscreen__btn", type: "button", "aria-label": "Repeat" }, repeatIcon);
  const controls = h("div", { class: "npscreen__controls" }, shuffle, prev, play, next, repeat);

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
      touchedAt = Date.now();
      sendVolume(v);
    },
    onCommit: (v) => {
      touchedAt = Date.now();
      sendVolume.cancel();
      if (view.id) ctx.call("media_player", "volume_set", view.id, { volume_level: v / 100 });
    },
  });
  const volumeRow = h("div", { class: "npscreen__volume" }, volIcon, volume.el);
  const speakerName = h("span");
  const speakerMore = h("span", { class: "npscreen__more" });
  const speaker = h("button", { class: "npscreen__speaker", type: "button" }, icon("speaker"), speakerName, speakerMore);

  const el = h(
    "div",
    { class: "npscreen", hidden: true, role: "dialog", "aria-label": t("np_playing") },
    background,
    fields,
    h("div", { class: "npscreen__top" }, closeBtn, libraryBtn),
    h("div", { class: "npscreen__main" }, art, h("div", { class: "npscreen__text" }, title, line2, line3)),
    h("div", { class: "npscreen__bottom" }, progress, controls, volumeRow, speaker),
  );

  // ---- actions ---------------------------------------------------------------------------
  pressable(closeBtn, { onTap: () => close({ dismiss: true }) });
  pressable(libraryBtn, {
    onTap: () => {
      close({ dismiss: true });
      ctx.navigate("music");
    },
  });
  pressable(play, { onTap: () => view.id && ctx.call("media_player", "media_play_pause", view.id) });
  pressable(prev, { onTap: () => view.id && ctx.call("media_player", "media_previous_track", view.id) });
  pressable(next, { onTap: () => view.id && ctx.call("media_player", "media_next_track", view.id) });
  pressable(shuffle, {
    onTap: () => view.id && ctx.call("media_player", "shuffle_set", view.id, { shuffle: !getState(view.id)?.attributes?.shuffle }),
  });
  pressable(repeat, {
    onTap: () => view.id && ctx.call("media_player", "repeat_set", view.id, { repeat: nextRepeat(getState(view.id)?.attributes?.repeat ?? "off") }),
  });
  pressable(speaker, {
    onTap: () => {
      if (view.active.length > 1) {
        current = view.active[(view.active.indexOf(view.id) + 1) % view.active.length];
        paint();
      }
    },
  });
  // The sliders must not be taken for taps on the background.
  for (const slider of [progress, volumeRow]) slider.addEventListener("pointerdown", (e) => e.stopPropagation());

  // ---- open / close ----------------------------------------------------------------------
  /** Opens the player; `preferId` (a speaker) is shown first when it is playing or paused. */
  function open(preferId = null) {
    if (preferId) {
      const leader = groupOf(preferId, getState).leader;
      current = getState(leader) ? leader : preferId;
    }
    if (isOpen) {
      paint();
      return true;
    }
    if (!choose()) return false;
    isOpen = true;
    clearTimeout(closeTimer);
    el.hidden = false;
    requestAnimationFrame(() => el.classList.add("is-open"));
    paint();
    return true;
  }

  function close({ dismiss = false } = {}) {
    if (!isOpen) return;
    isOpen = false;
    if (dismiss) dismissed = true;
    clearTimeout(closeTimer);
    el.classList.remove("is-open");
    setTimeout(() => {
      if (!isOpen) el.hidden = true;
    }, 350);
  }

  // ---- state -----------------------------------------------------------------------------
  function choose() {
    const choice = chooseNowPlaying({ ids: ctx.musicPlayers(), getState, current });
    if (choice) current = choice.id;
    else current = null;
    return choice;
  }

  function paintProgress() {
    const state = view.id ? getState(view.id) : null;
    const pos = state ? trackPosition(state.attributes, state.state) : null;
    progress.classList.toggle("is-hidden", !pos);
    if (!pos) return;
    if (Date.now() - touchedAt > 1500) seekBar.setRange?.(0, Math.round(pos.duration), 1);
    if (Date.now() - touchedAt > 1500) seekBar.setValue(Math.round(pos.position));
    elapsed.textContent = clock(pos.position);
    remaining.textContent = `-${clock(pos.duration - pos.position)}`;
  }
  const timer = setInterval(() => isOpen && paintProgress(), 500);

  function paint() {
    const choice = choose();
    if (!choice) {
      view = { id: null, mode: null, active: [] };
      return;
    }
    const state = getState(choice.id);
    const attrs = state?.attributes ?? {};
    const grp = groupOf(choice.id, getState);
    const media = describeMedia(attrs, ctx.stations());
    view = { id: choice.id, mode: choice.mode, active: choice.active };
    const playing = choice.mode === "playing";

    const picture = attrs.entity_picture ? pictureUrl(attrs.entity_picture) : media.station?.image ? `./${media.station.image}` : "";
    art.style.backgroundImage = picture ? bg(picture) : "";
    art.classList.toggle("has-art", Boolean(picture));
    background.style.backgroundImage = picture ? bg(picture) : "";
    if (picture !== paletteFor) {
      paletteFor = picture;
      extractPalette(picture).then((colors) => {
        if (paletteFor !== picture) return;
        const [a, b = a, c = b] = colors.length ? colors : ["var(--accent)"];
        el.style.setProperty("--np-a", a);
        el.style.setProperty("--np-b", b);
        el.style.setProperty("--np-c", c);
        el.classList.toggle("has-palette", colors.length > 0);
      });
    }
    title.textContent = media.title;
    const album = attrs.media_album_name && attrs.media_album_name !== media.title ? attrs.media_album_name : media.station && media.station.name !== media.title ? media.station.name : "";
    line2.textContent = album;
    line3.textContent = media.artist ?? "";
    line2.hidden = !album;
    line3.hidden = !media.artist;

    speakerName.textContent = attrs.friendly_name ?? choice.id.replace(/^media_player\./, "");
    speakerMore.textContent = grp.grouped ? `+${grp.members.length - 1}` : choice.active.length > 1 ? String(choice.active.length) : "";
    speaker.classList.toggle("is-switchable", choice.active.length > 1);

    setIcon(playIcon, playing ? "pause" : "play");
    prev.disabled = !supports(attrs, PREVIOUS_TRACK);
    next.disabled = !supports(attrs, NEXT_TRACK);
    shuffle.hidden = !supports(attrs, SHUFFLE_SET) || attrs.shuffle === undefined;
    shuffle.classList.toggle("is-on", Boolean(attrs.shuffle));
    const repeatMode = attrs.repeat ?? "off";
    repeat.hidden = !supports(attrs, REPEAT_SET) || attrs.repeat === undefined;
    repeat.classList.toggle("is-on", repeatMode !== "off");
    setIcon(repeatIcon, repeatMode === "one" ? "repeat-once" : repeatMode === "all" ? "repeat" : "repeat-off");
    seekBar.el.classList.toggle("is-locked", !supports(attrs, SEEK));
    seekBar.el.style.pointerEvents = supports(attrs, SEEK) ? "" : "none";

    const level = Number(attrs.volume_level);
    volumeRow.classList.toggle("is-hidden", !Number.isFinite(level));
    if (Number.isFinite(level)) {
      setIcon(volIcon, volumeIcon(level));
      if (Date.now() - touchedAt > 1200) volume.setValue(Math.round(level * 100));
    }
    el.classList.toggle("is-playing", playing);
    el.classList.toggle("is-unavailable", isUnavailable(state));
    paintProgress();
  }

  /** Called whenever entity states change. */
  function update() {
    const choice = chooseNowPlaying({ ids: ctx.musicPlayers(), getState, current });
    const mode = choice?.mode ?? null;
    const decision = screenDecision({ mode, prevMode, open: isOpen, dismissed, ready: Date.now() > readyAt, enabled: enabled() });
    dismissed = decision.dismissed;
    prevMode = mode;
    if (decision.shouldOpen) open();
    else if (isOpen) paint();
    if (decision.closeSoon) {
      if (!closeTimer) closeTimer = setTimeout(() => ((closeTimer = null), close()), GRACE_MS);
    } else if (closeTimer) {
      clearTimeout(closeTimer);
      closeTimer = null;
    }
  }

  return {
    el,
    open,
    close,
    update,
    get isOpen() {
      return isOpen;
    },
    destroy() {
      clearInterval(timer);
      clearTimeout(closeTimer);
      sendVolume.cancel();
      el.remove();
    },
  };
}
