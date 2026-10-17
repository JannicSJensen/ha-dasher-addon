/*
 * The to-do lists page: every `todo` entity of Home Assistant, the items of a list (through the websocket command
 * `todo/item/list`) and, for lists of the Local To-do integration, creating, renaming and deleting a list. Editing
 * items goes through the normal `todo.*` actions (add_item, update_item, remove_item, remove_completed_items).
 */
const domainOf = (id) => id.slice(0, id.indexOf("."));

/** Integrations whose lists this app can create and delete. */
export const MANAGED_PLATFORMS = new Set(["local_todo"]);
export const NAME_MAX = 60;

const SOURCES = { shopping_list: "Shopping list", local_todo: "Local", caldav: "CalDAV", google_tasks: "Google Tasks", todoist: "Todoist", microsoft_todo: "Microsoft To Do", ticktick: "TickTick", bring: "Bring!" };

/** The lists of the page: explicit `lists`, else every visible todo entity; `exclude` removes some. */
export function discoverTodoLists({ settings, registries, index = new Map() }) {
  const rows = (registries?.entities ?? []).filter((e) => e?.ei && domainOf(e.ei) === "todo");
  const hidden = new Set(rows.filter((e) => e.hb).map((e) => e.ei));
  const platform = new Map(rows.map((e) => [e.ei, e.pl ?? null]));
  const ids = settings.lists.length ? settings.lists : [...new Set([...rows.filter((e) => !e.hb).map((e) => e.ei), ...[...index.keys()].filter((id) => domainOf(id) === "todo" && !hidden.has(id))])];
  const excluded = new Set(settings.exclude);
  return ids
    .filter((id) => !excluded.has(id) && (index.size === 0 || index.has(id)))
    .map((id) => {
      const pl = platform.get(id) ?? null;
      return { id, name: tidyListName(index.get(id)?.name ?? id.slice(5).replace(/_/g, " ")), platform: pl, source: SOURCES[pl] ?? null, managed: MANAGED_PLATFORMS.has(pl) };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** CalDAV and some other integrations add a warning sign to names; "Påmindelser ⚠️" -> "Påmindelser". */
export const tidyListName = (name) => String(name ?? "").replace(/[\u26A0\uFE0F]/g, "").replace(/\s+/g, " ").trim();

/** The page as tablets get it; `enabled: auto` shows it when there is at least one list. */
export function resolveTodo({ settings, registries, index, manage }) {
  if (!settings || settings.enabled === false) return { enabled: false, lists: [], manage: false };
  const lists = discoverTodoLists({ settings, registries, index });
  return { enabled: settings.enabled === true || lists.length > 0, title: settings.title, icon: settings.icon, lists, manage: Boolean(manage) };
}

/** A list name from the tablet: trimmed, 1 to NAME_MAX characters, no control characters. */
export function cleanListName(value) {
  if (typeof value !== "string") return null;
  const name = value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  return name && name.length <= NAME_MAX ? name : null;
}

export function normalizeItem(raw) {
  if (!raw || typeof raw !== "object") return null;
  const summary = String(raw.summary ?? "").trim();
  if (!summary) return null;
  return {
    uid: raw.uid != null ? String(raw.uid) : summary,
    summary,
    done: raw.status === "completed",
    due: raw.due ? String(raw.due) : null,
    description: raw.description ? String(raw.description) : "",
  };
}

const httpError = (message, status = 502) => Object.assign(new Error(message), { status });

export class TodoService {
  /** `rest(method, path, body)` calls Home Assistant's REST API and resolves to the parsed JSON (or null). */
  constructor({ ha, rest, logger }) {
    this.ha = ha;
    this.rest = rest;
    this.log = logger;
  }

  async items(entityId) {
    const result = await this.ha.request({ type: "todo/item/list", entity_id: entityId });
    const items = (Array.isArray(result?.items) ? result.items : []).map(normalizeItem).filter(Boolean);
    return { items: items.filter((i) => !i.done), completed: items.filter((i) => i.done) };
  }

  /** Create a Local To-do list through the integration's config flow. */
  async createList(name) {
    let flow;
    try {
      flow = await this.rest("POST", "/api/config/config_entries/flow", { handler: "local_todo", show_advanced_options: false });
    } catch (err) {
      throw httpError(`The Local To-do integration is not available in Home Assistant (${err.message}).`);
    }
    try {
      const fields = (Array.isArray(flow?.data_schema) ? flow.data_schema : []).map((f) => f.name);
      if (flow?.type !== "form" || !fields.includes("todo_list_name") || fields.some((f) => f !== "todo_list_name")) {
        throw httpError("Home Assistant asked for something this app cannot fill in when creating a list.");
      }
      const done = await this.rest("POST", `/api/config/config_entries/flow/${encodeURIComponent(flow.flow_id)}`, { todo_list_name: name });
      if (done?.type !== "create_entry") {
        throw httpError(done?.reason ? `Home Assistant did not create the list (${done.reason}).` : "Home Assistant did not create the list.");
      }
      return { entryId: done.result?.entry_id ?? done.entry_id ?? null };
    } catch (err) {
      await this.rest("DELETE", `/api/config/config_entries/flow/${encodeURIComponent(flow.flow_id)}`).catch(() => {});
      throw err;
    }
  }

  async _entryId(entityId) {
    const entry = await this.ha.request({ type: "config/entity_registry/get", entity_id: entityId });
    if (!entry?.config_entry_id) throw httpError("That list does not belong to an integration entry.", 400);
    return entry.config_entry_id;
  }

  /** Remove a Local To-do list (the integration entry, which removes its entity and file). */
  async deleteList(entityId) {
    const entryId = await this._entryId(entityId);
    await this.rest("DELETE", `/api/config/config_entries/entry/${encodeURIComponent(entryId)}`);
  }

  /** Rename a list: the display name of its entity (the entity id stays). */
  async renameList(entityId, name) {
    await this.ha.request({ type: "config/entity_registry/update", entity_id: entityId, name });
  }
}
