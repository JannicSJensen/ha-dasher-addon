import { h } from "../core/h.js";
import { assetUrl } from "../core/api.js";
import { icon } from "../core/icons.js";
import { formatNumber, isUnavailable } from "../lib/format.js";
import { createHeader, friendlyName, pressable, runAction, safeImage, stateLabel } from "./common.js";

/** Car tile: headline value (range), status rows and a picture. Tapping it opens the Car page (or runs `tap`). */
export function createVehicleTile(cfg, ctx) {
  const header = createHeader({ iconName: cfg.icon ?? "car", title: cfg.name ?? "" });
  const rows = (cfg.rows ?? []).map((row) => {
    const value = h("b", { class: "vehicle__row-value" });
    const label = h("span", { class: "vehicle__row-label" });
    return { cfg: row, value, label, el: h("div", { class: "vehicle__row" }, icon(row.icon ?? "information-outline"), value, label) };
  });
  const image = cfg.image ? safeImage({ class: "vehicle__img", src: assetUrl(cfg.image) }) : null;

  const el = h("div", { class: "tile tile--vehicle" }, header.el, h("div", { class: "vehicle__rows" }, rows.map((r) => r.el)), image);

  pressable(el, {
    onTap: () => {
      if (cfg.tap) return runAction(cfg.tap, ctx, cfg.entity);
      if (ctx.evEnabled()) ctx.navigate("ev");
    },
  });

  const withUnit = (entity, decimals) => {
    if (isUnavailable(entity)) return "–";
    const n = Number(entity.state);
    const text = Number.isFinite(n) ? formatNumber(n, { locale: ctx.locale, decimals }) : entity.state;
    const unit = entity.attributes?.unit_of_measurement;
    return unit ? `${text}${unit === "%" ? "" : " "}${unit}` : text;
  };

  return {
    el,
    update() {
      const main = ctx.getState(cfg.entity);
      header.update({
        title: cfg.name ?? friendlyName(main, cfg.entity),
        subtitle: cfg.entity ? withUnit(main, cfg.decimals ?? 0) : "",
        active: true,
      });
      el.classList.toggle("is-unavailable", Boolean(cfg.entity) && isUnavailable(main));
      for (const row of rows) {
        const entity = ctx.getState(row.cfg.entity);
        const status = row.cfg.label_entity ? ctx.getState(row.cfg.label_entity) : null;
        row.value.textContent = withUnit(entity, row.cfg.decimals ?? 1);
        row.label.textContent = status ? stateLabel(ctx, status) : (row.cfg.label ?? "");
      }
    },
  };
}
