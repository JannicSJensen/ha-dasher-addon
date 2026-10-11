import { h } from "../core/h.js";
import { assetUrl } from "../core/api.js";
import { openModal } from "../core/modal.js";
import { createSlider } from "../core/slider.js";
import { icon } from "../core/icons.js";
import { isUnavailable } from "../lib/format.js";
import { format, translateState } from "../lib/i18n.js";
import { throttle } from "../lib/throttle.js";
import { createHeader, domainOf, friendlyName, isActive, pressable, runAction, safeImage, stateLabel } from "./common.js";

const DEFAULT_ICONS = {
  light: "lightbulb",
  switch: "toggle-switch",
  fan: "fan",
  input_boolean: "toggle-switch",
  cover: "window-shutter",
  media_player: "speaker",
};

const supportsBrightness = (entity) =>
  entity?.attributes?.brightness !== undefined ||
  (entity?.attributes?.supported_color_modes ?? []).some((m) => m !== "onoff");

const brightnessPct = (entity) => Math.round(((entity?.attributes?.brightness ?? 0) / 255) * 100);

/** "Powered on at 77%", "Playing", "Powered off" ... as shown on photo tiles. */
function powerLabel(ctx, entity, domain) {
  if (!entity) return "";
  const { state, attributes } = entity;
  if (state === "unavailable" || state === "unknown") return translateState(ctx.t, state);
  if (domain === "light" && state === "on") {
    return attributes.brightness != null ? format(ctx.t, "powered_on_at", { n: brightnessPct(entity) }) : ctx.t("powered_on");
  }
  if (state === "on") return ctx.t("powered_on");
  if (state === "off") return ctx.t("powered_off");
  if (state === "idle" || state === "standby") return ctx.t("powered_idle");
  return translateState(ctx.t, state);
}

/**
 * Light / switch / fan / cover / media player tile.
 *
 * layout "card" (default): icon header with a picture below.
 * layout "photo": full-bleed picture that is dimmed while the device is off, with the
 * status and name over it. Tap toggles; dimmable lights get a vertical brightness slider.
 */
export function createToggleTile(cfg, ctx) {
  const entityId = cfg.entity;
  const domain = domainOf(entityId);
  const photo = cfg.layout === "photo";
  const defaultIcon = cfg.icon ?? DEFAULT_ICONS[domain] ?? "lightbulb";

  const parts = [];
  let header = null;
  let status = null;
  let name = null;

  const imgOff = cfg.image_off ?? cfg.image;
  const imgOn = cfg.image_on ?? cfg.image;

  if (photo) {
    const picture = imgOn ?? imgOff;
    const layer = h("div", { class: "photo__img" });
    if (picture) {
      layer.style.backgroundImage = `url("${assetUrl(picture).replace(/"/g, "%22")}")`;
      if (cfg.zoom) layer.style.backgroundSize = `${Number(cfg.zoom) * 100}%`;
      if (cfg.image_position) layer.style.backgroundPosition = cfg.image_position;
    }
    status = h("div", { class: "photo__status" });
    name = h("div", { class: "photo__name" });
    parts.push(
      picture ? layer : h("div", { class: "photo__fallback" }, icon(defaultIcon)),
      h("div", { class: "photo__shade" }),
      h("div", { class: "photo__text" }, status, name, h("div", { class: "photo__rule" })),
    );
  } else {
    header = createHeader({ iconName: defaultIcon, title: cfg.name ?? "" });
    const media = h("div", { class: "toggle__media" });
    if (imgOn || imgOff) {
      media.classList.add("has-image");
      media.append(
        safeImage({ class: "toggle__img toggle__img--off", src: assetUrl(imgOff ?? imgOn) }),
        safeImage({ class: "toggle__img toggle__img--on", src: assetUrl(imgOn ?? imgOff) }),
      );
    } else {
      media.append(h("div", { class: "toggle__orb" }, icon(defaultIcon)));
    }
    parts.push(media, header.el);
  }

  // Brightness slider (lights only), shown while the light is on.
  let slider = null;
  let sliderWrap = null;
  let touchedAt = 0;
  if (domain === "light" && cfg.slider !== false) {
    const send = throttle((v) => ctx.call("light", "turn_on", entityId, { brightness_pct: v }), 250);
    slider = createSlider({
      orientation: "vertical",
      variant: "line",
      min: 1,
      max: 100,
      step: 1,
      value: 100,
      onInput: (v) => {
        touchedAt = Date.now();
        send(v);
      },
      onCommit: (v) => {
        touchedAt = Date.now();
        send.cancel();
        ctx.call("light", "turn_on", entityId, { brightness_pct: v });
      },
    });
    sliderWrap = h("div", { class: "light-slider" }, slider.el);
    // The slider must not toggle the tile underneath it.
    sliderWrap.addEventListener("pointerdown", (e) => e.stopPropagation());
    parts.push(sliderWrap);
  }

  const el = h("div", { class: `tile tile--toggle${photo ? " tile--photo" : ""}`, dataset: { entity: entityId } }, parts);

  const openBrightness = () => {
    const entity = ctx.getState(entityId);
    if (domain !== "light" || !supportsBrightness(entity) || ctx.readOnly) return;
    const value = h("div", { class: "modal__value" }, `${brightnessPct(entity)}%`);
    const modalSlider = createSlider({
      orientation: "horizontal",
      min: 0,
      max: 100,
      step: 1,
      value: brightnessPct(entity),
      onInput: (v) => (value.textContent = `${v}%`),
      onCommit: (v) => (v === 0 ? ctx.call("light", "turn_off", entityId) : ctx.call("light", "turn_on", entityId, { brightness_pct: v })),
    });
    openModal(h("div", { class: "modal__body" }, h("div", { class: "modal__title" }, friendlyName(entity, cfg.name)), value, modalSlider.el));
  };

  const defaultHold = () => {
    if (domain === "light") return openBrightness;
    if (domain === "media_player") return () => ctx.call("media_player", "turn_off", entityId);
    return undefined;
  };

  pressable(el, {
    onTap: () => runAction(cfg.tap, ctx, entityId),
    onHold: cfg.hold ? () => runAction(cfg.hold, ctx, entityId) : defaultHold(),
  });

  return {
    el,
    update() {
      const entity = ctx.getState(entityId);
      const on = isActive(entity);
      const attrs = entity?.attributes ?? {};
      const title = cfg.name ?? friendlyName(entity, entityId);

      if (photo) {
        status.textContent = powerLabel(ctx, entity, domain);
        name.textContent = title;
        name.title = title;
      } else {
        const brightness = on && attrs.brightness != null ? ` · ${brightnessPct(entity)}%` : "";
        const text = entity ? stateLabel(ctx, entity) + brightness : "";
        header.update({ title, subtitle: cfg.area ? `${cfg.area} | ${text}` : text, active: on });
      }

      el.classList.toggle("is-on", on);
      el.classList.toggle("is-unavailable", isUnavailable(entity));
      const rgb = attrs.rgb_color;
      if (on && Array.isArray(rgb)) el.style.setProperty("--glow", `rgb(${rgb.join(",")})`);
      else el.style.removeProperty("--glow");

      if (slider) {
        const show = entity?.state === "on" && supportsBrightness(entity) && !ctx.readOnly;
        el.classList.toggle("has-slider", show);
        // Ignore the echo of our own commands for a moment so the knob does not jump back.
        if (show && Date.now() - touchedAt > 1200) slider.setValue(Math.max(1, brightnessPct(entity)));
      }
    },
  };
}
