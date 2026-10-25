import { h } from "../core/h.js";
import { icon, setIcon } from "../core/icons.js";
import { evaluate } from "../lib/conditions.js";
import { translateState } from "../lib/i18n.js";

const ACTIVE_OFF = new Set(["off", "idle", "standby", "unavailable", "unknown", "closed", "closing", "locked"]);

/** True when a device should look "lit": lights/switches on, players playing, covers open. */
export function isActive(entity) {
  if (!entity) return false;
  return !ACTIVE_OFF.has(entity.state);
}

const DEFAULT_TOGGLE = {
  light: "toggle",
  switch: "toggle",
  fan: "toggle",
  input_boolean: "toggle",
  automation: "toggle",
  cover: "toggle",
  script: "turn_on",
  scene: "turn_on",
  button: "press",
  input_button: "press",
  media_player: "media_play_pause",
};

export const domainOf = (entityId) => entityId.split(".")[0];

export const isOn = (entity) => entity?.state === "on";

export const friendlyName = (entity, fallback = "") => entity?.attributes?.friendly_name ?? fallback;

/**
 * Perform a configured tap action.
 *   "toggle" | "none" | { action: "toggle" | "service" | "navigate" | "none", ... }
 */
export function runAction(action, ctx, defaultEntity) {
  const a = typeof action === "string" ? { action } : (action ?? { action: "toggle" });
  switch (a.action ?? "toggle") {
    case "none":
      return;
    case "navigate":
      return ctx.navigate(a.page);
    case "service": {
      const [domain, service] = String(a.service ?? "").split(".");
      return ctx.call(domain, service, a.entity ?? defaultEntity, a.data);
    }
    default: {
      const entityId = a.entity ?? defaultEntity;
      if (!entityId) return;
      const domain = domainOf(entityId);
      // A switched-off player needs turn_on; play/pause does nothing on a TV that is off.
      const service =
        domain === "media_player" && ctx.getState(entityId)?.state === "off"
          ? "turn_on"
          : (DEFAULT_TOGGLE[domain] ?? "toggle");
      return ctx.call(domain, service, entityId);
    }
  }
}

/** Tap / long-press handling that tolerates small finger jitter. */
export function pressable(el, { onTap, onHold, holdMs = 550 }) {
  let timer;
  let origin = null;
  let held = false;

  const reset = () => {
    clearTimeout(timer);
    origin = null;
    el.classList.remove("is-pressed");
  };

  el.addEventListener("pointerdown", (e) => {
    e.stopPropagation();
    origin = { x: e.clientX, y: e.clientY };
    held = false;
    el.classList.add("is-pressed");
    if (onHold) {
      timer = setTimeout(() => {
        held = true;
        el.classList.remove("is-pressed");
        onHold(e);
      }, holdMs);
    }
  });
  el.addEventListener("pointermove", (e) => {
    if (origin && Math.hypot(e.clientX - origin.x, e.clientY - origin.y) > 12) reset();
  });
  el.addEventListener("pointerup", (e) => {
    const wasTap = origin && !held;
    reset();
    if (wasTap) onTap?.(e);
  });
  el.addEventListener("pointercancel", reset);
  el.addEventListener("pointerleave", reset);
  el.addEventListener("contextmenu", (e) => e.preventDefault());
}

/** Icon chip + title + subtitle header used by most tiles. */
export function createHeader({ iconName, title }) {
  const chip = h("div", { class: "chip" }, icon(iconName));
  const titleEl = h("div", { class: "tile__title" }, title);
  const subEl = h("div", { class: "tile__sub" });
  const el = h("div", { class: "tile__head" }, chip, h("div", { class: "tile__heading" }, titleEl, subEl));
  return {
    el,
    update({ title: nextTitle, subtitle, iconName: nextIcon, active }) {
      if (nextTitle !== undefined) titleEl.textContent = nextTitle;
      if (subtitle !== undefined) subEl.textContent = subtitle;
      if (nextIcon) setIcon(chip.firstChild, nextIcon);
      chip.classList.toggle("is-active", Boolean(active));
    },
  };
}

/** Row of icon buttons (used by hero and the standalone "buttons" tile). */
export function createButtonRow(buttons, ctx, { labels = false } = {}) {
  const items = (buttons ?? []).map((cfg) => {
    const label = labels && cfg.name ? h("span", { class: "icon-btn__label" }, cfg.name) : null;
    const el = h("button", { class: `icon-btn${label ? " has-label" : ""}`, type: "button", title: cfg.name ?? "", "aria-label": cfg.name ?? cfg.icon }, icon(cfg.icon), label);
    pressable(el, { onTap: () => runAction(cfg.tap ?? "toggle", ctx, cfg.entity) });
    return { cfg, el };
  });
  return {
    el: h("div", { class: "button-row" }, items.map((i) => i.el)),
    update() {
      for (const { cfg, el } of items) {
        const activeWhen = cfg.active_when ?? (cfg.entity ? { entity: cfg.entity, state: "on" } : null);
        el.classList.toggle("is-active", activeWhen ? evaluate(activeWhen, ctx.getState) : false);
      }
    },
  };
}

export const stateLabel = (ctx, entity) => (entity ? translateState(ctx.t, entity.state) : "");

export function backgroundImage(el, url) {
  el.style.backgroundImage = url ? `url("${url.replace(/"/g, "%22")}")` : "";
}

/** <img> that hides itself when the file is missing instead of showing a broken icon. */
export function safeImage(props) {
  return h("img", { alt: "", draggable: "false", ...props, onerror: (e) => (e.target.style.display = "none") });
}
