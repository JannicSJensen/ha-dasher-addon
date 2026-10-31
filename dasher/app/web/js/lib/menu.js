export const BUILTIN_MENU_ITEMS = [
  { id: "climate", section: "climate", title: "climate" },
  { id: "areas", section: "areas", title: "areas" },
  { id: "music", section: "music", title: "music" },
  { id: "calendar", section: "calendar", title: "calp_title" },
  { id: "family", section: "family", title: "fam_title" },
  { id: "meals", section: "meals", title: "meals_title" },
  { id: "todo", section: "todo", title: "todo_title" },
  { id: "devices", section: "devices", title: "dev_devices" },
  { id: "media", section: "plex", title: "plex_media" },
  { id: "ev", section: "ev", title: "ev_car" },
];

export function menuItems(config, state, t, { includePending = false } = {}) {
  const overrides = new Map((config.menu_items ?? []).map((item) => [item.id, item]));
  const pages = config.pages.map((page) => ({
    key: `page:${page.id}`, kind: "page", id: page.id,
    href: `#/${page.id}`, title: page.title, icon: page.icon, enabled: true,
  }));
  const builtins = BUILTIN_MENU_ITEMS.map((item) => {
    const settings = config[item.section];
    const model = state[item.section];
    const pending = includePending && ["areas", "music"].includes(item.id) && model == null;
    return {
      key: item.id, kind: item.section, id: null,
      href: `#/${item.id}`, title: settings?.title ?? t(item.title), icon: settings?.icon,
      enabled: settings?.enabled !== false && (item.id === "calendar" ? settings?.enabled : model?.enabled || pending),
    };
  });
  return [...pages, ...builtins]
    .map((item, index) => ({ ...item, order: overrides.get(item.key)?.order ?? index }))
    .filter((item) => item.enabled && overrides.get(item.key)?.visible !== false)
    .sort((a, b) => a.order - b.order);
}

export function menuRoute(hash, items) {
  const raw = hash.replace(/^#\/?/, "");
  const target = raw === "radio" ? "music" : raw.startsWith("area/") ? "areas" : raw.startsWith("todo/") ? "todo" : raw;
  // Built-in routes take precedence over dashboard pages with the same id.
  const item = items.find((i) => i.kind !== "page" && i.href === `#/${target}`)
    ?? items.find((i) => i.kind === "page" && i.href === `#/${raw}`)
    ?? items[0];
  if (!item) return { kind: "empty", id: null };
  if (item.kind === "areas" && raw.startsWith("area/")) return { kind: "area", id: decodeURIComponent(raw.slice(5)) };
  if (item.kind === "todo" && raw.startsWith("todo/")) return { kind: "todo", id: decodeURIComponent(raw.slice(5)) };
  return { kind: item.kind, id: item.id };
}

export function menuItemActive(item, route) {
  return item.kind === "page"
    ? route.kind === "page" && route.id === item.id
    : item.kind === route.kind || (item.kind === "areas" && route.kind === "area");
}
