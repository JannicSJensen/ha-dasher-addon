import { assetUrl } from "../core/api.js";
import { h } from "../core/h.js";
import { icon, setIcon } from "../core/icons.js";
import { confirmDialog, openTimePicker } from "../components/dialogs.js";
import { formatNumber, isUnavailable } from "../lib/format.js";
import { batteryOf, chargeAction, isCharging, isPluggedIn, plannedWindow } from "../lib/ev.js";
import { format, translateState } from "../lib/i18n.js";
import { pressable } from "../tiles/common.js";

const BUSY_MS = 7000;
const STATUS_KEYS = new Set(["waiting_for_new_prices", "no_charging_planned", "waiting_for_charging_to_begin", "charging", "keeping_charger_on", "disconnected", "smart_charging_not_active", "low_price_charging", "low_soc_charging"]);

/**
 * The car page: battery and range, start/stop charging, smart charging with the times it should
 * charge, and a restart of the charger. Cards of entities that do not exist are left out.
 */
export function createEvPage(model, ctx) {
  const { t, getState } = ctx;
  const roles = model.roles ?? {};
  let busyUntil = 0;
  let busyTimer = null;

  const call = (id, service, data) => ctx.call(id.slice(0, id.indexOf(".")), service, id, data);

  // ---- car --------------------------------------------------------------------------
  const fill = h("div", { class: "evbar__fill" });
  const targetMark = h("div", { class: "evbar__target" });
  const percent = h("div", { class: "evcar__percent" });
  const targetText = h("div", { class: "evcar__target" });
  const range = h("div", { class: "evcar__range" });
  const plugChip = h("span", { class: "evchip" });
  const chargeChip = h("span", { class: "evchip" });
  const art = model.image
    ? h("img", { class: "evcar__img", src: assetUrl(model.image), alt: "", draggable: "false" })
    : h("div", { class: "evcar__glyph" }, icon("car-electric"));
  if (model.image) art.addEventListener("error", () => art.replaceWith(h("div", { class: "evcar__glyph" }, icon("car-electric"))));

  const car = h(
    "section",
    { class: "evcard evcar" },
    model.name ? h("h2", { class: "evcar__name" }, model.name) : null,
    art,
    h("div", { class: "evcar__battery" }, percent, h("div", { class: "evbar" }, fill, targetMark)),
    targetText,
    range,
    h("div", { class: "evcar__chips" }, plugChip, chargeChip),
  );

  // ---- charging now -------------------------------------------------------------------
  const startCall = chargeAction(roles, "start");
  const stopCall = chargeAction(roles, "stop");
  const chargeStatus = h("div", { class: "evcard__status" });
  const mainIcon = icon("flash");
  const mainLabel = h("span");
  const main = h("button", { class: "evbtn evbtn--primary", type: "button" }, mainIcon, mainLabel);
  pressable(main, {
    onTap: () => {
      const charging = isCharging(roles, getState);
      const action = charging ? stopCall : startCall;
      if (!action) return;
      call(action.id, action.service, action.data);
      busyUntil = Date.now() + BUSY_MS;
      clearTimeout(busyTimer);
      busyTimer = setTimeout(update, BUSY_MS + 50);
      update();
    },
  });
  const chargeCard = startCall || stopCall ? h("section", { class: "evcard" }, h("h3", { class: "evcard__title" }, t("ev_charging")), chargeStatus, main) : null;

  // ---- smart charging --------------------------------------------------------------------
  const smartSwitch = roles.smart_switch_entity
    ? h("button", { class: "evswitch", type: "button", role: "switch", "aria-checked": "false", "aria-label": t("ev_smart") }, h("span", { class: "evswitch__knob" }))
    : null;
  if (smartSwitch) pressable(smartSwitch, { onTap: () => call(roles.smart_switch_entity, "toggle") });
  const smartStatus = h("div", { class: "evcard__status" });
  const smartPlan = h("div", { class: "evcard__plan" });

  const timeRow = (role, label, iconName) => {
    if (!roles[role]) return null;
    const value = h("span", { class: "evtime__value" });
    const el = h("button", { class: "evtime", type: "button" }, icon(iconName), h("span", { class: "evtime__text" }, h("span", { class: "evtime__label" }, label), value));
    pressable(el, {
      onTap: () => {
        const state = getState(roles[role]);
        if (isUnavailable(state)) return;
        openTimePicker({
          title: label,
          options: state.attributes?.options,
          current: state.state,
          offLabel: t("ev_off"),
          onPick: (option) => ctx.call("select", "select_option", roles[role], { option }),
        });
      },
    });
    return { role, el, value };
  };
  const times = [timeRow("start_time_entity", t("ev_earliest"), "clock-start"), timeRow("ready_time_entity", t("ev_ready_by"), "clock-check-outline")].filter(Boolean);
  const hasSmart = smartSwitch || roles.smart_status_entity || times.length;
  const smartCard = hasSmart
    ? h(
        "section",
        { class: "evcard" },
        h("div", { class: "evcard__head" }, h("h3", { class: "evcard__title" }, t("ev_smart")), smartSwitch),
        smartStatus,
        smartPlan,
        times.length ? h("div", { class: "evtimes" }, times.map((r) => r.el)) : null,
      )
    : null;

  // ---- charger -----------------------------------------------------------------------------
  const restart = roles.restart_entity
    ? h("button", { class: "evbtn", type: "button" }, icon("restart"), h("span", null, t("ev_restart")))
    : null;
  if (restart) {
    pressable(restart, {
      onTap: () =>
        confirmDialog({
          title: t("ev_restart_title"),
          text: t("ev_restart_text"),
          confirmLabel: t("ev_restart_do"),
          cancelLabel: t("cancel"),
          danger: true,
          onConfirm: () => {
            const id = roles.restart_entity;
            const domain = id.slice(0, id.indexOf("."));
            ctx.call(domain, domain === "switch" ? "turn_on" : "press", id);
            ctx.toast(t("ev_restart_sent"));
          },
        }),
    });
  }
  const chargerCard = restart ? h("section", { class: "evcard" }, h("h3", { class: "evcard__title" }, t("ev_charger")), restart) : null;

  const nothing = !chargeCard && !smartCard && !chargerCard
    ? h("div", { class: "notice" }, icon("car-electric"), h("h2", null, t("ev_nothing")), h("p", null, t("ev_nothing_hint")))
    : null;

  const el = h(
    "div",
    { class: "ev" },
    h(
      "div",
      { class: "ev__inner" },
      h("h1", { class: "radio__title ev__title" }, model.title ?? t("ev_car")),
      h("div", { class: "ev__grid" }, car, h("div", { class: "ev__col" }, chargeCard, smartCard, chargerCard, nothing)),
    ),
  );

  // ---- rendering ---------------------------------------------------------------------------
  function update() {
    const { percent: level, target } = batteryOf(roles, getState);
    const hasBattery = level != null;
    percent.textContent = hasBattery ? `${formatNumber(level, { locale: ctx.locale, decimals: 0 })}%` : "–";
    fill.style.width = `${hasBattery ? Math.min(100, Math.max(0, level)) : 0}%`;
    fill.classList.toggle("is-low", hasBattery && level < 20);
    targetMark.hidden = target == null;
    if (target != null) targetMark.style.left = `${Math.min(100, Math.max(0, target))}%`;
    targetText.textContent = target != null ? format(t, "ev_target", { n: formatNumber(target, { locale: ctx.locale, decimals: 0 }) }) : "";

    const rangeState = roles.range_entity ? getState(roles.range_entity) : null;
    const rangeValue = !isUnavailable(rangeState) ? Number(rangeState.state) : NaN;
    range.textContent = Number.isFinite(rangeValue) ? `${formatNumber(rangeValue, { locale: ctx.locale, decimals: 0 })} ${rangeState.attributes?.unit_of_measurement ?? "km"}` : "";
    range.hidden = !range.textContent;

    const plugged = isPluggedIn(roles, getState);
    plugChip.hidden = plugged == null;
    plugChip.className = `evchip${plugged ? " is-on" : ""}`;
    plugChip.replaceChildren(icon(plugged ? "power-plug" : "power-plug-off"), t(plugged ? "ev_plugged" : "ev_unplugged"));

    const charging = isCharging(roles, getState);
    chargeChip.hidden = charging == null;
    chargeChip.className = `evchip${charging ? " is-on is-charging" : ""}`;
    chargeChip.replaceChildren(icon(charging ? "flash" : "flash-off"), t(charging ? "ev_charging_now" : "ev_not_charging"));

    if (chargeCard) {
      const busy = Date.now() < busyUntil;
      const action = charging ? stopCall : startCall;
      chargeStatus.textContent = charging == null ? t("unavailable") : t(charging ? "ev_charging_now" : "ev_not_charging");
      setIcon(mainIcon, charging ? "stop-circle-outline" : "play-circle-outline");
      mainLabel.textContent = t(charging ? "ev_stop" : "ev_start");
      main.disabled = !action || charging == null;
      main.classList.toggle("is-busy", busy);
      main.classList.toggle("is-stop", Boolean(charging));
    }

    if (smartCard) {
      if (smartSwitch) {
        const on = getState(roles.smart_switch_entity)?.state === "on";
        smartSwitch.classList.toggle("is-on", on);
        smartSwitch.setAttribute("aria-checked", String(on));
        smartSwitch.disabled = isUnavailable(getState(roles.smart_switch_entity));
      }
      const status = roles.smart_status_entity ? getState(roles.smart_status_entity) : null;
      smartStatus.textContent = !status || isUnavailable(status) ? "" : STATUS_KEYS.has(status.state) ? t(`ev_status_${status.state}`) : translateState(t, status.state);
      const info = roles.smart_info_entity ? getState(roles.smart_info_entity) : null;
      const plan = plannedWindow(info?.attributes);
      smartPlan.textContent = plan ? format(t, "ev_planned", plan) : "";
      smartPlan.hidden = !plan;
      for (const row of times) {
        const state = getState(roles[row.role]);
        const isTime = /^\d{1,2}:\d{2}/.test(String(state?.state));
        row.value.textContent = isUnavailable(state) ? "–" : isTime ? state.state.slice(0, 5) : t("ev_off");
        row.el.classList.toggle("is-off", !isTime);
        row.el.disabled = isUnavailable(state);
      }
    }
    // A button reports "unknown" until it has been pressed once, so only "unavailable" disables it.
    if (restart) restart.disabled = !getState(roles.restart_entity) || getState(roles.restart_entity).state === "unavailable";
  }

  return {
    el,
    entities: Object.values(roles),
    update,
    destroy() {
      clearTimeout(busyTimer);
    },
  };
}
