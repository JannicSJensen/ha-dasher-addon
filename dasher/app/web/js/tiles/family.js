import { h } from "../core/h.js";
import { initial, openCount } from "../lib/family.js";
import { createHeader, pressable } from "./common.js";

/**
 * The family at a glance: each person with their stars and what is left to do. A tap opens the family page.
 * Config: `name`, `icon`.
 */
export function createFamilyTile(cfg, ctx) {
  const { t } = ctx;
  const header = createHeader({ iconName: cfg.icon ?? "account-group", title: cfg.name ?? t("fam_title") });
  const list = h("div", { class: "famtile__list" });
  const el = h("div", { class: "tile tile--family" }, header.el, list);
  pressable(el, {
    onTap: () => {
      if (ctx.family?.()?.enabled) ctx.navigate("family");
    },
  });

  return {
    el,
    get entities() {
      return (ctx.family?.()?.people ?? []).map((p) => p.entity).filter(Boolean);
    },
    update() {
      const family = ctx.family?.();
      if (!family?.enabled) {
        list.replaceChildren(h("div", { class: "offers__empty" }, t("fam_not_available")));
        return;
      }
      const waiting = family.chores.filter((c) => c.status === "awaiting").length;
      header.update({ title: cfg.name ?? family.title ?? t("fam_title"), subtitle: waiting ? `${waiting} ${t("fam_awaiting").toLowerCase()}` : "", active: waiting > 0 });
      list.replaceChildren(
        ...family.people.map((p) => {
          const left = openCount(family.chores, p.id);
          const home = p.entity ? ctx.getState(p.entity)?.state === "home" : false;
          return h(
            "div",
            { class: "famtile__row" },
            h("span", { class: `favatar is-small${home ? " is-home" : ""}`, style: { "--who": p.color } }, p.avatar || initial(p.name)),
            h("div", { class: "famtile__name" }, p.name, h("small", null, left ? `${left} ${t("fam_to_do")}` : t("fam_all_done"))),
            h("div", { class: "famtile__stars" }, "★", String(p.balance)),
          );
        }),
      );
    },
  };
}
