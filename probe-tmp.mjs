import { chromium } from "playwright";
const BASE = process.argv[2];
const b = await chromium.launch({ channel: "chromium" });
const p = await b.newPage();
for (const path of ["/", "/terms", "/privacy", "/nonexistent-route-xyz"]) {
  const r = await p.goto(BASE + path, { waitUntil: "networkidle", timeout: 25000 });
  await p.waitForTimeout(800);
  const txt = (await p.innerText("body")).replace(/\s+/g, " ").slice(0, 260);
  console.log(`\n== ${path} -> ${r?.status()} | url=${p.url()}`);
  console.log(`   title: ${await p.title()}`);
  console.log(`   text: ${txt}`);
}
await b.close();
