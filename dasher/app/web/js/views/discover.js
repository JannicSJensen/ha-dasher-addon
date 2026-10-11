import { getJson } from "../core/api.js";
import { h } from "../core/h.js";
import { icon } from "../core/icons.js";
import { createCard } from "../components/cards.js";

/** Notice with a retry button, used by every view that loads from Music Assistant. */
export function errorNotice(ctx, message, retry) {
  const button = h("button", { class: "notice__btn", type: "button" }, ctx.t("retry"));
  button.addEventListener("click", retry);
  return h("div", { class: "notice" }, icon("alert-circle-outline"), h("h2", null, ctx.t("library_error")), h("p", null, message), button);
}

export const loadingEl = (ctx) => h("div", { class: "view__loading" }, h("span", { class: "spinner" }), h("span", null, ctx.t("loading")));

/** Rows of recommendations, like the Explore page of Music Assistant. */
export function createDiscoverView({ ctx, actions }) {
  const el = h("div", { class: "view view--discover" });
  const abort = new AbortController();

  async function load() {
    el.replaceChildren(loadingEl(ctx));
    try {
      const { rows } = await getJson("api/music/discover", { signal: abort.signal });
      if (!rows.length) return el.replaceChildren(h("div", { class: "notice" }, icon("compass-outline"), h("h2", null, ctx.t("nothing_here"))));
      el.replaceChildren(
        ...rows.map((row) =>
          h(
            "section",
            { class: "msection" },
            h("h2", { class: "msection__title" }, h("span", null, row.name)),
            row.subtitle ? h("p", { class: "msection__sub" }, row.subtitle) : null,
            h("div", { class: "hrow" }, row.items.map((item) => createCard(item, { ctx, actions }))),
          ),
        ),
      );
    } catch (err) {
      if (err.name !== "AbortError") el.replaceChildren(errorNotice(ctx, err.message, load));
    }
  }

  load();
  return { el, destroy: () => abort.abort() };
}
