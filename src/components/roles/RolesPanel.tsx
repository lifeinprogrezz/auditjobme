// RolesPanel — the right-hand glass panel of /roles (v43 mockup: cards list,
// detail view, empty states, panel-toggle). All styling comes from
// src/styles/roles.css (.roles-theme scope); the PAGE ROOT owns the
// .scored / .detail-open / .panel-hidden state classes — this component only
// renders panel content and never touches body/root classes.
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  EMPTY_FILTERS,
  FRESHNESS_WINDOWS,
  LEVELS,
  UK_SPONSOR_STATUSES,
  WORKPLACES,
  fitLabel,
  formatHeadcount,
  formatStage,
  geoVerdict,
  hueFor,
  postedAgo,
  websiteUrl,
  type RoleJob,
  type RolesFilters,
} from "@/lib/roles";
import { logoUrl, faviconUrls } from "@/lib/logodev";
import { scoreStatusOf } from "@/lib/scorePrefilter";
import { useTheme } from "@/lib/theme";
import { track } from "@/lib/analytics";
import ScoreBreakdown from "./ScoreBreakdown";
import FitChip from "./FitChip";

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
  /** Roles the paid scoring pass covers (#114). An unscored role outside this
   *  set will never score, so it must not claim to be scoring. */
  eligibleIds: Set<string>;
  detailJob: RoleJob | null;
  applied: Set<string>;
  saved: Set<string>;
  /** Roles the user said no to (issue #73 slice 4) — drives the detail's toggle. */
  dismissed: Set<string>;
  /** Dismiss / restore this role. */
  onToggleDismissed: (job: RoleJob) => void;
  onOpenDetail: (j: RoleJob) => void;
  onCloseDetail: () => void;
  onScoreMore: () => void;
  /** Save / unsave the role for later (Rober 7-15). */
  onToggleSaved: (job: RoleJob) => void;
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
 *  of logo.dev's generic pinwheel placeholder (the TravelPerk case). The logo.dev
 *  theme follows the ACTIVE app theme (design direction §5.5 / skill Logo.dev rule):
 *  dark card → theme=dark (light marks), light card → theme=light (dark marks) — a
 *  hardcoded param breaks on theme switch (the broken-logos bug, both directions). */
function Logo({ domain, company }: { domain: string | null; company: string }) {
  const { theme } = useTheme();
  const chain = domain
    ? [logoUrl(domain, theme === "dark" ? "dark" : "light"), ...faviconUrls(domain)].filter(Boolean)
    : [];
  const [stage, setStage] = useState(0);
  // Rewind the fallback chain on a theme flip so the new theme's logo is retried
  // (banked D3 nit 5a): a themed logo that 404'd once must get another shot at its
  // NEW theme variant instead of staying stuck on a favicon/initial after a switch.
  useEffect(() => setStage(0), [theme]);
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
  eligibleIds,
  detailJob,
  applied,
  saved,
  dismissed,
  onToggleDismissed,
  onOpenDetail,
  onCloseDetail,
  onScoreMore,
  onToggleSaved,
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

  // "Prepare application" routes into the apply bundle (issue #42); RequireAuth on
  // /apply handles the signed-out case. "Add your CV" opens the Phase-A CV-unlock
  // modal (onAddCv, from RolesMap).
  const goApply = (j: RoleJob) => navigate(`/apply?job=${encodeURIComponent(j.url)}`);

  // Every "open this role" path in the panel (a card click, Enter on a focused
  // card, or a "more roles" item) routes through here, so the event fires once
  // per open regardless of which affordance triggered it (issue #89). `scored`
  // mirrors `hasCv` below — whether this user's CV has been scored yet.
  const openDetail = (j: RoleJob) => {
    track("role_detail_opened", { scored, score: j.score ?? null });
    onOpenDetail(j);
  };

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
    ...(filters.workplaces ?? []).map((v) => ({
      key: `wp-${v}`,
      label: WORKPLACES.find((w) => w.value === v)?.label ?? v,
      onX: () => onFilters({ ...filters, workplaces: (filters.workplaces ?? []).filter((x) => x !== v) }),
    })),
    ...(filters.freshness ?? []).map((v) => ({
      key: `fr-${v}`,
      label: FRESHNESS_WINDOWS.find((w) => w.value === v)?.label ?? v,
      onX: () => onFilters({ ...filters, freshness: (filters.freshness ?? []).filter((x) => x !== v) }),
    })),
    ...(filters.sponsors ?? []).map((v) => ({
      key: `sp-${v}`,
      label: UK_SPONSOR_STATUSES.find((st) => st.value === v)?.label ?? v,
      onX: () => onFilters({ ...filters, sponsors: (filters.sponsors ?? []).filter((x) => x !== v) }),
    })),
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
  // Local-narrow mode only under a STRUCTURAL narrowing (company/city/facet chips).
  // The query chip alone must NOT flip the mode: in global mode the panel box edits
  // filters.query itself, and counting it here would remount the binding on the
  // first keystroke (value snaps from "stri" to ""), killing the search mid-word.
  const listContext = activeChips.some((c) => c.key !== "q");
  // Removing the last structural chip mid-narrow must DROP the local query with it
  // (review 7-25): panelQ only resets on map-selection change, so without this the
  // box rebinds to filters.query and renders empty while the stale panelQ keeps
  // filtering invisibly — an empty search box over a mysteriously narrowed list.
  useEffect(() => {
    if (!listContext) setPanelQ("");
  }, [listContext]);
  const shown = (() => {
    // Belt to the effect's suspenders: the local narrow can never apply outside
    // local mode, even for the one render before the reset effect runs.
    const q = listContext ? panelQ.trim().toLowerCase() : "";
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
      {/* One compact header row: title left, the scoring progress as a quiet mono
          whisper right — no separate banner bar (Rober 7-16). */}
      <div className="phead">
        <h1 className="ptitle">{defaultView ? (scored ? "Best fit" : "Hot right now") : "Your matches"}</h1>
        {scoring && (
          <span className="pprog num" role="status" aria-live="polite">
            {remaining} to go
          </span>
        )}
      </div>
      {activeChips.length > 0 && (
        <div className="selhdr">
          <div className="selchips">
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
          </div>
          <div className="selmeta">
            <span className="selcount">{shown.length} roles</span>
            {activeChips.length > 1 && (
              <button className="selclear" onClick={clearAllFilters}>
                Clear all
              </button>
            )}
          </div>
        </div>
      )}
      {/* Two modes, one box. Chip-narrowed list → the LOCAL narrow (unchanged).
          No chips (incl. the anon showcase) → the box edits the GLOBAL search:
          the showcase logos prime "type your favourite company" (Rober 7-25), and
          typing must surface that company's roles, not filter 7 curated cards.
          The box stays mounted while a global query empties the list, or the
          second keystroke would have nowhere to land. */}
      {(listContext ? jobs.length > 0 : true) && (
        <div className="psearch">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
            <circle cx="11" cy="11" r="7" />
            <path d="m21 21-4.3-4.3" />
          </svg>
          <input
            ref={panelSearchRef}
            type="text"
            aria-label={listContext ? "Search this list" : "Search all roles and companies"}
            placeholder={
              listContext
                ? searchTarget
                  ? `Search in ${searchTarget}`
                  : "Search these roles"
                : "Search any company or role"
            }
            value={listContext ? panelQ : filters.query}
            onChange={(e) =>
              listContext ? setPanelQ(e.target.value) : onFilters({ ...filters, query: e.target.value })
            }
          />
          {(listContext ? panelQ : filters.query) && (
            <button
              type="button"
              className="psearch-x"
              aria-label="Clear search"
              onClick={() => {
                if (listContext) setPanelQ("");
                else onFilters({ ...filters, query: "" });
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
            // Geo / work-auth badge (issue #42): only a high-confidence, actionable
            // verdict shows on the card; an unstated JD renders nothing (never a guess).
            const geo = geoVerdict(job);
            const open = (e: React.SyntheticEvent) => {
              if ((e.target as HTMLElement).closest(".acts")) return;
              openDetail(job);
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
                  {/* Card meta = location (+ geo badge) only; posted-age lives in the
                      detail facts, the card was carrying too much (Rober 7-16). */}
                  <div className="meta">
                    <b>{job.city ?? job.location ?? (job.remote ? "Remote" : "Location unknown")}</b>
                    {geo.onCard && <span className={`geo-badge geo-${geo.kind}`}>{geo.label}</span>}
                  </div>
                </div>
                {/* FitChip is the single score render; CSS hides it pre-CV
                    (.roles-theme:not(.scored) .card .fitchip). `reveal` counts
                    the numeral up when the score-reveal flips scored on. */}
                <FitChip score={job.score} size="md" reveal={scored} />
                {scored && job.reason && <div className="why">{job.reason}</div>}
                {scored && (
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
                )}
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
    // JD-extracted role facts (Rober 7-09): YoE enriches the Level cell in-parens;
    // comp + visa-sponsorship ride as their own data labels. Each shows ONLY when the
    // extraction carries the value — a silent JD just omits the label (fail-open).
    const ex = job.extraction ?? null;
    const yoe = ex?.yoe_min;
    const levelLabel = level
      ? yoe != null
        ? `${level} (${yoe}+ yrs)`
        : level
      : yoe != null
        ? `${yoe}+ yrs`
        : null;
    let comp: string | null = null;
    if (ex?.salary_min != null) {
      const sym = ex.salary_currency === "GBP" ? "£" : ex.salary_currency === "USD" ? "$" : "€";
      const k = (n: number) => (n >= 1000 ? `${Math.round(n / 1000)}k` : `${n}`);
      comp = `${sym}${k(ex.salary_min)}${ex.salary_max != null ? `–${k(ex.salary_max)}` : ""}`;
    }
    const roleFacts: [string, string][] = [];
    const loc = job.city ?? job.location;
    if (loc) roleFacts.push(["Location", loc]);
    if (levelLabel) roleFacts.push(["Level", levelLabel]);
    if (job.remote) roleFacts.push(["Remote", "Yes"]);
    if (ago) roleFacts.push(["Posted", ago]);
    if (comp) roleFacts.push(["Comp", comp]);
    // Work-eligibility cell (issue #42): ALWAYS shown, so an ambiguous /
    // login-walled JD never silently omits it and never shows a wrong verdict
    // (geoVerdict's safety property). When the verdict is unverified but the JD
    // DID state something (e.g. "Canada only" — real, just not classifiable),
    // show the raw statement rather than a false "Not stated" (#54 honesty fix);
    // "Not stated" is reserved for a genuinely silent JD.
    const geo = geoVerdict(job);
    const geoRaw = job.extraction?.geo_eligibility?.trim();
    roleFacts.push([
      "Work eligibility",
      geo.kind === "unverified" ? (geoRaw ? `"${geoRaw.length > 70 ? `${geoRaw.slice(0, 67)}…` : geoRaw}"` : "Not stated") : geo.label,
    ]);
    const others = allJobs.filter((j) => j.company === job.company && j.url !== job.url);
    // Hero: a CV holder sees their fit (or a pending state); everyone else sees the
    // unlock prompt — the pre-CV conversion moment (absorbs issue #18).
    const hasCv = scored;
    // The detail leads with the honest one-line summary (job.reason), not the
    // positive-only fit_bullets — a Weak-fit label must never sit above "why you fit"
    // points (Rober 7-15). The signed evidence in ScoreBreakdown carries the specifics.
    // Fall back to the first fit bullet only when the model left reason empty, so a
    // scored role never renders with no fit text at all.
    const summary = job.reason?.trim() || job.fitBullets?.[0]?.trim() || null;

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
        {(stage || size || job.foundedYear || job.ukSponsorStatus === "licensed") && (
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
            {/* Company-level (Home Office register): this company holds a UK Skilled-Worker
                sponsor licence. Distinct from the role-level "Visa: Sponsors" JD fact above. */}
            {job.ukSponsorStatus === "licensed" && (
              <span className="dcm">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" aria-hidden="true">
                  <path d="M12 3l7 3v5c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6l7-3z" />
                  <path d="m9 12 2 2 4-4" />
                </svg>
                Licensed UK sponsor
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
                <FitChip score={job.score} size="lg" />
                <div className="dhl">
                  <div className="hlt">{fitLabel(job.score)}</div>
                </div>
              </>
            ) : scoreStatusOf(job.score, eligibleIds.has(job.id)) === "scoring" ? (
              <>
                <FitChip score={null} size="lg" />
                <div className="dhl">
                  <div className="hlt">Scoring this role…</div>
                  <div className="hls">Your fit lands in a moment.</div>
                </div>
              </>
            ) : (
              // Outside the paid slice (#114): it matches no target you picked, or
              // sits past the freshest-first cut. Saying "scoring" here would never
              // come true, so name the real state and point at the one control.
              <>
                <FitChip score={null} size="lg" pendingLabel="Not scored" />
                <div className="dhl">
                  <div className="hlt">Not scored</div>
                  <div className="hls">We score your newest matching roles first. Widen your targets in Settings to include this one.</div>
                </div>
              </>
            )}
          </div>
        )}
        {hasCv && summary && <p className="dsum">{summary}</p>}
        {hasCv && job.score != null && (
          // key on the job id so switching roles remounts it collapsed (the toggle
          // state must not carry over from the previous role — Rober 7-15 review).
          <ScoreBreakdown key={job.id} subscores={job.subscores} evidence={job.evidence} />
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
        {signedIn && (
          // Save and Not-interested share ONE secondary row: the same .dsave token,
          // side by side, so saying no is as easy as saying maybe (issue #73 slice 4).
          <div className="dacts">
            <button
              type="button"
              className="dsave"
              aria-pressed={saved.has(job.id)}
              onClick={() => {
                // Fire only on the save transition, never on unsave (issue #89).
                if (!saved.has(job.id)) track("role_saved");
                onToggleSaved(job);
              }}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill={saved.has(job.id) ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
                <path d="M6 3h12a1 1 0 0 1 1 1v17l-7-4-7 4V4a1 1 0 0 1 1-1z" />
              </svg>
              {saved.has(job.id) ? "Saved for later" : "Save for later"}
            </button>
            <button
              type="button"
              className="dsave"
              aria-pressed={dismissed.has(job.id)}
              onClick={() => onToggleDismissed(job)}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden="true">
                <path d="M18 6 6 18M6 6l12 12" />
              </svg>
              {dismissed.has(job.id) ? "Dismissed" : "Not interested"}
            </button>
          </div>
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
                  onClick={() => openDetail(o)}
                  onKeyDown={(e) => {
                    if (e.key !== "Enter" && e.key !== " ") return;
                    e.preventDefault();
                    openDetail(o);
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
