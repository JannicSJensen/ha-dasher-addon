import { EventEmitter } from "node:events";
import WebSocket from "ws";

const REGISTRY_EVENTS = ["area_registry_updated", "floor_registry_updated", "entity_registry_updated", "device_registry_updated"];
const PING_INTERVAL_MS = 30_000;
const PONG_TIMEOUT_MS = 10_000;

/**
 * Minimal Home Assistant WebSocket client that keeps a cache of the entities
 * the dashboard cares about and reconnects with exponential backoff.
 *
 * Emits: "status" (boolean connected), "state" (entityState), "snapshot" (Map),
 *        "registries" (area/floor/device/entity registries, or null when they could not be read)
 */
export class HAClient extends EventEmitter {
  constructor({ wsUrl, token, logger, WebSocketImpl = WebSocket }) {
    super();
    this.wsUrl = wsUrl;
    this.token = token;
    this.log = logger;
    this.WebSocketImpl = WebSocketImpl;
    this.watched = new Set();
    this.required = new Set();
    this.states = new Map();
    this.missing = [];
    this.registries = null;
    this.deviceClasses = new Map();
    this.connected = false;
    this._nextId = 1;
    this._pending = new Map();
    this._backoff = 1000;
    this._stopped = false;
  }

  start() {
    this._stopped = false;
    this._connect();
  }

  stop() {
    this._stopped = true;
    clearTimeout(this._retryTimer);
    clearTimeout(this._syncTimer);
    clearInterval(this._pingTimer);
    this.ws?.close();
  }

  /**
   * Replace the set of entities to track.
   * `required` are the entities the user listed explicitly; only those are reported as missing.
   */
  async setWatched(entityIds, { refresh = true, required = entityIds } = {}) {
    this.watched = new Set(entityIds);
    this.required = new Set(required);
    for (const id of [...this.states.keys()]) if (!this.watched.has(id)) this.states.delete(id);
    if (refresh && this.connected) await this._refreshStates().catch((e) => this.log.warn(`State refresh failed: ${e.message}`));
  }

  request(message) {
    return new Promise((resolve, reject) => {
      if (!this.connected) return reject(new Error("Not connected to Home Assistant."));
      const id = this._nextId++;
      const timer = setTimeout(() => {
        this._pending.delete(id);
        reject(new Error("Home Assistant did not answer in time."));
      }, 15_000);
      this._pending.set(id, { resolve, reject, timer });
      this.ws.send(JSON.stringify({ ...message, id }));
    });
  }

  callService(domain, service, data, entityIds) {
    return this.request({
      type: "call_service",
      domain,
      service,
      service_data: data,
      target: { entity_id: entityIds },
    });
  }

  /** Call an action that returns data (supports_response) and resolve with that data. */
  async callServiceWithResponse(domain, service, data) {
    const result = await this.request({
      type: "call_service",
      domain,
      service,
      service_data: data,
      return_response: true,
    });
    return result?.response ?? null;
  }

  _connect() {
    if (this._stopped) return;
    this.log.info(`Connecting to Home Assistant at ${this.wsUrl}`);
    const ws = new this.WebSocketImpl(this.wsUrl);
    this.ws = ws;

    ws.on("message", (raw) => {
      let msg;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }
      this._onMessage(msg);
    });
    ws.on("error", (err) => this.log.warn(`Home Assistant socket error: ${err.message}`));
    ws.on("close", () => this._onClose());
  }

  _onMessage(msg) {
    switch (msg.type) {
      case "auth_required":
        this.ws.send(JSON.stringify({ type: "auth", access_token: this.token }));
        break;
      case "auth_invalid":
        this.log.error(`Home Assistant rejected the token: ${msg.message}`);
        break;
      case "auth_ok":
        this._onAuthenticated();
        break;
      case "pong":
        clearTimeout(this._pongTimer);
        break;
      case "event":
        if (msg.event?.event_type === "state_changed") this._onStateChanged(msg.event.data);
        else if (REGISTRY_EVENTS.includes(msg.event?.event_type)) this._scheduleSync();
        break;
      case "result": {
        const pending = this._pending.get(msg.id);
        if (!pending) break;
        clearTimeout(pending.timer);
        this._pending.delete(msg.id);
        if (msg.success) pending.resolve(msg.result);
        else pending.reject(new Error(msg.error?.message ?? "Request failed."));
        break;
      }
    }
  }

  async _onAuthenticated() {
    this.log.info("Connected to Home Assistant");
    this.connected = true;
    this._backoff = 1000;
    this.emit("status", true);
    this._pingTimer = setInterval(() => this._ping(), PING_INTERVAL_MS);
    try {
      await this.request({ type: "subscribe_events", event_type: "state_changed" });
      // Registry events are a convenience; older cores or limited tokens may refuse them.
      await Promise.allSettled(REGISTRY_EVENTS.map((event_type) => this.request({ type: "subscribe_events", event_type })));
      await this._sync();
    } catch (err) {
      this.log.error(`Initial sync failed: ${err.message}`);
      this.ws.close();
    }
  }

  /** Full resync: states (for device classes), registries, then the watched states. */
  async _sync() {
    const all = await this.request({ type: "get_states" });
    this._indexDeviceClasses(all);
    await this._loadRegistries();
    this._applyStates(all);
  }

  async _refreshStates() {
    const all = await this.request({ type: "get_states" });
    this._indexDeviceClasses(all);
    this._applyStates(all);
  }

  _scheduleSync() {
    clearTimeout(this._syncTimer);
    this._syncTimer = setTimeout(() => {
      if (this.connected) this._sync().catch((e) => this.log.warn(`Registry refresh failed: ${e.message}`));
    }, 1000);
  }

  _indexDeviceClasses(all) {
    this.deviceClasses.clear();
    for (const s of all) {
      const cls = s.attributes?.device_class;
      if (cls && (s.entity_id.startsWith("sensor.") || s.entity_id.startsWith("binary_sensor."))) {
        this.deviceClasses.set(s.entity_id, cls);
      }
    }
  }

  async _loadRegistries() {
    try {
      const [areas, devices, entities, floors] = await Promise.all([
        this.request({ type: "config/area_registry/list" }),
        this.request({ type: "config/device_registry/list" }),
        this.request({ type: "config/entity_registry/list_for_display" }),
        this.request({ type: "config/floor_registry/list" }).catch(() => []),
      ]);
      this.registries = {
        areas,
        floors,
        devices: devices.map((d) => ({ id: d.id, area_id: d.area_id, disabled_by: d.disabled_by })),
        entities: entities?.entities ?? [],
      };
    } catch (err) {
      this.log.warn(`Area pages unavailable, could not read the registries: ${err.message}`);
      this.registries = null;
    }
    this.emit("registries", this.registries);
  }

  _applyStates(all) {
    this.states.clear();
    for (const s of all) if (this.watched.has(s.entity_id)) this.states.set(s.entity_id, slim(s));
    this.missing = [...this.required].filter((id) => !this.states.has(id)).sort();
    if (this.missing.length) this.log.warn(`Entities in dashboard.yaml that Home Assistant does not know: ${this.missing.join(", ")}`);
    this.emit("snapshot", this.states);
  }

  _onStateChanged({ entity_id, new_state }) {
    if (!this.watched.has(entity_id)) return;
    if (new_state) {
      const s = slim(new_state);
      this.states.set(entity_id, s);
      this.emit("state", s);
    } else {
      this.states.delete(entity_id);
      this.emit("state", { entity_id, state: "unavailable", attributes: {}, last_changed: null });
    }
  }

  _ping() {
    if (!this.connected) return;
    this.ws.send(JSON.stringify({ id: this._nextId++, type: "ping" }));
    this._pongTimer = setTimeout(() => {
      this.log.warn("Home Assistant stopped answering pings, reconnecting");
      this.ws.terminate();
    }, PONG_TIMEOUT_MS);
  }

  _onClose() {
    clearInterval(this._pingTimer);
    clearTimeout(this._pongTimer);
    const wasConnected = this.connected;
    this.connected = false;
    this.missing = [];
    for (const { reject, timer } of this._pending.values()) {
      clearTimeout(timer);
      reject(new Error("Connection to Home Assistant closed."));
    }
    this._pending.clear();
    if (wasConnected) {
      this.log.warn("Disconnected from Home Assistant");
      this.emit("status", false);
    }
    if (this._stopped) return;
    this._retryTimer = setTimeout(() => this._connect(), this._backoff);
    this._backoff = Math.min(this._backoff * 2, 30_000);
  }
}

const slim = ({ entity_id, state, attributes, last_changed }) => ({
  entity_id,
  state,
  attributes,
  last_changed,
});
