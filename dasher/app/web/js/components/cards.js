import { h } from "../core/h.js";
import { icon } from "../core/icons.js";
import { format } from "../lib/i18n.js";
import { formatDuration, TAB_ICONS } from "../lib/music.js";
import { pressable } from "../tiles/common.js";

const FALLBACK_ICONS = {
  album: "album",
  artist: "account-music",
  track: "music-note",
  playlist: "playlist-music",
  podcast: "podcast",
  podcast_episode: "podcast",
  radio: "radio",
  audiobook: "book-open-variant",
};

/** Cover picture that falls back to a symbol when there is no image (or it fails to load). */
export function createArt(item, className) {
  const frame = h("div", { class: className }, h("span", { class: "art__fallback" }, icon(FALLBACK_ICONS[item.type] ?? "music")));
  if (item.image) {
    const img = h("img", { class: "art__img", src: `./${item.image}`, alt: "", loading: "lazy", decoding: "async", draggable: "false" });
    img.addEventListener("error", () => img.remove());
    frame.append(img);
  }
  return frame;
}

/**
 * Square (round for artists) card. Containers open on tap and play with the small play button;
 * single items (tracks, episodes, radio) play on tap.
 */
export function createCard(item, { ctx, actions }) {
  const art = createArt(item, "mcard__art");
  const children = [art, h("div", { class: "mcard__name", title: item.name }, item.name), h("div", { class: "mcard__sub" }, item.subtitle ?? "")];
  const el = h("div", { class: `mcard mcard--${item.type}`, role: "button", tabindex: "0", "aria-label": item.name }, children);

  if (item.container) {
    const playBtn = h("button", { class: "mcard__play", type: "button", "aria-label": `${ctx.t("play")}: ${item.name}` }, icon("play"));
    pressable(playBtn, { onTap: () => actions.play(item, el) });
    art.append(playBtn);
    pressable(el, { onTap: () => actions.open(item) });
  } else {
    pressable(el, { onTap: () => actions.play(item, el) });
  }
  el.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    e.preventDefault();
    if (item.container) actions.open(item);
    else actions.play(item, el);
  });
  return el;
}

/** One line of a track list or episode list. */
export function createRow(item, { ctx, actions, container = null, index = null, showArt = false }) {
  const { t } = ctx;
  const lead = showArt
    ? createArt(item, "mrow__art")
    : h("div", { class: "mrow__num" }, item.number ?? (index != null ? index + 1 : icon("music-note")));

  const meta = [];
  if (item.type === "podcast_episode") {
    if (item.date) meta.push(item.date);
    if (item.played) meta.push(t("played"));
    else if (item.resume) meta.push(format(t, "resume_at", { time: formatDuration(item.resume) }));
  } else if (item.subtitle) meta.push(item.subtitle);

  const queue = h("button", { class: "mrow__queue", type: "button", "aria-label": t("add_to_queue"), title: t("add_to_queue") }, icon("playlist-plus"));
  pressable(queue, { onTap: () => actions.queue(item) });

  const el = h(
    "div",
    { class: `mrow${item.played ? " is-played" : ""}`, role: "button", tabindex: "0", "aria-label": item.name },
    lead,
    h("div", { class: "mrow__text" }, h("div", { class: "mrow__title" }, item.name), meta.length ? h("div", { class: "mrow__meta" }, meta.join(" · ")) : null),
    item.duration ? h("div", { class: "mrow__time" }, formatDuration(item.duration)) : null,
    queue,
  );
  pressable(el, { onTap: () => actions.play(item, el, { container }) });
  el.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      actions.play(item, el, { container });
    }
  });
  return el;
}

/** Section heading with an optional icon. */
export function sectionTitle(text, tab) {
  return h("h2", { class: "msection__title" }, tab ? icon(TAB_ICONS[tab] ?? "music") : null, h("span", null, text));
}
