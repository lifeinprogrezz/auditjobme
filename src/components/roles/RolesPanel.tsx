// RolesPanel — the right-hand glass panel of /roles (v43 mockup: cards list,
// detail view, empty states, panel-toggle). All styling comes from
// src/styles/roles.css (.roles-theme scope); the PAGE ROOT owns the
// .scored / .detail-open / .panel-hidden state classes — this component only
// renders panel content and never touches body/root classes.
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  LEVELS,
  fitLabel,
  formatHeadcount,
  formatStage,
  hueFor,
  postedAgo,
  scoreBucket,
  websiteUrl,
  type RoleJob,
} from "@/lib/roles";
import { logoUrl, faviconUrls } from "@/lib/logodev";

// The pool is unbounded (1000+ live rows); each card mounts a Logo.dev <img>,
// so cap the DOM and point the user at search/filters for the tail.
const CARD_CAP = 200;

export type RolesPanelProps = {
  jobs: RoleJob[];
  allJobs: RoleJob[];
  scored: boolean;
  signedIn: boolean;
  loading: boolean;
  scoring: boolean;
  remaining: number;
  detailJob: RoleJob | null;
  /** The open role's full JD, lazy-fetched on detail open (null = none stored). */
  detailJd?: string | null;
  detailJdLoading?: boolean;
  applied: Set<string>;
  onOpenDetail: (j: RoleJob) => void;
  onCloseDetail: () => void;
  onScoreMore: () => void;
  onToggleHidden: () => void;
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
    if (was) {
      setDisplay(value); // score arrived post-reveal (background pass) — no animation
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
  scored,
  signedIn,
  loading,
  scoring,
  remaining,
  detailJob,
  detailJd,
  detailJdLoading,
  applied,
  onOpenDetail,
  onCloseDetail,
  onScoreMore,
  onToggleHidden,
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

  const goApply = (j: RoleJob) => navigate("/apply?job=" + encodeURIComponent(j.url));
  // Unscored hero + CTA mirror the nav's "Add your CV": profile if signed in, else home → sign-in.
  const onAddCv = () => navigate(signedIn ? "/profile" : "/");

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
      <h1 className="ptitle">Your matches</h1>
      {(selCo || selCity) && (
        <div className="selhdr">
          {selCo && (
            <button className="selchip" onClick={onClearCo} aria-label={`Remove ${selCo} filter`}>
              <b>{selCo}</b>
              <span className="x">×</span>
            </button>
          )}
          {selCity && (
            <button className="selchip" onClick={onClearCity} aria-label={`Remove ${selCity} filter`}>
              {selCity}
              <span className="x">×</span>
            </button>
          )}
          <span className="selcount">{jobs.length}</span>
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
          {jobs.slice(0, CARD_CAP).map((job, i) => {
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
          {jobs.length > CARD_CAP && (
            <div className="scorebar">
              Showing the top {CARD_CAP} of {jobs.length} roles. Narrow with search or filters.
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
    // Company facts (stage / size / founded) vs role facts (location / level /
    // remote / posted) — labeled key-value cells in a 2-col grid, no separators.
    const companyFacts: [string, string][] = [];
    const stage = formatStage(job.stage);
    if (stage) companyFacts.push(["Stage", stage]);
    const size = formatHeadcount(job.headcount);
    if (size) companyFacts.push(["Size", size]);
    if (job.foundedYear) companyFacts.push(["Founded", String(job.foundedYear)]);
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
        {companyFacts.length > 0 && (
          <div className="dgrid">
            {companyFacts.map(([k, v]) => (
              <div key={k} className="dg">
                <span className="dg-k">{k}</span>
                <span className="dg-v">{v}</span>
              </div>
            ))}
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
        {hasCv ? (
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
        ) : (
          <div
            className="dhero unlock"
            role="button"
            tabIndex={0}
            onClick={onAddCv}
            onKeyDown={(e) => {
              if (e.key !== "Enter" && e.key !== " ") return;
              e.preventDefault();
              onAddCv();
            }}
          >
            <div className="dlock">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <rect x="4" y="11" width="16" height="10" rx="2" />
                <path d="M8 11V8a4 4 0 0 1 8 0v3" />
              </svg>
            </div>
            <div className="dhl">
              <div className="hlt">Unlock your fit</div>
              <div className="hls">Add your CV to see your fit.</div>
            </div>
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
          <div className="dfit-lock">
            <ul className="dfit blurred" aria-hidden="true">
              <li>Your background lines up with what this role needs.</li>
              <li>Your experience maps to their product and stage.</li>
              <li>Your level fits the scope of this role.</li>
            </ul>
            <button className="dfl-cta" onClick={onAddCv}>
              Add your CV to unlock why you fit
            </button>
          </div>
        )}
        {applied.has(job.id) ? (
          <button className="btn dcta applied-cta" disabled>
            ✓ Applied
          </button>
        ) : hasCv ? (
          <button className="btn g dcta" onClick={() => goApply(job)}>
            Prepare application
          </button>
        ) : (
          <button className="btn g dcta" onClick={onAddCv}>
            Add your CV
          </button>
        )}
        {(detailJdLoading || detailJd) && (
          <details className="djd">
            <summary className="djd-sum">
              Full description
              <svg className="djd-caret" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden="true">
                <path d="m6 9 6 6 6-6" />
              </svg>
            </summary>
            {detailJdLoading ? (
              <div className="djd-note">Loading description…</div>
            ) : (
              <p className="djd-body">{detailJd}</p>
            )}
          </details>
        )}
        <div>
          <div className="dmore-h">
            {others.length
              ? `More ${job.company} roles in Europe (${others.length})`
              : `Only role from ${job.company} right now`}
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
