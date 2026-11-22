import { menuItemActive } from "./menu.js";
import { swipeStep } from "./swipe.js";

const EDITABLE = "input, select, textarea, [contenteditable]:not([contenteditable='false']), [role='slider'], .slider, .dial__svg";

function scrollAvailability(target, stage) {
  let up = false;
  let down = false;
  for (let node = target; node; node = node.parentElement) {
    if (node.scrollHeight > node.clientHeight + 1) {
      const { overflowY } = stage.ownerDocument.defaultView.getComputedStyle(node);
      if (["auto", "scroll", "overlay"].includes(overflowY)) {
        up ||= node.scrollTop > 1;
        down ||= node.scrollTop < node.scrollHeight - node.clientHeight - 1;
      }
    }
    if (node === stage) break;
  }
  return { up, down };
}

function activeIndex(navigation) {
  return navigation.items.findIndex((item) => menuItemActive(item, navigation.route));
}

export function installPageSwipe(stage, getNavigation, navigate) {
  let swipe = null;
  const cancel = () => { swipe = null; };

  stage.addEventListener("touchstart", (event) => {
    cancel();
    if (event.touches.length !== 1) return;
    const target = event.target.nodeType === 1 ? event.target : event.target.parentElement;
    if (!target || target.closest(EDITABLE)) return;
    const navigation = getNavigation();
    if (!navigation || navigation.items.length < 2) return;
    const index = activeIndex(navigation);
    if (index < 0) return;
    const touch = event.touches[0];
    swipe = {
      id: touch.identifier, x: touch.clientX, y: touch.clientY, at: Date.now(),
      hash: navigation.hash, key: navigation.items[index].key,
      scroll: scrollAvailability(target, stage),
    };
  }, { capture: true, passive: true });

  stage.addEventListener("touchmove", (event) => {
    if (swipe && (event.touches.length !== 1 || event.touches[0].identifier !== swipe.id)) cancel();
  }, { capture: true, passive: true });

  stage.addEventListener("touchend", (event) => {
    const start = swipe;
    cancel();
    if (!start || event.touches.length !== 0) return;
    const touch = Array.from(event.changedTouches).find((point) => point.identifier === start.id);
    if (!touch) return;
    const step = swipeStep(touch.clientY - start.y, touch.clientX - start.x, Date.now() - start.at);
    if (!step || (step > 0 ? start.scroll.down : start.scroll.up)) return;
    const navigation = getNavigation();
    if (!navigation || navigation.hash !== start.hash) return;
    const index = activeIndex(navigation);
    if (index < 0 || navigation.items[index].key !== start.key) return;
    const next = navigation.items[index + step];
    if (!next) return;
    if (event.cancelable) event.preventDefault();
    navigate(next.href);
  }, { capture: true, passive: false });

  stage.addEventListener("touchcancel", cancel, { capture: true, passive: true });
}
