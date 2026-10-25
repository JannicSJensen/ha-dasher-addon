import { h } from "../core/h.js";
import { arcPath, fractionFromPoint, fractionOf, pointAt, angleOf, valueAt } from "../lib/dial.js";

const NS = "http://www.w3.org/2000/svg";
const svg = (tag, attrs = {}, ...children) => {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  el.append(...children);
  return el;
};

let uid = 0;

/**
 * A ring dial: a track, a coloured arc up to the setpoint, a knob at the setpoint and (optionally) a small mark for
 * the measured value. With `onInput` the setpoint can be dragged around the ring. The middle is free for text
 * (`dial.center`).
 *   options: { size, min, max, step, stops: [[offset, colour]], onInput(value), onCommit(value) }
 */
export function createDial({ min = 5, max = 35, step = 0.5, stops = [[0, "#4fc3f7"], [0.5, "#2dd4bf"], [1, "#ff8a3d"]], onInput = null, onCommit = null, knob = true } = {}) {
  const id = `dial${++uid}`;
  const C = 100;
  const R = 82;
  const gradient = svg(
    "linearGradient",
    { id, gradientUnits: "userSpaceOnUse", x1: "18", y1: "0", x2: "182", y2: "0" },
    ...stops.map(([offset, color]) => svg("stop", { offset, "stop-color": color })),
  );
  const track = svg("path", { class: "dial__track", d: arcPath(C, C, R, 0, 1), fill: "none" });
  const arc = svg("path", { class: "dial__arc", fill: "none", stroke: `url(#${id})` });
  const mark = svg("circle", { class: "dial__mark", r: "5" });
  const knobEl = svg("circle", { class: "dial__knob", r: "9", hidden: "" });
  const picture = svg("svg", { class: "dial__svg", viewBox: "0 0 200 200" }, svg("defs", {}, gradient), track, arc, mark, knobEl);
  const center = h("div", { class: "dial__center" });
  const el = h("div", { class: `dial${onInput ? " is-draggable" : ""}` }, picture, center);

  const state = { range: { min, max, step }, value: null, current: null };

  function paint() {
    const { range, value, current } = state;
    const f = value == null ? null : fractionOf(value, range);
    arc.setAttribute("d", f == null || f <= 0.001 ? "" : arcPath(C, C, R, 0, f));
    arc.style.display = f == null ? "none" : "";
    if (f != null && knob) {
      const p = pointAt(C, C, R, angleOf(f));
      knobEl.setAttribute("cx", p.x);
      knobEl.setAttribute("cy", p.y);
      knobEl.removeAttribute("hidden");
    } else knobEl.setAttribute("hidden", "");
    if (current != null && Number.isFinite(Number(current))) {
      const p = pointAt(C, C, R, angleOf(fractionOf(current, range)));
      mark.setAttribute("cx", p.x);
      mark.setAttribute("cy", p.y);
      mark.removeAttribute("hidden");
    } else mark.setAttribute("hidden", "");
  }

  if (onInput) {
    let dragging = false;
    const valueFor = (event) => {
      const box = picture.getBoundingClientRect();
      const x = ((event.clientX - box.left) / box.width) * 200;
      const y = ((event.clientY - box.top) / box.height) * 200;
      return valueAt(fractionFromPoint(C, C, x, y), state.range);
    };
    picture.addEventListener("pointerdown", (event) => {
      const box = picture.getBoundingClientRect();
      const x = ((event.clientX - box.left) / box.width) * 200 - C;
      const y = ((event.clientY - box.top) / box.height) * 200 - C;
      const distance = Math.hypot(x, y);
      if (distance < R - 34 || distance > R + 24) return; // only the ring itself, not the middle
      dragging = true;
      picture.setPointerCapture?.(event.pointerId);
      onInput(valueFor(event));
      event.preventDefault();
    });
    picture.addEventListener("pointermove", (event) => {
      if (dragging) onInput(valueFor(event));
    });
    const end = (event) => {
      if (!dragging) return;
      dragging = false;
      onCommit?.(valueFor(event));
    };
    picture.addEventListener("pointerup", end);
    picture.addEventListener("pointercancel", () => (dragging = false));
  }

  return {
    el,
    center,
    /** Setpoint (null hides the arc), measured value (null hides the mark), and the range. */
    set({ value = state.value, current = state.current, min: lo = state.range.min, max: hi = state.range.max, step: s = state.range.step } = {}) {
      state.range = { min: lo, max: hi, step: s };
      state.value = value;
      state.current = current;
      paint();
    },
  };
}
