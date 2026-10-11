import { getJson } from "../core/api.js";
import { h } from "../core/h.js";
import { icon } from "../core/icons.js";
import { createCard, createRow, sectionTitle } from "../components/cards.js";
import { errorNotice, loadingEl } from "./discover.js";

let lastQuery = ""; // the search survives switching tabs

const SECTIONS = [
  ["artists", "sec_artists", "cards"],
  ["albums", "sec_albums", "cards"],
  ["tracks", "sec_tracks", "rows"],
  ["playlists", "sec_playlists", "cards"],
  ["podcasts", "sec_podcasts", "cards"],
  ["radio", "sec_radio", "rows"],
];

/** Search over the library and the connected music services. */
export function createSearchView({ ctx, actions }) {
  const { t } = ctx;
  let timer;
  let generation = 0;
  const abort = new AbortController();

  const input = h("input", { class: "msearch__input", type: "search", placeholder: t("search_placeholder"), "aria-label": t("search_placeholder"), autocomplete: "off", enterkeyhint: "search", value: lastQuery });
  const results = h("div", { class: "msearch__results" });
  const el = h("div", { class: "view view--search" }, h("div", { class: "msearch" }, icon("magnify"), input), results);

  input.addEventListener("input", () => {
    clearTimeout(timer);
    timer = setTimeout(run, 400);
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      clearTimeout(timer);
      input.blur();
      run();
    }
  });

  async function run() {
    const query = input.value.trim();
    lastQuery = input.value;
    const mine = ++generation;
    if (query.length < 2) return results.replaceChildren(h("p", { class: "view__hint" }, t("search_hint")));
    results.replaceChildren(loadingEl(ctx));
    try {
      const groups = await getJson(`api/music/search?q=${encodeURIComponent(query)}`, { signal: abort.signal });
      if (mine !== generation) return;
      const sections = SECTIONS.filter(([key]) => groups[key]?.length).map(([key, label, kind]) =>
        h(
          "section",
          { class: "msection" },
          sectionTitle(t(label)),
          kind === "cards"
            ? h("div", { class: "hrow" }, groups[key].map((item) => createCard(item, { ctx, actions })))
            : h("div", { class: "mlist" }, groups[key].map((item) => createRow(item, { ctx, actions, showArt: true }))),
        ),
      );
      results.replaceChildren(...(sections.length ? sections : [h("div", { class: "notice" }, icon("magnify"), h("h2", null, t("no_results")))]));
    } catch (err) {
      if (err.name !== "AbortError" && mine === generation) results.replaceChildren(errorNotice(ctx, err.message, run));
    }
  }

  if (lastQuery.trim().length >= 2) run();
  else results.replaceChildren(h("p", { class: "view__hint" }, t("search_hint")));

  return {
    el,
    destroy() {
      abort.abort();
      clearTimeout(timer);
    },
  };
}
