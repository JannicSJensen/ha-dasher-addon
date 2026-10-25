import { h } from "../core/h.js";
import { formatDate, formatTime } from "../lib/format.js";
import { createButtonRow } from "../tiles/common.js";

/**
 * The ambient screen: a big calm clock on black with a slowly breathing orb, shown after a while without touch.
 * A tap anywhere (but on a button) brings the dashboard back. The content drifts a few pixels now and then,
 * so a screen that stays on does not burn in.
 */
export function createAmbient(cfg, ctx) {
  const clock = h("div", { class: "ambient__clock" });
  const date = h("div", { class: "ambient__date" });
  const buttons = createButtonRow(cfg.buttons, ctx, { labels: true });
  const content = h("div", { class: "ambient__content" }, clock, date, cfg.buttons?.length ? buttons.el : null);
  const el = h("div", { class: "ambient", hidden: true, role: "dialog", "aria-label": "Clock", style: { "--ambient-brightness": String(cfg.brightness ?? 0.8) } }, h("div", { class: "ambient__orb" }), content);
  let timer = null;

  const tick = () => {
    const now = new Date();
    const fmt = { locale: ctx.locale, hour12: cfg.time_format === "12h" };
    clock.textContent = formatTime(now, fmt);
    date.textContent = formatDate(now, fmt);
  };

  function hide() {
    clearInterval(timer);
    timer = null;
    el.classList.remove("is-open");
    setTimeout(() => !timer && (el.hidden = true), 450);
  }

  // The first touch only wakes the dashboard; it must not press something underneath.
  el.addEventListener("pointerdown", (event) => {
    if (event.target.closest(".icon-btn")) return;
    event.stopPropagation();
    hide();
  });

  return {
    el,
    get isOpen() {
      return !el.hidden && el.classList.contains("is-open");
    },
    show() {
      if (timer) return;
      tick();
      buttons.update();
      el.hidden = false;
      requestAnimationFrame(() => el.classList.add("is-open"));
      timer = setInterval(() => {
        tick();
        buttons.update();
      }, 1000);
    },
    hide,
    update() {
      if (!el.hidden) buttons.update();
    },
    destroy() {
      clearInterval(timer);
      el.remove();
    },
  };
}
