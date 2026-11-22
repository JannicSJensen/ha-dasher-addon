import assert from "node:assert/strict";
import { test } from "node:test";
import { installPageSwipe } from "../web/js/lib/page-swipe.js";

const point = (x, y, identifier = 1) => ({ clientX: x, clientY: y, identifier });

function harness() {
  function element(parentElement = null, props = {}) {
    return {
      nodeType: 1, parentElement, scrollHeight: 0, clientHeight: 0, scrollTop: 0,
      overflowY: "visible", ...props,
      closest(selector) {
        for (let node = this; node; node = node.parentElement) {
          if (node.blocked && selector.includes(node.blocked)) return node;
        }
        return null;
      },
    };
  }
  const stage = element();
  stage.ownerDocument = { defaultView: { getComputedStyle: (node) => ({ overflowY: node.overflowY }) } };
  const listeners = {};
  stage.addEventListener = (type, handler, options) => { listeners[type] = { handler, options }; };
  const target = element(stage);
  const items = [
    { key: "page:home", kind: "page", id: "home", href: "#/home" },
    { key: "music", kind: "music", id: null, href: "#/music" },
    { key: "areas", kind: "areas", id: null, href: "#/areas" },
    { key: "todo", kind: "todo", id: null, href: "#/todo" },
  ];
  const h = {
    element, stage, target, listeners, visited: [],
    navigation: { items, route: { kind: "page", id: "home" }, hash: "#/home" },
    fire(type, { target: eventTarget = target, touches = [], changedTouches = [] } = {}) {
      const event = {
        target: eventTarget, touches, changedTouches, cancelable: true, defaultPrevented: false,
        preventDefault() { this.defaultPrevented = true; },
      };
      listeners[type].handler(event);
      return event;
    },
    start(eventTarget = target, x = 200, y = 300) {
      return this.fire("touchstart", { target: eventTarget, touches: [point(x, y)] });
    },
    end(eventTarget = target, x = 200, y = 200) {
      return this.fire("touchend", { target: eventTarget, changedTouches: [point(x, y)] });
    },
    gesture(eventTarget = target, dx = 0, dy = -100) {
      this.start(eventTarget);
      this.fire("touchmove", { target: eventTarget, touches: [point(200 + dx, 300 + dy)] });
      return this.end(eventTarget, 200 + dx, 300 + dy);
    },
  };
  installPageSwipe(stage, () => h.navigation, (href) => h.visited.push(href));
  return h;
}

test("vertical swipes follow visible menu order in both directions without wrapping", () => {
  const h = harness();
  assert.equal(h.listeners.touchend.options.passive, false);
  assert.equal(h.gesture().defaultPrevented, true);
  assert.deepEqual(h.visited, ["#/music"]);

  h.navigation.route = { kind: "music", id: null };
  h.navigation.hash = "#/music";
  assert.equal(h.gesture(h.target, 0, 100).defaultPrevented, true);
  assert.equal(h.visited.at(-1), "#/home");
  assert.equal(h.gesture().defaultPrevented, true);
  assert.equal(h.visited.at(-1), "#/areas");

  h.navigation.route = { kind: "page", id: "home" };
  h.navigation.hash = "#/home";
  assert.equal(h.gesture(h.target, 0, 100).defaultPrevented, false);
  h.navigation.route = { kind: "todo", id: "todo.shopping" };
  h.navigation.hash = "#/todo/todo.shopping";
  assert.equal(h.gesture().defaultPrevented, false);
  assert.equal(h.visited.length, 3);

  h.navigation.items.splice(1, 1);
  h.navigation.route = { kind: "page", id: "home" };
  h.navigation.hash = "#/home";
  h.gesture();
  assert.equal(h.visited.at(-1), "#/areas");
});

test("subpages use the parent menu item when swiping", () => {
  const h = harness();
  h.navigation.route = { kind: "area", id: "living room" };
  h.navigation.hash = "#/area/living%20room";
  h.gesture();
  assert.equal(h.visited.at(-1), "#/todo");
  h.gesture(h.target, 0, 100);
  assert.equal(h.visited.at(-1), "#/music");
  h.navigation.route = { kind: "todo", id: "todo.shopping" };
  h.navigation.hash = "#/todo/todo.shopping";
  h.gesture(h.target, 0, 100);
  assert.equal(h.visited.at(-1), "#/areas");
});

test("scrolling wins until a new swipe starts at the appropriate boundary", () => {
  const h = harness();
  const scroller = h.element(h.stage, { overflowY: "auto", scrollHeight: 1000, clientHeight: 400, scrollTop: 0 });
  const content = h.element(scroller);
  h.start(content);
  scroller.scrollTop = 600;
  assert.equal(h.end(content).defaultPrevented, false);
  assert.deepEqual(h.visited, [], "reaching the bottom during a scroll must not change page");
  assert.equal(h.gesture(content).defaultPrevented, true);
  assert.deepEqual(h.visited, ["#/music"]);

  h.navigation.route = { kind: "music", id: null };
  h.navigation.hash = "#/music";
  assert.equal(h.gesture(content, 0, 100).defaultPrevented, false, "scroll up before going back");
  scroller.scrollTop = 0;
  assert.equal(h.gesture(content, 0, 100).defaultPrevented, true);
  assert.equal(h.visited.at(-1), "#/home");
});

test("nested scroll regions and fractional scroll positions are respected", () => {
  const h = harness();
  const outer = h.element(h.stage, { overflowY: "scroll", scrollHeight: 1000, clientHeight: 400, scrollTop: 300 });
  const inner = h.element(outer, { overflowY: "auto", scrollHeight: 600, clientHeight: 300, scrollTop: 300 });
  const target = h.element(inner);
  assert.equal(h.gesture(target).defaultPrevented, false, "the outer region can still scroll down");
  outer.scrollTop = 599.5;
  assert.equal(h.gesture(target).defaultPrevented, true);
  inner.scrollTop = 299;
  outer.scrollTop = 600;
  assert.equal(h.gesture(target).defaultPrevented, true, "one-pixel rounding does not block the boundary");
  inner.scrollTop = 200;
  assert.equal(h.gesture(target).defaultPrevented, false, "the inner region can still scroll down");
  inner.overflowY = "hidden";
  assert.equal(h.gesture(target).defaultPrevented, true, "a clipped region is not a touch scroller");
});

test("page swipes ignore form fields, sliders and dials while allowing button surfaces", () => {
  const h = harness();
  for (const blocked of ["input", "select", "textarea", "contenteditable", "role='slider'", ".slider", ".dial__svg"]) {
    const control = h.element(h.stage, { blocked });
    assert.equal(h.gesture(h.element(control)).defaultPrevented, false, blocked);
  }
  const button = h.element(h.stage);
  assert.equal(h.gesture(h.element(button)).defaultPrevented, true);
  assert.deepEqual(h.visited, ["#/music"]);
});

test("short, diagonal, slow, multi-touch and cancelled gestures never navigate", () => {
  const h = harness();
  assert.equal(h.gesture(h.target, 0, -69).defaultPrevented, false);
  assert.equal(h.gesture(h.target, 80, -100).defaultPrevented, false);
  assert.equal(h.gesture(h.target, 0, -70).defaultPrevented, true);
  assert.equal(h.gesture(h.target, 50, -90).defaultPrevented, true);
  h.visited.length = 0;
  const originalNow = Date.now;
  let now = 1000;
  Date.now = () => now;
  try {
    h.start();
    now += 701;
    assert.equal(h.end().defaultPrevented, false);
  } finally {
    Date.now = originalNow;
  }

  h.start();
  h.fire("touchmove", { touches: [point(200, 200), point(220, 200, 2)] });
  assert.equal(h.end().defaultPrevented, false);
  h.fire("touchstart", { touches: [point(200, 300), point(220, 300, 2)] });
  assert.equal(h.end().defaultPrevented, false);
  h.start();
  h.fire("touchcancel");
  assert.equal(h.end().defaultPrevented, false);
  h.start();
  assert.equal(h.fire("touchend", { changedTouches: [point(200, 200, 2)] }).defaultPrevented, false);
  h.start();
  assert.equal(h.fire("touchend", { touches: [point(220, 200, 2)], changedTouches: [point(200, 200)] }).defaultPrevented, false);
  assert.deepEqual(h.visited, []);
});

test("a route, menu or overlay change during a gesture cancels navigation", () => {
  const h = harness();
  h.start();
  h.navigation.hash = "#/music";
  assert.equal(h.end().defaultPrevented, false);
  h.navigation.hash = "#/home";
  h.start();
  h.navigation.route = { kind: "music", id: null };
  assert.equal(h.end().defaultPrevented, false);
  h.navigation.route = { kind: "page", id: "home" };
  h.start();
  h.navigation.items.shift();
  assert.equal(h.end().defaultPrevented, false);
  h.navigation.route = { kind: "music", id: null };
  h.navigation.hash = "#/music";
  h.start();
  h.navigation = null;
  assert.equal(h.end().defaultPrevented, false);
  assert.deepEqual(h.visited, []);
});
