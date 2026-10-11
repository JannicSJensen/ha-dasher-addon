import { h } from "../core/h.js";
import { assetUrl } from "../core/api.js";
import { formatDate, formatTime } from "../lib/format.js";
import { icon } from "../core/icons.js";
import { pickFirst } from "../lib/conditions.js";
import { activeMessages } from "../lib/messages.js";
import { backgroundImage, createButtonRow } from "./common.js";

/** Large area tile: state-dependent background, clock/date and a row of quick buttons. */
export function createHeroTile(cfg, ctx) {
  const layers = [h("div", { class: "hero__img" }), h("div", { class: "hero__img" })];
  let front = 0;
  let currentUrl = null;

  const clock = h("div", { class: "hero__clock" });
  const date = h("div", { class: "hero__date" });
  const buttons = createButtonRow(cfg.buttons, ctx);
  const messages = h("div", { class: `hero__messages${cfg.show_clock === false ? " no-clock" : ""}`, "aria-live": "polite" });
  let messagesSignature = "";

  const el = h(
    "div",
    { class: "tile tile--hero" },
    layers,
    h("div", { class: "hero__shade" }),
    cfg.show_clock === false ? null : h("div", { class: "hero__top" }, clock, date),
    messages,
    buttons.el,
  );

  const tickClock = () => {
    const now = new Date();
    const fmt = { locale: ctx.locale, hour12: cfg.time_format === "12h" };
    clock.textContent = formatTime(now, fmt);
    date.textContent = formatDate(now, fmt);
  };

  let timer;
  const schedule = () => {
    tickClock();
    timer = setTimeout(schedule, 60_000 - (Date.now() % 60_000) + 50);
  };
  schedule();
  const onVisible = () => {
    if (!document.hidden) {
      clearTimeout(timer);
      schedule();
    }
  };
  document.addEventListener("visibilitychange", onVisible);

  const setBackground = (url) => {
    if (url === currentUrl) return;
    currentUrl = url;
    const next = 1 - front;
    backgroundImage(layers[next], url);
    layers[next].classList.add("is-visible");
    layers[front].classList.remove("is-visible");
    front = next;
  };

  const paintMessages = () => {
    const list = Array.isArray(cfg.messages) && cfg.messages.length ? activeMessages(cfg.messages, ctx.getState, { t: ctx.t, locale: ctx.locale }) : [];
    const signature = JSON.stringify(list);
    if (signature === messagesSignature) return;
    messagesSignature = signature;
    messages.replaceChildren(
      ...list.map((m) =>
        h(
          "div",
          { class: `heromsg${m.urgent ? " is-urgent" : ""}`, style: m.color ? `--msg:${m.color}` : null },
          h("div", { class: "heromsg__icon" }, icon(m.icon)),
          h("div", { class: "heromsg__text" }, h("div", { class: "heromsg__title" }, m.title), m.detail ? h("div", { class: "heromsg__detail" }, m.detail) : null),
          m.badge ? h("span", { class: "heromsg__badge" }, m.badge) : null,
        ),
      ),
    );
  };
  // Pick-ups are counted in days, so the list is also re-checked when midnight passes.
  const msgTimer = setInterval(paintMessages, 60_000);

  return {
    el,
    update() {
      paintMessages();
      const match = pickFirst(cfg.backgrounds, ctx.getState);
      setBackground(assetUrl(match?.image ?? cfg.image));
      buttons.update();
    },
    destroy() {
      clearTimeout(timer);
      clearInterval(msgTimer);
      document.removeEventListener("visibilitychange", onVisible);
    },
  };
}
