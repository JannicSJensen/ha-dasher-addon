import { BUILTIN_MENU_ITEMS } from "../web/js/lib/menu.js";

export function completeMenuOptions(items, pages) {
  if (!Array.isArray(items)) throw new Error("Supervisor menu_items is not a list");
  const builtins = new Set(BUILTIN_MENU_ITEMS.map(({ id }) => id));
  const present = new Set(items.flatMap((item) => {
    if (typeof item?.id !== "string") return [];
    const id = item.id.trim();
    return [builtins.has(id) || id.startsWith("page:") ? id : `page:${id}`];
  }));
  const missing = [
    ...pages.map(({ id }) => `page:${id}`),
    ...BUILTIN_MENU_ITEMS.map(({ id }) => id),
  ].filter((id) => !present.has(id));
  return missing.length ? [...items, ...missing.map((id) => ({ id, visibility: "default" }))] : null;
}

/** Populate the Supervisor's saved options without changing menu visibility or other options. */
export class MenuOptionsSync {
  constructor({ token, logger, fetchImpl = globalThis.fetch, supervisorUrl = "http://supervisor", retryMs = 30_000 }) {
    this.token = token;
    this.log = logger;
    this.fetch = fetchImpl;
    this.url = `${supervisorUrl}/addons/self`;
    this.retryMs = retryMs;
    this.pages = null;
    this.running = false;
    this.pending = false;
    this.timer = null;
  }

  update(config) {
    if (!config) return;
    this.pages = config.pages;
    this.pending = true;
    clearTimeout(this.timer);
    this.timer = null;
    if (!this.running) void this.run();
  }

  async request(path, init = {}) {
    const response = await this.fetch(`${this.url}${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${this.token}`, ...init.headers },
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) throw new Error(`Supervisor ${path} answered HTTP ${response.status}`);
    const body = await response.json();
    if (body.result !== "ok") throw new Error(`Supervisor ${path} failed: ${body.message ?? "invalid response"}`);
    return body.data;
  }

  async run() {
    this.running = true;
    try {
      while (this.pending) {
        this.pending = false;
        const info = await this.request("/info");
        if (!info?.options || typeof info.options !== "object" || Array.isArray(info.options)) {
          throw new Error("Supervisor did not return app options");
        }
        const items = completeMenuOptions(info.options.menu_items ?? [], this.pages);
        if (!items) continue;
        await this.request("/options", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ options: { ...info.options, menu_items: items } }),
        });
        this.log.info("Added missing dashboard menu items to the app configuration");
      }
    } catch (err) {
      this.log.warn(`Could not synchronize menu items with app configuration: ${err.message}`);
      this.pending = true;
      this.timer = setTimeout(() => {
        this.timer = null;
        void this.run();
      }, this.retryMs);
      this.timer.unref?.();
    } finally {
      this.running = false;
    }
  }
}
