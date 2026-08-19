#!/usr/bin/env node
/**
 * Rasterize the brand assets from public/favicon.svg (issue #107).
 *
 * The SVG is the ONLY source. Every binary in public/ is derived here and can
 * be rebuilt byte-for-byte, so a mark change is one file edit plus one command
 * instead of a pile of hand-exported images nobody can regenerate.
 *
 *   node scripts/generate-icons.mjs
 *
 * Writes: favicon-16.png · favicon-32.png · favicon.ico (16/32/48) ·
 *         apple-touch-icon.png (180) · icon-192.png · icon-512.png · og.jpg
 *
 * Tab icons are the ink mark on transparency. App icons and the social image
 * sit on the ink ground with the pale mark, because iOS and Android composite
 * a transparent icon onto black and Open Graph readers onto white.
 */
import { chromium } from "@playwright/test";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PUB = resolve(ROOT, "public");

// The two brand grounds, from BRAND.md / src/styles/roles.css.
const INK = "#0b1f26";
const PALE = "#eaf2f3";

/** The mark's geometry, lifted from the SVG so this script cannot drift from it. */
function markPaths() {
  const svg = readFileSync(resolve(PUB, "favicon.svg"), "utf8");
  const ds = [...svg.matchAll(/\sd="([^"]+)"/g)].map((m) => m[1]);
  if (ds.length !== 2) {
    throw new Error(`favicon.svg should hold exactly 2 paths, found ${ds.length}`);
  }
  return { north: ds[0], south: ds[1] };
}

/** One mark, at one color, scaled to fill a box of `size` with `pad` breathing room. */
function markSvg({ north, south }, size, color, pad = 0) {
  const inner = size - pad * 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${inner}" height="${inner}" viewBox="0 0 64 64" fill="none" style="display:block">
    <path d="${north}" fill="${color}"/>
    <path d="${south}" fill="none" stroke="${color}" stroke-width="3.4" stroke-linejoin="round"/>
  </svg>`;
}

function page(bodyStyle, inner) {
  return `<!doctype html><html><head><meta charset="utf-8">
    <style>
      *{margin:0;padding:0;box-sizing:border-box}
      html,body{width:100%;height:100%}
      body{display:flex;align-items:center;justify-content:center;${bodyStyle}}
    </style></head><body>${inner}</body></html>`;
}

/** ICO with embedded PNGs. Supported by every browser still worth a .ico. */
function buildIco(pngs) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // 1 = icon
  header.writeUInt16LE(pngs.length, 4);

  let offset = 6 + pngs.length * 16;
  const dir = [];
  for (const { size, data } of pngs) {
    const e = Buffer.alloc(16);
    e.writeUInt8(size >= 256 ? 0 : size, 0); // 0 means 256
    e.writeUInt8(size >= 256 ? 0 : size, 1);
    e.writeUInt8(0, 2); // palette
    e.writeUInt8(0, 3); // reserved
    e.writeUInt16LE(1, 4); // planes
    e.writeUInt16LE(32, 6); // bits per pixel
    e.writeUInt32LE(data.length, 8);
    e.writeUInt32LE(offset, 12);
    offset += data.length;
    dir.push(e);
  }
  return Buffer.concat([header, ...dir, ...pngs.map((p) => p.data)]);
}

const OG_W = 1200;
const OG_H = 630;

/** The social card: the lockup on the ink ground over a faint graticule, which
 *  is the same globe geometry the product's landing map is made of. */
function ogHtml(paths) {
  const lines = [];
  for (let i = 1; i < 8; i++) {
    lines.push(`<div class="mer" style="left:${(i / 8) * 100}%"></div>`);
  }
  for (let i = 1; i < 5; i++) {
    lines.push(`<div class="par" style="top:${(i / 5) * 100}%"></div>`);
  }
  return `<!doctype html><html><head><meta charset="utf-8">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;600&display=swap">
  <style>
    *{margin:0;padding:0;box-sizing:border-box}
    body{width:${OG_W}px;height:${OG_H}px;background:${INK};position:relative;overflow:hidden;
         font-family:"Space Grotesk",system-ui,sans-serif;color:${PALE}}
    .grat{position:absolute;inset:0}
    .mer,.par{position:absolute;background:rgba(234,242,243,.055)}
    .mer{top:0;bottom:0;width:1px}
    .par{left:0;right:0;height:1px}
    .halo{position:absolute;left:50%;top:50%;width:760px;height:760px;transform:translate(-50%,-50%);
          border-radius:50%;border:1px solid rgba(234,242,243,.07)}
    .in{position:relative;padding:0 96px;display:flex;flex-direction:column;justify-content:center;height:100%;gap:26px}
    .lock{display:flex;align-items:center;gap:26px}
    .name{font-size:74px;font-weight:600;letter-spacing:-.035em;line-height:1}
    .tag{font-size:33px;font-weight:400;line-height:1.34;max-width:19ch;color:#9db1b8}
    .tag b{color:${PALE};font-weight:600}
  </style></head><body>
  <div class="grat">${lines.join("")}<div class="halo"></div></div>
  <div class="in">
    <div class="lock">${markSvg(paths, 92, PALE)}<span class="name">northgoing</span></div>
    <p class="tag">The live map of tech jobs in Europe, <b>scored against your CV</b>.</p>
  </div></body></html>`;
}

async function main() {
  const paths = markPaths();
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ deviceScaleFactor: 1 });
  const p = await ctx.newPage();

  /** Screenshot one square at exactly `size`, transparent unless a ground is given. */
  async function square(size, { ground = null, color = INK, pad = 0 } = {}) {
    await p.setViewportSize({ width: size, height: size });
    await p.setContent(
      page(ground ? `background:${ground}` : "background:transparent", markSvg(paths, size, color, pad)),
    );
    return p.screenshot({ omitBackground: !ground, type: "png" });
  }

  // Tab icons: ink mark, transparent ground, no padding (a favicon needs every pixel).
  const png16 = await square(16);
  const png32 = await square(32);
  const png48 = await square(48);
  writeFileSync(resolve(PUB, "favicon-16.png"), png16);
  writeFileSync(resolve(PUB, "favicon-32.png"), png32);
  writeFileSync(resolve(PUB, "favicon.ico"), buildIco([
    { size: 16, data: png16 },
    { size: 32, data: png32 },
    { size: 48, data: png48 },
  ]));

  // App icons: pale mark on the ink ground, inset so the OS mask never clips it.
  for (const [size, name] of [[180, "apple-touch-icon.png"], [192, "icon-192.png"], [512, "icon-512.png"]]) {
    writeFileSync(
      resolve(PUB, name),
      await square(size, { ground: INK, color: PALE, pad: Math.round(size * 0.22) }),
    );
  }

  // Social card.
  await p.setViewportSize({ width: OG_W, height: OG_H });
  await p.setContent(ogHtml(paths), { waitUntil: "networkidle" });
  await p.waitForTimeout(300); // let the webfont paint before the shot
  writeFileSync(resolve(PUB, "og.jpg"), await p.screenshot({ type: "jpeg", quality: 90 }));

  await browser.close();
  console.log("Wrote favicon-16/32.png · favicon.ico · apple-touch-icon.png · icon-192/512.png · og.jpg");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
