import { h } from "../core/h.js";
import { createHeader, pressable } from "./common.js";
import { tonight } from "../lib/meals.js";

/** "Tonight" tile: today's dinner and tomorrow's from the meal plan. Tap opens the recipe. Config: `name`, `icon`. */
export function createDinnerTile(cfg, ctx) {
  const { t } = ctx;
  const header = createHeader({ iconName: cfg.icon ?? "silverware-fork-knife", title: cfg.name ?? t("meals_tonight") });
  const dish = h("div", { class: "dinner__dish" });
  const meta = h("div", { class: "dinner__meta" });
  const next = h("div", { class: "dinner__next" });
  const el = h("div", { class: "tile tile--dinner" }, header.el, h("div", { class: "dinner__body" }, dish, meta), next);

  pressable(el, {
    onTap: () => {
      const meals = ctx.meals?.();
      if (meals?.enabled) ctx.navigate("meals");
    },
  });
  const timer = setInterval(() => update(), 60_000); // the day turns at midnight

  function update() {
    const meals = ctx.meals?.();
    const { today, tomorrow } = tonight(meals?.days ?? {});
    header.update({ title: cfg.name ?? t("meals_tonight"), subtitle: "", active: Boolean(today) });
    if (!meals?.enabled) {
      dish.textContent = t("meals_not_available");
      meta.textContent = "";
      next.textContent = "";
      return;
    }
    dish.textContent = today ? today.title : t("meals_nothing_planned");
    dish.classList.toggle("is-empty", !today);
    meta.textContent = today
      ? [today.kind === "leftovers" ? t("meals_kind_leftovers") : null, today.minutes ? `${today.minutes} min` : null, today.vegetarian ? t("meals_vegetarian") : null].filter(Boolean).join(" · ")
      : "";
    next.textContent = tomorrow ? `${t("meals_tomorrow")}: ${tomorrow.title}` : "";
  }

  return {
    el,
    update,
    destroy() {
      clearInterval(timer);
    },
  };
}
