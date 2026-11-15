import { h } from "../core/h.js";
import { icon } from "../core/icons.js";
import { ALARM_MAX_SECONDS, ALARM_PRESETS, alarmTime } from "../lib/alarms.js";

export function createAlarmsPage(settings, ctx) {
  const { t, alarms, alarmAlert } = ctx;
  const running = h("div", { class: "alarm-running" });
  const clocks = new Map();
  let runningIds = null;
  const name = h("input", { class: "alarm-input", type: "text", maxlength: "80", placeholder: t("alarm_custom_name"), "aria-label": t("alarm_custom_name") });
  const hours = h("input", { class: "alarm-input", type: "number", min: "0", max: "24", value: "0", inputmode: "numeric", "aria-label": t("alarm_hours") });
  const minutes = h("input", { class: "alarm-input", type: "number", min: "0", max: "59", value: "5", inputmode: "numeric", "aria-label": t("alarm_minutes") });
  const seconds = h("input", { class: "alarm-input", type: "number", min: "0", max: "59", value: "0", inputmode: "numeric", "aria-label": t("alarm_seconds") });
  const error = h("p", { class: "alarm-warning", role: "alert", hidden: true });

  function start(label, duration, preset = "") {
    void alarmAlert.enableSound().then((enabled) => {
      if (!enabled) ctx.toast(t("alarm_sound_blocked"));
    });
    try {
      if (alarms.start({ name: label, seconds: duration, preset })) {
        error.hidden = true;
      } else {
        error.textContent = t("alarm_storage_error");
        error.hidden = false;
      }
    } catch (err) {
      console.warn("Could not start alarm:", err);
      error.textContent = t("alarm_invalid");
      error.hidden = false;
    }
  }

  const presets = h("div", { class: "alarm-presets" }, ALARM_PRESETS.map((preset) =>
    h("button", { class: "alarm-preset", type: "button", onclick: () => start(t(`alarm_${preset.id}`), preset.seconds, preset.id) },
      h("img", { src: preset.image, alt: "", loading: "lazy" }),
      h("span", { class: "alarm-preset__name" }, t(`alarm_${preset.id}`)),
      h("span", { class: "alarm-preset__time" }, `${preset.seconds / 60} ${t("alarm_min_short")}`),
      h("span", { class: "alarm-preset__start" }, icon("play"), t("alarm_start")),
    )));
  const custom = h("form", { class: "alarm-custom", onsubmit: (event) => {
    event.preventDefault();
    const fields = [hours, minutes, seconds].map((input) => input.value === "" ? NaN : Number(input.value));
    const duration = fields[0] * 3600 + fields[1] * 60 + fields[2];
    if (fields.some((value, i) => !Number.isInteger(value) || value < 0 || value > (i === 0 ? 24 : 59))
      || duration < 1 || duration > ALARM_MAX_SECONDS) {
      error.textContent = t("alarm_invalid");
      error.hidden = false;
      return;
    }
    start(name.value.trim() || t("alarm_custom"), duration);
  } },
    h("h2", null, t("alarm_custom")),
    h("label", { class: "alarm-field" }, t("alarm_name"), name),
    h("div", { class: "alarm-fields" },
      [hours, minutes, seconds].map((input, i) => h("label", { class: "alarm-field" }, t(["alarm_hours", "alarm_minutes", "alarm_seconds"][i]), input))),
    error,
    h("button", { class: "alarm-btn", type: "submit" }, icon("play"), t("alarm_start_custom")),
  );
  const root = h("div", { class: "alarm-page" },
    h("header", { class: "alarm-head" }, icon(settings.icon), h("div", null, h("h1", null, settings.title || t("alarm_title")), h("p", null, t("alarm_intro")))),
    h("section", null, h("h2", null, t("alarm_presets")), presets),
    h("div", { class: "alarm-lower" }, custom,
      h("section", { class: "alarm-active" }, h("h2", null, t("alarm_active")), running)),
    h("p", { class: "alarm-hint" }, t("alarm_local_hint")),
  );

  function update() {
    const items = alarms.items.filter((item) => item.end > alarms.now());
    const signature = items.map((item) => item.id).join("|");
    if (runningIds !== signature) {
      runningIds = signature;
      clocks.clear();
      running.replaceChildren(...(items.length ? items.map((item) => {
        const clock = h("span", { class: "alarm-running__remaining" });
        clocks.set(item.id, clock);
        return h("div", { class: "alarm-running__item" },
          h("div", null, h("strong", null, item.name), clock),
          h("button", { class: "alarm-btn alarm-btn--secondary", type: "button", "aria-label": `${t("alarm_cancel")}: ${item.name}`, onclick: () => alarms.remove(item.id) }, t("alarm_cancel")));
      }) : [h("p", { class: "alarm-hint" }, t("alarm_none"))]));
    }
    for (const item of items) clocks.get(item.id).textContent = alarmTime((item.end - alarms.now()) / 1000);
  }
  const unsubscribe = alarms.subscribe(update);
  const interval = setInterval(update, 1000);
  update();
  return { el: root, entities: [], update, destroy() { clearInterval(interval); unsubscribe(); } };
}
