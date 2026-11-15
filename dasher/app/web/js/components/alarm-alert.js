import { h } from "../core/h.js";

export function createAlarmAlert(timers, translate, { audioFactory = () => new (globalThis.AudioContext || globalThis.webkitAudioContext)() } = {}) {
  const root = h("div", { class: "alarm-alert", hidden: true, role: "alertdialog", "aria-modal": "true", "aria-labelledby": "alarm-alert-title" });
  let audio;
  let soundError = false;
  let playing = false;
  let signature = "";

  async function enableSound() {
    try {
      audio ??= audioFactory();
      await audio.resume();
      if (audio.state !== "running") throw new Error("Audio is suspended");
      soundError = false;
    } catch (error) {
      console.warn("Alarm sound unavailable:", error);
      soundError = true;
    }
    signature = "";
    paint();
    return !soundError;
  }

  function beep() {
    if (!audio || audio.state !== "running") return;
    try {
      const oscillator = audio.createOscillator();
      const gain = audio.createGain();
      oscillator.type = "sine";
      oscillator.frequency.value = 880;
      gain.gain.setValueAtTime(0.001, audio.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.18, audio.currentTime + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + 0.35);
      oscillator.connect(gain);
      gain.connect(audio.destination);
      oscillator.start();
      oscillator.stop(audio.currentTime + 0.36);
    } catch (error) {
      console.warn("Alarm sound failed:", error);
      soundError = true;
      signature = "";
    }
  }

  function paint() {
    const due = timers.due();
    if (due.length && !playing) {
      playing = true;
      if (!audio || audio.state !== "running") soundError = true;
      beep();
    } else if (!due.length) playing = false;
    root.hidden = !due.length;
    const next = JSON.stringify([due.map((item) => [item.id, item.name]), soundError]);
    if (signature === next) return;
    signature = next;
    const t = translate();
    root.replaceChildren(h("div", { class: "alarm-alert__sheet" },
      h("div", { class: "alarm-alert__symbol", "aria-hidden": "true" }, "⏰"),
      h("h2", { id: "alarm-alert-title" }, t("alarm_finished")),
      h("ul", null, due.map((item) => h("li", null, h("span", null, item.name),
        h("button", { type: "button", class: "alarm-btn", onclick: () => timers.remove(item.id) }, t("alarm_dismiss"))))),
      soundError ? h("p", { class: "alarm-warning", role: "status" }, t("alarm_sound_blocked")) : null,
      soundError ? h("button", { type: "button", class: "alarm-btn alarm-btn--secondary", onclick: () => void enableSound() }, t("alarm_enable_sound")) : null,
    ));
  }

  const unsubscribe = timers.subscribe(paint);
  const timer = setInterval(() => { paint(); if (playing) beep(); }, 2000);
  paint();
  return { el: root, paint, enableSound, refreshTranslation() { signature = ""; paint(); }, destroy() { clearInterval(timer); unsubscribe(); audio?.close(); root.remove(); } };
}
