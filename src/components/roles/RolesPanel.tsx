// RolesPanel — the right-hand glass panel of /roles (v43 mockup: cards list,
// detail view, empty states, panel-toggle). All styling comes from
// src/styles/roles.css (.roles-theme scope); the PAGE ROOT owns the
// .scored / .detail-open / .panel-hidden state classes — this component only
// renders panel content and never touches body/root classes.
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  EMPTY_FILTERS,
  LEVELS,
  fitLabel,
  formatHeadcount,
  formatStage,
  hueFor,
  postedAgo,
  scoreBucket,
  websiteUrl,
  type RoleJob,
  type RolesFilters,
} from "@/lib/roles";
import { logoUrl, faviconUrls } from "@/lib/logodev";
import { prefersReducedMotion } from "@/hooks/usePrefersReducedMotion";

// The pool is unbounded (1000+ live rows); each card mounts a Logo.dev <img>,
// so cap the DOM and point the user at search/filters for the tail.
const CARD_CAP = 200;

export type RolesPanelProps = {
  jobs: RoleJob[];
  allJobs: RoleJob[];
  /** Default landing view → the panel shows the curated "hot companies" showcase. */
  defaultView?: boolean;
  scored: boolean;
  signedIn: boolean;
  loading: boolean;
  scoring: boolean;
  remaining: number;
  detailJob: RoleJob | null;
  applied: Set<string>;
  onOpenDetail: (j: RoleJob) => void;
  onCloseDetail: () => void;
  onScoreMore: () => void;
  onToggleHidden: () => void;
  /** Opens the CV-unlock modal (Phase A front door). */
  onAddCv: () => void;
  /** The live headbar filter state (mirrored as removable chips in the panel). */
  filters: RolesFilters;
  onFilters: (f: RolesFilters) => void;
  /** Map selection: company and/or city, each independently removable via a chip. */
  selCo?: string | null;
  selCity?: string | null;
  onClearCo?: () => void;
  onClearCity?: () => void;
};

/** Logo.dev → site favicon (DuckDuckGo, then Google) → colored initial. logo.dev
 *  404s when it lacks the brand, so the favicon step shows the real mark instead
 *  of logo.dev's generic pinwheel placeholder (the TravelPerk case). */
function Logo({ domain, company }: { domain: string | null; company: string }) {
  const chain = domain ? [logoUrl(domain), ...faviconUrls(domain)].filter(Boolean) : [];
  const [stage, setStage] = useState(0);
  const src = chain[stage] ?? null;
  if (!src) {
    return (
      <span className="fb" style={{ background: hueFor(company) }}>
        {company.charAt(0)}
      </span>
    );
  }
  return <img src={src as string} alt="" onError={() => setStage((s) => s + 1)} />;
}

/**
 * Count-up numeral for the score pill: animates 0→value only when `scored`
 * flips false→true while mounted; a mount with scored already true renders
 * the static value (no re-animation on remount/scroll). null never animates.
 */
function ScoreValue({ scored, value }: { scored: boolean; value: number | null }) {
  const [display, setDisplay] = useState<number>(scored && value != null ? value : 0);
  const prevScored = useRef(scored);
  useEffect(() => {
    const was = prevScored.current;
    prevScored.current = scored;
    if (!scored || value == null) return;
    if (was || prefersReducedMotion()) {
      // score arrived post-reveal (background pass), or the OS/browser asked
      // for reduced motion — either way, no rAF count-up, just the final value.
      setDisplay(value);
      return;
    }
    let raf = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / 900);
      setDisplay(value * (1 - (1 - t) * (1 - t))); // power2.out
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [scored, value]);
  return <span className="v num">{value == null ? "—" : display.toFixed(1)}</span>;
}

/** great bucket carries NO suffix class in roles.css — bare "score". */
function scorePillClass(score: number | null): string {
  if (score == null) return "score pending";
  const b = scoreBucket(score);
  return b === "great" ? "score" : `score s-${b}`;
}

/** Fit-score hero color bucket (great = jade, mid = amber, low = coral). */
function heroClass(score: number): string {
  const b = scoreBucket(score);
  return b === "great" ? "dhs" : `dhs s-${b}`;
}

/** Compact location for the "more roles" list: a many-city list collapses to
 *  "Multiple locations" so one sprawling role can't blow out the row (Rober 7-06). */
function moreCity(job: RoleJob): string {
  const loc = job.city ?? job.location ?? "";
  if (!loc) return "";
  const parts = loc.split(",").map((s) => s.trim()).filter(Boolean);
  return parts.length > 2 ? "Multiple locations" : loc;
}

export default function RolesPanel({
  jobs,
  allJobs,
  defaultView,
  scored,
  signedIn,
  loading,
  scoring,
  remaining,
  detailJob,
  applied,
  onOpenDetail,
  onCloseDetail,
  onScoreMore,
  onToggleHidden,
  onAddCv,
  filters,
  onFilters,
  selCo,
  selCity,
  onClearCo,
  onClearCity,
}: RolesPanelProps) {
  const navigate = useNavigate();
  const detailRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (detailJob) detailRef.current?.scrollTo(0, 0);
  }, [detailJob]);

  // "Prepare application" is Phase B — still gated to the coming-soon surface.
  // "Add your CV" opens the Phase-A CV-unlock modal (onAddCv, from RolesMap).
  const goApply = (_j: RoleJob) => navigate("/underconstruction");

  // Active-filter chips: map selection (co/city) + every headbar filter, each
  // removable. They read/write the SAME filter state the headbar uses, so the two
  // can never drift out of sync (Rober 7-06).
  const levelLabel = (v: string) => LEVELS.find((l) => l.value === v)?.label ?? v;
  const remove = (key: "levels" | "cities" | "sectors" | "sizes", v: string) =>
    onFilters({ ...filters, [key]: (filters[key] as string[]).filter((x) => x !== v) });
  const activeChips: { key: string; label: string; bold?: boolean; onX?: () => void }[] = [
    ...(selCo ? [{ key: "co", label: selCo, bold: true, onX: onClearCo }] : []),
    ...(selCity ? [{ key: "citysel", label: selCity, onX: onClearCity }] : []),
    ...(filters.query
      ? [{ key: "q", label: `“${filters.query}”`, onX: () => onFilters({ ...filters, query: "" }) }]
      : []),
    ...filters.levels.map((v) => ({ key: `lv-${v}`, label: levelLabel(v), onX: () => remove("levels", v) })),
    ...filters.cities.map((v) => ({ key: `ci-${v}`, label: v, onX: () => remove("cities", v) })),
    ...filters.sectors.map((v) => ({ key: `se-${v}`, label: v, onX: () => remove("sectors", v) })),
    ...filters.sizes.map((v) => ({ key: `sz-${v}`, label: v, onX: () => remove("sizes", v) })),
    ...(filters.remoteOnly
      ? [{ key: "remote", label: "Remote", onX: () => onFilters({ ...filters, remoteOnly: false }) }]
      : []),
  ];
  const clearAllFilters = () => {
    onFilters(EMPTY_FILTERS);
    onClearCo?.();
    onClearCity?.();
  };

  // In-panel search: inside any narrowed view, a local box finds a company without
  // going back up to the headbar (Rober 7-06). It narrows ONLY the panel's current
  // list (company + role); the headbar search stays global, and it resets whenever
  // the context changes.
  const searchTarget = selCity || selCo || (filters.cities.length === 1 ? filters.cities[0] : null);
  const [panelQ, setPanelQ] = useState("");
  const panelSearchRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    setPanelQ("");
  }, [selCo, selCity]);
  const listContext = activeChips.length > 0;
  const shown = (() => {
    const q = panelQ.trim().toLowerCase();
    return q ? jobs.filter((j) => `${j.company} ${j.title}`.toLowerCase().includes(q)) : jobs;
  })();

  // Cursor spotlight: one listener on the container, sets --mx/--my on the hovered card.
  const handleCardsMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const c = (e.target as HTMLElement).closest<HTMLElement>(".card");
    if (!c) return;
    const r = c.getBoundingClientRect();
    c.style.setProperty("--mx", `${e.clientX - r.left}px`);
    c.style.setProperty("--my", `${e.clientY - r.top}px`);
  };

  const renderCards = () => (
    <>
      <h1 className="ptitle">{defaultView ? "Hot right now" : "Your matches"}</h1>
      {activeChips.length > 0 && (
        <div className="selhdr">
          {activeChips.map((c) => (
            <button
              key={c.key}
              className="selchip"
              onClick={c.onX}
              aria-label={`Remove ${c.label} filter`}
            >
              {c.bold ? <b>{c.label}</b> : c.label}
              <span className="x">×</span>
            </button>
          ))}
          <span className="selcount">{shown.length} roles</span>
          {activeChips.length > 1 && (
            <button className="selclear" onClick={clearAllFilters}>
              Clear all
            </button>
          )}
        </div>
      )}
      {listContext && jobs.length > 0 && (
        <div className="psearch">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
            <circle cx="11" cy="11" r="7" />
            <path d="m21 21-4.3-4.3" />
          </svg>
          <input
            ref={panelSearchRef}
            type="text"
            aria-label="Search this list"
            placeholder={searchTarget ? `Search in ${searchTarget}` : "Search these roles"}
            value={panelQ}
            onChange={(e) => setPanelQ(e.target.value)}
          />
          {panelQ && (
            <button
              type="button"
              className="psearch-x"
              aria-label="Clear search"
              onClick={() => {
                setPanelQ("");
                panelSearchRef.current?.focus();
              }}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4">
                <path d="M18 6 6 18M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>
      )}
      {scoring && (
        <div className="scorebar">Scoring roles against your profile… {remaining} to go</div>
      )}
      {loading ? (
        <div className="panel-note">Loading roles…</div>
      ) : jobs.length === 0 ? (
        <div className="panel-note">
          <b>No roles match</b>
          {selCo || selCity ? "Try removing a filter above." : "Try clearing filters."}
        </div>
      ) : (
        <div className="cards" onMouseMove={handleCardsMove}>
          {shown.length === 0 && (
            <div className="panel-note">
              <b>No companies match</b>
              Nothing here for “{panelQ}”.
            </div>
          )}
          {shown.slice(0, CARD_CAP).map((job, i) => {
            const ago = postedAgo(job.posted_at);
            const open = (e: React.SyntheticEvent) => {
              if ((e.target as HTMLElement).closest(".acts")) return;
              onOpenDetail(job);
            };
            return (
              <article
                key={job.id}
                className={"card" + (scored && i === 0 ? " hero" : "")}
                role="button"
                tabIndex={0}
                onClick={open}
                onKeyDown={(e) => {
                  if (e.key !== "Enter") return;
                  open(e);
                }}
              >
                <div className="logo">
                  <Logo domain={job.domain} company={job.company} />
                </div>
                <div className="cbody">
                  <div className="co">{job.company}</div>
                  <div className="role">{job.title}</div>
                  <div className="meta">
                    <b>{job.city ?? job.location ?? (job.remote ? "Remote" : "Location unknown")}</b>
                    {ago && (
                      <>
                        <span className="d" />
                        {ago}
                      </>
                    )}
                  </div>
                </div>
                <div className={scorePillClass(job.score)}>
                  <ScoreValue scored={scored} value={job.score} />
                  <span className="l">FIT</span>
                </div>
                {scored && job.reason && <div className="why">{job.reason}</div>}
                <div className="acts">
                  <button
                    className="btn g"
                    onClick={(e) => {
                      e.stopPropagation();
                      goApply(job);
                    }}
                  >
                    Prepare application
                  </button>
                </div>
              </article>
            );
          })}
          {shown.length > CARD_CAP && (
            <div className="scorebar">
              Showing the top {CARD_CAP} of {shown.length} roles. Narrow with search or filters.
            </div>
          )}
        </div>
      )}
      {signedIn && scored && remaining > 0 && !scoring && (
        <button className="btn g morebtn" onClick={onScoreMore}>
          Score {Math.min(40, remaining)} more
        </button>
      )}
    </>
  );

  const renderDetail = (job: RoleJob) => {
    const ago = postedAgo(job.posted_at);
    const site = websiteUrl(job.website, job.domain);
    const level = LEVELS.find((l) => l.value === job.seniority)?.label;
    // Company meta (stage / size / founded) renders as a condensed icon row so a
    // lone value never floats; role facts (location / level / remote / posted)
    // stay a labeled grid inside the role box.
    const stage = formatStage(job.stage);
    const size = formatHeadcount(job.headcount);
    const roleFacts: [string, string][] = [];
    const loc = job.city ?? job.location;
    if (loc) roleFacts.push(["Location", loc]);
    if (level) roleFacts.push(["Level", level]);
    if (job.remote) roleFacts.push(["Remote", "Yes"]);
    if (ago) roleFacts.push(["Posted", ago]);
    const others = allJobs.filter((j) => j.company === job.company && j.url !== job.url);
    // Hero: a CV holder sees their fit (or a pending state); everyone else sees the
    // unlock prompt — the pre-CV conversion moment (absorbs issue #18).
    const hasCv = scored;
    const bullets = job.fitBullets?.length ? job.fitBullets : job.reason ? [job.reason] : [];

    return (
      <div className="detail" ref={detailRef}>
        <button className="dback" onClick={onCloseDetail}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4">
            <path d="m15 18-6-6 6-6" />
          </svg>
          All roles
        </button>
        <div className="dco">
          <div className="dco-logo">
            <Logo key={job.id} domain={job.domain} company={job.company} />
          </div>
          <div className="dco-main">
            <div className="dname">{job.company}</div>
            {job.sector && <div className="dsector">{job.sector}</div>}
          </div>
          {(site || job.linkedin) && (
            <div className="dco-links">
              {site && (
                <a className="dico" href={site} target="_blank" rel="noopener noreferrer" aria-label="Company website">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
                    <circle cx="12" cy="12" r="9" />
                    <path d="M3 9.5h18M3 14.5h18" />
                    <ellipse cx="12" cy="12" rx="4" ry="9" />
                  </svg>
                </a>
              )}
              {job.linkedin && (
                <a className="dico" href={job.linkedin} target="_blank" rel="noopener noreferrer" aria-label="LinkedIn">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                    <path d="M4.98 3.5C4.98 4.88 3.87 6 2.5 6S0 4.88 0 3.5 1.12 1 2.5 1s2.48 1.12 2.48 2.5zM.25 8h4.5v13H.25V8zm7 0h4.32v1.78h.06c.6-1.07 2.07-2.2 4.26-2.2 4.56 0 5.4 2.9 5.4 6.67V21h-4.5v-5.9c0-1.4-.03-3.2-2-3.2-2 0-2.3 1.53-2.3 3.1V21h-4.5V8z" />
                  </svg>
                </a>
              )}
            </div>
          )}
        </div>
        {job.description && <p className="ddesc">{job.description}</p>}
        {(stage || size || job.foundedYear) && (
          <div className="dcmeta">
            {stage && (
              <span className="dcm">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                  <path d="M3 17l6-6 4 4 7-7" />
                  <path d="M17 8h4v4" />
                </svg>
                {stage}
              </span>
            )}
            {size && (
              <span className="dcm">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" aria-hidden="true">
                  <circle cx="9" cy="8" r="3" />
                  <path d="M3.5 20c0-3 2.5-5 5.5-5s5.5 2 5.5 5" />
                  <path d="M16 5.5a3 3 0 0 1 0 5" />
                </svg>
                {size}
              </span>
            )}
            {job.foundedYear && (
              <span className="dcm">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                  <rect x="3" y="5" width="18" height="16" rx="2" />
                  <path d="M3 10h18M8 3v4M16 3v4" />
                </svg>
                {job.foundedYear}
              </span>
            )}
          </div>
        )}
        <div className="drole">
          <a className="rt" href={job.url} target="_blank" rel="noopener noreferrer">
            {job.title}
          </a>
          {roleFacts.length > 0 && (
            <div className="dgrid dg-inrole">
              {roleFacts.map(([k, v]) => (
                <div key={k} className="dg">
                  <span className="dg-k">{k}</span>
                  <span className="dg-v">{v}</span>
                </div>
              ))}
            </div>
          )}
        </div>
        {hasCv && (
          <div className="dhero">
            {job.score != null ? (
              <>
                <div className={heroClass(job.score)}>
                  <span className="hn num">{job.score.toFixed(1)}</span>
                  <span className="hx">/5</span>
                </div>
                <div className="dhl">
                  <div className="hlt">{fitLabel(job.score)}</div>
                  {bullets.length > 0 && <div className="hls">Why you fit</div>}
                </div>
              </>
            ) : (
              <div className="dhl">
                <div className="hlt">Scoring this role…</div>
                <div className="hls">Your fit lands in a moment.</div>
              </div>
            )}
          </div>
        )}
        {hasCv && bullets.length > 0 && (
          <ul className="dfit">
            {bullets.map((b, i) => (
              <li key={i}>{b}</li>
            ))}
          </ul>
        )}
        {!hasCv && (
          <div className="dfit-teaser">
            <div className="dfit-h">Why you're a match</div>
            <ul className="dfit blurred" aria-hidden="true">
              <li>Your background lines up with what this role needs.</li>
              <li>Your experience maps to their product and stage.</li>
              <li>Your level fits the scope of this role.</li>
            </ul>
          </div>
        )}
        {applied.has(job.id) ? (
          <button className="btn dcta applied-cta" disabled>
            ✓ Applied
          </button>
        ) : hasCv ? (
          <button className="btn dcta" onClick={() => goApply(job)}>
            Prepare application
          </button>
        ) : (
          <button className="btn dcta" onClick={onAddCv}>
            Add your CV to see your fit
          </button>
        )}
        {others.length > 0 && (
          <div>
            <div className="dmore-h">
              More {job.company} roles in Europe ({others.length})
            </div>
            <div className="dmore-list">
              {others.map((o) => (
                <div
                  key={o.id}
                  className="dmore-item"
                  role="button"
                  tabIndex={0}
                  onClick={() => onOpenDetail(o)}
                  onKeyDown={(e) => {
                    if (e.key !== "Enter" && e.key !== " ") return;
                    e.preventDefault();
                    onOpenDetail(o);
                  }}
                >
                  <span className="mi-role">{o.title}</span>
                  <span className="mi-city">{moreCity(o)}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  };

  return (
    <>
      <aside className="panel">{detailJob ? renderDetail(detailJob) : renderCards()}</aside>
      <button className="panel-toggle" onClick={onToggleHidden}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
          <path d="m9 6 6 6-6 6" />
        </svg>
      </button>
    </>
  );
}
