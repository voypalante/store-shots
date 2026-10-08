#!/usr/bin/env node
// store-shots: marketing images from app screenshots, rendered by a headless browser.
//
//   store-shots compose scene.json -o out.png     phones and windows on a soft background, with notes
//   store-shots pad shot.png ... -o dir           fit screenshots into Google Play's 2:1 limit
//   store-shots feature --title "..." -o f.png    a 1024x500 feature graphic
import { chromium } from 'playwright';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const HELP = `store-shots <command> [options]

  compose <scene.json> [-o out.png] [--scale 2]
      Lay out screenshots as phones or windows on a gradient, with handwritten-style notes.
      See examples/ for scene files.

  pad <image...> [-o dir] [--ratio 2]
      Extend images with their edge color so the long side is at most --ratio times the short
      side (Google Play rejects screenshots over 2:1). Writes <name>.png into -o (default: padded/).

  feature --title "..." [--subtitle "..."] [--logo logo.svg] [--from #fbf3ea] [--to #ecd3c2]
          [--color #1b1714] [-o feature.png]
      A 1024x500 feature graphic for a store listing.

  Set CHROME=/path/to/chrome to use a specific browser; otherwise Playwright's Chromium is used
  (install it once with: npx playwright install chromium).
`;

const args = process.argv.slice(2);
const cmd = args.shift();
const opt = (name, def) => {
  const i = args.findIndex((a) => a === `--${name}` || (name === 'out' && a === '-o'));
  if (i < 0) return def;
  const [, v] = args.splice(i, 2);
  return v;
};

const url = (p) => pathToFileURL(resolve(p)).href;
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

async function withPage(fn) {
  const browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
  try {
    return await fn(browser);
  } finally {
    await browser.close();
  }
}

// Renders an HTML string at width x height and saves a PNG or JPEG.
async function render(browser, html, { width, height, scale = 1, out }) {
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: scale });
  const file = join(tmpdir(), `store-shots-${process.pid}-${Date.now()}.html`);
  writeFileSync(file, html);
  await page.goto(url(file), { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts?.ready);
  mkdirSync(dirname(resolve(out)), { recursive: true });
  const jpeg = /\.jpe?g$/i.test(out);
  await page.screenshot({ path: out, type: jpeg ? 'jpeg' : 'png', ...(jpeg ? { quality: 90 } : {}) });
  await page.close();
}

const FONTS = '<link href="https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,400;1,9..144,400&display=swap" rel="stylesheet">';

// ------------------------------------------------------------------ compose
function sceneHtml(scene, base) {
  const W = scene.width ?? 1600;
  const H = scene.height ?? 1200;
  const bg = scene.background ?? {};
  const from = bg.from ?? '#fbf3ea';
  const to = bg.to ?? '#ecd3c2';
  const at = bg.at ?? '30% 20%';
  const ink = scene.ink ?? '#7a4a35';
  const font = scene.font ?? 'Fraunces, Georgia, serif';
  const src = (p) => (/^(https?|file|data):/.test(p) ? p : url(join(base, p)));

  const items = (scene.items ?? []).map((it) => {
    const crop = it.crop ? `object-fit:cover;object-position:${it.crop};aspect-ratio:${it.aspect ?? 'auto'};` : '';
    const style = `position:absolute;left:${it.x ?? 0}px;top:${it.y ?? 0}px;width:${it.width ?? 400}px;rotate:${it.rotate ?? 0}deg;z-index:${it.z ?? 1}`;
    if (it.type === 'window') {
      return `<div class="win" style="${style};border-radius:${it.radius ?? 16}px"><img src="${esc(src(it.src))}" style="${crop}"></div>`;
    }
    return `<div class="phone" style="${style};border-radius:${it.radius ?? 44}px;border-width:${it.bezel ?? 10}px"><img src="${esc(src(it.src))}" style="${crop}"></div>`;
  }).join('\n');

  const notes = (scene.notes ?? []).map((n) => {
    const side = n.align === 'right' ? `right:${n.right ?? 80}px;text-align:right` : `left:${n.x ?? 80}px`;
    return `<div class="note" style="${side};top:${n.y ?? 80}px;rotate:${n.rotate ?? -3}deg;font-size:${n.size ?? 30}px">${esc(n.text)}${n.sub ? `<small>${esc(n.sub)}</small>` : ''}</div>`;
  }).join('\n');

  return `<!doctype html><html><head><meta charset="utf-8">${FONTS}<style>
*{box-sizing:border-box;margin:0}
body{width:${W}px;height:${H}px;overflow:hidden;position:relative;background:radial-gradient(circle at ${at},${from},${to})}
.phone{position:absolute;border:10px solid #1b1714;overflow:hidden;background:#000;box-shadow:0 40px 80px -20px rgba(70,35,20,.45),0 10px 24px -8px rgba(70,35,20,.3)}
.win{position:absolute;overflow:hidden;background:#fff;box-shadow:0 30px 70px -20px rgba(60,30,15,.45)}
.phone img,.win img{display:block;width:100%}
.note{position:absolute;font-family:${font};font-style:italic;color:${ink};line-height:1.2;z-index:10}
.note small{display:block;font-size:.73em;opacity:.7}
</style></head><body>${items}${notes}</body></html>`;
}

async function compose() {
  const file = args.shift();
  if (!file) throw new Error('compose needs a scene.json');
  const scene = JSON.parse(readFileSync(file, 'utf8'));
  const out = opt('out', scene.out ?? `${basename(file, extname(file))}.png`);
  const scale = Number(opt('scale', scene.scale ?? 1.5));
  await withPage((b) => render(b, sceneHtml(scene, dirname(resolve(file))), { width: scene.width ?? 1600, height: scene.height ?? 1200, scale, out }));
  console.log(out);
}

// ------------------------------------------------------------------ pad
async function pad() {
  const ratio = Number(opt('ratio', 2));
  const dir = opt('out', 'padded');
  if (!args.length) throw new Error('pad needs at least one image');
  mkdirSync(dir, { recursive: true });
  await withPage(async (browser) => {
    const page = await browser.newPage();
    for (const file of args) {
      const data = readFileSync(file).toString('base64');
      const mime = /\.jpe?g$/i.test(file) ? 'image/jpeg' : 'image/png';
      // Done in the page with a canvas: the edge color is sampled from the middle of the left edge.
      const png = await page.evaluate(async ({ data, mime, ratio }) => {
        const img = new Image();
        img.src = `data:${mime};base64,${data}`;
        await img.decode();
        const w = img.naturalWidth, h = img.naturalHeight;
        let W = w, H = h;
        if (h / w > ratio) W = Math.ceil(h / ratio);
        else if (w / h > ratio) H = Math.ceil(w / ratio);
        const c = document.createElement('canvas');
        c.width = 1; c.height = 1;
        const probe = c.getContext('2d');
        probe.drawImage(img, 1, Math.floor(h / 2), 1, 1, 0, 0, 1, 1);
        const [r, g, b] = probe.getImageData(0, 0, 1, 1).data;
        c.width = W; c.height = H;
        const ctx = c.getContext('2d');
        ctx.fillStyle = `rgb(${r},${g},${b})`;
        ctx.fillRect(0, 0, W, H);
        ctx.drawImage(img, Math.round((W - w) / 2), Math.round((H - h) / 2));
        return { url: c.toDataURL('image/png'), from: `${w}x${h}`, to: `${W}x${H}` };
      }, { data, mime, ratio });
      const out = join(dir, `${basename(file, extname(file))}.png`);
      writeFileSync(out, Buffer.from(png.url.split(',')[1], 'base64'));
      console.log(`${out}  ${png.from} -> ${png.to}`);
    }
  });
}

// ------------------------------------------------------------------ feature graphic
async function feature() {
  const title = opt('title');
  if (!title) throw new Error('feature needs --title');
  const subtitle = opt('subtitle', '');
  const logo = opt('logo');
  const out = opt('out', 'feature.png');
  const html = `<!doctype html><html><head><meta charset="utf-8">${FONTS}<style>
*{box-sizing:border-box;margin:0}
body{width:1024px;height:500px;display:flex;align-items:center;gap:56px;padding:0 80px;
  background:radial-gradient(circle at 25% 30%,${opt('from', '#fbf3ea')},${opt('to', '#ecd3c2')});
  font-family:${opt('font', 'Fraunces, Georgia, serif')};color:${opt('color', '#1b1714')}}
img{width:220px;height:220px;flex:none;object-fit:contain}
h1{font-weight:400;font-size:60px;line-height:1.05;letter-spacing:-.02em}
p{font-size:26px;margin-top:18px;font-style:italic;opacity:.75}
</style></head><body>${logo ? `<img src="${esc(url(logo))}">` : ''}<div><h1>${esc(title).replace(/\\n|\n/g, '<br>')}</h1>${subtitle ? `<p>${esc(subtitle)}</p>` : ''}</div></body></html>`;
  await withPage((b) => render(b, html, { width: 1024, height: 500, out }));
  console.log(out);
}

const commands = { compose, pad, feature };
if (!commands[cmd]) {
  process.stdout.write(HELP);
  process.exit(cmd && cmd !== '--help' && cmd !== '-h' ? 1 : 0);
}
commands[cmd]().catch((err) => {
  console.error(`store-shots: ${err.message}`);
  process.exit(1);
});
