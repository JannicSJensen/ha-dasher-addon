import { getJson, mealsPost } from "../core/api.js";
import { h } from "../core/h.js";
import { icon } from "../core/icons.js";
import { openModal } from "../core/modal.js";
import { getPref, setPref } from "../core/prefs.js";
import { confirmDialog } from "../components/dialogs.js";
import { format } from "../lib/i18n.js";
import { aggregateIngredients, addDays, clockText, dateObject, listItemText, mondayOf, onList, stepTimer, todayLocal, weeksFrom } from "../lib/meals.js";
import { pressable } from "../tiles/common.js";

const TABS = [
  ["week", "calendar-week", "meals_tab_week"],
  ["recipe", "chef-hat", "meals_tab_recipe"],
  ["shopping", "cart-outline", "meals_tab_shopping"],
  ["rules", "tune-variant", "meals_tab_rules"],
];
const KINDS = ["dinner", "leftovers", "eatout", "skip"];
const WEEKDAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
const WEEKS = 3;
const timers = new Map(); // "date#step" -> { end, done } (kept while the page is left and entered again)

const isoWeek = (date) => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  return Math.ceil(((d - new Date(Date.UTC(d.getUTCFullYear(), 0, 1))) / 86_400_000 + 1) / 7);
};

function button(iconName, label, onTap, cls = "btn") {
  const b = h("button", { class: cls, type: "button" }, iconName ? icon(iconName) : null, label ? h("span", null, label) : null);
  pressable(b, { onTap });
  return b;
}

const field = (label, control) => h("label", { class: "tdfield" }, h("span", null, label), control);
const input = (props) => h("input", { class: "msearch__input tdinput", ...props });

/** The meal plan: the week's dinners, the recipe of a day, the shopping list from the plan, and the family's rules. */
export function createMealsPage(initialModel, ctx) {
  const { t } = ctx;
  let model = initialModel;
  let tab = TABS.some(([id]) => id === getPref("meals.tab")) ? getPref("meals.tab") : "week";
  let selected = null;
  let shoppingItems = null; // items of the shopping list, null until loaded
  let shoppingRange = "week";
  let picked = new Set(); // keys of the shopping rows left out
  const root = h("div", { class: "mealspage" });
  const content = h("div", { class: "mealspage__content" });
  const tabsEl = h("div", { class: "mtabs", role: "tablist" });
  root.append(h("div", { class: "radio__titlebar mealspage__title" }, h("h1", { class: "radio__title" }, model.title ?? t("meals_title"))), tabsEl, content);

  const show = (...parts) => content.replaceChildren(...parts.flat().filter(Boolean));
  const days = () => model.days ?? {};
  const editable = () => model.editable && !ctx.readOnly;
  const dateLabel = (date, opts) => new Intl.DateTimeFormat(ctx.locale, opts).format(dateObject(date));
  const ai = () => model.ai === true;

  async function post(action, body, { toastOk } = {}) {
    try {
      const result = await mealsPost(action, body);
      if (toastOk) ctx.toast(toastOk);
      return result;
    } catch (err) {
      ctx.toast(err.message);
      return null;
    }
  }

  const dinnerDates = () => Object.values(days()).filter((d) => d.kind === "dinner").map((d) => d.date).sort();
  const defaultSelected = () => {
    const dinners = dinnerDates();
    const today = todayLocal();
    return dinners.find((d) => d >= today) ?? dinners.at(-1) ?? today;
  };

  // ---- tabs -----------------------------------------------------------------------------------
  function paintTabs() {
    tabsEl.replaceChildren(
      ...TABS.map(([id, iconName, label]) => {
        const el = h("button", { class: `mtab${id === tab ? " is-active" : ""}`, type: "button", role: "tab", "aria-selected": String(id === tab) }, icon(iconName), h("span", null, t(label)));
        pressable(el, { onTap: () => showTab(id) });
        return el;
      }),
    );
  }

  function showTab(id) {
    tab = id;
    setPref("meals.tab", id);
    paintTabs();
    render({ reset: true });
    if (id === "shopping") loadShopping();
  }

  // ---- job banner ------------------------------------------------------------------------------
  function jobBanner() {
    const job = model.job ?? {};
    if (job.status === "running") {
      const text = job.message === "recipes" ? format(t, "meals_job_recipes", { progress: job.progress ?? "" }) : t(`meals_job_${job.message === "fix" ? "fix" : job.message === "recipe" ? "recipe" : "plan"}`);
      return h("div", { class: "mealsjob is-running" }, h("span", { class: "mealsjob__spin" }), text);
    }
    if (job.status === "error") return h("div", { class: "mealsjob is-error" }, icon("alert-circle-outline"), `${t("meals_job_error")}: ${job.error}`);
    return null;
  }

  // ---- week ---------------------------------------------------------------------------------------
  function renderWeek() {
    const today = todayLocal();
    const bar = h("div", { class: "mealsbar" });
    if (editable() && ai()) bar.append(button("creation", t("meals_new_plan"), () => openNewPlan(), "btn btn--primary"));
    if (editable() && !ai()) bar.append(h("p", { class: "view__hint mealsbar__hint" }, t("meals_no_ai")));
    const out = [bar, jobBanner()];
    for (const week of weeksFrom(today, WEEKS)) {
      const rows = week.dates.map((date) => {
        const entry = days()[date];
        const past = date < today;
        const kindText = entry ? (entry.kind === "dinner" ? entry.title : entry.kind === "leftovers" ? `${t("meals_kind_leftovers")}: ${entry.title}` : t(`meals_kind_${entry.kind}`)) : "";
        const meta = [entry?.kind === "dinner" && entry.minutes ? `${entry.minutes} min` : null, entry?.vegetarian ? t("meals_vegetarian") : null].filter(Boolean).join(" · ");
        const row = h(
          "button",
          { class: `mday${date === today ? " is-today" : ""}${past ? " is-past" : ""}${entry ? "" : " is-empty"}`, type: "button" },
          h("div", { class: "mday__date" }, h("span", { class: "mday__wd" }, dateLabel(date, { weekday: "short" })), h("span", { class: "mday__num" }, String(dateObject(date).getDate()))),
          h(
            "div",
            { class: "mday__text" },
            entry ? h("div", { class: `mday__title${entry.kind === "skip" || entry.kind === "eatout" ? " is-muted" : ""}` }, kindText) : h("div", { class: "mday__title is-muted" }, editable() && !past ? `+ ${t("meals_add_dinner")}` : "–"),
            meta ? h("div", { class: "mday__meta" }, meta) : null,
          ),
          entry?.warnings?.length ? h("span", { class: "mday__warn", title: entry.warnings.join("\n") }, icon("alert-outline")) : null,
          entry?.ingredients?.length ? h("span", { class: "mday__recipe", title: t("meals_has_recipe") }, icon("chef-hat")) : null,
        );
        pressable(row, { onTap: () => openDay(date) });
        return row;
      });
      out.push(h("section", { class: "mweek" }, h("h2", { class: "mweek__title" }, `${t("meals_week")} ${isoWeek(week.monday)}`), h("div", { class: "mweek__days" }, rows)));
    }
    show(...out);
  }

  // ---- a day -----------------------------------------------------------------------------------
  function openDay(date) {
    const entry = days()[date];
    if (!editable() && !entry) return;
    let modal;
    const kind = h("select", { class: "msearch__input tdinput", "aria-label": t("meals_kind") }, KINDS.map((k) => h("option", { value: k, selected: (entry?.kind ?? "dinner") === k }, t(`meals_kind_${k}`))));
    const title = input({ type: "text", maxlength: "120", value: entry?.title ?? "", "aria-label": t("meals_dish"), placeholder: t("meals_dish") });
    const minutes = input({ type: "number", min: "0", max: "600", value: entry?.minutes || "", "aria-label": t("meals_minutes") });
    const vegetarian = h("input", { type: "checkbox", checked: Boolean(entry?.vegetarian) });
    const alt = h("div", { class: "malts" });

    const save = async () => {
      const k = kind.value;
      if ((k === "dinner" || k === "leftovers") && !title.value.trim()) return title.focus();
      modal.close();
      await post("day", { date, entry: { ...(entry ?? {}), date, kind: k, title: title.value, minutes: Number(minutes.value) || 0, vegetarian: vegetarian.checked } });
    };
    const remove = async () => {
      modal.close();
      await post("day", { date, entry: null });
    };
    const writeRecipe = async () => {
      modal.close();
      ctx.toast(t("meals_job_recipe"));
      await post("recipe", { date });
    };
    const findAlternatives = async () => {
      alt.replaceChildren(h("p", { class: "view__hint" }, t("meals_job_alternatives")));
      const result = await post("alternatives", { date });
      if (!result) return alt.replaceChildren();
      alt.replaceChildren(
        ...result.alternatives.map((a) => {
          const el = h("button", { class: "malt", type: "button" }, h("div", { class: "malt__title" }, a.title), h("div", { class: "malt__meta" }, [a.description, a.minutes ? `${a.minutes} min` : null].filter(Boolean).join(" · ")));
          pressable(el, {
            onTap: async () => {
              modal.close();
              await post("day", { date, entry: { date, kind: "dinner", title: a.title, description: a.description, minutes: a.minutes, vegetarian: a.vegetarian, main_ingredient: a.main_ingredient, source: "ai" } });
              await post("recipe", { date });
            },
          });
          return el;
        }),
      );
    };
    const rate = (rating) => {
      if (!entry?.title) return;
      const current = (model.ratings ?? []).find((r) => r.name.toLowerCase() === entry.title.toLowerCase())?.rating;
      post("rate", { name: entry.title, rating: current === rating ? null : rating });
      modal.close();
    };
    const rated = (model.ratings ?? []).find((r) => entry && r.name.toLowerCase() === entry.title.toLowerCase())?.rating;

    modal = openModal(
      h(
        "div",
        { class: "modal__body dialog tdedit" },
        h("div", { class: "modal__title" }, dateLabel(date, { weekday: "long", day: "numeric", month: "long" })),
        field(t("meals_kind"), kind),
        field(t("meals_dish"), title),
        field(t("meals_minutes"), minutes),
        h("label", { class: "mcheck" }, vegetarian, h("span", null, t("meals_vegetarian"))),
        entry?.kind === "dinner" && entry.title
          ? h(
              "div",
              { class: "mrate" },
              ...[["like", "thumb-up-outline"], ["dislike", "thumb-down-outline"], ["favourite", "heart-outline"]].map(([r, i]) => {
                const b = h("button", { class: `mrate__btn${rated === r ? " is-on" : ""}`, type: "button", "aria-label": t(`meals_rate_${r}`) }, icon(i));
                pressable(b, { onTap: () => rate(r) });
                return b;
              }),
            )
          : null,
        alt,
        h(
          "div",
          { class: "dialog__actions mealsactions" },
          entry && editable() ? button("trash-can-outline", t("todo_delete"), remove, "btn btn--danger") : null,
          entry?.ingredients?.length ? button("chef-hat", t("meals_open_recipe"), () => (modal.close(), (selected = date), showTab("recipe"))) : null,
          editable() && ai() && entry?.kind === "dinner" && entry.title ? button("autorenew", t("meals_other_dish"), findAlternatives) : null,
          editable() && ai() && entry?.kind === "dinner" && entry.title ? button("text-box-edit-outline", t(entry.steps?.length ? "meals_rewrite_recipe" : "meals_write_recipe"), writeRecipe) : null,
          editable() ? button("check", t("todo_save"), save, "btn btn--primary") : null,
        ),
      ),
    );
  }

  // ---- new plan ----------------------------------------------------------------------------------
  function openNewPlan() {
    const today = todayLocal();
    const nextMonday = addDays(mondayOf(today), 7);
    const existing = dinnerDates().some((d) => d >= today && d < nextMonday);
    const start = input({ type: "date", value: existing ? nextMonday : today, "aria-label": t("meals_first_day") });
    const count = input({ type: "number", min: "1", max: "14", value: "7", "aria-label": t("meals_days") });
    const wishes = h("textarea", { class: "msearch__input tdinput tdtextarea", rows: "3", placeholder: t("meals_wishes_hint"), "aria-label": t("meals_wishes") });
    const skipBox = h("div", { class: "mskips" });
    const skipped = new Set();
    const paintSkips = () => {
      const from = start.value || today;
      skipBox.replaceChildren(
        ...Array.from({ length: Math.min(14, Number(count.value) || 7) }, (_, i) => addDays(from, i)).map((d) => {
          const chip = h("button", { class: `mskip${skipped.has(d) ? " is-on" : ""}`, type: "button" }, `${dateLabel(d, { weekday: "short" })} ${dateObject(d).getDate()}`);
          pressable(chip, { onTap: () => ((skipped.has(d) ? skipped.delete(d) : skipped.add(d)), chip.classList.toggle("is-on")) });
          return chip;
        }),
      );
    };
    start.addEventListener("change", () => (skipped.clear(), paintSkips()));
    count.addEventListener("change", paintSkips);
    paintSkips();
    let modal;
    const go = async (surprise) => {
      modal.close();
      const ok = await post("generate", { start: start.value, days: Number(count.value) || 7, skip: [...skipped], wishes: wishes.value, surprise });
      if (ok) ctx.toast(t("meals_job_plan"));
    };
    modal = openModal(
      h(
        "div",
        { class: "modal__body dialog tdedit" },
        h("div", { class: "modal__title" }, t("meals_new_plan")),
        field(t("meals_first_day"), start),
        field(t("meals_days"), count),
        h("div", { class: "tdfield" }, h("span", null, t("meals_skip_days")), skipBox),
        field(t("meals_wishes"), wishes),
        h("div", { class: "dialog__actions mealsactions" }, button("dice-multiple-outline", t("meals_surprise"), () => go(true)), button("creation", t("meals_make_plan"), () => go(false), "btn btn--primary")),
      ),
    );
  }

  // ---- recipe ---------------------------------------------------------------------------------------
  const ticksKey = (date) => `meals.ticks.${date}`;
  const readTicks = (date) => {
    try {
      return new Set(JSON.parse(getPref(ticksKey(date), "[]")));
    } catch {
      return new Set();
    }
  };

  function renderRecipe() {
    if (!selected || !days()[selected]) selected = defaultSelected();
    const entry = days()[selected];
    const dates = Object.values(days()).filter((d) => d.kind === "dinner" || d.kind === "leftovers").map((d) => d.date).sort();
    const index = dates.indexOf(selected);
    const nav = h(
      "div",
      { class: "mrnav" },
      button("chevron-left", "", () => ((selected = dates[index - 1] ?? selected), render()), "btn btn--icon"),
      h("div", { class: "mrnav__label" }, dateLabel(selected, { weekday: "long", day: "numeric", month: "long" })),
      button("chevron-right", "", () => ((selected = dates[index + 1] ?? selected), render()), "btn btn--icon"),
    );
    if (!entry || (entry.kind !== "dinner" && entry.kind !== "leftovers")) {
      show(nav, h("div", { class: "notice" }, icon("chef-hat"), h("h2", null, t("meals_no_dinner"))));
      return;
    }
    const source = entry.kind === "leftovers" && entry.from ? days()[entry.from] : entry;
    const recipe = source ?? entry;
    const ticks = readTicks(selected);
    const saveTicks = () => setPref(ticksKey(selected), JSON.stringify([...ticks]));
    const parts = [nav, jobBanner(), h("h2", { class: "mr__title" }, entry.title), h("div", { class: "mr__meta" }, [entry.kind === "leftovers" ? `${t("meals_kind_leftovers")} · ${dateLabel(entry.from ?? selected, { weekday: "long" })}` : null, recipe.minutes ? `${recipe.minutes} min` : null, `${recipe.servings} ${t("meals_servings")}`, recipe.vegetarian ? t("meals_vegetarian") : null].filter(Boolean).join(" · "))];
    for (const w of entry.warnings ?? []) parts.push(h("div", { class: "mealsjob is-error" }, icon("alert-outline"), w));
    if (!recipe.ingredients?.length) {
      parts.push(h("div", { class: "notice" }, icon("chef-hat"), h("h2", null, t("meals_no_recipe")), editable() && ai() ? button("text-box-edit-outline", t("meals_write_recipe"), async () => post("recipe", { date: recipe.date })) : null));
      show(...parts);
      return;
    }
    const tick = (list, i, el) => {
      const key = `${list}${i}`;
      if (ticks.has(key)) ticks.delete(key);
      else ticks.add(key);
      el.classList.toggle("is-done", ticks.has(key));
      saveTicks();
    };
    const ingredients = h(
      "ul",
      { class: "mr__list" },
      recipe.ingredients.map((ing, i) => {
        const li = h("li", { class: `mr__item${ticks.has(`i${i}`) ? " is-done" : ""}` }, icon("check-circle-outline"), h("span", { class: "mr__amount" }, ing.amount), h("span", null, ing.name));
        pressable(li, { onTap: () => tick("i", i, li) });
        return li;
      }),
    );
    const steps = h(
      "ol",
      { class: "mr__steps" },
      recipe.steps.map((text, i) => {
        const seconds = stepTimer(text);
        const li = h("li", { class: `mr__step${ticks.has(`s${i}`) ? " is-done" : ""}` }, h("span", { class: "mr__text" }, text));
        pressable(li, { onTap: () => tick("s", i, li) });
        if (seconds) li.append(timerButton(`${recipe.date}#${i}`, seconds, recipe.title));
        return li;
      }),
    );
    parts.push(h("div", { class: "mr__cols" }, h("section", null, h("h3", { class: "mr__h" }, t("meals_ingredients")), ingredients), h("section", null, h("h3", { class: "mr__h" }, t("meals_steps")), steps)));
    if (recipe.tip) parts.push(h("p", { class: "mr__tip" }, icon("lightbulb-on-outline"), recipe.tip));
    show(...parts);
  }

  function timerButton(key, seconds, title) {
    const label = h("span");
    const b = h("button", { class: "mr__timer", type: "button" }, icon("timer-outline"), label);
    const paint = () => {
      const t0 = timers.get(key);
      if (!t0) label.textContent = `${Math.round(seconds / 60)} min`;
      else if (t0.done) label.textContent = ctx.t("meals_timer_done");
      else label.textContent = clockText(Math.max(0, (t0.end - Date.now()) / 1000));
      b.classList.toggle("is-running", Boolean(t0 && !t0.done));
      b.classList.toggle("is-done", Boolean(t0?.done));
    };
    pressable(b, {
      onTap: () => {
        const current = timers.get(key);
        if (current) timers.delete(key);
        else timers.set(key, { end: Date.now() + seconds * 1000, done: false, title });
        paint();
      },
    });
    b.addEventListener("pointerdown", (e) => e.stopPropagation());
    paint();
    b._paint = paint;
    return b;
  }

  // one tick for every timer on the page, also a ring when time is up
  const timerLoop = setInterval(() => {
    for (const [key, timer] of timers) {
      if (!timer.done && Date.now() >= timer.end) {
        timer.done = true;
        ring(timer.title);
      }
    }
    root.querySelectorAll(".mr__timer").forEach((b) => b._paint?.());
  }, 500);

  function ring(title) {
    ctx.toast(`${ctx.t("meals_timer_done")}: ${title}`);
    try {
      navigator.vibrate?.([300, 150, 300, 150, 300]);
      const audio = new (window.AudioContext || window.webkitAudioContext)();
      for (let i = 0; i < 3; i++) {
        const osc = audio.createOscillator();
        osc.frequency.value = 880;
        osc.connect(audio.destination);
        osc.start(audio.currentTime + i * 0.35);
        osc.stop(audio.currentTime + i * 0.35 + 0.2);
      }
    } catch {
      // no sound available: the toast and the button show it
    }
  }

  // ---- shopping -----------------------------------------------------------------------------------
  async function loadShopping() {
    if (!model.shopping_list) return;
    try {
      shoppingItems = (await getJson(`api/todo/items?${new URLSearchParams({ entity_id: model.shopping_list })}`)).items;
    } catch {
      shoppingItems = [];
    }
    if (tab === "shopping") render();
  }

  function rangeEntries() {
    const today = todayLocal();
    const monday = mondayOf(today);
    const [from, to] = shoppingRange === "week" ? [today, addDays(monday, 7)] : shoppingRange === "next" ? [addDays(monday, 7), addDays(monday, 14)] : [today, addDays(today, 42)];
    return Object.values(days()).filter((d) => d.date >= from && d.date < to);
  }

  function renderShopping() {
    const rows = aggregateIngredients(rangeEntries());
    const chips = h(
      "div",
      { class: "mealsbar" },
      ...[["week", "meals_range_week"], ["next", "meals_range_next"], ["all", "meals_range_all"]].map(([id, label]) => {
        const c = h("button", { class: `mskip${shoppingRange === id ? " is-on" : ""}`, type: "button" }, t(label));
        pressable(c, { onTap: () => ((shoppingRange = id), (picked = new Set()), render()) });
        return c;
      }),
    );
    if (!model.shopping_list) {
      show(chips, h("div", { class: "notice" }, icon("cart-outline"), h("h2", null, t("meals_no_list"))));
      return;
    }
    const items = shoppingItems ?? [];
    const isOn = (row) => onList(row.name, items);
    // `picked` holds the rows whose default was flipped: ingredients start ticked, basics (salt, oil ...) unticked
    const isChosen = (row) => (row.basic ? picked.has(row.key) : !picked.has(row.key));
    const toAdd = rows.filter((r) => !isOn(r) && isChosen(r));
    const list = h(
      "ul",
      { class: "mr__list msl" },
      rows.map((row) => {
        const already = isOn(row);
        const li = h(
          "li",
          { class: `mr__item msl__item${already ? " is-listed" : ""}${!already && isChosen(row) ? " is-picked" : ""}` },
          icon(already ? "check" : isChosen(row) ? "checkbox-marked-outline" : "checkbox-blank-outline"),
          h("span", { class: "mr__amount" }, row.amount),
          h("span", { class: "msl__name" }, row.name),
          row.basic ? h("span", { class: "msl__tag" }, t("meals_basic")) : null,
          already ? h("span", { class: "msl__tag is-ok" }, t("meals_on_list")) : null,
        );
        if (!already) pressable(li, { onTap: () => ((picked.has(row.key) ? picked.delete(row.key) : picked.add(row.key)), render()) });
        return li;
      }),
    );
    const addBtn = button("cart-plus", format(t, "meals_add_to_list", { n: toAdd.length }), async () => {
      addBtn.disabled = true;
      let n = 0;
      for (const row of toAdd) {
        await ctx.call("todo", "add_item", model.shopping_list, { item: listItemText(row) });
        n += 1;
      }
      ctx.toast(format(t, "meals_added", { n }));
      picked = new Set();
      await loadShopping();
    }, "btn btn--primary");
    addBtn.disabled = toAdd.length === 0 || !editable();
    show(
      chips,
      rows.length ? h("div", { class: "mealsbar" }, addBtn) : null,
      rows.length ? list : h("div", { class: "notice" }, icon("cart-outline"), h("h2", null, t("meals_nothing_to_buy"))),
      h("p", { class: "view__hint" }, `${t("meals_list_is")}: ${model.shopping_list}${shoppingItems ? ` · ${format(t, "todo_open", { n: shoppingItems.length })}` : ""}`),
    );
  }

  // ---- rules ---------------------------------------------------------------------------------------
  function renderRules() {
    const p = model.prefs;
    const veg = input({ type: "number", min: "0", max: "7", value: p.vegetarian_days, "aria-label": t("meals_veg_days") });
    const left = input({ type: "number", min: "0", max: "4", value: p.leftover_days, "aria-label": t("meals_leftover_days") });
    const maxMin = input({ type: "number", min: "0", max: "240", value: p.max_minutes_weekday || "", "aria-label": t("meals_max_minutes") });
    const allergies = input({ type: "text", maxlength: "300", value: p.allergies, "aria-label": t("meals_allergies") });
    const avoid = input({ type: "text", maxlength: "300", value: p.avoid, "aria-label": t("meals_avoid") });
    const fixed = WEEKDAYS.map((d) => [d, input({ type: "text", maxlength: "80", value: p.fixed_days?.[d] ?? "", placeholder: "–", "aria-label": d })]);
    const notes = h("textarea", { class: "msearch__input tdinput tdtextarea", rows: "4", "aria-label": t("meals_notes"), placeholder: t("meals_notes_hint") });
    notes.value = (p.notes ?? []).join("\n");
    const favs = h("textarea", { class: "msearch__input tdinput tdtextarea", rows: "4", "aria-label": t("meals_favourites"), placeholder: t("meals_favourites_hint") });
    favs.value = (p.favourites ?? []).map((f) => (f.every === "inspiration" ? f.name : `${f.name} | ${f.every}`)).join("\n");
    const save = button("check", t("todo_save"), async () => {
      const favourites = favs.value.split("\n").map((l) => l.trim()).filter(Boolean).map((l) => {
        const [name, every] = l.split("|").map((x) => x.trim());
        return { name, every: ["week", "2weeks", "month"].includes(every) ? every : "inspiration" };
      });
      const prefs = {
        vegetarian_days: Number(veg.value) || 0,
        leftover_days: Number(left.value) || 0,
        max_minutes_weekday: Number(maxMin.value) || 0,
        allergies: allergies.value,
        avoid: avoid.value,
        fixed_days: Object.fromEntries(fixed.map(([d, el]) => [d, el.value]).filter(([, v]) => v.trim())),
        favourites,
        notes: notes.value.split("\n").map((l) => l.trim()).filter(Boolean),
      };
      if (await post("prefs", { prefs }, { toastOk: t("meals_saved") })) render({ keep: true });
    }, "btn btn--primary");
    save.disabled = !editable();

    const rated = (model.ratings ?? []).map((r) => {
      const chip = h("button", { class: `area__chip mrated is-${r.rating}`, type: "button" }, icon(r.rating === "dislike" ? "thumb-down-outline" : r.rating === "favourite" ? "heart" : "thumb-up-outline"), h("span", null, r.name), icon("close"));
      pressable(chip, { onTap: () => editable() && post("rate", { name: r.name, rating: null }) });
      return chip;
    });
    const status = [
      [t("meals_status_ai"), model.ai ? t("on") : t("meals_status_missing")],
      [t("meals_status_calendar"), model.calendar ? model.calendar_error ? `${model.calendar} (${model.calendar_error})` : model.calendar : t("meals_status_missing")],
      [t("meals_status_list"), model.shopping_list ?? t("meals_status_missing")],
    ];
    show(
      h("div", { class: "mrules" },
        h("section", { class: "mrules__col" },
          h("h3", { class: "mr__h" }, t("meals_rules")),
          field(t("meals_veg_days"), veg), field(t("meals_leftover_days"), left), field(t("meals_max_minutes"), maxMin), field(t("meals_allergies"), allergies), field(t("meals_avoid"), avoid),
          h("h3", { class: "mr__h" }, t("meals_fixed_days")),
          h("div", { class: "mfixed" }, fixed.map(([d, el]) => h("label", { class: "mfixed__row" }, h("span", null, dateLabel(addDays("2026-10-26", WEEKDAYS.indexOf(d)), { weekday: "short" })), el))),
        ),
        h("section", { class: "mrules__col" },
          field(t("meals_notes"), notes), field(t("meals_favourites"), favs),
          h("h3", { class: "mr__h" }, t("meals_rated")),
          rated.length ? h("div", { class: "area__chips" }, rated) : h("p", { class: "view__hint" }, t("meals_rated_none")),
          h("h3", { class: "mr__h" }, t("meals_status")),
          h("ul", { class: "mstatus" }, status.map(([k, v]) => h("li", null, h("span", null, k), h("code", null, v)))),
        ),
      ),
      h("div", { class: "mealsbar" }, save),
    );
  }

  // ---- render --------------------------------------------------------------------------------------
  function render({ reset = false } = {}) {
    const scroll = reset ? 0 : root.scrollTop;
    if (tab === "week") renderWeek();
    else if (tab === "recipe") renderRecipe();
    else if (tab === "shopping") renderShopping();
    else renderRules();
    root.scrollTop = scroll;
  }

  paintTabs();
  render();
  if (tab === "shopping") loadShopping();

  return {
    el: root,
    entities: [],
    update() {},
    /** New data from the server (a changed day, the job's progress): redraw, unless someone is typing. */
    setModel(next) {
      const typing = root.contains(document.activeElement) && ["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement.tagName);
      model = next;
      if (typing) return;
      if (tab === "shopping" && !shoppingItems) loadShopping();
      render();
    },
    destroy() {
      clearInterval(timerLoop);
    },
  };
}
