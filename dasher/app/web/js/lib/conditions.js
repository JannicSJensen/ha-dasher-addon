/**
 * Evaluate a tile condition against entity states.
 *
 *   { entity, state: "on" | ["on", "home"], attribute?, not?, above?, below? }
 *
 * An array of conditions means "all of them"; `any: [...]` means "at least one".
 */
export function evaluate(cond, getState) {
  if (cond == null) return true;
  if (Array.isArray(cond)) return cond.every((c) => evaluate(c, getState));
  if (Array.isArray(cond.any)) return cond.any.some((c) => evaluate(c, getState));
  if (!cond.entity) return true;

  const entity = getState(cond.entity);
  if (!entity) return false;
  const value = cond.attribute ? entity.attributes?.[cond.attribute] : entity.state;

  let result = true;
  if (cond.state !== undefined) {
    const expected = Array.isArray(cond.state) ? cond.state : [cond.state];
    result = expected.map(String).includes(String(value));
  }
  if (result && (cond.above !== undefined || cond.below !== undefined)) {
    const n = Number(value);
    if (Number.isNaN(n)) result = false;
    else {
      if (cond.above !== undefined && !(n > Number(cond.above))) result = false;
      if (cond.below !== undefined && !(n < Number(cond.below))) result = false;
    }
  }
  return cond.not ? !result : result;
}

/** First entry whose `when` matches wins; entries without `when` act as the default. */
export function pickFirst(entries, getState) {
  return (entries ?? []).find((entry) => evaluate(entry.when, getState)) ?? null;
}
