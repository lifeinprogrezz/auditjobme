// Optional outbound proxy for the sources that datacenter IPs are blocked from
// (startupmap → 403, Meta → 400 from the GitHub Actions runner; both work from a
// residential IP). Set SCRAPE_PROXY_URL (e.g. http://user:pass@host:port) to route
// ONLY those fetches through a residential/rotating proxy; unset = direct. The other
// sources keep fetching direct (they're not blocked), so proxy bandwidth stays minimal.
// Requires `undici` for ProxyAgent (bundled with the scrape, not the app build).
import { ProxyAgent } from "undici";

const PROXY = process.env.SCRAPE_PROXY_URL || "";
const dispatcher = PROXY ? new ProxyAgent(PROXY) : undefined;

/** `usingProxy` lets callers log whether the proxy is active. */
export const usingProxy = Boolean(PROXY);

/** fetch() that routes through SCRAPE_PROXY_URL when set, else a normal direct fetch. */
export function pfetch(url, opts = {}) {
  return fetch(url, dispatcher ? { ...opts, dispatcher } : opts);
}
