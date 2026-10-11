import { getJson } from "../core/api.js";
import { h } from "../core/h.js";
import { icon } from "../core/icons.js";
import { createArt, createCard, createRow, sectionTitle } from "../components/cards.js";
import { format } from "../lib/i18n.js";
import { formatTotal } from "../lib/music.js";
import { pressable } from "../tiles/common.js";
import { errorNotice, loadingEl } from "./discover.js";

const SECTION_LABELS = { tracks: "sec_tracks", albums: "sec_albums", episodes: "sec_episodes" };

/** An album, artist, podcast or playlist with its tracks, albums or episodes. */
export function createDetailView({ item, ctx, actions }) {
  const { t } = ctx;
  const abort = new AbortController();
  const body = h("div", { class: "detail__body" });
  const back = h("button", { class: "area__back detail__back", type: "button", "aria-label": t("back") }, icon("chevron-left"), h("span", null, t("back")));
  pressable(back, { onTap: () => actions.back() });
  const el = h("div", { class: "view view--detail" }, back, body);

  async function load() {
    body.replaceChildren(loadingEl(ctx));
    try {
      const data = await getJson(`api/music/item?${new URLSearchParams({ type: item.type, provider: item.provider, id: item.id })}`, { signal: abort.signal });
      render(data);
    } catch (err) {
      if (err.name !== "AbortError") body.replaceChildren(errorNotice(ctx, err.message, load));
    }
  }

  function render({ item: info, sections }) {
    const header = { ...item, ...info };
    const tracks = sections.find((s) => s.name === "tracks")?.items ?? [];
    const episodes = sections.find((s) => s.name === "episodes")?.items ?? [];
    const meta = [];
    if (header.type === "podcast" && header.subtitle) meta.push(header.subtitle);
    if (tracks.length && header.type !== "artist") {
      meta.push(format(t, "n_tracks", { n: tracks.length }));
      const total = tracks.reduce((sum, track) => sum + (track.duration ?? 0), 0);
      if (total) meta.push(formatTotal(total));
    }
    if (episodes.length) meta.push(format(t, "n_episodes", { n: header.total ?? episodes.length }));

    const playBtn = h("button", { class: "btn btn--primary", type: "button" }, icon("play"), h("span", null, t("play")));
    pressable(playBtn, { onTap: () => actions.play(header, playBtn) });
    const queueBtn = h("button", { class: "btn", type: "button" }, icon("playlist-plus"), h("span", null, t("add_to_queue")));
    pressable(queueBtn, { onTap: () => actions.queue(header) });

    const top = h(
      "div",
      { class: `detail__top detail__top--${header.type}` },
      createArt(header, "detail__art"),
      h(
        "div",
        { class: "detail__info" },
        h("h1", { class: "detail__title" }, header.name),
        header.type !== "podcast" && header.subtitle ? h("div", { class: "detail__sub" }, header.subtitle) : null,
        meta.length ? h("div", { class: "detail__meta" }, meta.join(" · ")) : null,
        header.description ? h("p", { class: "detail__desc" }, header.description) : null,
        h("div", { class: "detail__actions" }, playBtn, header.type === "artist" ? null : queueBtn),
      ),
    );

    const lists = sections.map((section) => {
      const title = sectionTitle(t(SECTION_LABELS[section.name] ?? "sec_tracks"));
      if (section.name === "albums") {
        return h("section", { class: "msection" }, title, h("div", { class: "hrow" }, section.items.map((it) => createCard(it, { ctx, actions }))));
      }
      const container = ["album", "playlist", "podcast"].includes(header.type) ? header : null;
      // Inside an album the artist is already in the header, so only show it when it differs.
      const lead = (header.subtitle ?? "").split(" · ")[0];
      const items = header.type === "album" ? section.items.map((it) => (it.subtitle?.split(" · ")[0] === lead ? { ...it, subtitle: "" } : { ...it, subtitle: it.subtitle?.split(" · ")[0] ?? "" })) : section.items;
      const rows = items.map((it, index) => createRow(it, { ctx, actions, container, index, showArt: header.type === "artist" || header.type === "playlist" }));
      return h("section", { class: "msection" }, title, h("div", { class: "mlist" }, rows));
    });
    body.replaceChildren(top, ...lists);
  }

  load();
  return { el, destroy: () => abort.abort() };
}
