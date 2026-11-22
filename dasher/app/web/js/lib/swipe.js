/** A flick along one axis: long enough, mostly straight and not a slow drag. */
export function swipeStep(distance, crossDistance, ms) {
  if (Math.abs(distance) < 70 || Math.abs(distance) < Math.abs(crossDistance) * 1.8 || ms > 700) return 0;
  return distance < 0 ? 1 : -1;
}
