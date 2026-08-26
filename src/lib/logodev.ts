// Logo.dev domain resolution for the /roles globe (issue #14).
// A wrong domain renders a WRONG company logo — strictly worse than the
// colored-initial fallback — so KNOWN_DOMAINS only carries certain mappings;
// everything else returns null and the UI falls back to hueFor(company) + initial.

/** Big-tech scrapers write their own source tag; the domain is implied. */
const SOURCE_DOMAINS: Record<string, string> = {
  google: "google.com",
  meta: "meta.com",
  amazon: "amazon.com",
  microsoft: "microsoft.com",
  apple: "apple.com",
};

/** Curated lowercase company name → primary domain. Certain mappings ONLY. */
const KNOWN_DOMAINS: Record<string, string> = {
  adyen: "adyen.com",
  airtable: "airtable.com",
  alan: "alan.com",
  alma: "getalma.eu",
  amazon: "amazon.com",
  apple: "apple.com",
  atlassian: "atlassian.com",
  babbel: "babbel.com",
  "back market": "backmarket.com",
  backbase: "backbase.com",
  "bending spoons": "bendingspoons.com",
  bitpanda: "bitpanda.com",
  blablacar: "blablacar.com",
  bolt: "bolt.eu",
  booking: "booking.com",
  "booking.com": "booking.com",
  bunq: "bunq.com",
  cabify: "cabify.com",
  canva: "canva.com",
  celonis: "celonis.com",
  cleo: "meetcleo.com",
  contentful: "contentful.com",
  datadog: "datadoghq.com",
  deepl: "deepl.com",
  deliveroo: "deliveroo.co.uk",
  "delivery hero": "deliveryhero.com",
  doctolib: "doctolib.fr",
  duolingo: "duolingo.com",
  factorial: "factorial.co",
  fever: "feverup.com",
  figma: "figma.com",
  flink: "goflink.com",
  framer: "framer.com",
  getyourguide: "getyourguide.com",
  gitlab: "gitlab.com",
  glovo: "glovoapp.com",
  google: "google.com",
  gostudent: "gostudent.org",
  hellofresh: "hellofresh.com",
  intercom: "intercom.com",
  jobandtalent: "jobandtalent.com",
  king: "king.com",
  klarna: "klarna.com",
  linear: "linear.app",
  lunar: "lunar.app",
  manomano: "manomano.com",
  meta: "meta.com",
  mews: "mews.com",
  microsoft: "microsoft.com",
  miro: "miro.com",
  mollie: "mollie.com",
  monzo: "monzo.com",
  n26: "n26.com",
  northvolt: "northvolt.com",
  omio: "omio.com",
  payfit: "payfit.com",
  payhawk: "payhawk.com",
  pennylane: "pennylane.com",
  personio: "personio.com",
  pitch: "pitch.com",
  pleo: "pleo.io",
  preply: "preply.com",
  qonto: "qonto.com",
  remote: "remote.com",
  revolut: "revolut.com",
  satispay: "satispay.com",
  "scalable capital": "scalable.capital",
  scalapay: "scalapay.com",
  sennder: "sennder.com",
  shopify: "shopify.com",
  soundcloud: "soundcloud.com",
  spendesk: "spendesk.com",
  spotify: "spotify.com",
  stripe: "stripe.com",
  "sword health": "swordhealth.com",
  synthesia: "synthesia.io",
  templafy: "templafy.com",
  tier: "tier.app",
  tink: "tink.com",
  "trade republic": "traderepublic.com",
  travelperk: "travelperk.com",
  trivago: "trivago.com",
  twilio: "twilio.com",
  typeform: "typeform.com",
  unbabel: "unbabel.com",
  vercel: "vercel.com",
  vinted: "vinted.com",
  wise: "wise.com",
  wolt: "wolt.com",
  zalando: "zalando.com",
  zendesk: "zendesk.com",
};

/** Trailing legal-entity suffixes stripped before lookup ("Personio GmbH" → "personio"). */
const LEGAL_SUFFIXES = new Set([
  "gmbh", "ab", "bv", "b.v", "b.v.", "sl", "s.l", "s.l.", "sas", "s.a.s", "s.a.s.",
  "ltd", "ltd.", "inc", "inc.", "se", "ag", "nv", "n.v", "n.v.", "aps", "oy", "as",
  "plc", "llc", "limited", "srl", "s.r.l", "s.r.l.", "sa", "s.a", "s.a.",
]);

// Own-property lookup: a plain bracket read on an object literal walks the
// prototype chain, so e.g. "Constructor" or "__proto__" as a company name
// would return inherited Object members instead of null.
function own(map: Record<string, string>, key: string): string | null {
  return Object.prototype.hasOwnProperty.call(map, key) ? map[key] : null;
}

export function domainFor(company: string, source: string | null): string | null {
  const bySource = source ? own(SOURCE_DOMAINS, source.trim().toLowerCase()) : null;
  if (bySource) return bySource;
  const name = company.trim().toLowerCase().replace(/,/g, " ").replace(/\s+/g, " ");
  const direct = own(KNOWN_DOMAINS, name);
  if (direct) return direct;
  const words = name.split(" ");
  while (words.length > 1 && LEGAL_SUFFIXES.has(words[words.length - 1])) words.pop();
  return own(KNOWN_DOMAINS, words.join(" "));
}

/**
 * Logo.dev image URL; null without a token. fallback=404 (Rober 7-05): for a domain
 * logo.dev DOESN'T have (e.g. travelperk.com) it must 404 so onError fires and the
 * caller falls through to the site's real favicon — WITHOUT it, logo.dev serves a
 * generic colored-pinwheel placeholder with a 200 (identical for every unknown
 * domain), which reads as a wrong logo. `theme` matches the SURFACE: "dark" returns
 * light marks (dark glass cards), "light" returns dark/colored marks (white map pins).
 */
// Domains logo.dev serves its generic pinwheel placeholder for — a 200 (so it
// can't be caught by onError at load time) that is byte-identical for every such
// domain. Verified by batch-testing all 324 live company domains: exactly these
// two. Skip logo.dev for them so the chain starts at the real site favicon.
const LOGODEV_PLACEHOLDER = new Set(["travelperk.com", "gozauber.com"]);

export function logoUrl(domain: string, theme: "dark" | "light" = "dark"): string | null {
  const token = import.meta.env.VITE_LOGODEV_TOKEN as string | undefined;
  if (!token || LOGODEV_PLACEHOLDER.has(domain)) return null;
  return `https://img.logo.dev/${domain}?token=${token}&size=96&format=png&theme=${theme}&retina=true&fallback=404`;
}

/** Site favicon fallback chain (real brand mark for domains logo.dev lacks).
 *  icon.horse serves the site's high-res apple-touch-icon (~180px), with Google
 *  favicons as the reliable fallback when icon.horse can't reach a site.
 *
 *  icons.duckduckgo.com was a middle hop here until issue #153 UI round 2: for
 *  any domain it has no real icon for, it answers HTTP 404 but WITH a
 *  decodable image body — its own generic "no icon on file" placeholder,
 *  byte-identical (confirmed via curl: same 1478-byte 48x48 PNG, same MD5)
 *  across every domain lacking a real one. A browser <img> that successfully
 *  decodes a response fires onload, not onerror, on the strength of the body
 *  alone — the HTTP status doesn't gate it — so the onError-driven fallback
 *  chain below (and its copies in GlobeMap/PaperLogo) got stuck showing that
 *  grey placeholder glyph instead of ever reaching Google or the coloured
 *  initial. No CORS header ships on any icons.duckduckgo.com response either,
 *  so there is no client-side way to hash/inspect the body and route around
 *  it — the domain is dropped from the chain rather than guessed at. */
export function faviconUrls(domain: string): string[] {
  return [
    `https://icon.horse/icon/${domain}`,
    `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=128`,
  ];
}

// No name-based favicon guess lives here (PR #164 live-verify rounds 1+2): a
// speculative `{slug}.com` request 404s for most companies, and Chromium logs
// every failed <img> load to the console straight from its resource loader —
// onError can redirect the UI but cannot silence that entry (143 errors in one
// walk). Coverage for companies with no domain on file comes from the
// server-side `scripts/company-records.mjs` + `scripts/logo-backfill.mjs`
// (companies.logo_domain), never from guessing in the browser. The chain ends:
// companies.logo_domain → KNOWN_DOMAINS → favicon services for a KNOWN domain →
// coloured initial.
