import { h } from "../core/h.js";
import { icon } from "../core/icons.js";
import { areaIcon, areaStats, cropFor, visibleAreaEntities } from "../lib/areas.js";
import { formatNumber } from "../lib/format.js";
import { format } from "../lib/i18n.js";
import { createToggleTile } from "../tiles/toggle.js";
import { areaImageUrl } from "./areas.js";

function stat(label) {
  const value = h("div", { class: "stat__value" });
  return { el: h("div", { class: "stat", hidden: true }, h("div", { class: "stat__label" }, label), value), value };
}

/** One area: big picture with title and key figures, and the area's devices below. */
export function createAreaPage(area, ctx) {
  const url = areaImageUrl(area);
  const bg = h("div", { class: "area__bg" });
  if (url) bg.style.backgroundImage = `url("${url.replace(/"/g, "%22")}")`;

  const temperature = stat(ctx.t("temperature"));
  const humidity = stat(ctx.t("humidity"));
  const windows = stat(ctx.t("windows"));
  const grid = h("section", { class: "area__tiles" });

  const back = h("a", { class: "area__back", href: "#/areas", "aria-label": ctx.t("back") }, icon("chevron-left"), h("span", null, ctx.t("areas")));
  const more = h("button", { class: "area__more", type: "button", "aria-label": ctx.t("scroll_down") }, icon("chevron-down"));
  more.addEventListener("click", () => grid.scrollIntoView({ behavior: "smooth", block: "start" }));

  const hero = h(
    "section",
    { class: "area__hero" },
    bg,
    url ? null : h("div", { class: "area__glyph" }, icon(areaIcon(area))),
    h("div", { class: "area__shade" }),
    back,
    h(
      "div",
      { class: "area__titleblock" },
      h("h1", { class: "area__title" }, area.name),
      h("div", { class: "area__stats" }, temperature.el, humidity.el, windows.el),
    ),
    area.entities.length ? more : null,
  );
  const el = h("div", { class: "area" }, hero, grid);

  let children = [];
  let shownKey = null;

  const buildTiles = (ids) => {
    for (const child of children) child.destroy?.();
    children = ids.map((id, index) => {
      const own = area.entity_images?.[id];
      const tile = createToggleTile(
        {
          type: "toggle",
          entity: id,
          layout: "photo",
          ...(own
            ? { image: own }
            : url
              ? { image: area.image ?? url, zoom: 1.7, image_position: cropFor(index) }
              : {}),
        },
        ctx,
      );
      return tile;
    });
    grid.replaceChildren(...children.map((c) => c.el));
    grid.hidden = children.length === 0;
  };

  const fmtStat = (target, data, decimals) => {
    target.el.hidden = !data;
    if (data) target.value.textContent = `${formatNumber(data.value, { locale: ctx.locale, decimals })}${data.unit === "%" ? "%" : (data.unit ?? "")}`;
  };

  return {
    el,
    entities: [...area.entities, ...area.temperature, ...area.humidity, ...area.windows],
    update() {
      const ids = visibleAreaEntities(area, ctx.getState);
      const key = ids.join("|");
      if (key !== shownKey) {
        shownKey = key;
        buildTiles(ids);
      }
      children.forEach((c) => c.update());

      const stats = areaStats(area, ctx.getState);
      fmtStat(temperature, stats.temperature, 1);
      fmtStat(humidity, stats.humidity, 0);
      windows.el.hidden = !stats.windows;
      if (stats.windows) {
        windows.value.textContent = stats.windows.open === 0 ? ctx.t("closed") : format(ctx.t, "n_open", { n: stats.windows.open });
      }
    },
    destroy: () => children.forEach((c) => c.destroy?.()),
  };
}
