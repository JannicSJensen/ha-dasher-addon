import * as mdi from "@mdi/js";

const NAME_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

const upperFirst = (s) => s.charAt(0).toUpperCase() + s.slice(1);

/** "lightbulb-on-outline" -> "mdiLightbulbOnOutline" */
function exportName(name) {
  return "mdi" + name.split("-").map(upperFirst).join("");
}

/** Returns the SVG path data for an MDI icon name, or null if unknown. */
export function iconPath(name) {
  if (typeof name !== "string" || !NAME_RE.test(name)) return null;
  const path = mdi[exportName(name)];
  return typeof path === "string" ? path : null;
}

export function iconSvg(name) {
  const d = iconPath(name);
  if (!d) return null;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="currentColor" d="${d}"/></svg>`;
}
