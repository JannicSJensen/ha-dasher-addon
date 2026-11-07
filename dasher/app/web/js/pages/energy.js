import { getJson } from "../core/api.js";
import { h } from "../core/h.js";
import { icon, setIcon } from "../core/icons.js";
import { format } from "../lib/i18n.js";
import { cheapestPriceWindow, currentSlot, makeClassifier } from "../lib/price.js";
import {
  ENERGY_PERIODS, createEnergyClient, energyBar, energyBucketText, energyCanNext, energyChart,
  energyDate, energyDeviceValue, energyFieldsForSources, energyNumber, energyRangeText, energySourceCostVisible, energyValue, energyWarnings, shiftEnergyDate,
} from "../lib/energy.js";

const GLYPHS = {
  grid_import: "transmission-tower", grid_export: "transmission-tower-export",
  solar: "solar-power", home: "home-lightning-bolt", battery_charge: "battery-plus",
  battery_discharge: "battery-minus", gas: "fire", water: "water",
};
let pageId = 0;

const action = (label, onClick, glyph, cls = "") => h(
  "button", { class: `energy-btn ${cls}`.trim(), type: "button", "aria-label": label, onclick: onClick },
  glyph ? icon(glyph) : null, glyph ? null : label,
);

/** Read-only HA energy statistics; no entity subscriptions or service calls. */
export function createEnergyPage(model, ctx) {
  const { t } = ctx;
  const locale = ctx.locale || "en";
  const id = `energy-${++pageId}`;
  let settings = model ?? {};
  let haToday = energyDate(settings.today);
  let destroyed = false;
  let snapshot;
  let renderedData;
  let renderedMode;
  let renderedPeriod;
  let renderedNotices;
  let priceRoot;
  let paintedPrices;
  let priceMinute;
  let priceCurrent;
  let priceMarker;
  let recommendationRoot;
  const root = h("div", { class: "energypage" });
  const titleIcon = icon(settings.icon || "lightning-bolt");
  const title = h("h1", { class: "energy-title" });
  const subtitle = h("p", { class: "energy-subtitle" }, t("energy_read_only"));
  const head = h("header", { class: "energy-head" }, h("div", { class: "energy-heading" }, titleIcon, h("div", null, title, subtitle)));
  const tabs = h("div", { class: "energy-tabs", role: "tablist", "aria-label": t("energy_period") });
  const panel = h("div", { class: "energy-content", id: `${id}-panel`, role: "tabpanel", tabindex: "0" });
  const notices = h("div", { class: "energy-notices", "aria-live": "polite", "aria-atomic": "true" });
  const rangeTitle = h("span", { class: "energy-range" });
  const previous = action(t("energy_previous"), () => step(-1), "chevron-left");
  const next = action(t("energy_next"), () => step(1), "chevron-right");
  const today = action(t("energy_today"), () => void client.select(todayDate()), null);
  const dateInput = h("input", {
    class: "energy-date", type: "date", "aria-label": t("energy_choose_date"),
    onchange: () => { if (energyDate(dateInput.value)) void client.select(dateInput.value); },
  });
  const refresh = action(t("energy_refresh"), () => void client.refresh(), "refresh");
  const controls = h("div", { class: "energy-controls" },
    tabs,
    h("div", { class: "energy-navigation" }, previous, rangeTitle, next),
    h("div", { class: "energy-actions" }, today, h("label", { class: "energy-date-label" }, h("span", { class: "energy-sr" }, t("energy_choose_date")), dateInput), refresh),
  );
  root.append(head, controls, notices, panel);

  const client = createEnergyClient({
    load: ctx.loadEnergy ?? getJson,
    date: settings.today,
    getToday: () => haToday,
    clock: ctx.energyClock ?? globalThis,
    isMounted: () => root.isConnected && !destroyed && settings.enabled !== false,
    onChange: (state) => {
      if (state.data && state.data !== snapshot?.data) haToday = energyDate(state.data.today) ?? haToday;
      snapshot = state;
      render();
    },
  });
  snapshot = client.getState();
  const tabButtons = ENERGY_PERIODS.map((period, index) => {
    const button = h("button", {
      class: "energy-tab", type: "button", role: "tab", id: `${id}-${period}`,
      "aria-controls": `${id}-panel`,
      onclick: () => void client.select(snapshot.date, period),
      onkeydown: (event) => {
        const offset = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
        if (!offset && !["Home", "End"].includes(event.key)) return;
        event.preventDefault();
        const target = event.key === "Home" ? 0 : event.key === "End" ? ENERGY_PERIODS.length - 1 : (index + offset + ENERGY_PERIODS.length) % ENERGY_PERIODS.length;
        tabButtons[target].focus();
        void client.select(snapshot.date, ENERGY_PERIODS[target]);
      },
    }, t(`energy_${period}`));
    tabs.append(button);
    return button;
  });

  const data = () => snapshot.data;
  const configuredFields = () => energyFieldsForSources(data()?.sources ?? []);
  const todayDate = () => haToday;
  const timeZone = () => data()?.time_zone || settings.time_zone || "UTC";
  const currency = () => data() ? data().currency || "" : settings.currency || "";
  const numberText = (value, unit = "kWh") => energyValue(value, { locale, unit });
  const accessibleValue = (value, unit = "kWh") => energyValue(value, { locale, unit, missing: t("energy_unavailable") });
  const costText = (value) => energyValue(value, { locale, unit: currency(), currency: true });
  const label = (field) => t(`energy_${field}`);
  const heading = (key, glyph) => h("h2", { class: "energy-card-title" }, glyph ? icon(glyph) : null, t(key));
  const card = (cls, ...children) => h("section", { class: `energy-card ${cls}`.trim() }, children);
  const priceNow = () => (ctx.priceNow ?? Date.now)();

  function paintPrices() {
    if (!priceRoot || destroyed) return;
    const prices = data()?.prices;
    const now = priceNow();
    const minute = Math.floor(now / 60_000);
    const changed = paintedPrices !== prices;
    if (paintedPrices === prices && priceMinute === minute) return;
    paintedPrices = prices;
    priceMinute = minute;
    const graph = card("energy-prices-card", heading("energy_prices_today", "chart-bar"));
    const recommendations = card("energy-recommendations", heading("energy_best_start", "clock-outline"));
    if (!prices?.slots?.length || now >= prices.end) {
      graph.append(h("p", { class: "energy-muted" }, t("energy_prices_missing")));
      recommendations.append(h("p", { class: "energy-muted" }, t("energy_prices_missing")));
      priceRoot.replaceChildren(graph, recommendations);
      return;
    }
    const rows = prices.slots;
    const fmt = (value) => numberText(value, prices.unit);
    const time = (instant, full = false) => energyBucketText(instant, "day", { locale, timeZone: timeZone(), full });
    const max = Math.max(0, ...rows.map((row) => row.value));
    const min = Math.min(0, ...rows.map((row) => row.value));
    const span = max - min || 1;
    const zero = max === min ? 100 : max / span * 100;
    const classify = makeClassifier(rows);
    const plot = h("div", { class: "energy-price-plot", "aria-hidden": "true" },
      h("div", { class: "energy-price-zero", style: { top: `${zero}%` } }),
      rows.map((row) => h("div", {
        class: `energy-price-slot energy-price-slot--${classify(row.value)}`,
        style: { left: `${(row.start - prices.start) / (prices.end - prices.start) * 100}%`, width: `${(row.end - row.start) / (prices.end - prices.start) * 100}%` },
        title: `${time(row.start, true)} – ${time(row.end)}: ${fmt(row.value)}`,
      }, h("div", { class: "energy-price-bar", style: {
        top: `${zero - Math.max(0, row.value) / span * 100}%`,
        height: `${Math.abs(row.value) / span * 100}%`,
      } }))),
    );
    const current = h("p", { class: "energy-price-current" }, `${t("energy_price_now")}: ${fmt(currentSlot(rows, now)?.value)}`);
    const marker = h("div", { class: "energy-price-now", style: { left: `${(now - prices.start) / (prices.end - prices.start) * 100}%` } });
    marker.hidden = now < prices.start || now >= prices.end;
    plot.append(marker);
    graph.append(
      h("p", { class: "energy-muted" }, `${energyRangeText(prices.date, "day", locale)} · ${prices.name} (${prices.entity_id})`),
      current,
      h("div", { class: "energy-chart-axis" }, h("span", null, fmt(max)), h("span", null, fmt(min))),
      plot,
      h("div", { class: "energy-price-ticks", "aria-hidden": "true" }, [0, 0.25, 0.5, 0.75, 1].map((fraction) => h("span", null, time(prices.start + (prices.end - prices.start) * fraction)))),
    );
    if (prices.partial) graph.append(h("p", { class: "energy-footnote", role: "status" }, t("energy_prices_partial")));
    graph.append(h("details", { class: "energy-values" }, h("summary", null, t("energy_show_values")),
      h("div", { class: "energy-table-scroll", tabindex: "0", role: "region", "aria-label": t("energy_prices_today") },
        h("table", { class: "energy-table" },
          h("caption", { class: "energy-sr" }, t("energy_prices_today")),
          h("thead", null, h("tr", null, h("th", { scope: "col" }, t("energy_time")), h("th", { scope: "col" }, prices.unit))),
          h("tbody", null, rows.map((row) => h("tr", null, h("th", { scope: "row" }, `${time(row.start, true)} – ${time(row.end)}`), h("td", null, fmt(row.value))))),
        ),
      ),
    ));
    const ev = prices.ev ?? {};
    const loads = [
      { key: "ev", glyph: "car-electric", hours: ev.hours, reason: ev.reason },
      { key: "dryer", glyph: "tumble-dryer", hours: 2 },
      { key: "washer", glyph: "washing-machine", hours: 2 },
      { key: "dishwasher", glyph: "dishwasher", hours: 2 },
    ];
    const recommendationNodes = [heading("energy_best_start", "clock-outline"), h("p", { class: "energy-muted" }, t("energy_recommendation_hint")),
      h("ul", { class: "energy-recommendation-list" }, loads.map((load) => {
        const window = load.reason ? null : cheapestPriceWindow(rows, load.hours, { now: Math.ceil(now / 60_000) * 60_000, end: prices.end });
        const message = load.reason === "no_plan" ? t("energy_ev_no_plan") : load.key === "ev" && (!load.hours || load.reason)
          ? t("energy_ev_duration_missing") : t("energy_no_window");
        return h("li", null, h("div", { class: "energy-recommendation-name" }, icon(load.glyph), h("strong", null, t(`energy_load_${load.key}`))),
          window ? h("div", { class: "energy-recommendation-time" },
            h("strong", null, `${window.start - now < 60_000 ? t("energy_start_now") : time(window.start)} – ${time(window.end)}`),
            h("span", { class: "energy-muted" }, format(t, "energy_run_price", { hours: new Intl.NumberFormat(locale).format(load.hours), price: fmt(window.average) })),
          ) : h("p", { class: "energy-muted" }, message),
        );
      })),
      h("p", { class: "energy-footnote" }, t("energy_recommendation_read_only"))];
    if (changed) {
      recommendations.replaceChildren(...recommendationNodes);
      priceRoot.replaceChildren(graph, recommendations);
      recommendationRoot = recommendations;
      priceCurrent = current;
      priceMarker = marker;
    } else {
      recommendationRoot.replaceChildren(...recommendationNodes);
      priceCurrent.textContent = current.textContent;
      priceMarker.hidden = marker.hidden;
      priceMarker.style.left = marker.style.left;
    }
  }

  function step(direction) {
    if (settings.enabled === false || direction === 1 && !energyCanNext(snapshot.date, snapshot.period, todayDate())) return;
    const date = shiftEnergyDate(snapshot.date, snapshot.period, direction);
    if (date) void client.select(date);
  }

  function paintControls() {
    title.textContent = settings.title || t("energy_title");
    setIcon(titleIcon, settings.icon || "lightning-bolt");
    const date = snapshot.date;
    rangeTitle.textContent = energyRangeText(date, snapshot.period, locale, data()?.range) || t("energy_ha_today");
    const disabled = settings.enabled === false;
    previous.disabled = disabled || !date;
    next.disabled = disabled || !energyCanNext(date, snapshot.period, todayDate());
    today.disabled = disabled;
    refresh.disabled = disabled || snapshot.loading;
    dateInput.disabled = disabled;
    dateInput.value = date || "";
    if (todayDate()) dateInput.max = todayDate();
    else dateInput.removeAttribute("max");
    tabButtons.forEach((button, index) => {
      const selected = ENERGY_PERIODS[index] === snapshot.period;
      button.setAttribute("aria-selected", String(selected));
      button.tabIndex = selected ? 0 : -1;
      button.disabled = disabled;
      button.classList.toggle("is-active", selected);
    });
    panel.setAttribute("aria-labelledby", `${id}-${snapshot.period}`);
    panel.setAttribute("aria-busy", String(snapshot.loading));
    subtitle.textContent = `${t("energy_read_only")} · ${timeZone()}`;
  }

  function paintNotices() {
    const items = [];
    const error = snapshot.error || settings.error;
    const detail = error ? typeof error === "object" ? error.message || String(error) : String(error) : "";
    const warnings = energyWarnings(data());
    const signature = JSON.stringify([detail, snapshot.stale, snapshot.loading, Boolean(data()), warnings]);
    if (signature === renderedNotices) return;
    renderedNotices = signature;
    if (error) {
      items.push(h("div", { class: "energy-notice energy-notice--error", role: "alert" },
        icon("alert-circle-outline"),
        h("div", null, h("strong", null, t("energy_error")), h("p", null, detail.startsWith("energy_") ? t(detail) : detail),
          data() ? h("p", null, t("energy_stale")) : null),
        action(t("energy_retry"), () => void client.refresh()),
      ));
    } else if (snapshot.stale) {
      items.push(h("div", { class: "energy-notice" }, icon("clock-alert-outline"), t("energy_stale")));
    }
    if (snapshot.loading) items.push(h("div", { class: "energy-loading", role: "status" }, h("span", { class: "energy-spinner", "aria-hidden": "true" }), t(data() ? "energy_refreshing" : "energy_loading")));
    if (warnings.length) {
      items.push(h("div", { class: "energy-notice", role: "status" },
        icon("alert-outline"), h("div", null,
          h("strong", null, t("energy_partial")),
          h("ul", null, warnings.map((warning) => {
            const known = ["missing_statistics", "unsupported_unit", "negative_balance", "cost_unavailable"].includes(warning.code);
            return h("li", null, known ? t(`energy_warning_${warning.code}`) : t("energy_warning_unknown"),
              warning.message ? h("span", { class: "energy-warning-detail" }, ` ${warning.message}`) : null);
          })),
        ),
      ));
    }
    notices.replaceChildren(...items);
  }

  function empty(kind) {
    return card("energy-empty",
      icon(kind === "disabled" ? "lightning-bolt-outline" : "chart-box-outline"),
      h("h2", null, t(`energy_${kind}`)),
      h("p", null, t(kind === "disabled" ? "energy_disabled_hint" : "energy_setup_hint")),
      h("p", { class: "energy-muted" }, t("energy_setup_readonly")),
    );
  }

  function flow() {
    const totals = data().totals;
    const fields = configuredFields();
    const simple = !fields.includes("solar") && !fields.some((field) => field.startsWith("battery_"));
    const graphic = h("div", { class: `energy-flow${simple ? " energy-flow--simple" : ""}` });
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 600 320");
    svg.setAttribute("preserveAspectRatio", "none");
    svg.setAttribute("aria-hidden", "true");
    svg.classList.add("energy-flow-lines");
    // Connections show the directions accumulated over this period, not instantaneous power.
    const connections = [
      ["solar", "M300 58 C300 105 440 65 475 119", "M460 108 L475 119 L476 100", totals.solar],
      ["grid_import", "M130 119 L465 119", "M451 109 L465 119 L451 129", totals.grid_import],
      ["grid_export", "M465 133 L130 133", "M144 123 L130 133 L144 143", totals.grid_export],
      ["battery_discharge", "M300 225 C300 170 442 201 475 148", "M458 155 L475 148 L476 166", totals.battery_discharge],
      ["battery_charge", "M465 158 C420 210 333 184 315 225", "M306 211 L315 225 L327 213", totals.battery_charge],
    ];
    for (const [field, path, arrow, value] of connections) {
      if (!fields.includes(field)) continue;
      for (const d of [path, arrow]) {
        const line = document.createElementNS(svg.namespaceURI, "path");
        line.setAttribute("d", d);
        line.setAttribute("class", `energy-line energy-color--${field}${energyNumber(value) === null ? " is-missing" : value === 0 ? " is-zero" : ""}`);
        svg.append(line);
      }
    }
    graphic.append(svg);
    const node = (name, glyph, values) => h("div", { class: `energy-node energy-node--${name}` },
      h("div", { class: `energy-node-icon energy-color--${name === "grid" ? "grid_import" : name === "battery" ? "battery_discharge" : name}` }, icon(glyph)),
      h("h3", null, t(`energy_${name}`)),
      values.map(([field, titleKey]) => h("div", { class: "energy-node-value" },
        titleKey ? h("span", null, t(titleKey)) : null,
        h("strong", { "aria-label": `${label(field)}: ${accessibleValue(totals[field])}` }, numberText(totals[field])),
      )),
    );
    const gridValues = [["grid_import", "energy_from_grid"], ["grid_export", "energy_to_grid"]].filter(([field]) => fields.includes(field));
    const batteryValues = [["battery_charge", "energy_charged"], ["battery_discharge", "energy_discharged"]].filter(([field]) => fields.includes(field));
    if (fields.includes("solar")) graphic.append(node("solar", GLYPHS.solar, [["solar"]]));
    if (gridValues.length) graphic.append(node("grid", GLYPHS.grid_import, gridValues));
    graphic.append(node("home", GLYPHS.home, [["home"]]));
    if (batteryValues.length) graphic.append(node("battery", "battery-charging", batteryValues));
    return card("energy-flow-card", heading("energy_flow", "lightning-bolt"), graphic, h("p", { class: "energy-footnote" }, t("energy_flow_hint")));
  }

  function kpis() {
    const fields = ["grid_import", "grid_export", "solar", "home"].filter((field) => configuredFields().includes(field));
    return h("div", { class: "energy-kpis", role: "group", "aria-label": t("energy_totals"), style: { "--energy-kpi-count": fields.length } },
      fields.map((field) => card(`energy-kpi energy-color--${field}`,
        h("div", { class: "energy-kpi-label" }, icon(GLYPHS[field]), label(field)),
        h("strong", { class: "energy-kpi-value", "aria-label": `${label(field)}: ${accessibleValue(data().totals[field])}` }, numberText(data().totals[field])),
        h("span", { class: "energy-muted" }, t("energy_in_period")),
      )),
    );
  }

  function chart() {
    const rows = data().series;
    const { fields, max, empty: noValues } = energyChart(rows, configuredFields());
    const bucketOptions = { locale, timeZone: timeZone() };
    const bucket = (row, full = false) => energyBucketText(row.start, snapshot.period, { ...bucketOptions, full });
    const chartKey = snapshot.period === "day" ? "energy_hourly" : snapshot.period === "year" ? "energy_monthly" : "energy_daily";
    const plot = card("energy-chart-card", heading(chartKey, "chart-bar"));
    if (noValues) {
      plot.append(h("p", { class: "energy-chart-empty" }, t("energy_no_statistics")));
      return plot;
    }
    plot.append(h("div", { class: "energy-legend" }, fields.map((field) => h("span", null,
      h("i", { class: `energy-dot energy-color--${field}`, "aria-hidden": "true" }), label(field)))));
    const stride = Math.max(1, Math.ceil(rows.length / 8));
    const groups = rows.map((row, index) => h("div", { class: "energy-chart-group" },
      h("div", { class: "energy-chart-bars" }, fields.map((field) => {
        const height = energyBar(row[field], max);
        return h("div", {
          class: `energy-chart-bar energy-color--${field}${height === null ? " is-missing" : row[field] < 0 ? " is-negative" : ""}`,
          style: { height: height === null ? "100%" : `${height}%` },
          title: `${bucket(row, true)} · ${label(field)}: ${accessibleValue(row[field])}`,
        });
      })),
      h("span", { class: "energy-chart-tick" }, index % stride === 0 || index === rows.length - 1 ? bucket(row) : ""),
    ));
    plot.append(h("div", { class: "energy-chart-axis", "aria-hidden": "true" }, numberText(max), h("span", null, "0 kWh")));
    plot.append(h("div", { class: "energy-chart-scroll", "aria-hidden": "true" },
      h("div", { class: "energy-chart-plot", style: { "--energy-buckets": rows.length } }, groups)));
    plot.append(h("p", { class: "energy-footnote" }, t("energy_chart_hint")));
    const details = h("details", { class: "energy-values" }, h("summary", null, t("energy_show_values")));
    details.append(h("div", { class: "energy-table-scroll", tabindex: "0", role: "region", "aria-label": t("energy_show_values") },
      h("table", { class: "energy-table" },
        h("caption", { class: "energy-sr" }, t(chartKey)),
        h("thead", null, h("tr", null, h("th", { scope: "col" }, t("energy_time")), fields.map((field) => h("th", { scope: "col" }, label(field))))),
        h("tbody", null, rows.map((row) => h("tr", null,
          h("th", { scope: "row" }, bucket(row, true)), fields.map((field) => h("td", null, accessibleValue(row[field])))))),
      ),
    ));
    plot.append(details);
    return plot;
  }

  function breakdown(items, { key, glyph, costs = false, devices = false, kind } = {}) {
    const section = card("energy-breakdown", heading(key, glyph));
    if (!items.length) {
      section.append(h("p", { class: "energy-muted" }, t(devices ? "energy_no_devices" : "energy_no_sources")));
      return section;
    }
    const maxima = new Map();
    const barValue = (item) => devices ? energyDeviceValue(item) : energyNumber(item.value);
    for (const item of items) maxima.set(item.unit, Math.max(maxima.get(item.unit) || 0, Math.abs(barValue(item) ?? 0)));
    section.append(h("ul", { class: "energy-source-list" }, items.map((item) => {
      const value = barValue(item);
      const percent = energyBar(value, maxima.get(item.unit));
      const parent = devices && item.parent ? items.find((device) => device.id === item.parent) : null;
      const exclusive = devices && Object.hasOwn(item, "exclusive_value");
      const field = kind || item.kind || "home";
      return h("li", { class: `energy-source${parent ? " energy-source--child" : ""}` },
        h("div", { class: "energy-source-head" },
          h("div", { class: "energy-source-name" }, icon(GLYPHS[field] || GLYPHS.home),
            h("div", null, h("span", null, item.name || item.id),
              parent ? h("small", { class: "energy-muted" }, format(t, "energy_part_of", { name: parent.name || parent.id })) : null,
              !devices && !kind ? h("small", { class: "energy-muted" }, label(field)) : null)),
          h("strong", { "aria-label": exclusive ? format(t, "energy_recorded_value", { value: accessibleValue(item.value, item.unit || "") }) : accessibleValue(item.value, item.unit || "") }, numberText(item.value, item.unit || "")),
        ),
        h("div", { class: `energy-source-track${percent === null ? " is-missing" : ""}`, "aria-hidden": "true" },
          percent !== null ? h("span", { class: `energy-source-fill energy-color--${field}${value < 0 ? " is-negative" : ""}`, style: { width: `${percent}%` } }) : null),
        exclusive ? h("div", { class: "energy-source-own" }, t("energy_exclusive"), ": ", accessibleValue(item.exclusive_value, item.unit || "")) : null,
        costs && energySourceCostVisible(item, items) ? h("div", { class: "energy-source-cost" },
          t(item.kind === "grid_export" ? "energy_export_compensation" : "energy_cost"), ": ",
          energyNumber(item.cost) === null ? t("energy_unavailable") : costText(item.cost)) : null,
      );
    })));
    section.append(h("p", { class: "energy-footnote" }, t(devices ? kind === "water" ? "energy_water_device_hint" : "energy_device_hint" : "energy_source_hint")));
    return section;
  }

  function stats() {
    const totals = data().totals;
    const hasSolar = configuredFields().includes("solar");
    const hasBattery = configuredFields().some((field) => field.startsWith("battery_"));
    const rows = [
      ["self_consumption", "%"], ["self_sufficiency", "%"], ["solar_used", "kWh"], ["net_cost", currency()],
    ].filter(([field, unit]) => (hasSolar || field === "net_cost") && !(hasBattery && field === "self_consumption")
      && energyNumber(totals[field]) !== null && (unit !== "%" || totals[field] >= 0 && totals[field] <= 100));
    if (!rows.length) return null;
    return card("energy-stats", heading("energy_insights", "chart-donut"),
      h("dl", { class: "energy-stat-grid" }, rows.map(([field, unit]) => h("div", { class: "energy-stat" },
        h("dt", null, label(field)),
        h("dd", null, field === "net_cost" ? costText(totals[field]) : numberText(totals[field], unit)),
        unit === "%" ? h("div", { class: "energy-source-track", "aria-hidden": "true" },
          h("span", { class: "energy-source-fill energy-color--solar", style: { width: `${totals[field]}%` } })) : null,
      ))),
      h("p", { class: "energy-footnote" }, t(hasSolar ? hasBattery ? "energy_insights_battery_hint" : "energy_insights_hint" : "energy_cost_hint")),
    );
  }

  function render() {
    if (destroyed) return;
    paintPrices();
    paintControls();
    paintNotices();
    const mode = settings.enabled === false ? "disabled"
      : data()?.configured === false || !data() && settings.configured === false ? "not_configured"
        : data() ? "data" : snapshot.loading ? "loading" : "error";
    if (renderedData === data() && renderedMode === mode && renderedPeriod === snapshot.period) return;
    renderedData = data();
    renderedMode = mode;
    renderedPeriod = snapshot.period;
    priceRoot = null;
    if (settings.enabled === false) {
      panel.replaceChildren(empty("disabled"));
    } else if (data()?.configured === false || !data() && settings.configured === false) {
      panel.replaceChildren(empty("not_configured"));
    } else if (!data()) {
      panel.replaceChildren(snapshot.loading ? h("div", { class: "energy-skeleton", "aria-hidden": "true" },
        [1, 2, 3, 4].map(() => h("div"))) : h("p", { class: "energy-wait" }, t("energy_retry_hint")));
    } else {
      const sources = data().sources;
      const optional = ["gas", "water"].filter((kind) => sources.some((source) => source.kind === kind));
      priceRoot = h("div", { class: "energy-main-grid energy-prices" });
      paintedPrices = null;
      priceMinute = null;
      panel.replaceChildren(
        kpis(),
        h("div", { class: "energy-main-grid" }, flow(), chart()),
        priceRoot,
        ...[stats()].filter(Boolean),
        h("div", { class: "energy-breakdown-grid" },
          breakdown(sources.filter((source) => !["gas", "water"].includes(source.kind)), { key: "energy_sources", glyph: "transmission-tower", costs: true }),
          breakdown(data().devices, { key: "energy_devices", glyph: "power-plug", devices: true }),
          optional.map((kind) => breakdown(sources.filter((source) => source.kind === kind), { key: `energy_${kind}`, glyph: GLYPHS[kind], costs: true, kind })),
          (data().water_devices ?? []).length ? breakdown(data().water_devices, { key: "energy_water_devices", glyph: GLYPHS.water, devices: true, kind: "water" }) : null,
        ),
      );
      paintPrices();
    }
  }

  render();
  if (settings.enabled !== false) void client.start();
  const priceClock = ctx.priceClock ?? globalThis;
  const priceTimer = priceClock.setInterval(() => {
    if (root.isConnected && settings.enabled !== false) paintPrices();
  }, 60_000);
  return {
    el: root,
    entities: [],
    update: render,
    setModel(nextModel) {
      if (destroyed) return;
      const previousSettings = settings;
      settings = nextModel ?? {};
      haToday = energyDate(settings.today) ?? haToday;
      if (settings.enabled === false) {
        client.stop();
        snapshot = client.getState();
      } else if (previousSettings.enabled === false) {
        void client.start();
      } else if (settings.configured !== previousSettings.configured || settings.time_zone !== previousSettings.time_zone
        || settings.today !== previousSettings.today) {
        void client.refresh();
      }
      render();
    },
    destroy() {
      destroyed = true;
      priceClock.clearInterval(priceTimer);
      client.destroy();
    },
  };
}
