import { h } from "../core/h.js";
import { icon } from "../core/icons.js";
import { findActiveStation, initials } from "../lib/radio.js";
import { pressable } from "../tiles/common.js";

const PENDING_MS = 10_000;
const bg = (url) => `url("${String(url).replace(/"/g, "%22")}")`;

/** Radio stations from Music Assistant, one button per station. */
export function createRadioView({ model, ctx, panel }) {
  const { t } = ctx;
  const stations = model.stations;
  let pending = null; // { id, timer }

  const tiles = stations.map((station) => {
    const logo = h("div", { class: "station__logo" });
    const fallback = h("div", { class: "station__fallback" }, initials(station.name));
    logo.append(fallback);
    if (station.image) {
      logo.style.backgroundImage = bg(`./${station.image}`);
      // Hide the initials once the logo has loaded, keep them if it fails.
      const probe = new Image();
      probe.onload = () => (fallback.hidden = true);
      probe.src = `./${station.image}`;
    }
    const el = h(
      "div",
      { class: "tile tile--station", role: "button", tabindex: "0", "aria-label": station.name },
      h(
        "div",
        { class: "station__inner" },
        h("div", { class: "station__frame" }, logo, h("span", { class: "eq eq--station", "aria-hidden": "true" }, h("i"), h("i"), h("i"))),
        h("div", { class: "station__name" }, station.name),
      ),
    );
    const start = () => playStation(station);
    pressable(el, { onTap: start });
    el.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") start();
    });
    return { station, el };
  });

  const empty = !stations.length
    ? h("div", { class: "notice" }, icon(model.error ? "alert-circle-outline" : "radio"), h("h2", null, t(model.error ? "radio_error" : "radio_empty")), h("p", null, model.error ?? t("radio_empty_hint")))
    : null;

  const el = h(
    "div",
    { class: "view view--radio" },
    empty ?? h("div", { class: "radio__stations" }, tiles.map((x) => x.el)),
    model.library ? null : h("p", { class: "view__hint" }, t(model.library_missing === "token" ? "library_hint_token" : "library_hint")),
  );

  async function playStation(station) {
    const target = panel.target();
    if (!target) return ctx.toast(t("choose_speaker"));
    clearTimeout(pending?.timer);
    pending = { id: station.id, timer: setTimeout(() => ((pending = null), update()), PENDING_MS) };
    panel.setPending({ name: station.name, image: station.image ? `./${station.image}` : "" });
    update();
    const ok = await ctx.playRadio(target, station.id);
    if (!ok) {
      clearTimeout(pending?.timer);
      pending = null;
      panel.clearPending();
      update();
    }
  }

  function update() {
    const player = panel.player();
    const active = findActiveStation(stations, player);
    if (pending && active?.id === pending.id) {
      clearTimeout(pending.timer);
      pending = null;
    }
    const playing = player?.state === "playing";
    for (const { station, el: tile } of tiles) {
      tile.classList.toggle("is-active", active?.id === station.id);
      tile.classList.toggle("is-playing", active?.id === station.id && playing);
      tile.classList.toggle("is-loading", pending?.id === station.id);
    }
  }

  return {
    el,
    update,
    destroy: () => clearTimeout(pending?.timer),
  };
}
