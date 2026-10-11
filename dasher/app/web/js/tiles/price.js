import { h } from "../core/h.js";
import { currentSlot, makeClassifier, normalizeSlots, priceRange, startOfDay } from "../lib/price.js";
import { formatNumber, formatTime } from "../lib/format.js";
import { createHeader, friendlyName } from "./common.js";

const DAY_MS = 24 * 3600 * 1000;
const LABELS = ["00", "06", "12", "18", "00"];

/** Electricity price tile with a colour-coded 24h timeline and a "now" marker. */
export function createPriceTile(cfg, ctx) {
  const multiplier = cfg.multiplier ?? 1;
  const decimals = cfg.decimals ?? (multiplier >= 100 ? 0 : 2);
  const rangeDecimals = cfg.range_decimals ?? 1;
  const fmt = (v, d) => formatNumber(v * multiplier, { locale: ctx.locale, decimals: d });

  const header = createHeader({ iconName: cfg.icon ?? "flash", title: cfg.name ?? "" });
  const slotLabel = h("div", { class: "price__slot" });
  const value = h("span", { class: "price__value" });
  const unit = h("span", { class: "price__unit" }, cfg.unit ?? "");
  const rangeLabel = h("div", { class: "price__range-label" }, ctx.t("todays_price"));
  const range = h("div", { class: "price__range" });
  const bar = h("div", { class: "price__bar" });
  const marker = h("div", { class: "price__marker" });
  const ticks = h("div", { class: "price__ticks" });
  const labels = h("div", { class: "price__labels" }, LABELS.map((l) => h("span", null, l)));

  for (let i = 0; i <= 24; i++) {
    ticks.append(h("i", { class: i % 6 === 0 ? "is-major" : "", style: { left: `${(i / 24) * 100}%` } }));
  }

  const el = h(
    "div",
    { class: "tile tile--price" },
    header.el,
    h(
      "div",
      { class: "price__body" },
      h("div", { class: "price__now" }, slotLabel, h("div", { class: "price__big" }, value, unit)),
      h("div", { class: "price__summary" }, rangeLabel, range),
    ),
    h("div", { class: "price__chart" }, h("div", { class: "price__bar-wrap" }, bar, marker), ticks, labels),
  );

  let slots = [];

  const renderBar = () => {
    const classify = makeClassifier(slots, cfg.thresholds);
    const dayStart = startOfDay(new Date()).getTime();
    bar.replaceChildren(
      ...slots.map((s) =>
        h("span", {
          class: `price__seg price__seg--${classify(s.value)}`,
          style: { left: `${((s.start - dayStart) / DAY_MS) * 100}%`, width: `${((s.end - s.start) / DAY_MS) * 100}%` },
        }),
      ),
    );
  };

  const paintNow = () => {
    const now = Date.now();
    const dayStart = startOfDay(new Date(now)).getTime();
    marker.style.left = `${((now - dayStart) / DAY_MS) * 100}%`;
    const slot = currentSlot(slots, now);
    const entity = ctx.getState(cfg.entity);
    const stateValue = Number(entity?.state);
    const current = slot ? slot.value : Number.isFinite(stateValue) ? stateValue : null;
    value.textContent = current == null ? "–" : fmt(current, decimals);
    slotLabel.textContent = slot
      ? `${formatTime(new Date(slot.start), { locale: ctx.locale })}-${formatTime(new Date(slot.end), { locale: ctx.locale })}`
      : "";
  };

  let timer = setInterval(paintNow, 30_000);

  return {
    el,
    update() {
      const entity = ctx.getState(cfg.entity);
      slots = normalizeSlots(entity?.attributes, { attribute: cfg.attribute });
      const r = priceRange(slots);
      range.textContent = r ? `${fmt(r.min, rangeDecimals)} - ${fmt(r.max, rangeDecimals)}` : "";
      header.update({
        title: cfg.name ?? friendlyName(entity, cfg.entity),
        subtitle: cfg.subtitle ?? "",
        active: true,
      });
      renderBar();
      paintNow();
    },
    destroy() {
      clearInterval(timer);
    },
  };
}
