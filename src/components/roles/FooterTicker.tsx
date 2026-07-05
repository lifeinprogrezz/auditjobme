// FooterTicker — the freshest roles as an auto-scrolling marquee along the map
// footer (startupmap has sponsor cards there; ours carries real product data —
// the page's liveness signal). Click opens the role's detail in the panel.
import { useMemo, useState } from "react";
import { hueFor, postedAgo, type RoleJob } from "@/lib/roles";
import { logoUrl } from "@/lib/logodev";

export type FooterTickerProps = {
  jobs: RoleJob[];
  onOpen: (j: RoleJob) => void;
};

const TICKER_COUNT = 14;

function TickerLogo({ job }: { job: RoleJob }) {
  // The logo tile is a white disc in both identities -> light-theme marks.
  const src = job.domain ? logoUrl(job.domain, "light") : null;
  const [failed, setFailed] = useState(false);
  if (!src || failed) {
    return (
      <span className="fb" style={{ background: hueFor(job.company) }}>
        {job.company.charAt(0)}
      </span>
    );
  }
  return <img src={src} alt="" onError={() => setFailed(true)} />;
}

export default function FooterTicker({ jobs, onOpen }: FooterTickerProps) {
  const freshest = useMemo(
    () =>
      jobs
        .filter((j) => j.posted_at)
        .sort((a, b) => Date.parse(b.posted_at as string) - Date.parse(a.posted_at as string))
        .slice(0, TICKER_COUNT),
    [jobs],
  );
  if (freshest.length < 4) return null;

  const cards = (suffix: string) =>
    freshest.map((j) => {
      const ago = postedAgo(j.posted_at);
      return (
        <div key={j.id + suffix} className="tcard" onClick={() => onOpen(j)}>
          <span className="tlogo">
            <TickerLogo job={j} />
          </span>
          <span className="tco">{j.company}</span>
          <span className="trole">{j.title}</span>
          <span className="tmeta">
            {j.city ?? j.location ?? ""}
            {ago ? ` · ${ago}` : ""}
          </span>
        </div>
      );
    });

  return (
    <div className="ticker" aria-label="Freshest roles">
      {/* content duplicated once: the track animates -50% for a seamless loop */}
      <div className="ticker-track">
        {cards("a")}
        {cards("b")}
      </div>
    </div>
  );
}
