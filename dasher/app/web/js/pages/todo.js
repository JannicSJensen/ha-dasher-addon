import { getJson, manageTodoList } from "../core/api.js";
import { h } from "../core/h.js";
import { icon } from "../core/icons.js";
import { openModal } from "../core/modal.js";
import { confirmDialog } from "../components/dialogs.js";
import { friendlyName, pressable } from "../tiles/common.js";
import { format } from "../lib/i18n.js";
import { describeDue, dueInputValue, listFeatures, openCount, updateData } from "../lib/todo.js";

const POLL_MS = 20_000;

const button = (iconName, label, onTap, cls = "btn") => {
  const b = h("button", { class: cls, type: "button" }, icon(iconName), label ? h("span", null, label) : null);
  pressable(b, { onTap });
  return b;
};

/** Text prompt in a sheet; `onSubmit(value)` runs on Enter or the confirm button. */
function promptDialog({ title, label, value = "", confirmLabel, cancelLabel, onSubmit }) {
  let modal;
  const input = h("input", { class: "msearch__input tdinput", type: "text", maxlength: "60", value, "aria-label": label, placeholder: label, autocomplete: "off", enterkeyhint: "done" });
  const submit = () => {
    const text = input.value.trim();
    if (!text) return input.focus();
    modal.close();
    onSubmit(text);
  };
  input.addEventListener("keydown", (e) => e.key === "Enter" && submit());
  modal = openModal(h("div", { class: "modal__body dialog" }, h("div", { class: "modal__title" }, title), input, h("div", { class: "dialog__actions" }, button("close", cancelLabel, () => modal.close()), button("check", confirmLabel, submit, "btn btn--primary"))));
  setTimeout(() => (input.focus(), input.select()), 50);
  return modal;
}

/** The to-do page: every list as a card; opening one shows its items to add, tick off, edit and delete. */
export function createTodoPage(model, ctx, listId = null) {
  const { t, getState } = ctx;
  const num = (n) => new Intl.NumberFormat(ctx.locale).format(n);
  const lists = model.lists ?? [];
  const list = listId ? lists.find((l) => l.id === listId) : null;
  const call = (service, data) => ctx.call("todo", service, listId, data);

  // ============ overview ============================================================
  if (!list) {
    if (listId) setTimeout(() => ctx.navigate("todo"), 0); // an unknown list: back to the overview
    const cards = lists.map((l) => {
      const count = h("div", { class: "tdcard__count" });
      const label = h("div", { class: "tdcard__label" });
      const el = h(
        "button",
        { class: "tdcard", type: "button" },
        h("div", { class: "tdcard__top" }, icon("format-list-checks"), h("span", { class: "tdcard__name" }, l.name)),
        count,
        label,
        l.source ? h("span", { class: "tdcard__source" }, l.source) : null,
      );
      pressable(el, { onTap: () => ctx.navigate(`todo/${encodeURIComponent(l.id)}`) });
      return {
        id: l.id,
        el,
        update() {
          const n = openCount(getState(l.id));
          count.textContent = n == null ? "–" : num(n);
          label.textContent = n == null ? t("unavailable") : n === 0 ? t("todo_all_done") : format(t, "todo_open", { n });
          el.classList.toggle("is-empty", n === 0);
          el.classList.toggle("is-unavailable", n == null);
        },
      };
    });
    const createBtn = model.manage
      ? button("plus", t("todo_new_list"), () =>
          promptDialog({
            title: t("todo_new_list"),
            label: t("todo_list_name"),
            confirmLabel: t("todo_create"),
            cancelLabel: t("cancel"),
            onSubmit: async (name) => {
              try {
                await manageTodoList("create", { name });
                ctx.toast(t("todo_created"));
              } catch (err) {
                ctx.toast(err.message);
              }
            },
          }),
        "btn btn--primary")
      : null;
    const el = h(
      "div",
      { class: "todopage" },
      h("div", { class: "radio__titlebar" }, h("h1", { class: "radio__title" }, model.title ?? t("todo_title")), createBtn),
      cards.length ? h("div", { class: "tdgrid" }, cards.map((c) => c.el)) : h("div", { class: "notice" }, icon("format-list-checks"), h("h2", null, t("todo_none"))),
    );
    return { el, entities: lists.map((l) => l.id), update: () => cards.forEach((c) => c.update()) };
  }

  // ============ one list ============================================================
  let data = { items: [], completed: [] };
  let loaded = false;
  let error = null;
  let generation = 0;
  let lastState = null;
  const features = () => listFeatures(getState(listId));

  const title = h("h1", { class: "radio__title tdtitle" }, list.name);
  const back = button("arrow-left", t("todo_back"), () => ctx.navigate("todo"), "btn tdback");
  const manageButtons = list.managed && model.manage
    ? [
        button("pencil-outline", null, () =>
          promptDialog({
            title: t("todo_rename"),
            label: t("todo_list_name"),
            value: list.name,
            confirmLabel: t("todo_save"),
            cancelLabel: t("cancel"),
            onSubmit: async (name) => {
              try {
                await manageTodoList("rename", { entity_id: listId, name });
                ctx.toast(t("todo_renamed"));
              } catch (err) {
                ctx.toast(err.message);
              }
            },
          }),
        "btn btn--icon"),
        button("trash-can-outline", null, () =>
          confirmDialog({
            title: t("todo_delete_list"),
            text: format(t, "todo_delete_list_text", { name: list.name }),
            confirmLabel: t("todo_delete"),
            cancelLabel: t("cancel"),
            danger: true,
            onConfirm: async () => {
              try {
                await manageTodoList("delete", { entity_id: listId });
                ctx.toast(t("todo_deleted"));
                ctx.navigate("todo");
              } catch (err) {
                ctx.toast(err.message);
              }
            },
          }),
        "btn btn--icon"),
      ]
    : [];

  const addInput = h("input", { class: "msearch__input tdadd__input", type: "text", maxlength: "255", placeholder: t("todo_add_placeholder"), "aria-label": t("todo_add_placeholder"), autocomplete: "off", enterkeyhint: "done" });
  const addBtn = button("plus", t("todo_add"), () => addItem(), "btn btn--primary");
  const addRow = h("div", { class: "tdadd" }, addInput, addBtn);
  addInput.addEventListener("keydown", (e) => e.key === "Enter" && addItem());

  const openList = h("div", { class: "tditems" });
  const doneHead = h("div", { class: "tddonehead" });
  const doneList = h("div", { class: "tditems tditems--done" });
  const status = h("div", { class: "tdstatus" });

  const el = h(
    "div",
    { class: "todopage" },
    h("div", { class: "tdheader" }, back, title, h("div", { class: "tdheader__actions" }, manageButtons)),
    addRow,
    status,
    openList,
    doneHead,
    doneList,
  );

  async function addItem() {
    const text = addInput.value.trim();
    if (!text) return addInput.focus();
    addInput.value = "";
    await call("add_item", { item: text });
    await load();
    addInput.focus();
  }

  const toggle = async (item) => {
    await call("update_item", { item: item.uid, status: item.done ? "needs_action" : "completed" });
    await load();
  };

  function openEditor(item) {
    const f = features();
    let modal;
    const text = h("input", { class: "msearch__input tdinput", type: "text", maxlength: "255", value: item.summary, "aria-label": t("todo_text") });
    const description = f.description ? h("textarea", { class: "msearch__input tdinput tdtextarea", rows: "3", "aria-label": t("todo_description"), placeholder: t("todo_description") }, item.description) : null;
    if (description) description.value = item.description;
    const due = f.due ? h("input", { class: "msearch__input tdinput", type: "date", value: dueInputValue(item.due), "aria-label": t("todo_due") }) : null;
    const save = async () => {
      const changes = updateData(item, { summary: text.value, description: description?.value, due: due?.value }, f);
      modal.close();
      if (changes) {
        await call("update_item", changes);
        await load();
      }
    };
    text.addEventListener("keydown", (e) => e.key === "Enter" && save());
    const remove = f.remove
      ? button("trash-can-outline", t("todo_delete"), async () => {
          modal.close();
          await call("remove_item", { item: [item.uid] });
          await load();
        }, "btn btn--danger")
      : null;
    modal = openModal(
      h(
        "div",
        { class: "modal__body dialog tdedit" },
        h("div", { class: "modal__title" }, t("todo_edit")),
        h("label", { class: "tdfield" }, h("span", null, t("todo_text")), text),
        description ? h("label", { class: "tdfield" }, h("span", null, t("todo_description")), description) : null,
        due ? h("label", { class: "tdfield" }, h("span", null, t("todo_due")), due) : null,
        h("div", { class: "dialog__actions" }, remove, button("close", t("cancel"), () => modal.close()), button("check", t("todo_save"), save, "btn btn--primary")),
      ),
    );
  }

  function createRow(item) {
    const f = features();
    const check = h("button", { class: `tdcheck${item.done ? " is-done" : ""}`, type: "button", role: "checkbox", "aria-checked": String(item.done), "aria-label": item.summary, disabled: !f.update }, icon(item.done ? "check" : "circle-outline"));
    pressable(check, { onTap: () => toggle(item) });
    const due = describeDue(item.due, { locale: ctx.locale });
    const body = h(
      "div",
      { class: "tdrow__text" },
      h("div", { class: "tdrow__summary" }, item.summary),
      item.description ? h("div", { class: "tdrow__desc" }, item.description) : null,
      due ? h("span", { class: `tdrow__due${due.overdue && !item.done ? " is-overdue" : ""}` }, icon("calendar-outline"), due.label) : null,
    );
    if (f.update) pressable(body, { onTap: () => openEditor(item) });
    const remove = f.remove ? button("close", null, async () => (await call("remove_item", { item: [item.uid] }), load()), "tdrow__remove") : null;
    if (remove) remove.setAttribute("aria-label", t("todo_delete"));
    return h("div", { class: `tdrow${item.done ? " is-done" : ""}` }, check, body, remove);
  }

  function render() {
    const f = features();
    addRow.hidden = !f.create;
    status.replaceChildren();
    if (error && !loaded) status.append(h("div", { class: "notice" }, icon("alert-circle-outline"), h("p", null, error)));
    else if (!loaded) status.append(h("p", { class: "view__hint" }, t("plex_loading")));
    else if (!data.items.length && !data.completed.length) status.append(h("p", { class: "view__hint" }, t("todo_empty")));
    openList.replaceChildren(...data.items.map(createRow));
    doneHead.replaceChildren();
    doneList.replaceChildren();
    if (data.completed.length) {
      const clear = f.remove
        ? button("broom", t("todo_clear_completed"), () =>
            confirmDialog({
              title: t("todo_clear_completed"),
              text: format(t, "todo_clear_text", { n: data.completed.length }),
              confirmLabel: t("todo_clear"),
              cancelLabel: t("cancel"),
              danger: true,
              onConfirm: async () => (await call("remove_completed_items", {}), load()),
            }),
          "btn")
        : null;
      doneHead.append(h("h2", { class: "tddonehead__title" }, `${t("todo_completed")} (${data.completed.length})`), clear);
      doneList.append(...data.completed.map(createRow));
    }
  }

  async function load() {
    const mine = ++generation;
    try {
      const result = await getJson(`api/todo/items?${new URLSearchParams({ entity_id: listId })}`);
      if (mine !== generation) return;
      data = result;
      error = null;
      loaded = true;
    } catch (err) {
      if (mine !== generation) return;
      error = err.message;
    }
    render();
  }

  load();
  const timer = setInterval(load, POLL_MS);

  return {
    el,
    entities: [listId],
    update() {
      const state = getState(listId);
      if (!state) return; // the list was removed
      const signature = `${state?.state}|${state?.attributes?.supported_features}`;
      if (signature !== lastState) {
        const first = lastState === null;
        lastState = signature;
        if (!first) load(); // the list changed elsewhere
      }
      title.textContent = list.name || friendlyName(state, listId);
    },
    destroy() {
      clearInterval(timer);
      generation += 1;
    },
  };
}
