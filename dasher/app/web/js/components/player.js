import { pictureUrl } from "../core/api.js";
import { h } from "../core/h.js";
import { icon, setIcon } from "../core/icons.js";
import { getPref, setPref } from "../core/prefs.js";
import { createSlider } from "../core/slider.js";
import { isUnavailable } from "../lib/format.js";
import { format, translateState } from "../lib/i18n.js";
import { canGroup, groupOf, pickPlayer } from "../lib/radio.js";
import { throttle } from "../lib/throttle.js";
import { pressable } from "../tiles/common.js";

const PREF_PLAYER = "radio.player";
const PENDING_MS = 10_000;
const BUSY_MS = 8_000;
const bg = (url) => `url("${String(url).replace(/"/g, "%22")}")`;
const volumeIcon = (level) => (level === 0 ? "volume-off" : level < 0.34 ? "volume-low" : level < 0.67 ? "volume-medium" : "volume-high");
const mediaKey = (state) => `${state?.state}|${state?.attributes?.media_content_id}|${state?.attributes?.media_title}`;

/**
 * Everything about the speakers, shared by all tabs of the music page: the speaker buttons with
 * sync-group editing, the title bar and the "now playing" bar with play/pause and volume.
 *
 * Views ask `target()` which speaker to play on (the group leader) and `player()` for its state,
 * and call `setPending()` to show that something is starting.
 */
export function createPlayerPanel({ model, ctx }) {
  const { t, getState } = ctx;
  const players = model.players;
  let selected = pickPlayer({ players, getState, saved: getPref(PREF_PLAYER), defaultPlayer: model.default_player });
  let pending = null; // { name, image, key, timer }
  let touchedVolumeAt = 0;
  let groupMode = false;
  const busy = new Map(); // speaker id -> { want: boolean (member afterwards), timer }

  const nameOf = (id) => getState(id)?.attributes?.friendly_name ?? id.replace(/^media_player\./, "");

  // ---- speakers --------------------------------------------------------------
  const chips = players.map((id) => {
    const status = h("span", { class: "speaker__status" });
    const label = h("span", { class: "speaker__name" });
    const bars = h("span", { class: "eq", "aria-hidden": "true" }, h("i"), h("i"), h("i"));
    const check = h("span", { class: "speaker__check", "aria-hidden": "true" }, icon("check"));
    const link = h("span", { class: "speaker__link", "aria-hidden": "true" }, icon("link-variant"));
    const el = h("button", { class: "speaker", type: "button", "aria-pressed": "false" }, icon("speaker"), check, h("span", { class: "speaker__text" }, label, status), link, bars);
    pressable(el, { onTap: () => (groupMode ? toggleMember(id) : select(id)) });
    return { id, el, label, status };
  });
  const speakers = players.length
    ? h("div", { class: "radio__speakers", role: "group", "aria-label": t("speakers") }, chips.map((c) => c.el))
    : h("div", { class: "radio__nospeakers" }, t("no_speakers"));

  // ---- group controls ----------------------------------------------------------
  const groupCount = h("span", { class: "groupbtn__count" });
  const groupBtn = h("button", { class: "groupbtn", type: "button", "aria-pressed": "false" }, icon("speaker-multiple"), h("span", null, t("group")), groupCount);
  pressable(groupBtn, { onTap: () => ((groupMode = !groupMode), update()) });
  const hintText = h("span", { class: "grouphint__text" });
  const ungroupBtn = h("button", { class: "grouphint__btn", type: "button" }, icon("link-variant-off"), h("span", null, t("ungroup_all")));
  pressable(ungroupBtn, { onTap: () => ungroupAll() });
  const hint = h("div", { class: "grouphint", hidden: true }, hintText, ungroupBtn);

  const head = h(
    "header",
    { class: "music__head" },
    h("div", { class: "radio__titlebar" }, h("h1", { class: "radio__title" }, model.title ?? t("music")), players.length ? groupBtn : null),
    speakers,
    hint,
  );

  // ---- now playing bar ------------------------------------------------------
  const art = h("div", { class: "np__art" }, h("span", { class: "np__expand" }, icon("arrow-expand")));
  const title = h("div", { class: "np__title" });
  const sub = h("div", { class: "np__sub" });
  // The picture and the title open the full-screen player (again, if it was closed).
  const openFull = () => {
    if (!bar.classList.contains("is-openable")) return;
    ctx.openNowPlaying?.(selected ?? target());
  };
  const playIcon = icon("play");
  const play = h("button", { class: "np__play", type: "button", "aria-label": "Play/Pause" }, playIcon);
  pressable(play, { onTap: () => target() && ctx.call("media_player", "media_play_pause", target()) });

  const volIcon = icon("volume-medium");
  const volValue = h("span", { class: "np__volvalue" });
  const sendVolume = throttle((v) => selected && ctx.call("media_player", "volume_set", selected, { volume_level: v / 100 }), 250);
  const volume = createSlider({
    orientation: "horizontal",
    min: 0,
    max: 100,
    step: 1,
    value: 0,
    onInput: (v) => {
      touchedVolumeAt = Date.now();
      volValue.textContent = `${v}%`;
      sendVolume(v);
    },
    onCommit: (v) => {
      touchedVolumeAt = Date.now();
      sendVolume.cancel();
      if (selected) ctx.call("media_player", "volume_set", selected, { volume_level: v / 100 });
    },
  });
  const textBox = h("div", { class: "np__text" }, title, sub);
  const bar = h(
    "footer",
    { class: "np" },
    art,
    textBox,
    play,
    h("div", { class: "np__volume", title: t("volume") }, volIcon, h("div", { class: "np__slider" }, volume.el), volValue),
  );

  pressable(art, { onTap: openFull });
  pressable(textBox, { onTap: openFull });

  // ---- selection and groups --------------------------------------------------------
  function select(id) {
    selected = id;
    setPref(PREF_PLAYER, id);
    update();
  }

  /** Playback is controlled through the group leader; the others follow it. */
  function target() {
    return selected ? groupOf(selected, getState).leader : null;
  }

  const player = () => (target() ? getState(target()) : null);

  function markBusy(ids, want) {
    for (const id of ids) {
      clearTimeout(busy.get(id)?.timer);
      busy.set(id, { want, timer: setTimeout(() => (busy.delete(id), update()), BUSY_MS) });
    }
  }
  function clearBusy(ids) {
    for (const id of ids) {
      clearTimeout(busy.get(id)?.timer);
      busy.delete(id);
    }
  }

  async function changeGroup(leader, change) {
    const ids = [...(change.add ?? []), ...(change.remove ?? [])];
    markBusy(change.add ?? [], true);
    markBusy(change.remove ?? [], false);
    update();
    const ok = await ctx.groupRadio(leader, change);
    if (!ok) {
      clearBusy(ids);
      update();
    }
  }

  function toggleMember(id) {
    if (!selected) return;
    const grp = groupOf(selected, getState);
    if (id === grp.leader) return;
    if (!canGroup(getState(grp.leader)) || !canGroup(getState(id))) return ctx.toast(t("group_unsupported"));
    return changeGroup(grp.leader, grp.members.includes(id) ? { remove: [id] } : { add: [id] });
  }

  function ungroupAll() {
    if (!selected) return;
    const grp = groupOf(selected, getState);
    const others = grp.members.filter((m) => m !== grp.leader);
    if (others.length) changeGroup(grp.leader, { remove: others });
  }

  // ---- "starting ..." feedback ------------------------------------------------------
  /** Show `name` in the bar until the speaker reports new media (or a timeout). */
  function setPending({ name, image }) {
    clearTimeout(pending?.timer);
    pending = { name, image, key: mediaKey(player()), timer: setTimeout(() => ((pending = null), update()), PENDING_MS) };
    update();
  }
  function clearPending() {
    clearTimeout(pending?.timer);
    pending = null;
    update();
  }

  // ---- rendering --------------------------------------------------------------------
  function update() {
    // Re-pick when the chosen speaker has disappeared.
    if (!selected || isUnavailable(getState(selected))) {
      selected = pickPlayer({ players, getState, saved: selected, defaultPlayer: model.default_player }) ?? selected;
    }
    const grp = selected ? groupOf(selected, getState) : { leader: null, members: [], grouped: false };
    const control = grp.leader;
    const leader = control ? getState(control) : null; // media info and transport come from the leader
    const own = selected ? getState(selected) : null; // volume belongs to the chosen speaker
    const groupable = canGroup(getState(control));
    if (groupMode && !groupable) groupMode = false;
    for (const [id, entry] of busy) if (entry.want === grp.members.includes(id)) clearBusy([id]);
    if (pending && mediaKey(leader) !== pending.key && ["playing", "buffering"].includes(leader?.state)) {
      clearTimeout(pending.timer);
      pending = null;
    }

    for (const chip of chips) {
      const state = getState(chip.id);
      const gone = isUnavailable(state);
      const member = grp.grouped && grp.members.includes(chip.id);
      chip.el.hidden = gone && chip.id !== selected && !member;
      chip.el.classList.toggle("is-selected", chip.id === selected);
      chip.el.classList.toggle("is-playing", state?.state === "playing");
      chip.el.classList.toggle("is-member", member);
      chip.el.classList.toggle("is-leader", member && chip.id === grp.leader);
      chip.el.classList.toggle("is-busy", busy.has(chip.id));
      chip.el.classList.toggle("is-nogroup", groupMode && chip.id !== control && !canGroup(state));
      chip.el.classList.toggle("is-locked", groupMode && chip.id === control);
      chip.el.setAttribute("aria-pressed", String(groupMode ? member || chip.id === control : chip.id === selected));
      chip.label.textContent = nameOf(chip.id);
      chip.status.textContent = !state
        ? ""
        : member
          ? chip.id === grp.leader ? t("group_leader") : t("in_group")
          : groupMode && !canGroup(state) ? t("group_unsupported") : translateState(t, state.state);
    }
    head.classList.toggle("is-grouping", groupMode);
    groupBtn.classList.toggle("is-active", groupMode);
    groupBtn.setAttribute("aria-pressed", String(groupMode));
    groupBtn.disabled = !groupable;
    groupCount.textContent = grp.grouped ? String(grp.members.length) : "";
    hint.hidden = !groupMode;
    hintText.textContent = format(t, "group_hint", { name: control ? nameOf(control) : "" });
    ungroupBtn.hidden = !grp.grouped;

    // Now playing bar
    const attrs = leader?.attributes ?? {};
    const playing = leader?.state === "playing";
    const idle = !leader || !["playing", "paused", "buffering"].includes(leader.state);
    const showPending = Boolean(pending);
    const picture = showPending ? pending.image : attrs.entity_picture ? pictureUrl(attrs.entity_picture) : "";
    art.style.backgroundImage = picture ? bg(picture) : "";
    art.classList.toggle("has-art", Boolean(picture));
    title.textContent = showPending ? pending.name : idle ? t("nothing_playing") : (attrs.media_title ?? "");
    const where = !control ? null : grp.grouped ? format(t, "on_group", { name: nameOf(control), n: grp.members.length - 1 }) : format(t, "on_speaker", { name: nameOf(control) });
    const lead = showPending || idle ? null : (attrs.media_artist ?? attrs.media_album_name ?? null);
    sub.textContent = [lead, where].filter(Boolean).join(" · ");
    setIcon(playIcon, playing ? "pause" : "play");
    play.disabled = (idle && !showPending) || !control;
    bar.classList.toggle("is-openable", !idle && !showPending);

    const level = Number(own?.attributes?.volume_level);
    const hasVolume = Number.isFinite(level);
    bar.classList.toggle("no-volume", !hasVolume);
    if (hasVolume) {
      setIcon(volIcon, volumeIcon(level));
      if (Date.now() - touchedVolumeAt > 1200) {
        volume.setValue(Math.round(level * 100));
        volValue.textContent = `${Math.round(level * 100)}%`;
      }
    }
  }

  return {
    head,
    bar,
    update,
    target,
    player,
    setPending,
    clearPending,
    nameOf,
    destroy() {
      clearTimeout(pending?.timer);
      clearBusy([...busy.keys()]);
      sendVolume.cancel();
    },
  };
}
