import { getJson } from "../core/api.js";
import { h } from "../core/h.js";
import { icon } from "../core/icons.js";
import { createCard } from "../components/cards.js";
import { pressable } from "../tiles/common.js";
import { errorNotice, loadingEl } from "./discover.js";

const PAGE = 60;
const SORTS = [
  ["name", "sort_name"],
  ["new", "sort_new"],
  ["random", "sort_random"],
];

/** Albums, artists, podcasts or playlists of the library: sort, favourites, filter, endless scrolling. */
export function createLibraryView({ tab, ctx, actions, scroller }) {
  const { t } = ctx;
  let sort = "name";
  let favorite = false;
  let query = "";
  let offset = 0;
  let more = true;
  let loading = false;
  let generation = 0;
  let timer;
  const abort = new AbortController();

  const grid = h("div", { class: `mgrid mgrid--${tab}` });
  const status = h("div", { class: "view__status" });
  const moreBtn = h("button", { class: "notice__btn", type: "button", hidden: true }, t("load_more"));
  moreBtn.addEventListener("click", () => load(false));

  const sortChips = SORTS.map(([key, label]) => {
    const chip = h("button", { class: "chip-toggle", type: "button" }, t(label));
    pressable(chip, { onTap: () => ((sort = key), refresh()) });
    return { key, chip };
  });
  const favBtn = h("button", { class: "chip-toggle", type: "button" }, icon("heart"), h("span", null, t("favorites")));
  pressable(favBtn, { onTap: () => ((favorite = !favorite), refresh()) });
  const input = h("input", { class: "mfilter", type: "search", placeholder: t("filter_placeholder"), "aria-label": t("filter_placeholder"), autocomplete: "off", enterkeyhint: "search" });
  input.addEventListener("input", () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      query = input.value.trim();
      refresh();
    }, 350);
  });

  const controls = h("div", { class: "controls" }, h("div", { class: "controls__chips" }, sortChips.map((c) => c.chip), favBtn), input);
  const el = h("div", { class: "view view--library" }, controls, grid, status, moreBtn);

  function paintControls() {
    for (const { key, chip } of sortChips) chip.classList.toggle("is-active", key === sort);
    favBtn.classList.toggle("is-active", favorite);
  }

  function refresh() {
    paintControls();
    load(true);
  }

  async function load(reset) {
    if (loading && !reset) return;
    if (reset) {
      generation += 1;
      offset = 0;
      more = true;
      grid.replaceChildren();
    }
    const mine = generation;
    loading = true;
    moreBtn.hidden = true;
    status.replaceChildren(loadingEl(ctx));
    try {
      const params = new URLSearchParams({ tab, limit: String(PAGE), offset: String(offset), sort });
      if (query) params.set("q", query);
      if (favorite) params.set("fav", "1");
      const result = await getJson(`api/music/library?${params}`, { signal: abort.signal });
      if (mine !== generation) return; // a newer request replaced this one
      grid.append(...result.items.map((item) => createCard(item, { ctx, actions })));
      offset += result.items.length;
      more = result.more && result.items.length > 0;
      status.replaceChildren(!grid.childElementCount ? h("div", { class: "notice" }, icon("magnify"), h("h2", null, t(query || favorite ? "no_results" : "nothing_here"))) : "");
    } catch (err) {
      if (err.name === "AbortError" || mine !== generation) return;
      status.replaceChildren(errorNotice(ctx, err.message, () => load(reset)));
    } finally {
      if (mine === generation) {
        loading = false;
        moreBtn.hidden = !more;
        watchEnd();
      }
    }
  }

  // Load the next page when the end of the list scrolls into view.
  let observer = null;
  function watchEnd() {
    observer?.disconnect();
    if (!more || typeof IntersectionObserver === "undefined") return;
    observer = new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && load(false), { root: scroller, rootMargin: "300px" });
    observer.observe(moreBtn);
  }

  paintControls();
  load(true);
  return {
    el,
    destroy() {
      abort.abort();
      observer?.disconnect();
      clearTimeout(timer);
    },
  };
}
