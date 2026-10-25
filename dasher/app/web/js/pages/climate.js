import { createDial } from "../components/dial.js";
import { h } from "../core/h.js";
import { icon } from "../core/icons.js";
import { formatNumber, isUnavailable } from "../lib/format.js";
import { climateStatus, climateSummary, niceName, powerCall, stepTarget } from "../lib/climate.js";
import { format } from "../lib/i18n.js";
import { friendlyName, pressable } from "../tiles/common.js";

const SEND_DELAY_MS = 600;

/** Overview of the climate entities: one card per room with the temperature, the setpoint and a power button. */
export function createClimatePage(model, ctx) {
  const { t, getState } = ctx;
  const ids = model.entities ?? [];
  const num = (v, decimals = 1) => formatNumber(v, { locale: ctx.locale, decimals });

  const heroTemp = h("div", { class: "clhero__temp" });
  const heroLabel = h("div", { class: "clhero__label" });
  const heroChips = h("div", { class: "clhero__chips" });
  const hero = h("div", { class: "clhero", hidden: true }, h("div", null, heroTemp, heroLabel), heroChips);
  const grid = h("div", { class: "clgrid" });
  const el = h("div", { class: "climate-page" }, h("h1", { class: "radio__title" }, model.title ?? t("climate")), hero, grid);

  const cards = ids.map((id) => {
    const state = { pending: null, timer: null };
    const name = h("span", { class: "clcard__name" });
    const status = h("div", { class: "clcard__status" });
    const temp = h("div", { class: "clcard__temp" });
    const target = h("span", { class: "clcard__target" });
    const minus = h("button", { class: "clbtn", type: "button", "aria-label": "−" }, icon("minus"));
    const plus = h("button", { class: "clbtn", type: "button", "aria-label": "+" }, icon("plus"));
    const power = h("button", { class: "clbtn clbtn--power", type: "button", "aria-label": "Power" }, icon("power"));
    const dial = createDial({
      onInput: (value) => {
        state.pending = value;
        paintTarget();
      },
      onCommit: (value) => {
        state.pending = value;
        paintTarget();
        clearTimeout(state.timer);
        state.timer = null;
        ctx.call("climate", "set_temperature", id, { temperature: value });
      },
    });
    dial.center.append(temp, status, target);
    const controls = h("div", { class: "clcard__controls" }, minus, plus);
    const card = h("section", { class: "clcard" }, h("div", { class: "clcard__top" }, icon("radiator"), name, power), dial.el, controls);

    const entity = () => getState(id);
    const range = () => {
      const a = entity()?.attributes ?? {};
      return { step: Number(a.target_temp_step ?? a.target_temperature_step) || 0.5, min: a.min_temp ?? 5, max: a.max_temp ?? 35 };
    };
    const nudge = (direction) => {
      const current = state.pending ?? entity()?.attributes?.temperature;
      state.pending = stepTarget(current, direction, range());
      paintTarget();
      clearTimeout(state.timer);
      state.timer = setTimeout(() => {
        const value = state.pending;
        state.timer = null;
        ctx.call("climate", "set_temperature", id, { temperature: value });
      }, SEND_DELAY_MS);
    };
    pressable(minus, { onTap: () => nudge(-1) });
    pressable(plus, { onTap: () => nudge(1) });
    pressable(power, {
      onTap: () => {
        const call = powerCall(entity());
        ctx.call("climate", call.service, id, call.data);
      },
    });

    function paintTarget() {
      const attrs = entity()?.attributes ?? {};
      const setpoint = state.pending ?? attrs.temperature;
      target.textContent = setpoint != null ? `→ ${num(setpoint)}°` : "";
      const { min, max, step } = range();
      dial.set({ value: setpoint ?? null, current: attrs.current_temperature, min, max, step });
    }

    return {
      id,
      state,
      el: card,
      update() {
        const e = entity();
        const attrs = e?.attributes ?? {};
        const kind = climateStatus(e);
        if (state.pending !== null && attrs.temperature === state.pending && !state.timer) state.pending = null;
        card.className = `clcard is-${kind}`;
        name.textContent = niceName(friendlyName(e, id));
        temp.textContent = attrs.current_temperature != null ? `${num(attrs.current_temperature)}°` : "–";
        card.classList.toggle("is-set", attrs.temperature != null && kind !== "off" && kind !== "unavailable");
        status.textContent = kind === "unavailable" ? t("unavailable") : t(`climate_${kind}`) !== `climate_${kind}` ? t(`climate_${kind}`) : t(e.state);
        const hasSetpoint = attrs.temperature != null;
        for (const control of [minus, plus, target]) control.hidden = !hasSetpoint;
        controls.hidden = !hasSetpoint;
        minus.disabled = plus.disabled = isUnavailable(e);
        power.disabled = isUnavailable(e);
        paintTarget();
      },
    };
  });
  grid.append(...cards.map((c) => c.el));

  return {
    el,
    entities: ids,
    update() {
      for (const card of cards) card.update();
      const states = ids.map((id) => getState(id)).filter(Boolean);
      const stats = climateSummary(states);
      hero.hidden = !stats.total;
      heroTemp.textContent = stats.average != null ? `${num(stats.average)}°` : "–";
      heroLabel.textContent = t("climate_average_label");
      const kinds = states.map((e) => climateStatus(e));
      const chip = (kind, text) => h("span", { class: `clchip is-${kind}` }, text);
      heroChips.replaceChildren(
        chip("on", format(t, "climate_summary", { on: stats.on, total: stats.total })),
        ...["heating", "cooling"].filter((k) => kinds.includes(k)).map((k) => chip(k, `${kinds.filter((x) => x === k).length} ${t(`climate_${k}`).toLowerCase()}`)),
      );
    },
    destroy() {
      for (const card of cards) clearTimeout(card.state.timer);
    },
  };
}
