/** Helpers for the offers (Tilbud) of the meal plan. */

export const unitLabel = (unit) => (unit === "ltr" ? "l" : String(unit ?? ""));

const fmt = (locale, value, decimals) => new Intl.NumberFormat(locale, { minimumFractionDigits: decimals, maximumFractionDigits: decimals }).format(value);

/** 9.95 -> "9,95" */
export const money = (value, locale = "da") => fmt(locale, value, 2);

/** The package: "1,5 l", or "6 × 0,33 l" when there are several. */
export function packText(offer, locale = "da") {
  const size = offer.quantity ? `${fmt(locale, offer.quantity, offer.quantity % 1 ? (offer.quantity * 100) % 1 ? 3 : 2 : 0).replace(/[,.]?0+$/, "")} ${unitLabel(offer.unit)}`.trim() : "";
  return offer.units > 1 && size ? `${offer.units} × ${size}` : size;
}

/** The text put on the shopping list for an offer. */
export function offerListText(offer, locale = "da") {
  const label = [offer.brand, offer.name].filter((x, i, all) => x && all.indexOf(x) === i && !(i === 1 && offer.brand.toLowerCase().includes(x.toLowerCase()))).join(" ");
  const pack = packText(offer, locale);
  return `${label}${pack ? ` ${pack}` : ""} (${offer.chain}, ${money(offer.price, locale)} kr)`;
}

/** A steady colour for a store's badge. */
export function chainColor(name) {
  let hash = 0;
  for (const ch of String(name ?? "")) hash = (hash * 31 + ch.charCodeAt(0)) % 360;
  return `hsl(${hash} 55% 42%)`;
}

/** "til 29. okt" / "fra 3. nov" depending on whether the offer has started. */
export function validityText(offer, today, { locale = "da", from = "from", until = "until" } = {}) {
  const short = (date) => new Intl.DateTimeFormat(locale, { day: "numeric", month: "short" }).format(new Date(`${date}T12:00:00`));
  if (offer.start && offer.start > today) return `${from} ${short(offer.start)}`;
  return offer.end ? `${until} ${short(offer.end)}` : "";
}
