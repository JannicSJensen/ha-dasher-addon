import { h } from "../core/h.js";
import { createButtonRow } from "./common.js";

/** Standalone grid of icon buttons, e.g. scenes or script triggers. */
export function createButtonsTile(cfg, ctx) {
  const row = createButtonRow(cfg.buttons, ctx);
  const el = h("div", { class: "tile tile--buttons" }, cfg.title ? h("div", { class: "tile__title" }, cfg.title) : null, row.el);
  return { el, update: row.update };
}
