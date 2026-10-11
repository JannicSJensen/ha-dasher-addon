import { h } from "../core/h.js";
import { createHeader, friendlyName } from "./common.js";
import { createPriceParts } from "./pricechart.js";

/** Electricity price tile with a colour-coded 24h timeline and a "now" marker. */
export function createPriceTile(cfg, ctx) {
  const header = createHeader({ iconName: cfg.icon ?? "flash", title: cfg.name ?? "" });
  const parts = createPriceParts(cfg, ctx);
  const el = h("div", { class: "tile tile--price" }, header.el, parts.body, parts.chart);

  return {
    el,
    update() {
      const entity = ctx.getState(cfg.entity);
      header.update({
        title: cfg.name ?? friendlyName(entity, cfg.entity),
        subtitle: cfg.subtitle ?? "",
        active: true,
      });
      parts.update();
    },
    destroy: parts.destroy,
  };
}
