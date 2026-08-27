# Can company office coordinates be had for free? — measurement, 2026-08-27

**The decision this feeds.** Mapbox's free tier is *temporary* geocoding: the results may not be
stored. Storing them needs *permanent* geocoding at $5.00 per 1,000 requests, about $8 one-off for
our live-job companies (1,210 of them today). The owner pays that only if the free route measurably falls short.

**The answer, in one line.** The free route gets a correct office coordinate for **9 of 70 sampled
companies (12.9%)**. With a company website for every company, the same routes *project* to
about **26%** (arithmetic on measured rates, marked as a projection below). The free route does not
close the gap.

Every number below was measured on 2026-08-27 against live production data and live public
endpoints. Nothing here is estimated unless the line says *projection*.

> **Corrected after an independent verification pass, same day.** The first version of this report
> said 7 of 70 (10.0%). An adversarial re-run reproduced the population, the sample and every other
> figure exactly, and found that the address extractor was still missing two address shapes its own
> sample prints, which cost two real hits (Akamas, Reel). The extractor is fixed and pinned by
> fixtures (`selftest`); the numbers below are from the re-run. The decision does not change.

---

## The sample

Read-only, from the **public** dataplane artifact
(`…/storage/v1/object/public/dataplane/dataplane.json` + `jobs.ndjson`) — no database access, no
credentials, nothing written back.

| | count |
|---|---|
| companies with a live job | 1,210 |
| of those, with no `company_offices` row | 944 |
| of those, also with no `companies.lat` | 906 |
| of those, whose job location resolves to a city the map knows (`cityOf` + `coordsOf`) | **810** ← the pool |
| random sample carried through every hypothesis | **70** |
| sample companies with a website in production | 29 (41.4%) |

The pool is the population that matters: these are the companies the map currently scatters on
`naturalPlace()`'s disc around a city centroid. The sample is a deterministic random draw
(FNV-1a hash of `slug + "geo-sample-2026-08-27"`), so it reproduces exactly.

The 41.4% website figure is not a sampling artifact. Across the whole 944, production holds a
website for 400 (42.4%).

**Acceptance rule, identical for every hypothesis**: the coordinate must sit within **50 km** of the
city centroid the map would otherwise use, and must be street-level or better. A coarse or far-away
point is rejected, never written as a guess. Both halves come from production
(`MAX_OFFICE_TO_CITY_KM = 50`; `precision === "street"` means `house_number || road`).

**One way this rule is looser than production, and it matters for H2.** Production also runs
`isTrustworthyOffice`, which requires the geocoder's own result name to equal the company name.
That gate exists because production queries by *company name*. Every H2 hit below is a *postal
address* query, so its result is named for the building or the street, and **all nine would fail
`isTrustworthyOffice` as written**. Adopting H2 therefore means changing that gate, not just adding
a source. The gate is doing real work on the name route (see H1) and must not simply be deleted.

---

## Results

| Hypothesis | tried | addresses found | coordinates accepted | hit rate | hand-checked precision |
|---|---|---|---|---|---|
| H1a — OSM POI by name (Photon) | 70 | n/a | 5 | 7.1% | **1 of 5 correct**, 1 ambiguous, 3 wrong |
| H1b — OSM POI by name (Overpass) | 46 answered of 70 | n/a | 1 | 2.2% | 1 of 1 ambiguous (same feature as H1a) |
| H2 — company website → postal address → Nominatim | 70 | 13 (of the 29 with a website) | 9 | 12.9% | **8 of 9 correct** |
| H3 — ATS board structured address (Ashby) | 14 on an Ashby board | 3 street-level | 0 | 0.0% | n/a |
| **Union of all free routes** | 70 | — | 13 | 18.6% | **9 correct → 12.9%** |

Requests made, first run: Photon 70, Overpass 154, Nominatim 52, company websites 208, ATS board
APIs 49, dataplane 2. **535 in total.** Requests made by the verification pass that corrected H2:
Photon 70, Nominatim 30, company websites 137 plus about 130 probe fetches, ATS board APIs 25,
dataplane 2. **394 in total.** Pacing: 1.1 s between Nominatim calls, 1.1 s between Photon calls,
5 s between Overpass calls, one thread throughout, both runs.

### H1 — OpenStreetMap points of interest, searched by company name

Free, and ODbL permits storing with attribution. It does not work, for the simple reason that most
of these companies are not in OpenStreetMap as named features.

Photon answered all 70 queries. 16 companies returned zero features of any kind. Five passed the
name-and-distance gate. I hand-checked all five by looking up the company's real address in an
independent source (company register, national business directory, the company's own site) and
comparing:

| company | OSM feature accepted | real address | verdict |
|---|---|---|---|
| Veo | `building=commercial` "Veo Technologies", Rovsingsgade, Copenhagen | Rovsingsgade 68, 2100 København Ø (Danish CVR 37240834) | **correct** |
| Tapio | `office=company` "Tapio", Rue du Magistrat, Ixelles | registered office Avenue Louise 231, 1050 Bruxelles — same district, ~500 m away | ambiguous |
| Juni | `shop=massage` "Juni Aponia Massage", Karlbergsvägen, Stockholm | Masthamnsgatan 21, 413 28 Gothenburg | **wrong** |
| Gradient Labs | `amenity=bench` "Gradient Fade - Adham Faramawy", Knapp Road, London E3 | 10 Holmesdale Road, London N6 5TQ | **wrong** |
| Rival (GDevelop) | `shop=sports` "Rival Boxing Gear", Boulevard Ney, Paris | a game-engine company, not a boxing shop | **wrong** |

The failures are name collisions, and the accept gate is what let them through: it accepted a
prefix match. Re-scored offline under exact name equality, the answer depends on which normaliser
you use, and both were re-measured: under this script's `norm()` (which strips corporate suffixes)
**2 of 70** survive, Tapio and Veo, so the one *correct* hit is kept and all three wrong ones are
dropped; under production's `normalizeForNameMatch` (which does not strip suffixes) **1 of 70**
survives, Tapio. Either way H1 is near zero. Tightening the gate does not rescue it. It only makes
the near-zero yield explicit.

Overpass returned the same single Tapio feature and nothing else. It also refused the sweep: the
public instance answered 46 of 70 companies and returned HTTP 429 for the rest across six resumed
runs, at 5 s spacing, so I stopped. An exact-name query answers in under a second. A
case-insensitive regex over a 30 km disc times out (measured: 48 s, then HTTP 504), which is why
the query is an exact match.

### H2 — the company's own website carries its address

This is the route that works, and it is limited by input, not by method.

- 29 of 70 sample companies have a website in production.
- The crawler fetched the home page, then up to four candidate pages ranked
  Impressum / legal notice → contact → legal / about, including guessed paths for sites that render
  their footer with JavaScript.
- Addresses were extracted from schema.org `PostalAddress` JSON-LD and from three postcode-anchored
  text patterns (continental, UK, Dutch).
- 13 of the 29 yielded a usable postal address. 9 of those geocoded to a coordinate that passed
  the 50 km + street-level gate.

Hand-check of all 7 accepted coordinates. Method: the address string came from the company's own
contact or Impressum page. I compared Nominatim's `display_name` field by field with that string.
For five of them I confirmed the company's presence at that address in an independent source.

| company | address used | Nominatim result | independent confirmation | verdict |
|---|---|---|---|---|
| Amphora Logistics | Travessera de Gràcia 58, 08006 Barcelona | same street + number, 1.8 km from centroid | Catalonia Startup Hub lists Travessera de Gràcia 58 | correct |
| Metiundo | Bessemerstraße 16, 12103 Berlin | same street + number, 6.5 km | German company register + Lobbyregister entry | correct |
| Crypto Quantique | 180 Union Street, London SE1 0LH | "The Print Rooms, 164-180 Union Street", 2.2 km | Companies House registered office 10267904 | correct |
| Qargo | Gaston Crommenlaan 4, 9050 Ghent | same street + number, 1.9 km | Belgian register, Qargo Tech SRL BE0772640434 | correct |
| Doccla | 184 Shepherds Bush Road, London W6 7NL | "WeWork, 184 Shepherds Bush Road", 6.7 km | the company's own contact page | correct |
| Rankscale | Untere Viaduktgasse 10/6, 1030 Vienna | street level, 1.4 km | the company's own Austrian Impressum (a legal obligation) | correct |
| Akamas | Via Schiaffino 11, 20158 Milano | same street + number, 5.5 km | the company's own contact page, Akamas S.p.A. with an Italian landline | correct |
| Reel | Frederiksholms Kanal 4, 1220 Copenhagen | same street + number, 0.6 km | the company's own legal notice at `/legal/imprint` | correct |
| Tapio | Frankrijklei 5, 2000 Antwerpen | correct building in Antwerp, 41.2 km from Brussels | registered office is Avenue Louise 231, Brussels | **wrong city** |

**Precision 8 of 9 (89%).** When this route hits, the coordinate can be trusted.

**The structural limit, and it is not fixable by a better parser.** A website gives you *one*
address — the registered head office. The map needs the office in the city the *role* is in. Three
more companies produced a perfectly correct address that the distance gate then had to reject,
exactly as designed:

| company | address found | role city | distance |
|---|---|---|---|
| Airmo | Gotzinger Straße 8, 81371 München | Berlin | 506 km |
| Lizy | Maliestraat 50, 1050 Ixelles | Amsterdam | 176 km |
| Bit2Me | Calle Germán Bernácer 69, 03203 Elche | Madrid | 355 km |

A paid geocoder does not fix this either. The address is right. It is the wrong city.

**A note on what was measured, and on how it was wrong twice.** The first version of the address
extractor found 4 hits. It was missing UK addresses printed inside a single HTML element — Doccla's
"184 Shepherds Bush Road, London W6 7NL" among them. It was rewritten, fed that exact page, and
watched go from empty to correct. That produced 7, which is what the first version of this report
published. It was still wrong: an independent verification pass re-read the sites of all 18
companies the run had marked "website but no address" and found two more addresses printed in
plain sight, in two more shapes the regex did not cover — a comma between street and number with a
dash before the postcode (`Via Schiaffino, 11 – 20158 Milan`) and a floor token between the number
and the postcode (`Vesterbrogade 26, 1. th 1620 København V`). Both geocode inside the gate. Fixing
one page shape had not fixed the class.

The lesson is procedural, and it is now enforced in the script: `node scripts/…​ selftest` holds
nine fixtures, seven positive shapes taken from this sample's own sites and two negatives that a
looser regex would swallow. Each was mutation-tested — the pre-fix regex turns two fixtures red,
and removing the `DENY` guard turns a third red — so the fixtures fail for the reason they exist.
`probe --url=…` still reproduces any single page by hand.

**One hit is measured but not counted, on purpose.** Propane's address
(`Vesterbrogade 26, 1620 København V`, 1.1 km from the Copenhagen centroid, verified by hand) is
printed only on `/privacy` and `/terms`. The crawler ranks four candidate pages and guesses only
Impressum / imprint / contact / legal-notice, and Propane's home page renders its footer in
JavaScript, so no link is ever seen. That is a crawler-coverage limit, not an extractor limit, and
it is left unfixed and stated rather than silently absorbed. The honest reading of H2 on this
sample is therefore **9 counted, 10 reachable**.

### H3 — the ATS board's own structured address

14 of the 70 sample companies post through Ashby. Ashby's public posting API
(`api.ashbyhq.com/posting-api/job-board/<handle>`) returns a schema.org `PostalAddress` per job.

- All 14 boards carried a `PostalAddress`.
- Only **3** carried a `streetAddress`. The other 11 give country, region, and locality — which is
  the city, which the map already knows.
- **0 of 3** passed the gate, all for the same reason as H2: the street address is the head office,
  and the role is in another city (Plancraft's Hamburg address against a Milan role, Nord
  Security's Vilnius address against a Warsaw role).

One of the three, Pliant, is a parser failure rather than a data failure: the field reads
`"Prenzlauer Allee 242–247"` and Nominatim returns nothing for a house-number range. Checked by
hand — `Prenzlauer Allee 242, 10405 Berlin` resolves to 52.53043, 13.41686, about 1.4 km from the
Berlin centroid, and the role *is* in Berlin. So H3's honest ceiling on this sample is 1 of 14, not
0 of 14.

Ashby's public posting API carries **no company website** (verified live: the response holds only
`jobs` and `apiVersion`). Workable's public widget account endpoint carries none either. Neither
raised H2's denominator by one company.

### Licence terms, quoted

- **OpenStreetMap data** (Nominatim, Photon, Overpass all return it): ODbL 1.0. Storing and
  redistributing derived coordinates is permitted with attribution and the share-alike obligation.
- **Nominatim usage policy**, verbatim: "No heavy uses (an absolute maximum of 1 request per
  second)". "Scripts running longer than a day and scripts that are run at regular intervals are
  restricted to 4 requests per minute". "Limited to 1 machine only, no distributed scripts."
  "Results **must be cached** on your side." Storing results is not merely allowed, it is required.
  Attribution: "Clearly display attribution as suitable for your medium."
- **Photon** (photon.komoot.io), verbatim: "You can use the API for your project, but please be
  fair - extensive usage will be throttled" and "We do not guarantee for the availability and usage
  might be subject of change in the future." No stated rate limit, no availability guarantee.
- **Overpass** public instance: no published quota. It rate-limited this 70-company sweep in
  practice.
- **The two clauses that constrain a product, not a measurement.** The Nominatim policy also
  forbids "Reselling of geocoding results", and ODbL's share-alike means a stored, published
  database of OSM-derived coordinates is a Derivative Database with an ODbL obligation attached.
  Neither blocks showing a dot on the map with attribution. Both are reasons the free route is not
  simply "free". And the "4 requests per minute" ceiling on scripts "run at regular intervals" is
  the binding limit on the nightly crawl suggested at the end of this document: at 4 per minute a
  pass over the 810-company pool is about 3.4 hours of continuous requests against a donated
  server, so a real nightly job must be incremental and cached, never a full re-sweep.

---

## What this means for the $8

**Measured, today:** the free routes together give a correct coordinate for **9 of 70 (12.9%)** of
the office-less pool. Applied to the pool of 810, that is roughly 105 companies. 705 stay on the
sunflower disc.

**Projection, clearly labelled as such:** the binding constraint on H2 is website coverage (41.4%),
not the method. H2 accepted 9 of the 29 companies that had a website and 8 of those were correct —
27.6% correct, conditional on having a website. If the other track lifts website coverage to 95%,
the arithmetic gives 0.95 × 27.6% ≈ **26%** of the pool. This is arithmetic on two measured rates,
not a measurement.

**The free route does not reach a coverage worth calling the problem solved.** At 13% today, or a
projected 26% later, three office-less companies in four still land on the disc. If the goal is "most
companies get a real dot", $8 is the better buy, and it is cheap enough that the analysis cost more
than the purchase.

**One caveat the owner should not skip, because it decides how the $8 gets spent.** Mapbox's own
yield on this pool is **not measured here** — there is no Mapbox token in this environment, and a
number I did not measure does not belong in this report. Two things about the problem are already
known to be provider-independent:

1. A geocoder that resolves *addresses* cannot invent the office for a company whose only published
   address is in another country. Airmo, Lizy, Bit2Me, Plancraft and Nord Security fail for Mapbox
   for the same reason they failed here.
2. Mapbox's advantage is its commercial POI database, which is where OpenStreetMap was empty (16 of
   70 companies returned no OSM feature at all). That is exactly the gap it might close, and exactly
   the thing nobody has counted.

Before spending, run the same 70-company sample against Mapbox's **free temporary** tier and count
the hits. That measurement is free, it takes 70 requests, and it turns the $8 from a guess into a
priced decision. `scripts/measure-geocoding-2026-08-27.mjs` already holds the sample and the
acceptance rule. `scripts/geocode-lib.mjs` already holds `mapboxSearchUrl` and `parseMapboxResult`.

**Worth doing regardless of the $8:** H2 is precise (8 of 9) and it depends on nothing but a
company website. If website coverage lands, it is roughly 210 companies' worth of real coordinates
for the cost of an incremental nightly crawl. Two conditions attach, and both are in this document
rather than in a footnote: production's `isTrustworthyOffice` gate rejects address-shaped hits and
would have to change, and the Nominatim terms above (4 requests per minute on a scheduled script,
attribution, no reselling, ODbL share-alike) apply to the stored result, not just to the run.

---

## Reproducing this

`scripts/measure-geocoding-2026-08-27.mjs` — a **throwaway measurement script**, not part of the
product, not wired into any workflow, safe to delete. It never writes to production and never
touches the database. Stages, each cached to `.geo-measure/`:

```
node scripts/measure-geocoding-2026-08-27.mjs sample       # the 70, from the public dataplane
node scripts/measure-geocoding-2026-08-27.mjs sites        # website recovery from ATS boards
node scripts/measure-geocoding-2026-08-27.mjs h1photon
node scripts/measure-geocoding-2026-08-27.mjs h1overpass   # resumable, expect 429s
node scripts/measure-geocoding-2026-08-27.mjs h2
node scripts/measure-geocoding-2026-08-27.mjs h3board
node scripts/measure-geocoding-2026-08-27.mjs selftest    # extractor fixtures, exits non-zero on a miss
node scripts/measure-geocoding-2026-08-27.mjs report
node scripts/measure-geocoding-2026-08-27.mjs probe --url=https://doccla.com/contact
```

The production geocoding path was not changed. `scripts/logo-*.mjs` was not touched.
