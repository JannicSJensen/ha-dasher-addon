import { setAreaDeviceHidden } from "../core/api.js";
import { h } from "../core/h.js";
import { icon, setIcon } from "../core/icons.js";
import { areaIcon, areaStats, cropFor, restorableEntities, visibleAreaEntities } from "../lib/areas.js";
import { formatNumber } from "../lib/format.js";
import { format } from "../lib/i18n.js";
import { createAreaClimateTile } from "../tiles/areaclimate.js";
import { friendlyName, pressable } from "../tiles/common.js";
import { createToggleTile } from "../tiles/toggle.js";
import { areaImageUrl } from "./areas.js";

const DEVICE_ICONS = { light: "lightbulb", fan: "fan", cover: "window-shutter", media_player: "speaker", climate: "radiator", switch: "toggle-switch", input_boolean: "toggle-switch" };

function stat(label) {
  const value = h("div", { class: "stat__value" });
  return { el: h("div", { class: "stat", hidden: true }, h("div", { class: "stat__label" }, label), value), value };
}

/**
 * One area: big picture with title and key figures, and the area's devices below. Devices that are unavailable are
 * not shown; with editing allowed a pencil lets people remove devices they do not want here and bring them back.
 */
export function createAreaPage(initialArea, ctx) {
  let area = initialArea;
  let editing = false;
  const url = areaImageUrl(area);
  const bg = h("div", { class: "area__bg" });
  if (url) bg.style.backgroundImage = `url("${url.replace(/"/g, "%22")}")`;

  const temperature = stat(ctx.t("temperature"));
  const humidity = stat(ctx.t("humidity"));
  const windows = stat(ctx.t("windows"));
  const grid = h("div", { class: "area__tiles" });
  const editBtnIcon = icon("pencil-outline");
  const editLabel = h("span", null, ctx.t("area_edit"));
  const editBtn = h("button", { class: "btn area__edit", type: "button" }, editBtnIcon, editLabel);
  const head = h("div", { class: "area__devhead" }, h("h2", { class: "area__devtitle" }, ctx.t("area_devices")), editBtn);
  const hint = h("p", { class: "area__hint", hidden: true }, ctx.t("area_edit_hint"));
  const removed = h("div", { class: "area__removed", hidden: true });
  const devices = h("section", { class: "area__devices" }, head, hint, grid, removed);

  const back = h("a", { class: "area__back", href: "#/areas", "aria-label": ctx.t("back") }, icon("chevron-left"), h("span", null, ctx.t("areas")));
  const more = h("button", { class: "area__more", type: "button", "aria-label": ctx.t("scroll_down") }, icon("chevron-down"));
  more.addEventListener("click", () => devices.scrollIntoView({ behavior: "smooth", block: "start" }));

  const title = h("h1", { class: "area__title" }, area.name);
  const hero = h(
    "section",
    { class: "area__hero" },
    bg,
    url ? null : h("div", { class: "area__glyph" }, icon(areaIcon(area))),
    h("div", { class: "area__shade" }),
    back,
    h("div", { class: "area__titleblock" }, title, h("div", { class: "area__stats" }, temperature.el, humidity.el, windows.el)),
    more,
  );
  const el = h("div", { class: "area" }, hero, devices);

  let children = [];
  let shownKey = null;
  const canEdit = () => ctx.areasEditable?.() === true;

  async function setHidden(id, hidden) {
    try {
      await setAreaDeviceHidden(id, hidden);
    } catch (err) {
      ctx.toast(err.message);
    }
  }

  pressable(editBtn, { onTap: () => ((editing = !editing), (shownKey = null), update()) });

  const createTile = (id, index) => {
    const own = area.entity_images?.[id];
    const look = own ? { image: own } : url ? { image: area.image ?? url, zoom: 1.7, image_position: cropFor(index) } : {};
    const cfg = { type: "toggle", entity: id, layout: "photo", ...look };
    const tile = id.startsWith("climate.") ? createAreaClimateTile(cfg, ctx) : createToggleTile(cfg, ctx);
    if (editing) {
      // A cover over the tile: taps do nothing but the × (the tile's own tap and hold are not reachable).
      const remove = h("button", { class: "tile__remove", type: "button", "aria-label": ctx.t("area_remove") }, icon("close"));
      pressable(remove, { onTap: () => setHidden(id, true) });
      const cover = h("div", { class: "tile__edit" }, remove);
      for (const type of ["pointerdown", "pointerup", "pointermove", "click"]) cover.addEventListener(type, (e) => e.stopPropagation());
      tile.el.append(cover);
    }
    return tile;
  };

  const buildTiles = (ids) => {
    for (const child of children) child.destroy?.();
    children = ids.map(createTile);
    grid.replaceChildren(...children.map((c) => c.el));
  };

  function paintRemoved() {
    const ids = restorableEntities(area, ctx.getState);
    removed.hidden = !editing;
    if (!editing) return removed.replaceChildren();
    removed.replaceChildren(
      h("h3", { class: "area__removedtitle" }, ctx.t("area_removed")),
      ids.length
        ? h(
            "div",
            { class: "area__chips" },
            ids.map((id) => {
              const chip = h("button", { class: "area__chip", type: "button" }, icon(DEVICE_ICONS[id.slice(0, id.indexOf("."))] ?? "devices"), h("span", null, friendlyName(ctx.getState(id), id)), icon("plus"));
              pressable(chip, { onTap: () => setHidden(id, false) });
              return chip;
            }),
          )
        : h("p", { class: "view__hint" }, ctx.t("area_removed_none")),
    );
  }

  const fmtStat = (target, data, decimals) => {
    target.el.hidden = !data;
    if (data) target.value.textContent = `${formatNumber(data.value, { locale: ctx.locale, decimals })}${data.unit === "%" ? "%" : (data.unit ?? "")}`;
  };

  function update() {
    const ids = visibleAreaEntities(area, ctx.getState);
    const restorable = restorableEntities(area, ctx.getState);
    const editable = canEdit();
    if (!editable) editing = false;

    const key = `${editing}|${ids.join("|")}`;
    if (key !== shownKey) {
      shownKey = key;
      buildTiles(ids);
    }
    children.forEach((c) => c.update());

    const hasContent = ids.length > 0 || (editable && restorable.length > 0);
    devices.hidden = !hasContent;
    more.hidden = !hasContent;
    head.hidden = !editable || !hasContent;
    grid.hidden = ids.length === 0;
    grid.classList.toggle("is-editing", editing);
    hint.hidden = !editing;
    setIcon(editBtnIcon, editing ? "check" : "pencil-outline");
    editLabel.textContent = ctx.t(editing ? "area_done" : "area_edit");
    editBtn.classList.toggle("btn--primary", editing);
    paintRemoved();

    const stats = areaStats(area, ctx.getState);
    fmtStat(temperature, stats.temperature, 1);
    fmtStat(humidity, stats.humidity, 0);
    windows.el.hidden = !stats.windows;
    if (stats.windows) {
      windows.value.textContent = stats.windows.open === 0 ? ctx.t("closed") : format(ctx.t, "n_open", { n: stats.windows.open });
    }
  }

  const trackedIds = (a) => [...a.entities, ...(a.hidden_entities ?? []), ...a.temperature, ...a.humidity, ...a.windows];

  return {
    el,
    entities: trackedIds(area),
    update,
    /** A changed area model (a device removed or restored): update in place, so the scroll position stays. */
    setArea(next) {
      area = next;
      title.textContent = next.name;
      shownKey = null;
      this.entities = trackedIds(next);
      update();
    },
    destroy: () => children.forEach((c) => c.destroy?.()),
  };
}
