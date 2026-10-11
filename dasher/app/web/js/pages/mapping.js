import { getJson, putJson } from "../core/api.js";
import { h } from "../core/h.js";
import { icon } from "../core/icons.js";
import { openModal } from "../core/modal.js";
import { format } from "../lib/i18n.js";
import { pressable } from "../tiles/common.js";

const STATUS = { missing: "map_missing", mapped: "map_mapped", ok: "map_ok" };
const statusOf = (item) => (!item.found ? "missing" : item.mapped ? "mapped" : "ok");

/**
 * Lets the user tell the dashboard which of their own entities to use when an entity of
 * dashboard.yaml does not exist. The choice goes to entity-map.yaml; dashboard.yaml stays as it is.
 */
export function createMappingPage(ctx) {
  const { t } = ctx;
  let items = [];
  let connected = true;
  let showAll = false;
  let error = null;

  const list = h("div", { class: "maplist" });
  const allBtn = h("button", { class: "chip-toggle", type: "button" }, t("map_show_all"));
  pressable(allBtn, { onTap: () => ((showAll = !showAll), render()) });
  const summary = h("span", { class: "mapping__summary" });
  const offline = h("p", { class: "view__hint", hidden: true }, t("map_offline"));

  const el = h(
    "div",
    { class: "mapping" },
    h("h1", { class: "radio__title" }, t("map_title")),
    h("p", { class: "mapping__hint" }, t("map_hint")),
    h("div", { class: "controls" }, h("div", { class: "controls__chips" }, allBtn), summary),
    offline,
    list,
  );

  async function load() {
    try {
      const data = await getJson("api/entities/mapping");
      items = data.items;
      connected = data.connected;
      error = null;
    } catch (err) {
      error = err.message;
    }
    render();
  }

  function render() {
    const missing = items.filter((i) => !i.found).length;
    summary.textContent = missing ? format(t, "map_n_missing", { n: missing }) : "";
    allBtn.classList.toggle("is-active", showAll);
    offline.hidden = connected;
    const visible = showAll ? items : items.filter((i) => !i.found || i.mapped);
    if (error) return list.replaceChildren(h("div", { class: "notice" }, icon("alert-circle-outline"), h("p", null, error)));
    if (!visible.length) {
      return list.replaceChildren(h("div", { class: "notice" }, icon("check-circle-outline"), h("h2", null, t("map_all_found"))));
    }
    list.replaceChildren(...visible.map(createRow));
  }

  function createRow(item) {
    const status = statusOf(item);
    const button = h("button", { class: "btn", type: "button" }, icon("swap-horizontal"), h("span", null, t(item.mapped || item.found ? "map_change" : "map_choose")));
    pressable(button, { onTap: () => openPicker(item) });
    return h(
      "div",
      { class: `maprow is-${status}` },
      h(
        "div",
        { class: "maprow__main" },
        h("code", { class: "maprow__id" }, item.id),
        item.tiles.length ? h("div", { class: "maprow__tiles" }, `${t("map_used_in")}: ${item.tiles.slice(0, 3).join(", ")}${item.tiles.length > 3 ? " …" : ""}`) : null,
        item.mapped ? h("div", { class: "maprow__to" }, icon("arrow-right"), h("span", null, item.name ? `${item.name} · ` : ""), h("code", null, item.mapped)) : null,
      ),
      h("span", { class: `maprow__status maprow__status--${status}` }, t(STATUS[status])),
      button,
    );
  }

  // ---- picker ------------------------------------------------------------------------
  function openPicker(item) {
    let modal;
    let timer;
    let generation = 0;
    const results = h("div", { class: "picker__list" });
    const input = h("input", { class: "msearch__input picker__search", type: "search", placeholder: t("map_search"), "aria-label": t("map_search"), autocomplete: "off", enterkeyhint: "search" });
    const heading = h("div", { class: "picker__sub" }, t("map_suggestions"));

    async function search() {
      const mine = ++generation;
      const q = input.value.trim();
      heading.textContent = q ? "" : t("map_suggestions");
      try {
        const data = await getJson(`api/entities/candidates?${new URLSearchParams({ for: item.id, q })}`);
        if (mine !== generation) return;
        results.replaceChildren(...(data.items.length ? data.items.map(createOption) : [h("p", { class: "view__hint" }, t("map_none"))]));
      } catch (err) {
        if (mine === generation) results.replaceChildren(h("p", { class: "view__hint" }, err.message));
      }
    }

    function createOption(candidate) {
      const chosen = candidate.id === (item.mapped ?? item.id);
      const meta = [candidate.area, candidate.device_class, candidate.unit].filter(Boolean).join(" · ");
      const row = h(
        "button",
        { class: `picker__item${chosen ? " is-chosen" : ""}`, type: "button" },
        h("span", { class: "picker__name" }, candidate.name ?? candidate.id),
        h("code", { class: "picker__id" }, candidate.id),
        meta ? h("span", { class: "picker__meta" }, meta) : null,
        chosen ? icon("check") : null,
      );
      pressable(row, { onTap: () => save(candidate.id) });
      return row;
    }

    async function save(to) {
      try {
        await putJson("api/entities/map", { from: item.id, to });
        modal.close();
        ctx.toast(t(to ? "map_saved" : "map_removed"));
        load();
      } catch (err) {
        ctx.toast(err.message);
      }
    }

    input.addEventListener("input", () => {
      clearTimeout(timer);
      timer = setTimeout(search, 300);
    });

    const removeBtn = item.mapped ? h("button", { class: "btn", type: "button" }, icon("link-variant-off"), h("span", null, t("map_remove"))) : null;
    if (removeBtn) pressable(removeBtn, { onTap: () => save(null) });

    modal = openModal(
      h(
        "div",
        { class: "modal__body picker" },
        h("div", { class: "modal__title" }, format(t, "map_pick_title", { id: item.id })),
        item.tiles.length ? h("div", { class: "picker__tiles" }, `${t("map_used_in")}: ${item.tiles.join(", ")}`) : null,
        input,
        heading,
        results,
        removeBtn,
      ),
      { onClose: () => clearTimeout(timer) },
    );
    search();
  }

  load();
  return { el, entities: [], update() {} };
}
