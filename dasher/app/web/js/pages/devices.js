import { h } from "../core/h.js";
import { icon, setIcon } from "../core/icons.js";
import { formatNumber, isUnavailable } from "../lib/format.js";
import { powerCall, stepTarget } from "../lib/climate.js";
import { applianceInfo, batteryIcon, formatRemaining, vacuumInfo, vacuumMainCall } from "../lib/devices.js";
import { translateState } from "../lib/i18n.js";
import { friendlyName, pressable } from "../tiles/common.js";

const KIND_ICONS = { washer: "washing-machine", dryer: "tumble-dryer", dishwasher: "dishwasher", heater: "radiator" };
const SECTIONS = [
  ["vacuums", "dev_vacuums"],
  ["dishwasher", "dev_dishwashers"],
  ["dryer", "dev_dryers"],
  ["washer", "dev_washers"],
];
const SEND_DELAY_MS = 600;

const button = (iconName, label, onTap, cls = "devbtn") => {
  const b = h("button", { class: cls, type: "button" }, icon(iconName), h("span", null, label));
  pressable(b, { onTap });
  return b;
};

/** The Devices page: robot vacuums with their controls, and washing machines, dryers, dishwashers and clothes heaters. */
export function createDevicesPage(model, ctx) {
  const { t, getState } = ctx;
  const num = (v, d = 0) => formatNumber(v, { locale: ctx.locale, decimals: d });
  const call = (id, service, data) => ctx.call(id.slice(0, id.indexOf(".")), service, id, data);
  const cards = [];

  // ---- vacuum ---------------------------------------------------------------------------
  function createVacuumCard(id) {
    const name = h("span", { class: "devcard__name" });
    const iconEl = icon("robot-vacuum");
    const batteryIconEl = icon("battery-unknown");
    const batteryText = h("span");
    const battery = h("span", { class: "devchip" }, batteryIconEl, batteryText);
    const status = h("div", { class: "devcard__status" });
    const error = h("div", { class: "devcard__error" });
    const mainIcon = icon("play");
    const mainLabel = h("span");
    const main = h("button", { class: "devbtn devbtn--primary", type: "button" }, mainIcon, mainLabel);
    const dock = button("home-import-outline", t("dev_dock"), () => call(id, "return_to_base"));
    const locate = button("map-marker-radius-outline", t("dev_locate"), () => call(id, "locate"));
    const speeds = h("div", { class: "devspeeds" });
    const card = h("section", { class: "devcard" }, h("div", { class: "devcard__top" }, iconEl, name, battery), status, error, h("div", { class: "devcard__buttons" }, main, dock, locate), speeds);

    pressable(main, {
      onTap: () => {
        const action = vacuumMainCall(vacuumInfo(getState(id)));
        if (action) call(id, action.service);
      },
    });

    return {
      entities: [id],
      el: card,
      update() {
        const e = getState(id);
        const info = vacuumInfo(e);
        card.className = `devcard is-${info.status}${info.cleaning ? " is-active" : ""}`;
        name.textContent = friendlyName(e, id).replace(/\s+/g, " ").trim();
        setIcon(iconEl, info.cleaning ? "robot-vacuum" : info.docked ? "robot-vacuum" : info.status === "error" ? "robot-vacuum-alert" : "robot-vacuum-variant");
        battery.hidden = info.battery == null;
        if (info.battery != null) {
          setIcon(batteryIconEl, batteryIcon(info.battery, info.charging));
          batteryText.textContent = `${num(info.battery)}%`;
        }
        status.textContent = info.usable ? (t(`dev_vac_${info.status}`) !== `dev_vac_${info.status}` ? t(`dev_vac_${info.status}`) : translateState(t, info.status)) : t(info.status === "unknown" ? "unknown" : "unavailable");
        error.textContent = info.error ?? "";
        error.hidden = !info.error;
        const action = info.usable ? vacuumMainCall(info) : null;
        main.disabled = !action;
        const pausing = action?.service === "pause" || action?.service === "stop";
        setIcon(mainIcon, pausing ? "pause" : "play");
        mainLabel.textContent = t(pausing ? "dev_pause" : info.paused ? "dev_resume" : "dev_start");
        dock.disabled = !info.usable || !info.canDock || info.docked || info.returning;
        dock.hidden = info.usable && !info.canDock;
        locate.hidden = info.usable && !info.canLocate;
        locate.disabled = !info.usable;
        speeds.hidden = !info.fanSpeeds.length;
        if (info.fanSpeeds.length) {
          speeds.replaceChildren(
            ...info.fanSpeeds.map((speed) => {
              const chip = h("button", { class: `devspeed${speed === info.fanSpeed ? " is-active" : ""}`, type: "button" }, translateState(t, speed));
              pressable(chip, { onTap: () => call(id, "set_fan_speed", { fan_speed: speed }) });
              return chip;
            }),
          );
        }
      },
    };
  }

  // ---- appliance ----------------------------------------------------------------------------
  function createApplianceCard(app) {
    const roles = app.roles;
    const name = h("span", { class: "devcard__name" }, app.name ?? "");
    const statusChip = h("span", { class: "devchip" });
    const big = h("div", { class: "devcard__big" });
    const status = h("div", { class: "devcard__status" });
    const buttons = h("div", { class: "devcard__buttons" });

    let powerSwitch = null;
    if (roles.power_entity) {
      powerSwitch = h("button", { class: "evswitch", type: "button", role: "switch", "aria-checked": "false", "aria-label": t("dev_power") }, h("span", { class: "evswitch__knob" }));
      pressable(powerSwitch, {
        onTap: () => {
          const id = roles.power_entity;
          if (id.startsWith("climate.")) {
            const c = powerCall(getState(id));
            call(id, c.service, c.data);
          } else call(id, "toggle");
        },
      });
    }

    const startIcon = icon("play");
    const startLabel = h("span");
    const startBtn = roles.operation_entity ? h("button", { class: "devbtn devbtn--primary", type: "button" }, startIcon, startLabel) : null;
    if (startBtn) {
      pressable(startBtn, {
        onTap: () => {
          const info = applianceInfo(roles, getState);
          call(roles.operation_entity, "select_option", { option: info.active ? "stop" : "start" });
        },
      });
      buttons.append(startBtn);
    }

    // delayed end (hours), when the appliance has it
    let pendingDelay = null;
    let delayTimer = null;
    const delayValue = h("span", { class: "evtemp__value" });
    const delayPaint = () => {
      const state = getState(roles.delay_entity);
      const shown = pendingDelay ?? (isUnavailable(state) ? null : Number(state.state));
      delayValue.textContent = shown != null && Number.isFinite(shown) ? (shown === 0 ? t("dev_delay_none") : `${num(shown)} h`) : "–";
    };
    const nudge = (direction) => {
      const state = getState(roles.delay_entity);
      if (isUnavailable(state)) return;
      const a = state.attributes ?? {};
      pendingDelay = stepTarget(pendingDelay ?? Number(state.state), direction, { step: Number(a.step) || 1, min: Number(a.min ?? 0), max: Number(a.max ?? 24) });
      delayPaint();
      clearTimeout(delayTimer);
      delayTimer = setTimeout(() => {
        const value = pendingDelay;
        delayTimer = null;
        call(roles.delay_entity, "set_value", { value });
      }, SEND_DELAY_MS);
    };
    const mk = (iconName, direction) => {
      const b = h("button", { class: "clbtn", type: "button", "aria-label": direction > 0 ? "+" : "−" }, icon(iconName));
      pressable(b, { onTap: () => nudge(direction) });
      return b;
    };
    const delayMinus = roles.delay_entity ? mk("minus", -1) : null;
    const delayPlus = roles.delay_entity ? mk("plus", 1) : null;
    const delayRow = roles.delay_entity
      ? h("div", { class: "evtemp" }, h("span", { class: "evtemp__label" }, t("dev_delay")), h("div", { class: "evtemp__control" }, delayMinus, delayValue, delayPlus))
      : null;

    const iconEl = icon(KIND_ICONS[app.kind] ?? "washing-machine");
    const card = h("section", { class: "devcard" }, h("div", { class: "devcard__top" }, iconEl, name, powerSwitch), h("div", { class: "devcard__row" }, big, statusChip), status, buttons.childElementCount ? buttons : null, delayRow);

    return {
      entities: Object.values(roles),
      destroy: () => clearTimeout(delayTimer),
      el: card,
      update() {
        const info = applianceInfo(roles, getState);
        const first = roles.status_entity ?? roles.power_entity;
        const e = getState(first);
        name.textContent = app.name ?? friendlyName(e, first).replace(/\s*(Current status|Power)$/i, "");
        card.className = `devcard is-${info.unavailable ? "unavailable" : info.active ? "active" : "idle"}`;
        const label = info.unavailable ? t("unavailable") : info.status ? (t(`dev_status_${info.status}`) !== `dev_status_${info.status}` ? t(`dev_status_${info.status}`) : translateState(t, info.status)) : info.powerOn == null ? "" : t(info.powerOn ? "on" : "off");
        statusChip.textContent = label;
        statusChip.hidden = !label;
        statusChip.classList.toggle("is-on", info.active);
        big.textContent = info.remaining != null ? formatRemaining(info.remaining) : "";
        big.hidden = info.remaining == null;
        status.textContent = info.remaining != null ? t("dev_left") : "";
        status.hidden = info.remaining == null;
        if (powerSwitch) {
          powerSwitch.classList.toggle("is-on", info.powerOn === true);
          powerSwitch.setAttribute("aria-checked", String(info.powerOn === true));
          powerSwitch.disabled = info.unavailable || isUnavailable(getState(roles.power_entity));
        }
        if (startBtn) {
          const stopping = info.active && info.canStop;
          setIcon(startIcon, stopping ? "stop" : "play");
          startLabel.textContent = t(stopping ? "dev_stop" : "dev_start_remote");
          startBtn.disabled = info.unavailable || !(stopping || (!info.active && info.canStart));
        }
        if (delayRow) {
          const state = getState(roles.delay_entity);
          if (pendingDelay !== null && !delayTimer && Number(state?.state) === pendingDelay) pendingDelay = null;
          delayMinus.disabled = delayPlus.disabled = isUnavailable(state);
          delayPaint();
        }
      },
    };
  }

  // ---- sections ------------------------------------------------------------------------------
  const sections = [];
  const groups = {
    vacuums: model.vacuums.map(createVacuumCard),
    dishwasher: model.appliances.filter((a) => a.kind === "dishwasher").map(createApplianceCard),
    dryer: model.appliances.filter((a) => a.kind === "dryer" || a.kind === "heater").map(createApplianceCard),
    washer: model.appliances.filter((a) => a.kind === "washer").map(createApplianceCard),
  };
  for (const [key, label] of SECTIONS) {
    if (!groups[key].length) continue;
    cards.push(...groups[key]);
    sections.push(h("section", { class: "devsection" }, h("h2", { class: "devsection__title" }, t(label)), h("div", { class: "devgrid" }, groups[key].map((c) => c.el))));
  }
  const el = h(
    "div",
    { class: "devpage" },
    h("h1", { class: "radio__title" }, model.title ?? t("dev_devices")),
    sections.length ? sections : h("div", { class: "notice" }, icon("washing-machine"), h("h2", null, t("dev_none"))),
  );

  return {
    el,
    entities: [...new Set(cards.flatMap((c) => c.entities))],
    update() {
      for (const c of cards) {
        try {
          c.update();
        } catch (err) {
          console.error(err); // one broken card must not stop the others
        }
      }
    },
    destroy() {
      for (const c of cards) c.destroy?.();
    },
  };
}
