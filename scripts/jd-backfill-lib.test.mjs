// JD backfill pure-logic tests (issue #143). No network, no DB.
// Run: node --test scripts/jd-backfill-lib.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  BACKFILL_LIMIT,
  JD_CAP,
  atsKindOf,
  cap,
  extractAshby,
  extractGreenhouse,
  extractJsonLd,
  extractLever,
  extractPersonio,
  extractRecruitee,
  extractSmartRecruiters,
  extractWorkable,
  greenhouseRef,
  isReadableJd,
  leverRef,
  newTally,
  personioRef,
  recruiteeRef,
  shouldFollow,
  smartRecruitersRef,
  summaryLine,
} from "./jd-backfill-lib.mjs";

test("the per-run cap is bounded and stated", () => {
  assert.equal(BACKFILL_LIMIT, 300);
});

test("cap trims to JD_CAP and never returns an empty string", () => {
  assert.equal(cap(""), null);
  assert.equal(cap(null), null);
  assert.equal(cap("x".repeat(JD_CAP + 10)).length, JD_CAP);
});

test("isReadableJd mirrors the scorer's rule: blank is not readable", () => {
  assert.equal(isReadableJd("A real description"), true);
  assert.equal(isReadableJd("   \n"), false);
  assert.equal(isReadableJd(null), false);
});

test("atsKindOf routes by host and refuses unknown sites", () => {
  assert.equal(atsKindOf("https://boards.greenhouse.io/acme/jobs/123"), "greenhouse");
  assert.equal(atsKindOf("https://jobs.lever.co/acme/abc"), "lever");
  assert.equal(atsKindOf("https://jobs.ashbyhq.com/acme/uuid"), "ashby");
  assert.equal(atsKindOf("https://jobs.smartrecruiters.com/Acme/743999-pm"), "smartrecruiters");
  assert.equal(atsKindOf("https://apply.workable.com/acme/j/ABC123/"), "workable");
  assert.equal(atsKindOf("https://acme.recruitee.com/o/pm"), "recruitee");
  assert.equal(atsKindOf("https://acme.jobs.personio.de/job/42"), "personio");
  assert.equal(atsKindOf("https://acme.wd3.myworkdayjobs.com/en-US/x/job/PM_1"), "workday");
  // Never generic HTML from an unknown site: startupmap, a company site, junk.
  assert.equal(atsKindOf("https://startupmap.one/jobs/123"), null);
  assert.equal(atsKindOf("https://acme.com/careers/pm"), null);
  assert.equal(atsKindOf("not a url"), null);
  // Host match is anchored: a lookalike domain does not route.
  assert.equal(atsKindOf("https://greenhouse.io.evil.com/x"), null);
});

test("only board sources may follow their apply URL once", () => {
  assert.equal(shouldFollow("startupmap"), true);
  assert.equal(shouldFollow("scaling-europe"), true);
  assert.equal(shouldFollow("vc:getro:atomico"), true);
  assert.equal(shouldFollow("vc:balderton"), true);
  assert.equal(shouldFollow("smartrecruiters"), false);
  assert.equal(shouldFollow("meta"), false);
  assert.equal(shouldFollow(null), false);
});

test("posting references parse from each ATS URL shape", () => {
  assert.deepEqual(greenhouseRef("https://boards.greenhouse.io/acme/jobs/4001?gh_src=x"), { token: "acme", id: "4001" });
  assert.deepEqual(greenhouseRef("https://boards.greenhouse.io/embed/job_app?for=acme&token=4001"), { token: "acme", id: "4001" });
  assert.equal(greenhouseRef("https://boards.greenhouse.io/acme"), null);
  assert.deepEqual(leverRef("https://jobs.lever.co/acme/1a2b-3c4d?lever-origin=applied"), { token: "acme", id: "1a2b-3c4d" });
  assert.deepEqual(smartRecruitersRef("https://jobs.smartrecruiters.com/Acme/743999-product-manager"), { company: "Acme", id: "743999" });
  assert.deepEqual(
    smartRecruitersRef("https://careers.smartrecruiters.com/Acme/0f1e2d3c-4b5a-6789-abcd-ef0123456789-pm"),
    { company: "Acme", id: "0f1e2d3c-4b5a-6789-abcd-ef0123456789" },
  );
  assert.equal(smartRecruitersRef("https://jobs.smartrecruiters.com/Acme"), null);
  assert.deepEqual(recruiteeRef("https://acme.recruitee.com/o/product-manager-berlin"), { company: "acme", slug: "product-manager-berlin" });
  assert.deepEqual(personioRef("https://acme.jobs.personio.de/job/1234567?language=en"), { origin: "https://acme.jobs.personio.de", id: "1234567" });
  assert.equal(personioRef("https://acme.jobs.personio.de/"), null);
});

test("extractors turn each detail payload into stripped text", () => {
  assert.equal(extractGreenhouse({ content: "<p>Build &amp; ship</p>" }), "Build ship");
  assert.equal(extractGreenhouse({}), null);
  assert.equal(extractLever({ descriptionPlain: "Plain wins", description: "<b>html</b>" }), "Plain wins");
  assert.equal(extractLever({ description: "<b>html only</b>" }), "html only");
  assert.equal(extractLever(null), null);
  const board = { jobs: [{ id: "u1", descriptionHtml: "<p>One</p>" }, { id: "u2", jobUrl: "https://jobs.ashbyhq.com/acme/u2", descriptionPlain: "Two" }] };
  assert.equal(extractAshby(board, "u2"), "Two");
  assert.equal(extractAshby(board, "nope"), null);
  assert.equal(
    extractSmartRecruiters({ jobAd: { sections: { jobDescription: { text: "<p>Do X</p>" }, qualifications: { text: "Need Y" } } } }),
    "Do X Need Y",
  );
  assert.equal(extractSmartRecruiters({}), null);
  assert.equal(extractRecruitee({ offers: [{ slug: "pm-berlin", description: "<p>PM</p>" }] }, "pm-berlin-2"), "PM");
  assert.equal(extractRecruitee({ offers: [] }, "pm"), null);
});

test("personio: the matching <position> only, CDATA unwrapped", () => {
  const xml = `<workzag-jobs>
    <position><id>1</id><jobDescriptions><![CDATA[<p>Other</p>]]></jobDescriptions></position>
    <position><id>42</id><jobDescriptions><jobDescription><value><![CDATA[<p>Ours &amp; only</p>]]></value></jobDescription></jobDescriptions></position>
  </workzag-jobs>`;
  assert.equal(extractPersonio(xml, "42"), "Ours only");
  assert.equal(extractPersonio(xml, "7"), null);
  assert.equal(extractPersonio("<position><id>42</id></position>", "42"), null);
});

test("JSON-LD JobPosting.description: bare, array, and @graph shapes", () => {
  const wrap = (obj) => `<html><script type="application/ld+json">${JSON.stringify(obj)}</script></html>`;
  assert.equal(extractJsonLd(wrap({ "@type": "JobPosting", description: "<p>Bare</p>" })), "Bare");
  assert.equal(extractJsonLd(wrap([{ "@type": "Organization" }, { "@type": ["Thing", "JobPosting"], description: "Arr" }])), "Arr");
  assert.equal(extractJsonLd(wrap({ "@graph": [{ "@type": "JobPosting", description: "Graph" }] })), "Graph");
  assert.equal(extractJsonLd(wrap({ "@type": "Organization" })), null);
  assert.equal(extractJsonLd('<script type="application/ld+json">{not json</script>'), null);
  assert.equal(extractJsonLd(""), null);
});

test("workable: JSON-LD first, og:description second, else null", () => {
  const ld = `<script type="application/ld+json">{"@type":"JobPosting","description":"Full JD"}</script><meta property="og:description" content="Summary">`;
  assert.equal(extractWorkable(ld), "Full JD");
  assert.equal(extractWorkable(`<meta property="og:description" content="We&#39;re hiring &amp; growing">`), "We're hiring & growing");
  assert.equal(extractWorkable("<html></html>"), null);
});

test("summary line reports every counter, dry and live", () => {
  const t = newTally();
  t.selected = 5; t.attempted = 4; t.filled = 3; t.failed = 1; t.unsupported = 1; t.followed = 2;
  assert.equal(
    summaryLine(t, { dry: true, wrote: 0 }),
    "jd-backfill: selected 5 · attempted 4 · filled 3 · failed 1 · unsupported 1 · followed 2 · [dry-run] no writes",
  );
  assert.match(summaryLine(t, { dry: false, wrote: 3 }), / · wrote 3$/);
});
