/*
 * Maths of the ring dials (climate, car battery ...): a 270 degree arc open at the bottom, drawn from the
 * lower left clockwise over the top to the lower right.
 */

export const START_DEG = -135;
export const SWEEP_DEG = 270;

const rad = (deg) => (deg * Math.PI) / 180;

/** Point on a circle of radius r around (cx, cy); 0 degrees is straight up, positive is clockwise. */
export const pointAt = (cx, cy, r, deg) => ({ x: cx + r * Math.sin(rad(deg)), y: cy - r * Math.cos(rad(deg)) });

/** The angle of a fraction (0..1) of the ring. */
export const angleOf = (fraction) => START_DEG + SWEEP_DEG * Math.min(1, Math.max(0, fraction));

const fixed = (n) => Number(n.toFixed(2));

/** SVG path of the arc from fraction `from` to fraction `to`. */
export function arcPath(cx, cy, r, from, to) {
  const a = pointAt(cx, cy, r, angleOf(from));
  const b = pointAt(cx, cy, r, angleOf(to));
  const large = (Math.max(from, to) - Math.min(from, to)) * SWEEP_DEG > 180 ? 1 : 0;
  return `M${fixed(a.x)} ${fixed(a.y)}A${r} ${r} 0 ${large} 1 ${fixed(b.x)} ${fixed(b.y)}`;
}

/** The fraction (0..1) of the ring that the point (x, y) is at, as seen from the centre; the gap snaps to the nearer end. */
export function fractionFromPoint(cx, cy, x, y) {
  const deg = (Math.atan2(x - cx, -(y - cy)) * 180) / Math.PI; // -180..180, 0 = up
  const relative = (((deg - START_DEG) % 360) + 360) % 360; // 0 at the start of the arc, clockwise
  if (relative <= SWEEP_DEG) return relative / SWEEP_DEG;
  return relative - SWEEP_DEG < (360 - SWEEP_DEG) / 2 ? 1 : 0;
}

/** Value for a fraction, snapped to `step` and kept within min..max. */
export function valueAt(fraction, { min, max, step = 0.5 }) {
  const raw = min + (max - min) * Math.min(1, Math.max(0, fraction));
  const snapped = Math.round(raw / step) * step;
  return fixed(Math.min(max, Math.max(min, snapped)));
}

export const fractionOf = (value, { min, max }) => (max > min ? Math.min(1, Math.max(0, (Number(value) - min) / (max - min))) : 0);
