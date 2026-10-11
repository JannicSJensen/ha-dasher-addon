import { getJson } from "../core/api.js";
import { h } from "../core/h.js";
import { icon } from "../core/icons.js";
import { buildAgenda, calendarColor, dayKey, startOfDay, weatherIcon } from "../lib/calendar.js";
import { format } from "../lib/i18n.js";

const REFRESH_MS = 5 * 60_000;
const REPAINT_MS = 60_000;

/**
 * Agenda tile: the next days that have something planned, with the weather forecast for each day.
 *
 * Config: `entities` (calendars to show; default every calendar), `colors` (one per calendar, in order),
 * `weather_entity` (a weather entity for the daily temperature and icon), `days` (how far ahead to look,
 * default 7), `name`, `icon`.
 */
export function createCalendarTile(cfg, ctx) {
  const { t } = ctx;
  const days = Math.min(Math.max(Number(cfg.days) || 7, 1), 31);
  const explicit = Array.isArray(cfg.entities) ? cfg.entities : [];
  const fmt = (options) => new Intl.DateTimeFormat(ctx.locale, options);
  const weekday = fmt({ weekday: "short" });
  const month = fmt({ month: "short" });
  const clean = (text) => text.replace(/\.$/, "");

  const list = h("div", { class: "cal__list" });
  const el = h(
    "div",
    { class: "tile tile--calendar" },
    h("div", { class: "cal__head" }, icon(cfg.icon ?? "calendar-month"), h("span", null, cfg.name ?? t("cal_title"))),
    list,
  );

  let data = null;
  let failed = false;
  let loading = null;
  let loadedDay = "";

  const load = async () => {
    const from = startOfDay(new Date());
    const params = new URLSearchParams({
      start: from.toISOString(),
      end: startOfDay(from, days).toISOString(),
      entities: explicit.length ? explicit.join(",") : "all",
    });
    if (cfg.weather_entity) params.set("weather", cfg.weather_entity);
    try {
      data = await getJson(`api/calendar?${params}`);
      failed = false;
      loadedDay = dayKey(from);
    } catch {
      failed = true;
    }
    paint();
  };

  const refresh = () => {
    loading ??= load().finally(() => (loading = null));
    return loading;
  };

  function paint() {
    if (failed && !data) return list.replaceChildren(h("div", { class: "cal__empty" }, t("cal_error")));
    if (!data) return list.replaceChildren();
    const now = new Date();
    const ids = explicit.length ? explicit : Object.keys(data.calendars ?? {});
    const agenda = buildAgenda(data.events ?? [], { from: startOfDay(now), days, now });
    if (!agenda.length) return list.replaceChildren(h("div", { class: "cal__empty" }, t("cal_nothing")));
    list.replaceChildren(
      ...agenda.map((day) => {
        const forecast = data.forecast?.[day.key];
        const isToday = day.key === dayKey(now);
        return h(
          "section",
          { class: "cal__day" },
          h(
            "div",
            { class: `cal__date${isToday ? " is-today" : ""}` },
            h("span", { class: "cal__weekday" }, clean(weekday.format(day.date))),
            h("span", { class: "cal__num" }, String(day.date.getDate())),
            h("span", { class: "cal__month" }, clean(month.format(day.date))),
            forecast?.temperature != null
              ? h("span", { class: "cal__weather" }, icon(weatherIcon(forecast.condition)), `${Math.round(forecast.temperature)}°`)
              : null,
          ),
          h(
            "div",
            { class: "cal__events" },
            day.items.map((item) =>
              h(
                "div",
                { class: "cal__event", style: `--cal:${calendarColor(item.calendar, ids, cfg.colors)}` },
                h("div", { class: "cal__title" }, item.summary),
                h("div", { class: "cal__time" }, icon("clock-outline"), timeText(item)),
              ),
            ),
          ),
        );
      }),
    );
  }

  function timeText(item) {
    if (!item.allDay) return item.timeLabel;
    if (!item.multi) return t("cal_all_day");
    return item.endsToday ? t("cal_all_day_ends_today") : format(t, "cal_all_day_until", { date: `${clean(weekday.format(item.endsOn))} ${item.endsOn.getDate()}` });
  }

  const repaint = setInterval(() => {
    if (data && loadedDay !== dayKey(new Date())) refresh();
    else paint();
  }, REPAINT_MS);
  const reload = setInterval(refresh, REFRESH_MS);
  refresh();

  return {
    el,
    update() {},
    destroy() {
      clearInterval(repaint);
      clearInterval(reload);
    },
  };
}
