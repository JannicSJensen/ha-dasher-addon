import { assetUrl, pictureUrl } from "../core/api.js";
import { h } from "../core/h.js";
import { icon } from "../core/icons.js";
import { formatNumber } from "../lib/format.js";
import { areaIcon, lightsOn } from "../lib/areas.js";
import { format } from "../lib/i18n.js";
import { pressable } from "../tiles/common.js";

/** Picture of an area: file from the assets folder, else the picture set in Home Assistant, else the built-in room picture. */
export function areaImageUrl(area) {
  if (area.image) return assetUrl(area.image);
  if (area.picture) return pictureUrl(area.picture);
  if (area.default_image) return `./${area.default_image}`;
  return "";
}

/** True when the picture is one of the built-in room pictures (they are drawn dark already). */
export const isBuiltinImage = (area) => Boolean(area.builtin_picture) || (!area.image && !area.picture && Boolean(area.default_image));

function createAreaCard(area, ctx) {
  const url = areaImageUrl(area);
  const layer = h("div", { class: "photo__img" });
  if (url) layer.style.backgroundImage = `url("${url.replace(/"/g, "%22")}")`;

  const caption = h("div", { class: "photo__status" });
  const chips = h("div", { class: "photo__chips" });
  const el = h(
    "div",
    { class: `tile tile--photo tile--area${isBuiltinImage(area) ? " is-builtin" : ""}`, role: "link", tabindex: "0", "aria-label": area.name },
    url ? layer : h("div", { class: "photo__fallback" }, icon(areaIcon(area))),
    h("div", { class: "photo__shade" }),
    chips,
    h("div", { class: "photo__text" }, caption, h("div", { class: "photo__name" }, area.name), h("div", { class: "photo__rule" })),
  );
  pressable(el, { onTap: () => ctx.navigate(`area/${encodeURIComponent(area.id)}`) });
  el.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") ctx.navigate(`area/${encodeURIComponent(area.id)}`);
  });

  // small status chips in the corner: temperature, open windows, music playing
  function paintChips() {
    const temps = (area.temperature ?? []).map((id) => Number(ctx.getState(id)?.state)).filter(Number.isFinite);
    const open = (area.windows ?? []).filter((id) => ctx.getState(id)?.state === "on").length;
    const playing = area.entities.some((id) => id.startsWith("media_player.") && ctx.getState(id)?.state === "playing");
    const parts = [];
    if (temps.length) parts.push(h("span", { class: "photo__chip" }, `${formatNumber(temps.reduce((a, b) => a + b, 0) / temps.length, { locale: ctx.locale, decimals: 1 })}°`));
    if (open) parts.push(h("span", { class: "photo__chip is-alert", title: ctx.t("windows") }, icon("window-open-variant")));
    if (playing) parts.push(h("span", { class: "photo__chip is-accent", title: ctx.t("np_playing") }, icon("music")));
    const signature = parts.map((p) => p.textContent + p.className).join("|") + parts.length;
    if (chips.dataset.sig === signature) return;
    chips.dataset.sig = signature;
    chips.replaceChildren(...parts);
  }

  return {
    el,
    update() {
      const on = lightsOn(area, ctx.getState);
      const text = on === 0 ? (area.floor ?? "") : on === 1 ? ctx.t("one_light_on") : format(ctx.t, "lights_on", { n: on });
      caption.textContent = text;
      el.classList.toggle("is-on", on > 0);
      paintChips();
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
    entities: [...new Set(model.areas.flatMap((a) => [...a.entities, ...(a.temperature ?? []), ...(a.windows ?? [])]))],
    update: () => cards.forEach((c) => c.update()),
  };
}
