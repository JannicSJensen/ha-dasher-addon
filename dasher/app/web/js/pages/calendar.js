import { calendarPost, getJson } from "../core/api.js";
import { h } from "../core/h.js";
import { icon } from "../core/icons.js";
import { openModal } from "../core/modal.js";
import { getPref, setPref } from "../core/prefs.js";
import { confirmDialog } from "../components/dialogs.js";
import { dayKey, parseWhen, startOfDay } from "../lib/calendar.js";
import { blankForm, eventsOnDay, monthGrid, repeatOf, timeText, toForm, weekDays, weekStartOf } from "../lib/calview.js";
import { format } from "../lib/i18n.js";
import { pressable } from "../tiles/common.js";

const REFRESH_MS = 5 * 60_000;
const MONTH_LINES = 3;
const REPEATS = ["none", "daily", "weekly", "monthly", "yearly"];

function button(iconName, label, onTap, cls = "btn") {
  const b = h("button", { class: cls, type: "button" }, iconName ? icon(iconName) : null, label ? h("span", null, label) : null);
  pressable(b, { onTap });
  return b;
}
const field = (label, control) => h("label", { class: "tdfield" }, h("span", null, label), control);
const input = (props) => h("input", { class: "msearch__input tdinput", ...props });

/**
 * The calendar page: a month, or the week as a planner with a column per calendar. Tap an event for its details,
 * a day for its list and a new event; where the calendar allows it, events can be added, changed and deleted.
 */
export function createCalendarPage(config, ctx) {
  const { t } = ctx;
  const settings = config.calendar ?? {};
  const weekStart = settings.week_start === "sun" ? "sun" : "mon";
  let view = ["month", "planner"].includes(getPref("calendar.view")) ? getPref("calendar.view") : settings.view === "planner" ? "planner" : "month";
  let anchor = startOfDay(new Date());
  let data = null; // { calendars, events, failed, editable }
  let failed = null;
  let hidden = new Set(JSON.parse(getPref("calendar.hidden", "[]") || "[]"));
  let loadedKey = "";
  let loading = null;

  const root = h("div", { class: "calpage" });
  const head = h("div", { class: "calhead" });
  const chipsEl = h("div", { class: "calchips" });
  const body = h("div", { class: "calbody" });
  const fab = h("button", { class: "calfab", type: "button", "aria-label": t("calp_new") }, icon("plus"));
  pressable(fab, {
    onTap: () => {
      const today = startOfDay(new Date());
      const { from, to } = range();
      openEditor(null, blankForm(today >= from && today < to ? today : anchor));
    },
  });
  root.append(head, chipsEl, body, fab);

  const fmt = (options) => new Intl.DateTimeFormat(ctx.locale, options);
  const calendars = () => data?.calendars ?? [];
  const calendarOf = (id) => calendars().find((c) => c.id === id);
  const colorOf = (id) => calendarOf(id)?.color ?? "#38bdf8";
  const visibleEvents = () => (data?.events ?? []).filter((e) => !hidden.has(e.calendar));
  const writable = (kind = "create") => Boolean(data?.editable) && calendars().some((c) => c.can?.[kind]);

  // ---- the range on screen ------------------------------------------------------------------

  function range() {
    if (view === "planner") {
      const days = weekDays(anchor, weekStart);
      return { from: days[0], to: startOfDay(days[6], 1) };
    }
    const grid = monthGrid(anchor, weekStart);
    return { from: grid[0].date, to: startOfDay(grid[41].date, 1) };
  }

  async function load({ force = false } = {}) {
    const { from, to } = range();
    const key = `${from.toISOString()}|${to.toISOString()}`;
    if (!force && key === loadedKey && data) return;
    if (loading) await loading.catch(() => {});
    loading = (async () => {
      try {
        data = await getJson(`api/calendar/view?start=${encodeURIComponent(from.toISOString())}&end=${encodeURIComponent(to.toISOString())}`);
        failed = null;
        loadedKey = key;
      } catch (err) {
        failed = err.message;
      }
    })();
    await loading;
    loading = null;
    render();
  }

  // ---- the head ---------------------------------------------------------------------------------

  function title() {
    if (view === "planner") {
      const days = weekDays(anchor, weekStart);
      const short = fmt({ day: "numeric", month: "short" });
      return `${short.format(days[0])} – ${short.format(days[6])}`;
    }
    return fmt({ month: "long", year: "numeric" }).format(anchor).replace(/^./, (c) => c.toLocaleUpperCase(ctx.locale));
  }

  function step(direction) {
    anchor = view === "planner" ? startOfDay(anchor, direction * 7) : new Date(anchor.getFullYear(), anchor.getMonth() + direction, 1);
    load();
    paintHead();
  }

  function goto(date) {
    anchor = startOfDay(date);
    load();
    render();
  }

  function paintHead() {
    const seg = h(
      "div",
      { class: "calseg", role: "tablist" },
      ["month", "planner"].map((v) => {
        const b = h("button", { class: `calseg__btn${view === v ? " is-active" : ""}`, type: "button", role: "tab", "aria-selected": String(view === v) }, icon(v === "month" ? "calendar-month-outline" : "view-column-outline"), h("span", null, t(`calp_${v}`)));
        pressable(b, { onTap: () => ((view = v), setPref("calendar.view", v), load(), render()) });
        return b;
      }),
    );
    const prev = h("button", { class: "calnav", type: "button", "aria-label": t("calp_prev") }, icon("chevron-left"));
    const next = h("button", { class: "calnav", type: "button", "aria-label": t("calp_next") }, icon("chevron-right"));
    pressable(prev, { onTap: () => step(-1) });
    pressable(next, { onTap: () => step(1) });
    const today = button("", t("calp_today"), () => goto(new Date()), "btn");
    const quick = [];
    if (view === "planner") {
      const base = weekStartOf(new Date(), weekStart);
      for (const [offset, label] of [[0, t("calp_this_week")], [1, t("calp_next_week")], [2, t("calp_in2")]]) {
        const date = startOfDay(base, offset * 7);
        const active = dayKey(weekStartOf(anchor, weekStart)) === dayKey(date);
        const q = h("button", { class: `calquick${active ? " is-active" : ""}`, type: "button" }, label);
        pressable(q, { onTap: () => goto(date) });
        quick.push(q);
      }
    }
    head.replaceChildren(...[h("div", { class: "calhead__row" }, seg, h("div", { class: "calhead__nav" }, prev, h("h1", { class: "calhead__title" }, title()), next), today), quick.length ? h("div", { class: "calquicks" }, quick) : null].filter(Boolean));
  }

  function paintChips() {
    const events = data?.events ?? [];
    const { from, to } = range();
    const inRange = events.filter((e) => {
      const s = parseWhen(e.start);
      return s && s < to && (parseWhen(e.end) ?? s) > from;
    });
    chipsEl.replaceChildren(
      ...calendars().map((c) => {
        const count = inRange.filter((e) => e.calendar === c.id).length;
        const chip = h("button", { class: `calchip${hidden.has(c.id) ? " is-off" : ""}`, type: "button", style: { "--cal": c.color }, "aria-pressed": String(!hidden.has(c.id)) }, h("i", { class: "calchip__dot" }), c.name, h("span", { class: "calchip__n" }, String(count)));
        pressable(chip, {
          onTap: () => {
            if (hidden.has(c.id)) hidden.delete(c.id);
            else hidden.add(c.id);
            setPref("calendar.hidden", JSON.stringify([...hidden]));
            render();
          },
        });
        return chip;
      }),
    );
  }

  // ---- month ------------------------------------------------------------------------------------

  const eventChip = (event, { compact = false } = {}) => {
    const el = h(
      "button",
      { class: `cev${event.allDay ? " is-allday" : ""}${compact ? " is-compact" : ""}`, type: "button", style: { "--cal": colorOf(event.calendar) }, title: event.summary },
      !event.allDay && compact ? h("span", { class: "cev__time" }, fmt({ hour: "numeric", minute: "2-digit" }).format(parseWhen(event.start))) : null,
      h("span", { class: "cev__title" }, event.summary),
      !compact ? h("span", { class: "cev__when" }, timeText(event, { locale: ctx.locale, allDay: t("calp_allday") })) : null,
    );
    pressable(el, { onTap: () => openEvent(event) });
    return el;
  };

  function renderMonth() {
    const grid = monthGrid(anchor, weekStart);
    const events = visibleEvents();
    const todayKey = dayKey(new Date());
    const names = h("div", { class: "calmonth__names" }, weekDays(new Date(), weekStart).map((d) => h("div", null, fmt({ weekday: "short" }).format(d).replace(/\.$/, ""))));
    const cells = grid.map(({ date, inMonth }) => {
      const day = eventsOnDay(events, date);
      const cell = h(
        "div",
        { class: `cmday${inMonth ? "" : " is-out"}${dayKey(date) === todayKey ? " is-today" : ""}`, role: "button", tabindex: "0" },
        h("div", { class: "cmday__num" }, String(date.getDate())),
        ...day.slice(0, MONTH_LINES).map((e) => eventChip(e, { compact: true })),
        day.length > MONTH_LINES ? h("div", { class: "cmday__more" }, format(t, "calp_more", { n: day.length - MONTH_LINES })) : null,
      );
      pressable(cell, { onTap: () => openDay(date) });
      return cell;
    });
    body.replaceChildren(h("div", { class: "calmonth" }, names, h("div", { class: "calmonth__grid" }, cells)));
  }

  // ---- planner ----------------------------------------------------------------------------------

  function renderPlanner() {
    const days = weekDays(anchor, weekStart);
    const cols = calendars().filter((c) => !hidden.has(c.id));
    const todayKey = dayKey(new Date());
    const events = visibleEvents();
    if (!cols.length) {
      body.replaceChildren(h("div", { class: "notice" }, icon("calendar-blank-outline"), h("h2", null, t("calp_none"))));
      return;
    }
    const grid = h("div", { class: "calplan", style: { "--cols": String(cols.length) } });
    grid.append(h("div", { class: "calplan__corner" }), ...cols.map((c) => h("div", { class: "calplan__col", style: { "--cal": c.color } }, h("i", { class: "calchip__dot" }), c.name)));
    for (const day of days) {
      const isToday = dayKey(day) === todayKey;
      grid.append(h("div", { class: `calplan__day${isToday ? " is-today" : ""}` }, h("span", { class: "calplan__wd" }, fmt({ weekday: "long" }).format(day)), h("span", { class: "calplan__num" }, String(day.getDate()))));
      for (const c of cols) {
        const list = eventsOnDay(events.filter((e) => e.calendar === c.id), day);
        const cell = h("div", { class: `calplan__cell${isToday ? " is-today" : ""}`, role: "button", tabindex: "0" }, list.map((e) => eventChip(e)));
        pressable(cell, { onTap: () => (c.can?.create && data.editable ? openEditor(null, blankForm(day), c.id) : openDay(day)) });
        grid.append(cell);
      }
    }
    body.replaceChildren(grid);
  }

  function render() {
    paintHead();
    if (failed && !data) {
      chipsEl.replaceChildren();
      body.replaceChildren(h("div", { class: "notice" }, icon("alert-circle-outline"), h("h2", null, t("calp_error")), h("p", null, failed)));
      fab.hidden = true;
      return;
    }
    if (!data) {
      body.replaceChildren(h("p", { class: "view__hint" }, t("meals_loading")));
      return;
    }
    fab.hidden = !writable();
    paintChips();
    const warn = data.failed?.length ? h("div", { class: "mealsjob is-error" }, icon("alert-circle-outline"), `${t("calp_failed")}: ${data.failed.map((id) => calendarOf(id)?.name ?? id).join(", ")}`) : null;
    if (view === "planner") renderPlanner();
    else renderMonth();
    if (warn) body.prepend(warn);
  }

  // ---- a day ------------------------------------------------------------------------------------

  function openDay(date) {
    const list = eventsOnDay(visibleEvents(), date);
    let modal;
    const rows = list.map((e) => {
      const row = h("button", { class: "calrow", type: "button", style: { "--cal": colorOf(e.calendar) } }, h("i", { class: "calrow__bar" }), h("span", { class: "calrow__text" }, h("span", { class: "calrow__title" }, e.summary), h("span", { class: "calrow__sub" }, `${timeText(e, { locale: ctx.locale, allDay: t("calp_allday") })} · ${calendarOf(e.calendar)?.name ?? ""}`)));
      pressable(row, { onTap: () => (modal.close(), openEvent(e)) });
      return row;
    });
    modal = openModal(
      h(
        "div",
        { class: "modal__body dialog tdedit" },
        h("div", { class: "modal__title" }, fmt({ weekday: "long", day: "numeric", month: "long" }).format(date)),
        rows.length ? h("div", { class: "calrows" }, rows) : h("p", { class: "view__hint" }, t("calp_nothing")),
        writable() ? h("div", { class: "dialog__actions" }, button("plus", t("calp_new"), () => (modal.close(), openEditor(null, blankForm(date))), "btn btn--primary")) : null,
      ),
    );
  }

  // ---- an event -----------------------------------------------------------------------------------

  function whenText(event) {
    const from = parseWhen(event.start);
    const to = parseWhen(event.end) ?? from;
    const day = fmt({ weekday: "long", day: "numeric", month: "long" });
    if (event.allDay) {
      const last = startOfDay(to, to > from ? -1 : 0);
      return dayKey(last) === dayKey(from) ? `${day.format(from)} · ${t("calp_allday")}` : `${day.format(from)} – ${day.format(last)}`;
    }
    const sameDay = dayKey(from) === dayKey(to);
    const time = fmt({ hour: "numeric", minute: "2-digit" });
    return sameDay ? `${day.format(from)} · ${time.format(from)} – ${time.format(to)}` : `${day.format(from)} ${time.format(from)} – ${day.format(to)} ${time.format(to)}`;
  }

  function openEvent(event) {
    const cal = calendarOf(event.calendar);
    let modal;
    const repeating = Boolean(event.rrule || event.recurrence_id);
    const rows = [
      h("div", { class: "evsec" }, h("div", { class: "evsec__label" }, t("calp_calendar")), h("span", { class: "calchip", style: { "--cal": cal?.color ?? "#38bdf8" } }, h("i", { class: "calchip__dot" }), cal?.name ?? event.calendar)),
      h("div", { class: "evsec" }, h("div", { class: "evsec__label" }, t("calp_when")), h("div", { class: "evsec__text" }, whenText(event), repeating ? h("span", { class: "fchip" }, icon("repeat"), t("calp_repeats")) : null)),
      event.location ? h("div", { class: "evsec" }, h("div", { class: "evsec__label" }, t("calp_where")), h("div", { class: "evsec__text" }, event.location)) : null,
      event.description ? h("div", { class: "evsec" }, h("div", { class: "evsec__label" }, t("calp_notes")), h("div", { class: "evsec__text is-notes" }, event.description)) : null,
    ];
    const actions = h("div", { class: "dialog__actions mealsactions" });
    if (data.editable && cal?.can?.delete && event.uid) actions.append(button("trash-can-outline", t("todo_delete"), () => (modal.close(), askDelete(event)), "btn btn--danger"));
    if (data.editable && cal?.can?.update && event.uid) actions.append(button("pencil-outline", t("calp_edit"), () => (modal.close(), openEditor(event, toForm(event))), "btn btn--primary"));
    modal = openModal(h("div", { class: "modal__body dialog tdedit calevent", style: { "--cal": cal?.color ?? "#38bdf8" } }, h("div", { class: "modal__title" }, event.summary), ...rows, actions.childElementCount ? actions : null));
  }

  /** For an event of a repeating series: only this one, or this one and the ones after it. */
  function askRange(event, verb, done) {
    if (!event.recurrence_id) return done("this");
    let modal;
    const choose = (range) => () => (modal.close(), done(range));
    modal = openModal(
      h(
        "div",
        { class: "modal__body dialog" },
        h("div", { class: "modal__title" }, event.summary),
        h("p", { class: "dialog__text" }, t("calp_range")),
        h("div", { class: "dialog__actions mealsactions" }, button("", t("calp_only_this"), choose("this")), button("", t("calp_this_following"), choose("future"), verb === "delete" ? "btn btn--danger" : "btn btn--primary")),
      ),
    );
  }

  function askDelete(event) {
    askRange(event, "delete", (range) =>
      range === "this" && !event.recurrence_id
        ? confirmDialog({ title: event.summary, text: t("calp_delete_confirm"), confirmLabel: t("todo_delete"), cancelLabel: t("cancel"), danger: true, onConfirm: () => save("delete", event, null, "this") })
        : save("delete", event, null, range),
    );
  }

  async function save(action, event, body, range = "this", calendar = event?.calendar) {
    try {
      await calendarPost({ action, calendar, uid: event?.uid, recurrence_id: event?.recurrence_id, range, event: body });
      ctx.toast(t(action === "delete" ? "calp_deleted" : "calp_saved"));
      await load({ force: true });
    } catch (err) {
      ctx.toast(err.message);
    }
  }

  function openEditor(event, form, calendarId = null) {
    const creatable = calendars().filter((c) => c.can?.create);
    const target = event ? calendarOf(event.calendar) : creatable.find((c) => c.id === calendarId) ?? creatable[0];
    if (!target) return ctx.toast(t("calp_read_only"));
    const title = input({ type: "text", maxlength: "120", value: event?.summary ?? "", placeholder: t("calp_title_ph"), "aria-label": t("calp_title_ph") });
    const which = h("select", { class: "msearch__input tdinput", "aria-label": t("calp_calendar"), disabled: Boolean(event) }, (event ? [target] : creatable).map((c) => h("option", { value: c.id, selected: c.id === target.id }, c.name)));
    const allDay = h("input", { type: "checkbox", checked: form.all_day });
    const start = input({ type: form.all_day ? "date" : "datetime-local", value: form.start, "aria-label": t("calp_starts") });
    const end = input({ type: form.all_day ? "date" : "datetime-local", value: form.end, "aria-label": t("calp_ends") });
    allDay.addEventListener("change", () => {
      const on = allDay.checked;
      const fix = (value) => (on ? value.slice(0, 10) : `${value.slice(0, 10)}T${value.length > 10 ? value.slice(11, 16) : "09:00"}`);
      start.type = end.type = on ? "date" : "datetime-local";
      start.value = fix(start.value);
      end.value = fix(end.value);
      if (!on && end.value <= start.value) end.value = `${start.value.slice(0, 10)}T${String(Math.min(23, Number(start.value.slice(11, 13)) + 1)).padStart(2, "0")}${start.value.slice(13)}`;
    });
    start.addEventListener("change", () => {
      if (end.value < start.value) end.value = start.value;
    });
    const currentRepeat = repeatOf(event?.rrule);
    const repeat = h("select", { class: "msearch__input tdinput", "aria-label": t("calp_repeat"), disabled: Boolean(event) && currentRepeat === null }, REPEATS.map((r) => h("option", { value: r, selected: (currentRepeat ?? "none") === r }, t(`calp_repeat_${r}`))));
    const where = input({ type: "text", maxlength: "200", value: event?.location ?? "", placeholder: t("calp_where"), "aria-label": t("calp_where") });
    const notes = h("textarea", { class: "msearch__input tdinput tdtextarea", rows: "3", maxlength: "2000", placeholder: t("calp_notes"), "aria-label": t("calp_notes") }, event?.description ?? "");
    let modal;
    const submit = () => {
      if (!title.value.trim()) return title.focus();
      const body = { summary: title.value, all_day: allDay.checked, start: start.value, end: end.value, location: where.value, description: notes.value, repeat: repeat.value };
      const go = (range) => {
        modal.close();
        // a single occurrence of a series carries no repeat of its own
        save(event ? "update" : "create", event, range === "this" && event?.recurrence_id ? { ...body, repeat: "none" } : body, range, which.value);
      };
      if (event) askRange(event, "update", go);
      else go("this");
    };
    modal = openModal(
      h(
        "div",
        { class: "modal__body dialog tdedit" },
        h("div", { class: "modal__title" }, event ? t("calp_edit") : t("calp_new")),
        field(t("calp_title_ph"), title),
        field(t("calp_calendar"), which),
        h("label", { class: "mcheck" }, allDay, h("span", null, t("calp_allday"))),
        h("div", { class: "fgrid2" }, field(t("calp_starts"), start), field(t("calp_ends"), end)),
        field(t("calp_repeat"), repeat),
        field(t("calp_where"), where),
        field(t("calp_notes"), notes),
        h("div", { class: "dialog__actions mealsactions" }, button("check", t("todo_save"), submit, "btn btn--primary")),
      ),
    );
    setTimeout(() => !event && title.focus(), 60);
  }

  render();
  load();
  const timer = setInterval(() => load({ force: true }), REFRESH_MS);

  return {
    el: root,
    entities: [],
    update() {},
    destroy() {
      clearInterval(timer);
    },
  };
}
