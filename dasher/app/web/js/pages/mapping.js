import { getJson, putJson } from "../core/api.js";
import { h } from "../core/h.js";
import { icon } from "../core/icons.js";
import { openModal } from "../core/modal.js";
import { format } from "../lib/i18n.js";
import { buildSnippet } from "../lib/suggestions.js";
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
  let suggestions = [];
  const picks = {}; // suggestion id -> { entities, weather_entity, entity } chosen so far, kept while the screen is open
  const units = {};
  let connected = true;
  let showAll = false;
  let error = null;

  const list = h("div", { class: "maplist" });
  const suggestionsBox = h("div", { class: "mapsuggest", hidden: true });
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
    suggestionsBox,
  );

  async function load() {
    try {
      const data = await getJson("api/entities/mapping");
      items = data.items;
      suggestions = data.suggestions ?? [];
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
    renderSuggestions();
    if (error) return list.replaceChildren(h("div", { class: "notice" }, icon("alert-circle-outline"), h("p", null, error)));
    if (!visible.length && suggestions.length) return list.replaceChildren(h("p", { class: "mapping__ok" }, icon("check-circle-outline"), t("map_all_found")));
    if (!visible.length) {
      return list.replaceChildren(h("div", { class: "notice" }, icon("check-circle-outline"), h("h2", null, t("map_all_found"))));
    }
    list.replaceChildren(...visible.map(createRow));
  }

  function renderSuggestions() {
    suggestionsBox.hidden = !suggestions.length || Boolean(error);
    suggestionsBox.replaceChildren(
      h("h2", { class: "mapsuggest__title" }, t("sug_title")),
      h("p", { class: "mapping__hint" }, t("sug_hint")),
      ...suggestions.map((sug) => {
        const button = h("button", { class: "btn", type: "button" }, icon("playlist-edit"), h("span", null, t("sug_set_up")));
        pressable(button, { onTap: () => openSuggestion(sug) });
        return h(
          "div",
          { class: "maprow" },
          h("div", { class: "maprow__main" }, h("div", { class: "mapsuggest__name" }, t(`sug_${sug.id}`)), h("div", { class: "maprow__tiles" }, t(`sug_${sug.id}_text`))),
          h("span", { class: "maprow__status maprow__status--ok" }, t("sug_new")),
          button,
        );
      }),
    );
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

  // ---- suggestions: pick entities and copy the YAML --------------------------------------
  function openSuggestion(sug) {
    const state = (picks[sug.id] ??= {});
    const snippet = h("pre", { class: "snippet" });
    const copy = h("button", { class: "btn btn--primary", type: "button" }, icon("content-copy"), h("span", null, t("sug_copy")));
    const paint = () => {
      snippet.textContent = buildSnippet(sug.id, state, units) || t("sug_pick_first");
      copy.disabled = !buildSnippet(sug.id, state, units);
    };

    pressable(copy, {
      onTap: async () => {
        const text = snippet.textContent;
        const done = () => ctx.toast(t("sug_copied"));
        try {
          await navigator.clipboard.writeText(text);
          return done();
        } catch {
          // Plain http pages have no clipboard API; select the text so it can be copied by hand.
          const range = document.createRange();
          range.selectNodeContents(snippet);
          const selection = getSelection();
          selection.removeAllRanges();
          selection.addRange(range);
          if (document.execCommand?.("copy")) done();
          else ctx.toast(t("sug_select_hint"));
        }
      },
    });

    const sections = sug.fields.map((field) => {
      const options = h("div", { class: "picker__list picker__list--short" });
      const label = h("div", { class: "picker__sub" }, t(`sug_field_${field.key}`));
      const isChosen = (id) => (field.multi ? (state[field.key] ?? []).includes(id) : state[field.key] === id);
      const toggle = (id) => {
        if (field.multi) {
          const set = new Set(state[field.key] ?? []);
          set.has(id) ? set.delete(id) : set.add(id);
          state[field.key] = [...set];
        } else state[field.key] = state[field.key] === id ? null : id;
        paintOptions();
        paint();
      };
      let candidates = [];
      const paintOptions = () => {
        options.replaceChildren(
          ...(candidates.length
            ? candidates.map((c) => {
                const row = h(
                  "button",
                  { class: `picker__item${isChosen(c.id) ? " is-chosen" : ""}`, type: "button" },
                  h("span", { class: "picker__name" }, c.name ?? c.id),
                  h("code", { class: "picker__id" }, c.id),
                  c.unit ? h("span", { class: "picker__meta" }, c.unit) : null,
                  isChosen(c.id) ? icon("check") : null,
                );
                pressable(row, { onTap: () => toggle(c.id) });
                return row;
              })
            : [h("p", { class: "view__hint" }, t("map_none"))]),
        );
      };
      const input = h("input", { class: "msearch__input picker__search", type: "search", placeholder: t("map_search"), "aria-label": t("map_search"), autocomplete: "off" });
      let timer;
      let generation = 0;
      const search = async () => {
        const mine = ++generation;
        try {
          const data = await getJson(`api/entities/candidates?${new URLSearchParams({ for: field.for, q: input.value.trim() })}`);
          if (mine !== generation) return;
          candidates = data.items;
          for (const c of candidates) if (c.unit) units[c.id] = c.unit;
          paintOptions();
        } catch (err) {
          if (mine === generation) options.replaceChildren(h("p", { class: "view__hint" }, err.message));
        }
      };
      input.addEventListener("input", () => {
        clearTimeout(timer);
        timer = setTimeout(search, 300);
      });
      search();
      return h("div", { class: "mapsuggest__field" }, label, field.multi ? null : input, options, field.optional ? h("div", { class: "picker__tiles" }, t("sug_optional")) : null);
    });

    paint();
    openModal(
      h(
        "div",
        { class: "modal__body picker" },
        h("div", { class: "modal__title" }, t(`sug_${sug.id}`)),
        h("div", { class: "picker__tiles" }, t(`sug_${sug.id}_where`)),
        ...sections,
        h("div", { class: "picker__sub" }, t("sug_yaml")),
        snippet,
        copy,
      ),
    );
  }

  load();
  return { el, entities: [], update() {} };
}
