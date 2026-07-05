// RolesPanel — the right-hand glass panel of /roles (v43 mockup: cards list,
// detail view, empty states, panel-toggle). All styling comes from
// src/styles/roles.css (.roles-theme scope); the PAGE ROOT owns the
// .scored / .detail-open / .panel-hidden state classes — this component only
// renders panel content and never touches body/root classes.
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { LEVELS, hueFor, postedAgo, scoreBucket, type RoleJob } from "@/lib/roles";
import { logoUrl } from "@/lib/logodev";

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
  applied: Set<string>;
  onOpenDetail: (j: RoleJob) => void;
  onCloseDetail: () => void;
  onMarkApplied: (j: RoleJob) => void;
  onScoreMore: () => void;
  onToggleHidden: () => void;
};

/** Logo.dev image with colored-initial fallback (never a favicon service). */
function Logo({ domain, company }: { domain: string | null; company: string }) {
  const src = domain ? logoUrl(domain) : null;
  const [failed, setFailed] = useState(false);
  if (!src || failed) {
    return (
      <span className="fb" style={{ background: hueFor(company) }}>
        {company.charAt(0)}
      </span>
    );
  }
  return <img src={src} alt="" onError={() => setFailed(true)} />;
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

function dscoreClass(score: number): string {
  const b = scoreBucket(score);
  return b === "great" ? "dscore" : `dscore s-${b}`;
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
  applied,
  onOpenDetail,
  onCloseDetail,
  onMarkApplied,
  onScoreMore,
  onToggleHidden,
}: RolesPanelProps) {
  const navigate = useNavigate();
  const detailRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (detailJob) detailRef.current?.scrollTo(0, 0);
  }, [detailJob]);

  const goAudit = (j: RoleJob) => navigate("/audit?job=" + encodeURIComponent(j.url));
  const goApply = (j: RoleJob) => navigate("/apply?job=" + encodeURIComponent(j.url));

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
      {scoring && (
        <div className="scorebar">Scoring roles against your profile… {remaining} to go</div>
      )}
      {loading ? (
        <div className="panel-note">Loading roles…</div>
      ) : jobs.length === 0 ? (
        <div className="panel-note">
          <b>No roles match</b>
          Try clearing filters.
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
                    className="btn p"
                    onClick={(e) => {
                      e.stopPropagation();
                      goAudit(job);
                    }}
                  >
                    Audit this company
                  </button>
                  <button
                    className="btn g"
                    onClick={(e) => {
                      e.stopPropagation();
                      goApply(job);
                    }}
                  >
                    Prep application
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
    const hue = hueFor(job.company);
    const ago = postedAgo(job.posted_at);
    const facts: [string, string][] = [];
    const loc = job.city ?? job.location;
    if (loc) facts.push(["Location", loc]);
    const level = LEVELS.find((l) => l.value === job.seniority)?.label;
    if (level) facts.push(["Level", level]);
    if (job.remote) facts.push(["Remote", "Yes"]);
    if (job.source) facts.push(["Source", job.source]);
    if (ago) facts.push(["Posted", ago]);
    const others = allJobs.filter((j) => j.company === job.company && j.url !== job.url);

    return (
      <div className="detail" ref={detailRef}>
        <button className="dback" onClick={onCloseDetail}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4">
            <path d="m15 18-6-6 6-6" />
          </svg>
          All roles
        </button>
        <div className="dbanner">
          <div
            className="dbanner-img"
            style={{
              backgroundImage: `linear-gradient(135deg, ${hue}55, ${hue}11 60%, transparent)`,
              backgroundColor: "var(--surface-2)",
            }}
          />
          <div className="dbanner-scrim" />
          <div className="dhead">
            <div className="dlogo">
              <Logo key={job.id} domain={job.domain} company={job.company} />
            </div>
            <div>
              <div className="dname">{job.company}</div>
              <div className="dhiring">● Actively hiring</div>
            </div>
          </div>
        </div>
        <div className="dfacts">
          {facts.map(([label, value]) => (
            <span key={label} className="dfact">
              {label} <b>{value}</b>
            </span>
          ))}
        </div>
        <div className="drole">
          {scored && job.score != null && (
            <div className={dscoreClass(job.score)}>{job.score.toFixed(1)}</div>
          )}
          <div className="rt">{job.title}</div>
          <div className="rm">
            <b>{job.city ?? job.location ?? "—"}</b>
            {ago && (
              <>
                <span className="d" />
                {ago}
              </>
            )}
          </div>
          {scored && job.reason && <div className="dwhy">{job.reason}</div>}
        </div>
        <div className="dacts">
          <button className="btn p" onClick={() => goAudit(job)}>
            Audit this company
          </button>
          <button className="btn g" onClick={() => goApply(job)}>
            Prep application
          </button>
          <button className="btn g" onClick={() => window.open(job.url, "_blank", "noopener")}>
            View posting
          </button>
          {applied.has(job.id) ? (
            <button className="btn applied" disabled>
              ✓ Applied
            </button>
          ) : (
            <button className="btn g" onClick={() => onMarkApplied(job)}>
              Mark applied
            </button>
          )}
        </div>
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
                <span className="mi-city">{o.city ?? o.location ?? ""}</span>
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
