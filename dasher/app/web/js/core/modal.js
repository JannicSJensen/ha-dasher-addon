import { h } from "./h.js";

/** Bottom-sheet style modal; returns { close }. Tapping the backdrop closes it. */
export function openModal(content, { onClose } = {}) {
  const sheet = h("div", { class: "modal__sheet" }, content);
  const backdrop = h("div", { class: "modal" }, sheet);
  const close = () => {
    backdrop.remove();
    onClose?.();
  };
  backdrop.addEventListener("pointerdown", (e) => {
    if (e.target === backdrop) close();
  });
  document.body.append(backdrop);
  return { close };
}
