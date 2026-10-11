import { getJson } from "../core/api.js";
import { h } from "../core/h.js";
import { icon } from "../core/icons.js";
import { formatDuration } from "../lib/music.js";

const REFRESH_MS = 4000;
const bg = (url) => `url("${String(url).replace(/"/g, "%22")}")`;

/** Party plugin of Music Assistant: the guest QR code and the live queue (requests and boosts marked). */
export function createPartyView({ ctx }) {
  const { t } = ctx;
  let data = null;
  let error = null;

  const root = h("div", { class: "view view--party" });
  let timer = null;

  const art = (entry, cls) => {
    const el = h("div", { class: cls }, entry.image ? null : icon("music"));
    if (entry.image) el.style.backgroundImage = bg(`./${entry.image}`);
    return el;
  };

  const badges = (entry) => [
    entry.requested ? h("span", { class: "partybadge", style: data.requestColor ? { background: data.requestColor } : null, title: t("party_requested") }, icon("account-music")) : null,
    entry.boosted ? h("span", { class: "partybadge partybadge--boost", style: data.boostColor ? { background: data.boostColor } : null, title: t("party_boosted") }, icon("rocket-launch")) : null,
  ];

  function qrPanel() {
    return h(
      "section",
      { class: "party__qr" },
      data.name ? h("h2", { class: "party__name" }, data.name) : null,
      data.enabled
        ? h("div", { class: "party__code" }, h("img", { src: `./${data.qr}`, alt: t("party_qr"), draggable: "false" }))
        : h("div", { class: "party__off" }, icon("qrcode-remove"), h("p", null, t("party_disabled"))),
      data.enabled ? h("p", { class: "party__scan" }, data.qrText ?? t("party_scan")) : null,
      h("span", { class: "party__mode" }, icon(data.mode === "remote" ? "headphones" : "speaker"), t(`party_mode_${data.mode}`)),
    );
  }

  function queuePanel() {
    const now = data.now;
    return h(
      "section",
      { class: "party__queue" },
      h("h3", { class: "party__title" }, t("party_now")),
      now
        ? h(
            "div",
            { class: "partynow" },
            art(now, "partynow__art"),
            h(
              "div",
              { class: "partynow__text" },
              h("div", { class: "partynow__title" }, now.title, badges(now)),
              now.artist ? h("div", { class: "partynow__artist" }, now.artist) : null,
              data.elapsed != null && now.duration
                ? h("div", { class: "partynow__bar" }, h("i", { style: { width: `${Math.min(100, (data.elapsed / now.duration) * 100)}%` } }))
                : null,
            ),
          )
        : h("p", { class: "view__hint" }, data.player ? t("party_nothing") : t("party_no_player")),
      h("h3", { class: "party__title" }, t("party_next")),
      data.next.length
        ? h(
            "div",
            { class: "partylist" },
            data.next.map((entry) =>
              h(
                "div",
                { class: "partyrow" },
                art(entry, "partyrow__art"),
                h("div", { class: "partyrow__text" }, h("div", { class: "partyrow__title" }, entry.title, badges(entry)), entry.artist ? h("div", { class: "partyrow__artist" }, entry.artist) : null),
                entry.duration ? h("span", { class: "partyrow__time" }, formatDuration(entry.duration)) : null,
              ),
            ),
          )
        : h("p", { class: "view__hint" }, t("party_empty")),
    );
  }

  function render() {
    if (error && !data) {
      return root.replaceChildren(h("div", { class: "notice" }, icon("alert-circle-outline"), h("h2", null, t("party_error")), h("p", null, error)));
    }
    if (!data) return root.replaceChildren(h("p", { class: "view__hint" }, t("plex_loading")));
    root.replaceChildren(qrPanel(), queuePanel());
  }

  async function load() {
    try {
      data = await getJson("api/music/party");
      error = null;
    } catch (err) {
      error = err.message;
      if (error && data) data = null;
    }
    render();
  }

  load();
  timer = setInterval(load, REFRESH_MS);

  return {
    el: root,
    destroy() {
      clearInterval(timer);
    },
  };
}
