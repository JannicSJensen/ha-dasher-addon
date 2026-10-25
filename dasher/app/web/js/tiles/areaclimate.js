import { h } from "../core/h.js";
import { assetUrl } from "../core/api.js";
import { icon } from "../core/icons.js";
import { climateStatus, powerCall, stepTarget } from "../lib/climate.js";
import { formatNumber } from "../lib/format.js";
import { translateState } from "../lib/i18n.js";
import { friendlyName, pressable } from "./common.js";

const SEND_DELAY_MS = 600;
const GLOW = { heating: "#ff8a3d", cooling: "#4fc3f7" };

/**
 * A thermostat as a picture tile for the area pages, like the light tiles: the status and name over the picture,
 * a tap switches it on or off, and − / + on the right change the setpoint.
 */
export function createAreaClimateTile(cfg, ctx) {
  const id = cfg.entity;
  const { t, getState } = ctx;
  const num = (v) => formatNumber(v, { locale: ctx.locale, decimals: 1 });

  const layer = h("div", { class: "photo__img" });
  const picture = cfg.image;
  if (picture) {
    layer.style.backgroundImage = `url("${assetUrl(picture).replace(/"/g, "%22")}")`;
    if (cfg.zoom) layer.style.backgroundSize = `${Number(cfg.zoom) * 100}%`;
    if (cfg.image_position) layer.style.backgroundPosition = cfg.image_position;
  }
  const status = h("div", { class: "photo__status" });
  const name = h("div", { class: "photo__name" });

  const target = h("div", { class: "climate-ctl__target" });
  const plus = h("button", { class: "climate-ctl__btn", type: "button", "aria-label": "+" }, icon("plus"));
  const minus = h("button", { class: "climate-ctl__btn", type: "button", "aria-label": "−" }, icon("minus"));
  const controls = h("div", { class: "climate-ctl" }, plus, target, minus);
  // The buttons must not toggle the tile underneath them.
  controls.addEventListener("pointerdown", (e) => e.stopPropagation());

  const el = h(
    "div",
    { class: "tile tile--toggle tile--photo tile--climate", dataset: { entity: id } },
    picture ? layer : h("div", { class: "photo__fallback" }, icon("radiator")),
    h("div", { class: "photo__shade" }),
    h("div", { class: "photo__text" }, status, name, h("div", { class: "photo__rule" })),
    controls,
  );

  let pending = null;
  let timer = null;
  const range = () => {
    const a = getState(id)?.attributes ?? {};
    return { step: Number(a.target_temp_step ?? a.target_temperature_step) || 0.5, min: a.min_temp ?? 5, max: a.max_temp ?? 35 };
  };
  const nudge = (direction) => {
    pending = stepTarget(pending ?? getState(id)?.attributes?.temperature, direction, range());
    paintTarget();
    clearTimeout(timer);
    timer = setTimeout(() => {
      const value = pending;
      timer = null;
      ctx.call("climate", "set_temperature", id, { temperature: value });
    }, SEND_DELAY_MS);
  };
  pressable(plus, { onTap: () => nudge(1) });
  pressable(minus, { onTap: () => nudge(-1) });
  pressable(el, {
    onTap: () => {
      const call = powerCall(getState(id));
      ctx.call("climate", call.service, id, call.data);
    },
  });

  function paintTarget() {
    const value = pending ?? getState(id)?.attributes?.temperature;
    target.textContent = value != null ? `${num(value)}°` : "";
  }

  return {
    el,
    update() {
      const entity = getState(id);
      const attrs = entity?.attributes ?? {};
      const kind = climateStatus(entity);
      if (pending !== null && attrs.temperature === pending && !timer) pending = null;
      const label = t(`climate_${kind}`) !== `climate_${kind}` ? t(`climate_${kind}`) : translateState(t, entity?.state ?? "unavailable");
      const current = attrs.current_temperature != null ? ` · ${num(attrs.current_temperature)}°` : "";
      status.textContent = `${label}${current}`;
      const title = cfg.name ?? friendlyName(entity, id);
      name.textContent = title;
      name.title = title;
      const on = kind !== "off" && kind !== "unavailable";
      el.classList.toggle("is-on", on);
      const glow = GLOW[kind];
      if (on && glow) el.style.setProperty("--glow", glow);
      else el.style.removeProperty("--glow");
      const adjustable = attrs.temperature != null && on;
      controls.hidden = !adjustable;
      paintTarget();
    },
    destroy() {
      clearTimeout(timer);
    },
  };
}
