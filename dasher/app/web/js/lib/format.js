export function formatNumber(value, { locale, decimals } = {}) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "–";
  return new Intl.NumberFormat(locale, {
    minimumFractionDigits: decimals ?? 0,
    maximumFractionDigits: decimals ?? 1,
  }).format(n);
}

export function formatTime(date, { locale, hour12 = false } = {}) {
  return new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit", hour12 }).format(date);
}

export function formatDate(date, { locale } = {}) {
  return new Intl.DateTimeFormat(locale, { weekday: "long", day: "numeric", month: "long" }).format(date);
}

export const clamp = (n, min, max) => Math.min(max, Math.max(min, n));

export const isUnavailable = (entity) => !entity || entity.state === "unavailable" || entity.state === "unknown";
