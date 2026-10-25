/**
 * Talks to the add-on server: one Server-Sent-Events stream for config/state
 * pushes and a POST endpoint for service calls. URLs are relative so the page
 * works behind Home Assistant ingress as well as on the direct port.
 */
export function connect(handlers) {
  let source;
  let retry;

  const open = () => {
    source = new EventSource("./api/events");
    source.onopen = () => handlers.onConnection?.(true);
    source.onerror = () => {
      handlers.onConnection?.(false);
      // EventSource only retries on its own for dropped streams, not for HTTP errors.
      if (source.readyState === EventSource.CLOSED) {
        clearTimeout(retry);
        retry = setTimeout(open, 3000);
      }
    };
    for (const event of ["hello", "status", "config", "areas", "music", "ev", "climate", "plex", "devices", "todo", "meals", "lastplayed", "snapshot", "state"]) {
      source.addEventListener(event, (e) => handlers[event]?.(JSON.parse(e.data)));
    }
  };

  open();
  return () => {
    clearTimeout(retry);
    source?.close();
  };
}

export async function callService(domain, service, entityId, data = {}) {
  const response = await fetch("./api/service", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ domain, service, entity_id: entityId, data }),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error ?? `Request failed (${response.status})`);
  }
}

export async function playRadio(entityId, stationId) {
  const response = await fetch("./api/radio/play", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ entity_id: entityId, station: stationId }),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error ?? `Request failed (${response.status})`);
  }
}

export async function groupRadio(leader, { add = [], remove = [] }) {
  const response = await fetch("./api/radio/group", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ leader, add, remove }),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error ?? `Request failed (${response.status})`);
  }
}

/** GET a JSON endpoint of the add-on (relative to the page); throws with the server's message. */
export async function getJson(path, { signal } = {}) {
  const response = await fetch(`./${path}`, { signal });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error ?? `Request failed (${response.status})`);
  return body;
}

/** PUT a JSON body to an endpoint of the add-on; throws with the server's message. */
export async function putJson(path, body) {
  const response = await fetch(`./${path}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error ?? `Request failed (${response.status})`);
  return data;
}

export async function playMusic(entityId, request) {
  const response = await fetch("./api/music/play", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ entity_id: entityId, ...request }),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error ?? `Request failed (${response.status})`);
  }
}

export const proxyUrl = (path) => `./api/proxy?path=${encodeURIComponent(path)}`;

/** Resolve a configured image: absolute URLs stay, bare names come from the assets folder. */
export function assetUrl(value) {
  if (!value) return "";
  if (/^(https?:)?\/\//.test(value) || value.startsWith("data:")) return value;
  if (value.startsWith("./")) return value;
  if (value.startsWith("/")) return `.${value}`;
  return `./assets/${value.split("/").map(encodeURIComponent).join("/")}`;
}

/** Resolve an entity_picture attribute (HA-relative paths go through the proxy). */
export function pictureUrl(picture) {
  if (!picture) return "";
  if (/^https?:\/\//.test(picture)) return picture;
  return proxyUrl(picture);
}

/** Play a Plex item (a `plex://` id from the Media page) on a player. */
export async function playPlex(entityId, item) {
  const response = await fetch("./api/plex/play", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ entity_id: entityId, id: item.id, type: item.type }),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error ?? `Request failed (${response.status})`);
  }
}

/** Create, rename or delete a to-do list ("create" | "rename" | "delete"); throws with the server's message. */
export async function manageTodoList(action, body) {
  const response = await fetch(`./api/todo/${action}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error ?? `Request failed (${response.status})`);
  return data;
}

/** Remove a device from an area's overview (`hidden` true) or bring it back; throws with the server's message. */
export async function setAreaDeviceHidden(entityId, hidden) {
  const response = await fetch("./api/areas/device", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ entity_id: entityId, hidden }) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error ?? `Request failed (${response.status})`);
}

/** Remove a card from the Devices page (`hidden` true) or bring it back; throws with the server's message. */
export async function setDeviceCardHidden(key, hidden) {
  const response = await fetch("./api/devices/card", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key, hidden }) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error ?? `Request failed (${response.status})`);
}

/** Change the meal plan or ask the AI ("day", "prefs", "rate", "generate", "recipe", "alternatives"); throws with the server's message. */
export async function mealsPost(action, body) {
  const response = await fetch(`./api/meals/${action}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error ?? `Request failed (${response.status})`);
  return data;
}
