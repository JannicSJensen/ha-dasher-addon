import { h } from "../core/h.js";

const NS = "http://www.w3.org/2000/svg";
const svg = (tag, attrs = {}, ...children) => {
  const el = document.createElementNS(NS, tag);
  for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, value);
  el.append(...children);
  return el;
};

/** A decorative, CSS-animated landscape; all data and status text stay in the hero. */
export function createWeatherScene() {
  const cloud = (i) => svg("svg", { class: `weather-scene__cloud cloud-${i}`, viewBox: "0 0 300 110" },
    svg("path", { d: "M28 95C-8 95-6 48 27 43C27 9 74 0 94 27C116-11 177-8 194 34C224 15 258 36 257 62C296 57 309 95 273 95Z", fill: "currentColor" }),
  );
  const particles = (kind, count) => h("div", { class: `weather-scene__${kind}` },
    Array.from({ length: count }, (_, i) => h("i", {
      style: {
        "--x": `${(i * 37 + 11) % 100}%`,
        "--delay": `${-(i * 0.73)}s`,
        "--duration": `${2.4 + (i % 5) * 0.55}s`,
        "--drift": `${(i % 2 ? 1 : -1) * (10 + i % 7)}px`,
      },
    })),
  );
  const landscape = svg("svg", { class: "weather-scene__landscape", viewBox: "0 0 600 320", preserveAspectRatio: "none" },
    svg("path", { class: "weather-scene__hill-far", d: "M0 130Q70 48 150 106T315 90T465 103T600 74V320H0Z" }),
    svg("path", { class: "weather-scene__hill-mid", d: "M0 192Q95 117 203 176T394 155T600 161V320H0Z" }),
    svg("path", { class: "weather-scene__hill-near", d: "M0 230Q144 181 275 229T600 211V320H0Z" }),
    ...[12, 39, 63, 505, 547, 580].map((x, i) => svg("path", {
      class: "weather-scene__tree",
      d: `M${x} ${155 + i % 3 * 16}l-16 36h8l-15 25h15v18h16v-18h15l-15-25h8Z`,
    })),
  );
  const el = h("div", { class: "weather-scene", "aria-hidden": "true", hidden: true },
    h("div", { class: "weather-scene__glow" }),
    particles("stars", 16),
    h("div", { class: "weather-scene__sun" }),
    svg("svg", { class: "weather-scene__moon", viewBox: "0 0 100 100" },
      svg("path", { d: "M77 78A41 41 0 1 1 76 13A34 34 0 0 0 77 78Z", fill: "#fff1cd" }),
    ),
    h("div", { class: "weather-scene__clouds" }, [0, 1, 2].map(cloud)),
    h("div", { class: "weather-scene__flash" }),
    landscape,
    particles("rain", 28),
    particles("snow", 22),
    h("div", { class: "weather-scene__mist" }, [0, 1, 2].map(() => h("i"))),
    h("div", { class: "weather-scene__wind" }, [0, 1, 2].map(() => h("i"))),
  );
  return {
    el,
    set(model) {
      el.hidden = !model.scene;
      el.dataset.weather = model.scene ?? "";
      el.classList.toggle("is-night", model.night);
    },
    pause(paused) { el.classList.toggle("is-paused", paused); },
  };
}
