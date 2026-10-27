import { familyPost, getJson } from "../core/api.js";
import { h } from "../core/h.js";
import { icon } from "../core/icons.js";
import { openModal } from "../core/modal.js";
import { getPref, setPref } from "../core/prefs.js";
import { confirmDialog } from "../components/dialogs.js";
import { afford, choresFor, currentEvent, initial, isOverdue } from "../lib/family.js";
import { format } from "../lib/i18n.js";
import { pressable } from "../tiles/common.js";

const TABS = [
  ["chores", "broom", "fam_tab_chores"],
  ["rewards", "gift-outline", "fam_tab_rewards"],
  ["stars", "star-outline", "fam_tab_stars"],
];
const WEEKDAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
const CHORE_ICONS = ["🧹", "🍽️", "🗑️", "🛏️", "🧺", "🐕", "🌱", "📚", "🪥", "🚗"];
const REWARD_ICONS = ["🍦", "🎬", "🎮", "🧸", "🍕", "🚲", "📱", "⚽", "💰", "🎁"];
const PIN_KEEP_MS = 2 * 60_000;

function button(iconName, label, onTap, cls = "btn") {
  const b = h("button", { class: cls, type: "button" }, iconName ? icon(iconName) : null, label ? h("span", null, label) : null);
  pressable(b, { onTap });
  return b;
}
const field = (label, control) => h("label", { class: "tdfield" }, h("span", null, label), control);
const input = (props) => h("input", { class: "msearch__input tdinput", ...props });

/** The family board: who is home, the chores of everyone, the rewards and the log of the stars. */
export function createFamilyPage(initialModel, ctx) {
  const { t } = ctx;
  let model = initialModel;
  let tab = TABS.some(([id]) => id === getPref("family.tab")) ? getPref("family.tab") : "chores";
  let actorId = getPref("family.actor") || null;
  let pin = { id: null, value: "", until: 0 };
  let events = {}; // person id -> calendar events of today
  let eventsAt = 0;

  const root = h("div", { class: "familypage" });
  const peopleEl = h("div", { class: "fpeople" });
  const tabsEl = h("div", { class: "mtabs", role: "tablist" });
  const content = h("div", { class: "familypage__content" });
  root.append(h("div", { class: "radio__titlebar" }, h("h1", { class: "radio__title" }, model.title ?? t("fam_title"))), peopleEl, tabsEl, content);

  const people = () => model.people ?? [];
  const personOf = (id) => people().find((p) => p.id === id) ?? null;
  const me = () => personOf(actorId);
  const isAdult = () => me()?.role === "adult";
  const editable = () => model.editable && !ctx.readOnly;
  const show = (...parts) => content.replaceChildren(...parts.flat().filter(Boolean));

  // ---- actions ---------------------------------------------------------------------------------

  /** Ask for a PIN when the acting grown-up has one; remembered for a couple of minutes. */
  function askPin(person) {
    if (pin.id === person.id && pin.until > Date.now()) return Promise.resolve(pin.value);
    return new Promise((resolve) => {
      const code = input({ type: "password", inputmode: "numeric", maxlength: "8", autocomplete: "off", "aria-label": t("fam_pin") });
      let modal;
      const ok = () => {
        resolve(code.value); // before closing: closing says "no PIN" to a waiting caller
        modal.close();
      };
      code.addEventListener("keydown", (e) => e.key === "Enter" && ok());
      modal = openModal(
        h("div", { class: "modal__body dialog tdedit" }, h("div", { class: "modal__title" }, format(t, "fam_pin_for", { name: person.name })), field(t("fam_pin"), code), h("div", { class: "dialog__actions" }, button("check", t("fam_ok"), ok, "btn btn--primary"))),
        { onClose: () => resolve(null) },
      );
      setTimeout(() => code.focus(), 60);
    });
  }

  /** Send an action as the chosen person; `adult` actions need a grown-up and, if they have one, a PIN. */
  async function act(action, body = {}, { adult = false, toastOk = null } = {}) {
    const person = me();
    if (!person) {
      ctx.toast(t("fam_choose_first"));
      return null;
    }
    if (!editable()) return null;
    let code = "";
    if (adult) {
      if (person.role !== "adult") {
        ctx.toast(t("fam_adults_only"));
        return null;
      }
      if (person.has_pin) {
        code = await askPin(person);
        if (code == null) return null;
      }
    }
    try {
      const result = await familyPost(action, { ...body, actor: person.id, pin: code });
      if (adult && person.has_pin) pin = { id: person.id, value: code, until: Date.now() + PIN_KEEP_MS };
      if (toastOk) ctx.toast(toastOk);
      return result;
    } catch (err) {
      if (/PIN/.test(err.message)) pin = { id: null, value: "", until: 0 };
      ctx.toast(err.message);
      return null;
    }
  }

  function choose(id) {
    actorId = actorId === id ? null : id;
    setPref("family.actor", actorId ?? "");
    pin = { id: null, value: "", until: 0 };
    paintPeople();
    render();
  }

  // ---- people ---------------------------------------------------------------------------------

  const avatar = (p, size = "") => h("span", { class: `favatar${size}`, style: { "--who": p.color } }, p.avatar || initial(p.name));

  function presence(p) {
    const state = p.entity ? ctx.getState(p.entity)?.state : null;
    return state == null ? null : state === "home" ? "home" : state === "unavailable" || state === "unknown" ? null : "away";
  }

  function whatsOn(p) {
    const { now, next } = currentEvent(events[p.id] ?? []);
    if (now) return now.summary;
    if (next) return `${new Intl.DateTimeFormat(ctx.locale, { hour: "2-digit", minute: "2-digit" }).format(next.start)} ${next.summary}`;
    return "";
  }

  function paintPeople() {
    if (!people().length) {
      peopleEl.replaceChildren();
      return;
    }
    peopleEl.replaceChildren(
      ...people().map((p) => {
        const where = presence(p);
        const el = h(
          "button",
          { class: `fperson${p.id === actorId ? " is-me" : ""}`, type: "button", "aria-pressed": String(p.id === actorId) },
          avatar(p),
          h("span", { class: "fperson__text" }, h("span", { class: "fperson__name" }, p.name, where ? h("i", { class: `fperson__dot is-${where}`, title: t(`fam_${where}`) }) : null), h("span", { class: "fperson__sub" }, whatsOn(p) || (where ? t(`fam_${where}`) : ""))),
          h("span", { class: "fperson__stars" }, icon("star"), String(p.balance)),
        );
        pressable(el, { onTap: () => choose(p.id) });
        return el;
      }),
    );
  }

  async function loadEvents() {
    const withCalendar = people().filter((p) => p.calendar);
    if (!withCalendar.length || Date.now() - eventsAt < 60_000) return;
    eventsAt = Date.now();
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const end = new Date(start.getTime() + 36 * 3600_000);
    await Promise.all(
      withCalendar.map(async (p) => {
        try {
          const data = await getJson(`api/calendar?entities=${encodeURIComponent(p.calendar)}&start=${encodeURIComponent(start.toISOString())}&end=${encodeURIComponent(end.toISOString())}`);
          events[p.id] = data.events ?? [];
        } catch {
          events[p.id] = [];
        }
      }),
    );
    paintPeople();
  }

  // ---- tabs -------------------------------------------------------------------------------------

  function paintTabs() {
    tabsEl.replaceChildren(
      ...TABS.map(([id, iconName, label]) => {
        const el = h("button", { class: `mtab${id === tab ? " is-active" : ""}`, type: "button", role: "tab", "aria-selected": String(id === tab) }, icon(iconName), h("span", null, t(label)));
        pressable(el, { onTap: () => ((tab = id), setPref("family.tab", id), paintTabs(), render()) });
        return el;
      }),
    );
  }

  // ---- chores -----------------------------------------------------------------------------------

  const dueText = (chore) => {
    if (!chore.due) return "";
    const date = new Intl.DateTimeFormat(ctx.locale, { day: "numeric", month: "short" }).format(new Date(`${chore.due}T12:00:00`));
    return chore.due === model.today ? t("fam_today") : date;
  };

  function choreCard(chore) {
    const overdue = isOverdue(chore, model.today);
    const owner = personOf(chore.assignee);
    const actions = h("div", { class: "fchore__actions" });
    const mineOrAdult = chore.assignee === actorId || isAdult();
    if (chore.status === "open") {
      if (!chore.assignee) actions.append(button("hand-front-right", t("fam_take"), () => act("chore-claim", { id: chore.id }, { toastOk: t("fam_taken") }), "btn btn--primary"));
      else if (mineOrAdult || !actorId) actions.append(button("check", t("fam_done"), () => act("chore-done", { id: chore.id }), "btn btn--primary"));
    } else if (chore.status === "awaiting") {
      if (isAdult()) {
        actions.append(button("check-all", t("fam_approve"), () => act("chore-approve", { id: chore.id }, { adult: true, toastOk: format(t, "fam_paid", { n: chore.stars }) }), "btn btn--primary"), button("undo", t("fam_reject"), () => rejectDialog(chore)));
      } else if (chore.assignee === actorId) actions.append(button("undo", t("fam_undo"), () => act("chore-undo", { id: chore.id })));
    }
    if (editable() && isAdult()) {
      const edit = h("button", { class: "fchore__edit", type: "button", "aria-label": t("fam_edit") }, icon("pencil-outline"));
      pressable(edit, { onTap: () => openChoreEditor(chore) });
      actions.append(edit);
    }
    return h(
      "div",
      { class: `fchore is-${chore.status}${overdue ? " is-overdue" : ""}` },
      h("div", { class: "fchore__top" }, h("span", { class: "fchore__icon" }, chore.icon), h("span", { class: "fchore__title" }, chore.title), chore.stars ? h("span", { class: "fchore__stars" }, "★", String(chore.stars)) : null),
      h(
        "div",
        { class: "fchore__meta" },
        chore.status === "awaiting" ? h("span", { class: "fchip is-wait" }, t("fam_awaiting")) : null,
        chore.due ? h("span", { class: `fchip${overdue ? " is-late" : ""}` }, dueText(chore)) : null,
        chore.repeat?.type !== "none" ? h("span", { class: "fchip" }, icon("repeat")) : null,
        chore.mode === "rotation" ? h("span", { class: "fchip" }, icon("account-switch-outline")) : null,
        chore.streak > 1 ? h("span", { class: "fchip is-streak" }, `🔥${chore.streak}`) : null,
        !owner && chore.status === "open" ? h("span", { class: "fchip" }, t("fam_bin")) : null,
      ),
      chore.note_back ? h("div", { class: "fchore__back" }, `${t("fam_sent_back")}: ${chore.note_back}`) : null,
      actions.childElementCount ? actions : null,
    );
  }

  function rejectDialog(chore) {
    const note = input({ type: "text", maxlength: "200", placeholder: t("fam_reject_hint"), "aria-label": t("fam_reject_hint") });
    let modal;
    const go = async () => {
      modal.close();
      await act("chore-reject", { id: chore.id, note: note.value }, { adult: true });
    };
    modal = openModal(h("div", { class: "modal__body dialog tdedit" }, h("div", { class: "modal__title" }, chore.title), field(t("fam_reject_hint"), note), h("div", { class: "dialog__actions" }, button("undo", t("fam_reject"), go, "btn btn--primary"))));
  }

  function renderChores() {
    const columns = people().map((p) => ({ person: p, ...choresFor(model.chores, p.id, model.today) }));
    const bin = choresFor(model.chores, null, model.today);
    const waiting = model.chores.filter((c) => c.status === "awaiting").length;
    const out = [];
    const bar = h("div", { class: "mealsbar" });
    if (editable() && isAdult()) bar.append(button("plus", t("fam_new_chore"), () => openChoreEditor(), "btn btn--primary"));
    if (!actorId) bar.append(h("p", { class: "view__hint mealsbar__hint" }, t("fam_choose_hint")));
    else if (isAdult() && waiting) bar.append(h("span", { class: "fchip is-wait" }, format(t, "fam_waiting_n", { n: waiting })));
    out.push(bar);
    const board = h("div", { class: "fboard" });
    for (const col of columns) board.append(column(col.person, col));
    if (bin.open.length || !people().length) board.append(column(null, bin));
    out.push(board);
    if (!model.chores.length) out.push(h("div", { class: "notice" }, icon("broom"), h("h2", null, t("fam_no_chores")), h("p", null, t(isAdult() ? "fam_no_chores_hint" : "fam_choose_adult_hint"))));
    show(out);
  }

  function column(person, groups) {
    const done = groups.finished.length;
    const total = groups.open.length + groups.awaiting.length + done;
    const head = h("div", { class: "fcol__head" }, person ? avatar(person, " is-small") : h("span", { class: "favatar is-small is-bin" }, icon("inbox-outline")), h("span", { class: "fcol__name" }, person ? person.name : t("fam_bin")), person && total ? h("span", { class: "fcol__count" }, `${done}/${total}`) : null);
    const cards = [...groups.awaiting, ...groups.open].map(choreCard);
    return h("section", { class: `fcol${person && person.id === actorId ? " is-me" : ""}` }, head, cards.length ? cards : h("div", { class: "fcol__empty" }, person && total ? t("fam_all_done") : person ? t("fam_nothing") : t("fam_bin_hint")));
  }

  function openChoreEditor(chore = null) {
    const c = chore ?? { title: "", icon: CHORE_ICONS[0], stars: 1, assignee: people()[0]?.id ?? null, mode: "direct", rotation: [], repeat: { type: "none", days: [], every: 2 }, due: null, notes: "" };
    const title = input({ type: "text", maxlength: "80", value: c.title, placeholder: t("fam_chore_name"), "aria-label": t("fam_chore_name") });
    const iconInput = input({ type: "text", maxlength: "4", value: c.icon, "aria-label": t("fam_icon") });
    const picks = h("div", { class: "fpicks" }, CHORE_ICONS.map((e) => {
      const b = h("button", { class: "fpick", type: "button" }, e);
      pressable(b, { onTap: () => (iconInput.value = e) });
      return b;
    }));
    const stars = input({ type: "number", min: "0", max: "100", value: String(c.stars) });
    const who = h("select", { class: "msearch__input tdinput", "aria-label": t("fam_who") }, [
      ...people().map((p) => h("option", { value: p.id, selected: c.mode !== "rotation" && c.mode !== "first" && c.assignee === p.id }, p.name)),
      h("option", { value: "@bin", selected: c.mode === "bin" || (c.mode === "direct" && !c.assignee) }, t("fam_opt_bin")),
      h("option", { value: "@first", selected: c.mode === "first" }, t("fam_opt_first")),
      h("option", { value: "@turns", selected: c.mode === "rotation" }, t("fam_opt_turns")),
    ]);
    const turns = new Set(c.rotation);
    const turnBox = h("div", { class: "fpicks", hidden: who.value !== "@turns" }, people().map((p) => {
      const b = h("button", { class: `fpick${turns.has(p.id) ? " is-on" : ""}`, type: "button" }, p.name);
      pressable(b, { onTap: () => (turns.has(p.id) ? turns.delete(p.id) : turns.add(p.id), b.classList.toggle("is-on")) });
      return b;
    }));
    who.addEventListener("change", () => (turnBox.hidden = who.value !== "@turns"));
    const repeat = h("select", { class: "msearch__input tdinput", "aria-label": t("fam_repeat") }, ["none", "daily", "every", "weekdays"].map((r) => h("option", { value: r, selected: c.repeat.type === r }, t(`fam_repeat_${r}`))));
    const every = input({ type: "number", min: "1", max: "60", value: String(c.repeat.every || 2), "aria-label": t("fam_repeat_every") });
    const days = new Set(c.repeat.days);
    const dayBox = h("div", { class: "fpicks" }, WEEKDAYS.map((d, i) => {
      const b = h("button", { class: `fpick${days.has(i) ? " is-on" : ""}`, type: "button" }, t(`fam_${d}`));
      pressable(b, { onTap: () => (days.has(i) ? days.delete(i) : days.add(i), b.classList.toggle("is-on")) });
      return b;
    }));
    const syncRepeat = () => {
      every.hidden = repeat.value !== "every";
      dayBox.hidden = repeat.value !== "weekdays";
    };
    repeat.addEventListener("change", syncRepeat);
    syncRepeat();
    const due = input({ type: "date", value: c.due ?? "", "aria-label": t("fam_due") });
    const notes = input({ type: "text", maxlength: "300", value: c.notes ?? "", placeholder: t("fam_notes"), "aria-label": t("fam_notes") });
    let modal;
    const save = async () => {
      if (!title.value.trim()) return title.focus();
      const pick = who.value;
      const body = {
        ...(chore ? { id: chore.id } : {}),
        title: title.value,
        icon: iconInput.value,
        stars: Number(stars.value) || 0,
        mode: pick === "@turns" ? "rotation" : pick === "@first" ? "first" : pick === "@bin" ? "bin" : "direct",
        assignee: pick.startsWith("@") ? null : pick,
        rotation: [...turns],
        repeat: { type: repeat.value, every: Number(every.value) || 2, days: [...days] },
        due: due.value || null,
        notes: notes.value,
      };
      modal.close();
      await act("chore-save", { chore: body }, { adult: true });
    };
    const remove = () =>
      confirmDialog({
        title: c.title,
        text: t("fam_delete_chore"),
        confirmLabel: t("todo_delete"),
        cancelLabel: t("cancel"),
        danger: true,
        onConfirm: async () => {
          modal.close();
          await act("chore-delete", { id: chore.id }, { adult: true });
        },
      });
    modal = openModal(
      h(
        "div",
        { class: "modal__body dialog tdedit" },
        h("div", { class: "modal__title" }, chore ? t("fam_edit_chore") : t("fam_new_chore")),
        field(t("fam_chore_name"), title),
        h("div", { class: "fgrid2" }, field(t("fam_icon"), iconInput), field(t("fam_stars"), stars)),
        picks,
        field(t("fam_who"), who),
        turnBox,
        field(t("fam_repeat"), repeat),
        every,
        dayBox,
        field(t("fam_due"), due),
        field(t("fam_notes"), notes),
        h("div", { class: "dialog__actions mealsactions" }, chore ? button("trash-can-outline", t("todo_delete"), remove, "btn btn--danger") : null, button("check", t("todo_save"), save, "btn btn--primary")),
      ),
    );
  }

  // ---- rewards ----------------------------------------------------------------------------------

  function rewardCard(reward) {
    const p = me();
    const check = afford(p?.balance ?? 0, reward, model.allow_negative);
    const actions = h("div", { class: "freward__actions" });
    actions.append(
      button("gift-open-outline", check.ok || !p ? t("fam_redeem") : format(t, "fam_needs", { n: check.missing }), () => redeem(reward), `btn${p && check.ok ? " btn--primary" : ""}`),
    );
    if (editable() && isAdult()) {
      const edit = h("button", { class: "fchore__edit", type: "button", "aria-label": t("fam_edit") }, icon("pencil-outline"));
      pressable(edit, { onTap: () => openRewardEditor(reward) });
      actions.append(edit);
    }
    return h(
      "div",
      { class: "freward" },
      h("div", { class: "freward__icon" }, reward.icon),
      h("div", { class: "freward__title" }, reward.title),
      h("div", { class: "freward__meta" }, h("span", { class: "fchip is-cost" }, `★ ${reward.cost}`), reward.kind === "once" ? h("span", { class: "fchip" }, t("fam_once")) : null, reward.kind === "bank" ? h("span", { class: "fchip" }, `+${reward.amount} ${reward.unit}`) : null),
      reward.note ? h("div", { class: "freward__note" }, reward.note) : null,
      actions,
    );
  }

  async function redeem(reward) {
    const result = await act("reward-redeem", { id: reward.id }, { toastOk: format(t, "fam_enjoy", { title: reward.title }) });
    return result;
  }

  function renderRewards() {
    const active = model.rewards.filter((r) => r.status === "active");
    const suggested = model.rewards.filter((r) => r.status === "suggested");
    const out = [];
    const bar = h("div", { class: "mealsbar" });
    if (editable() && isAdult()) bar.append(button("plus", t("fam_new_reward"), () => openRewardEditor(), "btn btn--primary"));
    if (editable()) bar.append(button("lightbulb-on-outline", t("fam_suggest"), suggestDialog));
    if (!actorId) bar.append(h("p", { class: "view__hint mealsbar__hint" }, t("fam_choose_hint")));
    else bar.append(h("span", { class: "fchip is-cost" }, `★ ${me()?.balance ?? 0}`));
    out.push(bar);
    const bank = Object.entries(me()?.bank ?? {}).map(([id, amount]) => ({ reward: model.rewards.find((r) => r.id === id), amount })).filter((b) => b.reward);
    if (bank.length) {
      out.push(
        h(
          "section",
          { class: "fbank" },
          h("h3", { class: "fsec" }, t("fam_saved")),
          ...bank.map(({ reward, amount }) => {
            const row = h("div", { class: "fbank__row" }, h("span", { class: "freward__icon is-small" }, reward.icon), h("span", { class: "fbank__text" }, `${reward.title}: ${amount} ${reward.unit}`));
            row.append(button("timer-play-outline", t("fam_use"), () => useDialog(reward, amount)));
            return row;
          }),
        ),
      );
    }
    out.push(h("div", { class: "frewards" }, active.map(rewardCard)));
    if (!active.length) out.push(h("div", { class: "notice" }, icon("gift-outline"), h("h2", null, t("fam_no_rewards")), h("p", null, t("fam_no_rewards_hint"))));
    if (suggested.length) {
      out.push(
        h("h3", { class: "fsec" }, t("fam_suggestions")),
        h(
          "div",
          { class: "fsuggest" },
          suggested.map((r) => {
            const row = h("div", { class: "fsuggest__row" }, h("span", { class: "fsuggest__title" }, r.title), h("span", { class: "fsuggest__by" }, personOf(r.suggested_by)?.name ?? ""));
            if (editable() && isAdult()) {
              row.append(button("tag-outline", t("fam_set_price"), () => priceDialog(r)), button("close", "", () => act("reward-price", { id: r.id, accept: false }, { adult: true }), "btn btn--icon"));
            }
            return row;
          }),
        ),
      );
    }
    show(out);
  }

  function suggestDialog() {
    const what = input({ type: "text", maxlength: "60", placeholder: t("fam_suggest_hint"), "aria-label": t("fam_suggest_hint") });
    let modal;
    const go = async () => {
      if (!what.value.trim()) return what.focus();
      modal.close();
      await act("reward-suggest", { title: what.value }, { toastOk: t("fam_suggested") });
    };
    what.addEventListener("keydown", (e) => e.key === "Enter" && go());
    modal = openModal(h("div", { class: "modal__body dialog tdedit" }, h("div", { class: "modal__title" }, t("fam_suggest")), field(t("fam_suggest_hint"), what), h("div", { class: "dialog__actions" }, button("send", t("fam_suggest"), go, "btn btn--primary"))));
    setTimeout(() => what.focus(), 60);
  }

  function priceDialog(reward) {
    const cost = input({ type: "number", min: "0", max: "10000", value: "5", "aria-label": t("fam_cost") });
    let modal;
    const go = async () => {
      modal.close();
      await act("reward-price", { id: reward.id, cost: Number(cost.value) || 0, accept: true }, { adult: true });
    };
    modal = openModal(h("div", { class: "modal__body dialog tdedit" }, h("div", { class: "modal__title" }, reward.title), field(t("fam_cost"), cost), h("div", { class: "dialog__actions" }, button("check", t("todo_save"), go, "btn btn--primary"))));
  }

  function useDialog(reward, amount) {
    const n = input({ type: "number", min: "1", max: String(amount), value: String(Math.min(amount, reward.amount || amount)), "aria-label": reward.unit });
    let modal;
    const go = async () => {
      modal.close();
      await act("reward-use", { id: reward.id, amount: Number(n.value) || amount }, { toastOk: t("fam_used") });
    };
    modal = openModal(h("div", { class: "modal__body dialog tdedit" }, h("div", { class: "modal__title" }, reward.title), field(`${t("fam_use")} (${reward.unit})`, n), h("div", { class: "dialog__actions" }, button("timer-play-outline", t("fam_use"), go, "btn btn--primary"))));
  }

  function openRewardEditor(reward = null) {
    const r = reward ?? { title: "", icon: REWARD_ICONS[0], cost: 5, kind: "any", amount: 30, unit: "min", note: "" };
    const title = input({ type: "text", maxlength: "60", value: r.title, placeholder: t("fam_reward_name"), "aria-label": t("fam_reward_name") });
    const iconInput = input({ type: "text", maxlength: "4", value: r.icon, "aria-label": t("fam_icon") });
    const picks = h("div", { class: "fpicks" }, REWARD_ICONS.map((e) => {
      const b = h("button", { class: "fpick", type: "button" }, e);
      pressable(b, { onTap: () => (iconInput.value = e) });
      return b;
    }));
    const cost = input({ type: "number", min: "0", max: "10000", value: String(r.cost ?? 5) });
    const kind = h("select", { class: "msearch__input tdinput", "aria-label": t("fam_kind") }, ["any", "once", "bank"].map((k) => h("option", { value: k, selected: r.kind === k }, t(`fam_kind_${k}`))));
    const amount = input({ type: "number", min: "1", value: String(r.amount || 30), "aria-label": t("fam_amount") });
    const unit = input({ type: "text", maxlength: "12", value: r.unit || "min", "aria-label": t("fam_unit") });
    const bankBox = h("div", { class: "fgrid2", hidden: kind.value !== "bank" }, field(t("fam_amount"), amount), field(t("fam_unit"), unit));
    kind.addEventListener("change", () => (bankBox.hidden = kind.value !== "bank"));
    const note = input({ type: "text", maxlength: "120", value: r.note ?? "", placeholder: t("fam_notes"), "aria-label": t("fam_notes") });
    let modal;
    const save = async () => {
      if (!title.value.trim()) return title.focus();
      modal.close();
      await act("reward-save", { reward: { ...(reward ? { id: reward.id } : {}), title: title.value, icon: iconInput.value, cost: Number(cost.value) || 0, kind: kind.value, amount: Number(amount.value) || 30, unit: unit.value, note: note.value } }, { adult: true });
    };
    const remove = () =>
      confirmDialog({
        title: r.title,
        text: t("fam_delete_reward"),
        confirmLabel: t("todo_delete"),
        cancelLabel: t("cancel"),
        danger: true,
        onConfirm: async () => {
          modal.close();
          await act("reward-delete", { id: reward.id }, { adult: true });
        },
      });
    modal = openModal(
      h(
        "div",
        { class: "modal__body dialog tdedit" },
        h("div", { class: "modal__title" }, reward ? t("fam_edit_reward") : t("fam_new_reward")),
        field(t("fam_reward_name"), title),
        h("div", { class: "fgrid2" }, field(t("fam_icon"), iconInput), field(t("fam_cost"), cost)),
        picks,
        field(t("fam_kind"), kind),
        bankBox,
        field(t("fam_notes"), note),
        h("div", { class: "dialog__actions mealsactions" }, reward ? button("trash-can-outline", t("todo_delete"), remove, "btn btn--danger") : null, button("check", t("todo_save"), save, "btn btn--primary")),
      ),
    );
  }

  // ---- stars --------------------------------------------------------------------------------------

  function renderStars() {
    const out = [];
    const cards = h("div", { class: "fscores" }, people().map((p) => h("div", { class: "fscore" }, avatar(p), h("div", { class: "fscore__name" }, p.name), h("div", { class: "fscore__num" }, icon("star"), String(p.balance)))));
    out.push(cards);
    if (editable() && isAdult()) out.push(h("div", { class: "mealsbar" }, button("plus-minus-variant", t("fam_adjust"), adjustDialog)));
    const rows = model.ledger.map((l) => {
      const p = personOf(l.person);
      const row = h(
        "div",
        { class: "fledger__row" },
        p ? avatar(p, " is-small") : h("span", { class: "favatar is-small" }, "?"),
        h("div", { class: "fledger__text" }, h("div", { class: "fledger__reason" }, l.reason), h("div", { class: "fledger__when" }, `${p?.name ?? ""} · ${new Intl.DateTimeFormat(ctx.locale, { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(l.ts))}`)),
        h("div", { class: `fledger__delta${l.delta < 0 ? " is-neg" : l.delta > 0 ? " is-pos" : ""}` }, l.delta > 0 ? `+${l.delta}` : l.delta === 0 ? "" : String(l.delta)),
      );
      if (editable() && isAdult()) {
        const undo = h("button", { class: "fchore__edit", type: "button", "aria-label": t("fam_reverse") }, icon("undo"));
        pressable(undo, { onTap: () => confirmDialog({ title: l.reason, text: t("fam_reverse_confirm"), confirmLabel: t("fam_reverse"), cancelLabel: t("cancel"), danger: true, onConfirm: () => act("ledger-reverse", { id: l.id }, { adult: true }) }) });
        row.append(undo);
      }
      return row;
    });
    out.push(h("h3", { class: "fsec" }, t("fam_log")), rows.length ? h("div", { class: "fledger" }, rows) : h("p", { class: "view__hint" }, t("fam_log_empty")));
    show(out);
  }

  function adjustDialog() {
    const who = h("select", { class: "msearch__input tdinput", "aria-label": t("fam_who") }, people().map((p) => h("option", { value: p.id }, p.name)));
    const delta = input({ type: "number", min: "-1000", max: "1000", value: "1", "aria-label": t("fam_stars") });
    const reason = input({ type: "text", maxlength: "100", placeholder: t("fam_reason"), "aria-label": t("fam_reason") });
    let modal;
    const go = async () => {
      modal.close();
      await act("adjust", { person: who.value, delta: Number(delta.value), reason: reason.value }, { adult: true });
    };
    modal = openModal(h("div", { class: "modal__body dialog tdedit" }, h("div", { class: "modal__title" }, t("fam_adjust")), field(t("fam_who"), who), field(t("fam_stars"), delta), field(t("fam_reason"), reason), h("div", { class: "dialog__actions" }, button("check", t("todo_save"), go, "btn btn--primary"))));
  }

  // ---- render -------------------------------------------------------------------------------------

  function render() {
    const scroll = root.scrollTop;
    if (tab === "rewards") renderRewards();
    else if (tab === "stars") renderStars();
    else renderChores();
    root.scrollTop = scroll;
  }

  if (!personOf(actorId)) actorId = null;
  paintPeople();
  paintTabs();
  render();
  loadEvents();
  const timer = setInterval(() => {
    loadEvents();
    render();
  }, 60_000);

  return {
    el: root,
    get entities() {
      return people().map((p) => p.entity).filter(Boolean);
    },
    update() {
      paintPeople();
    },
    /** New data from the server: redraw, unless someone is typing. */
    setModel(next) {
      const typing = root.contains(document.activeElement) && ["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement.tagName);
      model = next;
      if (!personOf(actorId)) actorId = null;
      paintPeople();
      if (!typing) render();
    },
    destroy() {
      clearInterval(timer);
    },
  };
}
