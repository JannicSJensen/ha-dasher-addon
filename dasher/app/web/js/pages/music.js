import { h } from "../core/h.js";
import { icon } from "../core/icons.js";
import { getPref, setPref } from "../core/prefs.js";
import { createPlayerPanel } from "../components/player.js";
import { neighbourTab, playRequest, swipeStep, TAB_ICONS } from "../lib/music.js";
import { createDetailView } from "../views/detail.js";
import { createDiscoverView } from "../views/discover.js";
import { createLibraryView } from "../views/library.js";
import { createRadioView } from "../views/radio.js";
import { createPartyView } from "../views/party.js";
import { createSearchView } from "../views/search.js";
import { pressable } from "../tiles/common.js";

const PREF_TAB = "music.tab";
const LIBRARY_TABS = new Set(["albums", "artists", "podcasts", "playlists"]);

/**
 * The music page: speakers on top, swipeable tabs (discover, radio, albums, artists, podcasts,
 * search), the content of the chosen tab, and the "now playing" bar at the bottom.
 */
export function createMusicPage(model, ctx) {
  const { t } = ctx;
  const tabs = model.tabs?.length ? model.tabs : ["radio"];
  const panel = createPlayerPanel({ model, ctx });
  let current = tabs.includes(getPref(PREF_TAB)) ? getPref(PREF_TAB) : tabs[0];
  const stack = []; // { view, scrollTop }: the tab's own view, then opened albums, artists, ...

  const content = h("div", { class: "music__content" });

  // ---- actions the views can trigger ---------------------------------------------
  const actions = {
    open(item) {
      const top = stack.at(-1);
      top.scrollTop = content.scrollTop;
      top.view.el.hidden = true;
      push(createDetailView({ item, ctx, actions }));
      content.scrollTop = 0;
    },
    back() {
      if (stack.length < 2) return;
      const { view } = stack.pop();
      view.destroy?.();
      view.el.remove();
      const top = stack.at(-1);
      top.view.el.hidden = false;
      content.scrollTop = top.scrollTop;
    },
    async play(item, el, { container = null } = {}) {
      const target = panel.target();
      if (!target) return ctx.toast(t("choose_speaker"));
      el?.classList.add("is-loading");
      setTimeout(() => el?.classList.remove("is-loading"), 2500);
      panel.setPending({ name: item.name, image: item.image ? `./${item.image}` : "" });
      const ok = await ctx.playMusic(target, playRequest(item, { container }));
      if (!ok) panel.clearPending();
    },
    async queue(item) {
      const target = panel.target();
      if (!target) return ctx.toast(t("choose_speaker"));
      if (await ctx.playMusic(target, playRequest(item, { enqueue: "add" }))) ctx.toast(t("added_to_queue"));
    },
  };

  function push(view) {
    stack.push({ view, scrollTop: 0 });
    content.append(view.el);
    view.update?.();
  }

  function buildRoot(tab) {
    if (tab === "discover") return createDiscoverView({ ctx, actions });
    if (LIBRARY_TABS.has(tab)) return createLibraryView({ tab, ctx, actions, scroller: content });
    if (tab === "search") return createSearchView({ ctx, actions });
    if (tab === "party") return createPartyView({ ctx });
    return createRadioView({ model, ctx, panel });
  }

  // ---- tabs -------------------------------------------------------------------------
  const tabButtons = tabs.map((tab) => {
    const el = h("button", { class: "mtab", type: "button", role: "tab", "aria-selected": "false" }, icon(TAB_ICONS[tab] ?? "music"), h("span", null, t(`tab_${tab}`)));
    pressable(el, { onTap: () => showTab(tab) });
    return { tab, el };
  });
  const tabbar = h("nav", { class: "mtabs", role: "tablist", hidden: tabs.length < 2 }, tabButtons.map((b) => b.el));

  function showTab(tab, direction = 0) {
    for (const { view } of stack.splice(0)) view.destroy?.();
    content.replaceChildren();
    current = tab;
    setPref(PREF_TAB, tab);
    for (const b of tabButtons) {
      b.el.classList.toggle("is-active", b.tab === tab);
      b.el.setAttribute("aria-selected", String(b.tab === tab));
      if (b.tab === tab) b.el.scrollIntoView?.({ inline: "nearest", block: "nearest" });
    }
    push(buildRoot(tab));
    content.scrollTop = 0;
    content.classList.remove("slide-next", "slide-prev");
    if (direction) {
      void content.offsetWidth; // restart the animation
      content.classList.add(direction > 0 ? "slide-next" : "slide-prev");
    }
  }

  // ---- swiping between tabs ---------------------------------------------------------------
  let swipe = null;
  content.addEventListener(
    "pointerdown",
    (e) => {
      // Touch only; not inside horizontally scrolling rows, inputs or opened detail pages.
      const ok = e.pointerType !== "mouse" && stack.length === 1 && !e.target.closest(".hrow, input, .slider");
      swipe = ok ? { x: e.clientX, y: e.clientY, at: Date.now() } : null;
    },
    { capture: true },
  );
  content.addEventListener(
    "pointerup",
    (e) => {
      if (!swipe) return;
      const step = swipeStep(e.clientX - swipe.x, e.clientY - swipe.y, Date.now() - swipe.at);
      swipe = null;
      const next = step ? neighbourTab(tabs, current, step) : null;
      if (next) showTab(next, step);
    },
    { capture: true },
  );
  content.addEventListener("pointercancel", () => (swipe = null), { capture: true });

  const el = h("div", { class: "music" }, panel.head, tabbar, content, panel.bar);
  showTab(current);

  function update() {
    panel.update();
    for (const { view } of stack) view.update?.();
  }

  return {
    el,
    entities: model.players,
    update,
    destroy() {
      for (const { view } of stack) view.destroy?.();
      panel.destroy();
    },
  };
}
