import { h } from "../core/h.js";
import { chainColor, money, packText } from "../lib/offers.js";
import { createHeader, pressable } from "./common.js";

/**
 * Cheapest offers of a followed product (from the Offers tab of the meal plan). Tap opens the tab.
 * Config: `product` (the product's name or address name, default the first followed), `count` (rows, default 3), `name`, `icon`.
 */
export function createOffersTile(cfg, ctx) {
  const { t } = ctx;
  const header = createHeader({ iconName: cfg.icon ?? "tag-outline", title: cfg.name ?? t("offers_title") });
  const list = h("div", { class: "offers__list" });
  const el = h("div", { class: "tile tile--offers" }, header.el, list);
  pressable(el, {
    onTap: () => {
      if (ctx.meals?.()?.enabled) ctx.navigate("meals");
    },
  });
  const count = Math.max(1, Math.min(8, Number(cfg.count) || 3));

  return {
    el,
    update() {
      const offers = ctx.meals?.()?.offers;
      const wanted = String(cfg.product ?? "").toLowerCase();
      const product = offers?.products?.find((p) => p.slug === wanted || p.name.toLowerCase() === wanted) ?? offers?.products?.[0];
      header.update({ title: cfg.name ?? product?.name ?? t("offers_title"), subtitle: cfg.name && product ? product.name : t("offers_title"), active: Boolean(product?.offers?.length) });
      if (!product) {
        list.replaceChildren(h("div", { class: "offers__empty" }, t("offers_none")));
        return;
      }
      if (!product.offers.length) {
        list.replaceChildren(h("div", { class: "offers__empty" }, t("offers_none_now")));
        return;
      }
      list.replaceChildren(
        ...product.offers.slice(0, count).map((o) =>
          h(
            "div",
            { class: "offers__row" },
            h("span", { class: "offers__badge", style: { background: chainColor(o.chain) } }, o.chain.slice(0, 2).toUpperCase()),
            h("div", { class: "offers__store" }, o.chain, h("small", null, `${packText(o, ctx.locale)} · ${money(o.price, ctx.locale)} kr`)),
            h("div", { class: "offers__unit" }, money(o.unit_price, ctx.locale), " ", h("small", null, `kr/${o.unit}`)),
          ),
        ),
      );
    },
  };
}
