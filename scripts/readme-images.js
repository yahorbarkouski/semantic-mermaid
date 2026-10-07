// Render the documentation's pictures: every diagram in examples/ drawn by the semantic layout, as
// examples/<name>.png beside its source, and the README's comparisons, the same diagram drawn by
// Mermaid's ELK layout and by the semantic layout side by side (one above the other for wide
// drawings), as docs/images/<name>.png.
//
//   npm run images
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createRenderer } from '../toolchain/render.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const EXAMPLES = path.join(ROOT, 'examples');
const OUT = path.join(ROOT, 'docs/images');
/** examples the README compares with ELK */
const COMPARED = new Set(['sign-in', 'order', 'onboarding', 'incident', 'gateway']);

/** @param {string} label @param {string} svg @param {string} kind */
const panel = (label, svg, kind) => `<section class="${kind}"><div class="k">${label}</div>${svg}</section>`;

const STYLE = `
  body { margin: 0; background: #fff }
  .figure { display: inline-grid; gap: 28px; padding: 28px; background: #fff }
  .figure.across { grid-template-columns: auto auto; align-items: start }
  .k { font: 600 13px/1 ui-monospace, Menlo, monospace; letter-spacing: .08em; text-transform: uppercase; color: #64748B; margin: 0 0 14px }
  .ours .k { color: #35658A }
  svg { display: block }
`;

fs.mkdirSync(OUT, { recursive: true });
const renderer = await createRenderer();
const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 2, viewport: { width: 2400, height: 1200 } });
try {
  for (const file of fs.readdirSync(EXAMPLES).filter((f) => f.endsWith('.mmd')).sort()) {
    const name = file.replace(/\.mmd$/, '');
    const source = fs.readFileSync(path.join(EXAMPLES, file), 'utf8');
    // the example picture sits on a page, framed to the page's width; the comparison panels keep their own
    const framed = await renderer.render(source);
    await page.setContent(`<style>${STYLE}</style><div class="figure">${framed.svg}</div>`);
    await page.locator('.figure').screenshot({ path: path.join(EXAMPLES, `${name}.png`) });
    console.log(`examples/${name}.png  (${framed.report?.layout?.chosen})`);
    if (!COMPARED.has(name)) continue;
    const semantic = await renderer.render(source, { fit: false });
    const elk = await renderer.render(source, { layout: 'elk', fit: false });
    // wide drawings read better stacked; tall ones side by side
    const wide = (elk.width / elk.height + semantic.width / semantic.height) / 2 > 1.3;
    await page.setContent(`<style>${STYLE}</style><div class="figure ${wide ? 'stacked' : 'across'}">${panel('Mermaid · ELK layout', elk.svg, 'elk')}${panel('Semantic Mermaid', semantic.svg, 'ours')}</div>`);
    await page.locator('.figure').screenshot({ path: path.join(OUT, `${name}.png`) });
    console.log(`docs/images/${name}.png`);
  }
} finally {
  await browser.close();
  await renderer.close();
}
