import { h } from "./h.js";

const SVG_NS = "http://www.w3.org/2000/svg";
const cache = new Map();

const normalize = (name) => String(name ?? "").replace(/^mdi:/, "");

function loadPath(name) {
  if (!cache.has(name)) {
    cache.set(
      name,
      fetch(`./icons/${encodeURIComponent(name)}.svg`)
        .then((r) => (r.ok ? r.text() : ""))
        .then((svg) => /\sd="([^"]+)"/.exec(svg)?.[1] ?? "")
        .catch(() => ""),
    );
  }
  return cache.get(name);
}

/** Returns an inline MDI icon element (filled in once the path arrives). */
export function icon(name, className = "") {
  const wrap = h("span", { class: `icon ${className}`.trim(), "aria-hidden": "true" });
  setIcon(wrap, name);
  return wrap;
}

export function setIcon(wrap, name) {
  const key = normalize(name);
  if (wrap.dataset.icon === key) return;
  wrap.dataset.icon = key;
  if (!key) return wrap.replaceChildren();
  loadPath(key).then((d) => {
    if (wrap.dataset.icon !== key) return;
    const svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    const path = document.createElementNS(SVG_NS, "path");
    path.setAttribute("d", d);
    path.setAttribute("fill", "currentColor");
    svg.append(path);
    wrap.replaceChildren(svg);
  });
}
