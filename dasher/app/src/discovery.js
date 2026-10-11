/**
 * Find Music Assistant when it runs as a Home Assistant app, through the Supervisor API.
 * Only used when no address is set in the app options.
 */
const SUPERVISOR = "http://supervisor";
/** Where apps reach services of apps that run on the host network. */
const HOST_GATEWAY = "172.30.32.1";
const DEFAULT_PORT = 8095;

const isMusicAssistant = (addon) => /music[_ -]?assistant/i.test(`${addon.slug ?? ""} ${addon.name ?? ""}`);
const isBeta = (addon) => /beta|dev/i.test(addon.slug ?? "");

/** A running Music Assistant answers /info without authentication. */
async function probe(url, fetchImpl) {
  try {
    const response = await fetchImpl(`${url}/info`, { signal: AbortSignal.timeout(3000) });
    if (!response.ok) return false;
    const body = await response.json();
    return Boolean(body?.server_version);
  } catch {
    return false;
  }
}

/** Addresses to try for an app, from the Supervisor's description of it. */
export function candidateUrls(info) {
  const port = Number.parseInt(String(Object.keys(info?.network ?? {}).find((key) => key.startsWith(`${DEFAULT_PORT}/`)) ?? "").split("/")[0], 10) || DEFAULT_PORT;
  const hosts = info?.host_network ? [HOST_GATEWAY] : [info?.ip_address, info?.hostname];
  return [...new Set(hosts.filter(Boolean))].map((host) => `http://${host}:${port}`);
}

/**
 * Returns { url, slug } of a started Music Assistant app that answers, or null.
 * Errors (no Supervisor, no permission, nothing installed) also give null.
 */
export async function discoverMusicAssistant({ token, fetchImpl = globalThis.fetch, supervisorUrl = SUPERVISOR, log = null }) {
  if (!token) return null;
  const get = async (path) => {
    const response = await fetchImpl(`${supervisorUrl}${path}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) throw new Error(`Supervisor ${path} answered HTTP ${response.status}`);
    return (await response.json()).data ?? {};
  };

  try {
    const { addons = [] } = await get("/addons");
    const running = addons.filter((a) => isMusicAssistant(a) && a.state === "started").sort((a, b) => Number(isBeta(a)) - Number(isBeta(b)));
    for (const addon of running) {
      const info = await get(`/addons/${encodeURIComponent(addon.slug)}/info`);
      for (const url of candidateUrls(info)) {
        if (await probe(url, fetchImpl)) return { url, slug: addon.slug };
      }
    }
  } catch (err) {
    log?.debug(`Music Assistant discovery failed: ${err.message}`);
  }
  return null;
}
