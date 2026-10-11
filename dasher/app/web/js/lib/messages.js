import { evaluate } from "./conditions.js";

const DAY_MS = 24 * 3600 * 1000;
const HEX = /^#[0-9a-f]{3,8}$/i;

const startOfDay = (date) => new Date(date.getFullYear(), date.getMonth(), date.getDate());

/** Days until a pick-up: from `next_pickup_date` (a local date), else the sensor's own number of days; null when unknown. */
export function pickupDays(entity, now = new Date()) {
  if (!entity || entity.state === "unavailable") return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(entity.attributes?.next_pickup_date ?? ""));
  if (m) return Math.round((new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) - startOfDay(now)) / DAY_MS);
  const n = Number(entity.state);
  return entity.state !== "unknown" && Number.isFinite(n) ? n : null;
}

/** "240 L Rest/Mad - Beholder (Privat)" -> "240 L Rest/Mad" */
export function shortName(description) {
  return String(description ?? "")
    .replace(/\s*\([^)]*\)\s*/g, " ")
    .split(" - ")[0]
    .replace(/\s+/g, " ")
    .trim();
}

const iconOf = (cfg, attrs, fallback) => String(cfg.icon ?? attrs?.icon ?? fallback).replace(/^mdi:/, "");

/**
 * The status messages that are active now, for the hero tile. Each configured message is either
 *   a pick-up reminder (an entity with `next_pickup_date`, or `kind: pickup`): shown when the pick-up is today or
 *   within `within_days` (default 1: tomorrow), or
 *   a state message: shown while `when` holds (default: the entity is "on"), with `text`.
 * Returns [{ key, icon, color, title, detail, days, urgent }] sorted with the soonest pick-up first.
 */
export function activeMessages(messages, getState, { now = new Date(), t, locale } = {}) {
  const out = [];
  for (const [index, cfg] of (Array.isArray(messages) ? messages : []).entries()) {
    if (!cfg || typeof cfg !== "object") continue;
    const entity = cfg.entity ? getState(cfg.entity) : null;
    const attrs = entity?.attributes ?? {};
    const kind = cfg.kind ?? (attrs.next_pickup_date !== undefined ? "pickup" : "state");
    const color = HEX.test(cfg.color ?? "") ? cfg.color : HEX.test(attrs.icon_color ?? "") ? attrs.icon_color : null;

    if (kind === "pickup") {
      const days = pickupDays(entity, now);
      const within = Number.isFinite(Number(cfg.within_days)) ? Number(cfg.within_days) : 1;
      if (days == null || days < 0 || days > within) continue;
      const day = new Date(startOfDay(now).getTime() + days * DAY_MS);
      const when = new Intl.DateTimeFormat(locale, { weekday: "short", day: "numeric", month: "numeric" }).format(day);
      out.push({
        key: `m${index}`,
        icon: iconOf(cfg, attrs, "trash-can"),
        color,
        title: cfg.title ?? t("msg_trash"),
        detail: [cfg.name ?? (shortName(attrs.description) || attrs.friendly_name), when].filter(Boolean).join(" · "),
        badge: days === 0 ? t("msg_today") : days === 1 ? t("msg_tomorrow") : t("msg_in_days").replace("{n}", String(days)),
        days,
        urgent: days === 0,
      });
    } else {
      const cond = cfg.when ?? { entity: cfg.entity, state: "on" };
      if (!evaluate(cond, getState)) continue;
      out.push({
        key: `m${index}`,
        icon: iconOf(cfg, attrs, "information-outline"),
        color,
        title: cfg.text ?? cfg.title ?? attrs.friendly_name ?? cfg.entity ?? "",
        detail: cfg.detail ?? "",
        badge: "",
        days: null,
        urgent: Boolean(cfg.urgent),
      });
    }
  }
  return out.sort((a, b) => (a.days ?? 99) - (b.days ?? 99));
}
