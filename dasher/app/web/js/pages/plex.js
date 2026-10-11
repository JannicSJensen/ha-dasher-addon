import { getJson, playPlex } from "../core/api.js";
import { h } from "../core/h.js";
import { icon } from "../core/icons.js";
import { openModal } from "../core/modal.js";
import { friendlyName, pressable } from "../tiles/common.js";
import { format } from "../lib/i18n.js";
import { WIDE_TYPES, choosePlayer, fromStart, rememberPlayer, rememberedPlayer } from "../lib/plex.js";

const PLATFORM_ICONS = { plex: "plex", cast: "cast", apple_tv: "apple", dlna_dmr: "television-play" };
const REFRESH_MS = 5 * 60_000;
const SECTION_KEYS = { continue: "plex_continue", recent_movies: "plex_recent_movies", recent_series: "plex_recent_series" };
const bg = (url) => `url("${String(url).replace(/"/g, "%22")}")`;

/** The Media page: continue watching and recently added movies and series from Plex, played on a Plex or Cast player. */
export function createPlexPage(model, ctx) {
  const { t, getState } = ctx;
  const ids = model.players ?? [];
  let player = choosePlayer(ids, getState, rememberedPlayer());
  let data = null;
  let error = null;
  let loading = true;
  let modal = null;
  let sheetChips = null;

  const nameOf = (id) => friendlyName(getState(id), id);
  const online = (id) => getState(id) && getState(id).state !== "unavailable";

  // ---- player chips (page and sheet) ---------------------------------------------------
  function createChips() {
    const wrap = h("div", { class: "pchips", role: "group", "aria-label": t("plex_play_on") });
    const paint = () => {
      wrap.replaceChildren(
        ...ids.map((id) => {
          const chip = h(
            "button",
            { class: `pchip${id === player ? " is-active" : ""}${online(id) ? "" : " is-offline"}`, type: "button", disabled: !online(id) },
            icon(PLATFORM_ICONS[model.platforms?.[id]] ?? "television-play"),
            h("span", null, nameOf(id)),
          );
          pressable(chip, {
            onTap: () => {
              if (!online(id)) return;
              player = id;
              rememberPlayer(id);
              paintAllChips();
            },
          });
          return chip;
        }),
      );
    };
    paint();
    return { el: wrap, paint };
  }

  const pageChips = createChips();
  const paintAllChips = () => {
    pageChips.paint();
    sheetChips?.paint();
  };

  // ---- cards ---------------------------------------------------------------------------
  function createCard(item) {
    const wide = WIDE_TYPES.has(item.type);
    const art = h("div", { class: "plcard__art" });
    if (item.image) art.style.backgroundImage = bg(`./${item.image}`);
    else art.append(icon("movie-open-outline"));
    const card = h(
      "button",
      { class: `plcard${wide ? " plcard--wide" : ""}`, type: "button" },
      art,
      h("div", { class: "plcard__title" }, item.title),
      item.subtitle ? h("div", { class: "plcard__sub" }, item.subtitle) : null,
      item.meta ? h("div", { class: "plcard__meta" }, item.meta) : null,
    );
    pressable(card, { onTap: () => openItem(item) });
    return card;
  }

  const rows = h("div", { class: "plrows" });
  const status = h("div", { class: "plstatus" });
  const el = h("div", { class: "plexpage" }, h("h1", { class: "radio__title" }, model.title ?? t("plex_media")), pageChips.el, status, rows);

  function render() {
    status.replaceChildren();
    if (loading && !data) status.append(h("p", { class: "view__hint" }, t("plex_loading")));
    else if (error && !data) status.append(h("div", { class: "notice" }, icon("alert-circle-outline"), h("p", null, error)));
    else if (!data?.sections.length) status.append(h("p", { class: "view__hint" }, t("plex_nothing")));
    rows.replaceChildren(
      ...(data?.sections ?? []).map((section) =>
        h(
          "section",
          { class: "plsection" },
          h("h2", { class: "plsection__title" }, t(SECTION_KEYS[section.kind] ?? section.kind)),
          h("div", { class: "plsection__list" }, section.items.map(createCard)),
        ),
      ),
    );
  }

  async function load() {
    try {
      data = await getJson("api/plex/home");
      error = null;
    } catch (err) {
      error = err.message;
    }
    loading = false;
    render();
  }

  // ---- item sheet ----------------------------------------------------------------------
  async function play(item) {
    if (!player) return ctx.toast(t("plex_no_player"));
    try {
      await playPlex(player, item);
      ctx.toast(format(t, "plex_playing", { title: item.title, player: nameOf(player) }));
      modal?.close();
    } catch (err) {
      ctx.toast(err.message);
    }
  }

  function openItem(item, parents = []) {
    modal?.close();
    const body = h("div", { class: "plexsheet" });
    const wide = WIDE_TYPES.has(item.type);
    const art = h("div", { class: `plexsheet__art${wide ? " is-wide" : ""}` });
    if (item.image) art.style.backgroundImage = bg(`./${item.image}`);
    const buttons = h("div", { class: "plexsheet__buttons" });
    const list = h("div", { class: "plexsheet__list" });
    sheetChips = createChips();

    const button = (label, iconName, onTap, primary = true) => {
      const b = h("button", { class: `btn${primary ? " btn--primary" : ""}`, type: "button" }, icon(iconName), h("span", null, label));
      pressable(b, { onTap });
      return b;
    };
    if (item.playable) {
      buttons.append(button(item.resume ? t("plex_resume") : t("plex_play"), "play", () => play(item)));
      if (item.resume) buttons.append(button(t("plex_start_over"), "restart", () => play(fromStart(item)), false));
    }

    const head = h(
      "div",
      { class: "plexsheet__head" },
      art,
      h(
        "div",
        { class: "plexsheet__text" },
        parents.length ? h("button", { class: "plexsheet__back", type: "button" }, icon("arrow-left"), h("span", null, parents.at(-1).title)) : null,
        h("div", { class: "modal__title" }, item.title),
        item.subtitle ? h("div", { class: "plexsheet__sub" }, item.subtitle) : null,
        item.meta ? h("div", { class: "plexsheet__meta" }, item.meta) : null,
      ),
    );
    if (parents.length) pressable(head.querySelector(".plexsheet__back"), { onTap: () => openItem(parents.at(-1), parents.slice(0, -1)) });

    body.append(head, h("div", { class: "picker__sub" }, t("plex_play_on")), sheetChips.el, buttons, list);

    if (item.expandable) {
      list.append(h("p", { class: "view__hint" }, t("plex_loading")));
      getJson(`api/plex/browse?${new URLSearchParams({ id: item.id, type: item.type })}`)
        .then((children) => {
          list.replaceChildren(
            ...children.items.map((child) => {
              const row = h(
                "div",
                { class: "plexrow" },
                h("div", { class: "plexrow__text" }, h("div", { class: "plexrow__title" }, [child.meta, child.title].filter(Boolean).join(" · ")), child.subtitle ? h("div", { class: "plexrow__sub" }, child.subtitle) : null),
                child.playable && !child.expandable ? button(t("plex_play"), "play", () => play(child)) : child.expandable ? h("span", { class: "plexrow__go" }, icon("chevron-right")) : null,
              );
              if (child.expandable) pressable(row, { onTap: () => openItem(child, [...parents, item]) });
              return row;
            }),
          );
          if (!children.items.length) list.append(h("p", { class: "view__hint" }, t("plex_nothing")));
        })
        .catch((err) => list.replaceChildren(h("p", { class: "view__hint" }, err.message)));
    }

    modal = openModal(body, {
      onClose: () => {
        sheetChips = null;
        modal = null;
      },
    });
  }

  load();
  const timer = setInterval(load, REFRESH_MS);

  return {
    el,
    entities: ids,
    update() {
      const next = choosePlayer(ids, getState, player);
      if (next !== player && !online(player)) player = next;
      paintAllChips();
    },
    destroy() {
      clearInterval(timer);
      modal?.close();
    },
  };
}
