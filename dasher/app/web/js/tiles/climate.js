import { h } from "../core/h.js";
import { assetUrl } from "../core/api.js";
import { icon } from "../core/icons.js";
import { createSlider } from "../core/slider.js";
import { formatNumber, isUnavailable } from "../lib/format.js";
import { translateState } from "../lib/i18n.js";
import { createHeader, friendlyName, pressable } from "./common.js";

const GLOW = { heat: "#ff8a3d", cool: "#4fc3f7", heat_cool: "#2dd4bf", auto: "#2dd4bf", dry: "#fbbf24", fan_only: "#a3e635" };
const DEFAULT_BUTTONS = ["power", "fan", "swing"];
const BUTTON_ICONS = { power: "power", fan: "fan", swing: "air-filter" };

const nextOf = (list, current) => list[(list.indexOf(current) + 1) % list.length];

/** Heat pump / AC tile with a vertical target-temperature slider and mode buttons. */
export function createClimateTile(cfg, ctx) {
  const entityId = cfg.entity;
  const header = createHeader({ iconName: cfg.icon ?? "air-conditioner", title: cfg.name ?? "" });
  const image = cfg.image ? h("div", { class: "climate__img", style: { backgroundImage: `url("${assetUrl(cfg.image)}")` } }) : null;
  const current = h("div", { class: "climate__current" });
  const target = h("div", { class: "climate__target" });
  const ticks = h("div", { class: "climate__ticks" });

  let range = { min: 16, max: 30, step: 0.5 };
  let pendingTarget = null;

  const slider = createSlider({
    orientation: "vertical",
    min: range.min,
    max: range.max,
    step: range.step,
    value: range.min,
    onInput: (v) => paintTarget(v),
    onCommit: (v) => {
      pendingTarget = v;
      ctx.call("climate", "set_temperature", entityId, { temperature: v });
    },
  });
  const sliderWrap = h("div", { class: "climate__slider" }, slider.el, target, ticks);

  const buttonDefs = (cfg.buttons ?? DEFAULT_BUTTONS).map((kind) => {
    const iconEl = icon(cfg.icons?.[kind] ?? BUTTON_ICONS[kind] ?? "circle-outline");
    const caption = h("span", { class: "climate__caption" });
    const el = h("button", { class: "icon-btn icon-btn--stacked", type: "button", "aria-label": kind }, iconEl, caption);
    pressable(el, { onTap: () => onButton(kind) });
    return { kind, el, iconEl, caption };
  });

  const el = h(
    "div",
    { class: "tile tile--climate" },
    image,
    header.el,
    h("div", { class: "climate__body" }, current, sliderWrap),
    h("div", { class: "climate__buttons" }, buttonDefs.map((b) => b.el)),
  );

  function onButton(kind) {
    const attrs = ctx.getState(entityId)?.attributes ?? {};
    const state = ctx.getState(entityId)?.state;
    if (kind === "power") {
      if (state === "off") {
        const modes = attrs.hvac_modes ?? [];
        const mode =
          cfg.on_mode ??
          ["heat_cool", "auto", "heat", "cool"].find((m) => modes.includes(m)) ??
          modes.find((m) => m !== "off") ??
          attrs.last_active_hvac_mode ??
          "heat";
        if (mode) ctx.call("climate", "set_hvac_mode", entityId, { hvac_mode: mode });
      } else ctx.call("climate", "set_hvac_mode", entityId, { hvac_mode: "off" });
    } else if (kind === "fan" && attrs.fan_modes?.length) {
      ctx.call("climate", "set_fan_mode", entityId, { fan_mode: nextOf(attrs.fan_modes, attrs.fan_mode) });
    } else if (kind === "swing" && attrs.swing_modes?.length) {
      ctx.call("climate", "set_swing_mode", entityId, { swing_mode: nextOf(attrs.swing_modes, attrs.swing_mode) });
    }
  }

  function paintTarget(value) {
    const ratio = (value - range.min) / (range.max - range.min);
    target.style.bottom = `${ratio * 100}%`;
    target.textContent = `${formatNumber(value, { locale: ctx.locale, decimals: range.step < 1 ? 1 : 0 })}°`;
  }

  function paintTicks() {
    const span = range.max - range.min;
    const stepSize = span > 12 ? 5 : 1;
    const first = Math.ceil(range.min / stepSize) * stepSize;
    const marks = [];
    for (let v = first; v <= range.max; v += stepSize) {
      marks.push(h("span", { style: { bottom: `${((v - range.min) / span) * 100}%` } }, String(v)));
    }
    ticks.replaceChildren(...marks);
  }

  return {
    el,
    update() {
      const entity = ctx.getState(entityId);
      const attrs = entity?.attributes ?? {};
      const state = entity?.state ?? "unavailable";
      const off = state === "off";

      const next = {
        min: attrs.min_temp ?? 16,
        max: attrs.max_temp ?? 30,
        step: cfg.step ?? Math.max(attrs.target_temp_step ?? attrs.target_temperature_step ?? 0.5, 0.1),
      };
      if (next.min !== range.min || next.max !== range.max || next.step !== range.step) {
        range = next;
        slider.setRange(range.min, range.max, range.step);
        paintTicks();
      } else if (!ticks.firstChild) paintTicks();

      if (pendingTarget !== null && attrs.temperature === pendingTarget) pendingTarget = null;
      const shown = pendingTarget ?? attrs.temperature ?? range.min;
      slider.setValue(shown);
      paintTarget(shown);

      current.textContent = attrs.current_temperature != null ? `${formatNumber(attrs.current_temperature, { locale: ctx.locale, decimals: 0 })}` : "";
      current.dataset.unit = "°C";

      header.update({ title: cfg.name ?? friendlyName(entity, entityId), subtitle: translateState(ctx.t, state), active: !off && !isUnavailable(entity) });
      el.style.setProperty("--glow", off ? "transparent" : (GLOW[state] ?? GLOW.heat_cool));
      el.classList.toggle("is-off", off);
      el.classList.toggle("is-unavailable", isUnavailable(entity));

      for (const b of buttonDefs) {
        if (b.kind === "power") {
          b.el.classList.toggle("is-active", !off);
          b.caption.textContent = "";
        } else {
          const list = attrs[b.kind === "fan" ? "fan_modes" : "swing_modes"] ?? [];
          const value = attrs[b.kind === "fan" ? "fan_mode" : "swing_mode"];
          b.el.hidden = list.length === 0;
          b.el.classList.toggle("is-active", !off && Boolean(value) && value !== "off");
          b.caption.textContent = value ? translateState(ctx.t, value) : "";
        }
      }
    },
  };
}
