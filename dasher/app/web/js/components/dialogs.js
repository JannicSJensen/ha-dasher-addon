import { h } from "../core/h.js";
import { openModal } from "../core/modal.js";
import { hoursOf, minutesOf, pad, parseTimeOptions } from "../lib/ev.js";
import { pressable } from "../tiles/common.js";

/** "Are you sure?" dialog. `danger` colours the confirm button. */
export function confirmDialog({ title, text, confirmLabel, cancelLabel, danger = false, onConfirm }) {
  let modal;
  const ok = h("button", { class: `btn ${danger ? "btn--danger" : "btn--primary"}`, type: "button" }, confirmLabel);
  const cancel = h("button", { class: "btn", type: "button" }, cancelLabel);
  pressable(ok, { onTap: () => (modal.close(), onConfirm()) });
  pressable(cancel, { onTap: () => modal.close() });
  modal = openModal(h("div", { class: "modal__body dialog" }, h("div", { class: "modal__title" }, title), text ? h("p", { class: "dialog__text" }, text) : null, h("div", { class: "dialog__actions" }, cancel, ok)));
  return modal;
}

/**
 * Pick a time from the options of a select entity: the hour first, then the minute (skipped when an
 * hour has only one option), or the "off" option. Falls back to a plain list for other options.
 * `onPick(option)` receives the exact option string.
 */
export function openTimePicker({ title, options, current, offLabel, onPick }) {
  const { times, off } = parseTimeOptions(options);
  let modal;
  const body = h("div", { class: "modal__body timepicker" }, h("div", { class: "modal__title" }, title));
  const pick = (option) => (modal.close(), onPick(option));
  const button = (label, option, extra = "") => {
    const el = h("button", { class: `tp__btn${option === current ? " is-chosen" : ""}${extra}`, type: "button" }, label);
    pressable(el, { onTap: () => pick(option) });
    return el;
  };

  if (!times.length) {
    body.append(h("div", { class: "tp__grid tp__grid--list" }, (options ?? []).map((o) => button(o === off ? offLabel : o, o))));
  } else {
    const [currentHour] = String(current).split(":");
    const hourGrid = h("div", { class: "tp__grid tp__grid--hours" });
    const minuteRow = h("div", { class: "tp__grid tp__grid--minutes", hidden: true });
    const chooseHour = (hour) => {
      const minutes = minutesOf(times, hour);
      if (minutes.length === 1) return pick(`${pad(hour)}:${pad(minutes[0])}`);
      for (const b of hourGrid.children) b.classList.toggle("is-chosen", Number(b.dataset.hour) === hour);
      minuteRow.hidden = false;
      minuteRow.replaceChildren(...minutes.map((m) => button(`:${pad(m)}`, `${pad(hour)}:${pad(m)}`)));
    };
    for (const hour of hoursOf(times)) {
      const b = h("button", { class: `tp__btn${String(pad(hour)) === currentHour ? " is-chosen" : ""}`, type: "button", dataset: { hour: String(hour) } }, pad(hour));
      pressable(b, { onTap: () => chooseHour(hour) });
      hourGrid.append(b);
    }
    if (off) body.append(button(offLabel, off, " tp__btn--off"));
    body.append(hourGrid, minuteRow);
    if (times.some((t) => t.value === current)) chooseHour(Number(currentHour));
  }
  modal = openModal(body);
  return modal;
}
