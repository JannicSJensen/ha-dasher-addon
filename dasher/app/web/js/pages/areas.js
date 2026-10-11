import { assetUrl, pictureUrl } from "../core/api.js";
import { h } from "../core/h.js";
import { icon } from "../core/icons.js";
import { areaIcon, lightsOn } from "../lib/areas.js";
import { format } from "../lib/i18n.js";
import { pressable } from "../tiles/common.js";

/** Picture of an area: file from the assets folder, else the picture set in Home Assistant. */
export function areaImageUrl(area) {
  if (area.image) return assetUrl(area.image);
  if (area.picture) return pictureUrl(area.picture);
  return "";
}

function createAreaCard(area, ctx) {
  const url = areaImageUrl(area);
  const layer = h("div", { class: "photo__img" });
  if (url) layer.style.backgroundImage = `url("${url.replace(/"/g, "%22")}")`;

  const caption = h("div", { class: "photo__status" });
  const el = h(
    "div",
    { class: "tile tile--photo tile--area", role: "link", tabindex: "0", "aria-label": area.name },
    url ? layer : h("div", { class: "photo__fallback" }, icon(areaIcon(area))),
    h("div", { class: "photo__shade" }),
    h("div", { class: "photo__text" }, caption, h("div", { class: "photo__name" }, area.name), h("div", { class: "photo__rule" })),
  );
  pressable(el, { onTap: () => ctx.navigate(`area/${encodeURIComponent(area.id)}`) });
  el.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") ctx.navigate(`area/${encodeURIComponent(area.id)}`);
  });

  return {
    el,
    update() {
      const on = lightsOn(area, ctx.getState);
      const text = on === 0 ? (area.floor ?? "") : on === 1 ? ctx.t("one_light_on") : format(ctx.t, "lights_on", { n: on });
      caption.textContent = text;
      el.classList.toggle("is-on", on > 0);
    },
  };
}

/** Overview of every area as a grid of clickable pictures. */
export function createAreasPage(model, ctx) {
  const cards = model.areas.map((area) => createAreaCard(area, ctx));
  const el = h(
    "div",
    { class: "areas" },
    h("h1", { class: "radio__title areas__title" }, model.title ?? ctx.t("areas")),
    cards.length
      ? h("div", { class: "areas__grid" }, cards.map((c) => c.el))
      : h("div", { class: "notice" }, icon("floor-plan"), h("h2", null, ctx.t("no_areas")), h("p", null, ctx.t("no_areas_hint"))),
  );
  return {
    el,
    entities: [...new Set(model.areas.flatMap((a) => a.entities))],
    update: () => cards.forEach((c) => c.update()),
  };
}
