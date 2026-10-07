// Render the documentation's pictures: every diagram in examples/ drawn by Mermaid's ELK layout and by
// the semantic layout side by side (one above the other for wide drawings), as examples/<name>.png
// beside its source; docs/images/page-fit.png, a wide diagram on a page as written and as render draws
// it for the page; docs/images/swimlanes.png, the expense example as Mermaid's own swimlane diagram
// and with @lanes; and docs/images/pipeline.png, the engine's own pipeline for the README. The comparisons draw each layout at its own width, for no page.
//
//   npm run images
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createRenderer, PAGE_WIDTH } from '../toolchain/render.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const EXAMPLES = path.join(ROOT, 'examples');
const OUT = path.join(ROOT, 'docs/images');
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
    const semantic = await renderer.render(source, { fit: false });
    const elk = await renderer.render(source, { layout: 'elk', fit: false });
    // wide drawings read better stacked; tall ones side by side
    const wide = (elk.width / elk.height + semantic.width / semantic.height) / 2 > 1.3;
    await page.setContent(`<style>${STYLE}</style><div class="figure ${wide ? 'stacked' : 'across'}">${panel('Mermaid · ELK layout', elk.svg, 'elk')}${panel('Semantic Mermaid', semantic.svg, 'ours')}</div>`);
    await page.locator('.figure').screenshot({ path: path.join(EXAMPLES, `${name}.png`) });
    console.log(`examples/${name}.png  (${semantic.report?.layout?.chosen})`);
  }

  // the engine's own pipeline, for How it works: the semantic layout alone
  const pipeline = await renderer.render(fs.readFileSync(path.join(EXAMPLES, 'pipeline.mmd'), 'utf8'), { fit: false });
  await page.setContent(`<style>${STYLE}</style><div class="figure">${pipeline.svg}</div>`);
  await page.locator('.figure').screenshot({ path: path.join(OUT, 'pipeline.png') });
  console.log('docs/images/pipeline.png');

  // the page figure: one wide diagram on two pages as wide as render assumes, as written and as render draws it
  const wide = fs.readFileSync(path.join(EXAMPLES, 'food-delivery.mmd'), 'utf8');
  const written = await renderer.render(wide, { fit: false });
  const fitted = await renderer.render(wide);
  const shown = Math.round((PAGE_WIDTH / written.width) * 100);
  const onPage = (label, svg) => `<section><div class="k">${label}</div><div class="page">${svg}</div></section>`;
  const PAGE_STYLE = `.page { width: ${PAGE_WIDTH}px; box-sizing: content-box; padding: 20px; border: 1px solid #D0D7DE; border-radius: 6px } .page svg { width: 100%; height: auto }`;
  await page.setContent(`<style>${STYLE}${PAGE_STYLE}</style><div class="figure across">${onPage(`As written: ${Math.round(written.width)} px wide, shown at ${shown}%`, written.svg)}${onPage('As render draws it for the page', fitted.svg)}</div>`);
  await page.locator('.figure').screenshot({ path: path.join(OUT, 'page-fit.png') });
  console.log(`docs/images/page-fit.png  (${fitted.report?.layout?.chosen})`);

  // the swimlane figure: the expense example as Mermaid's own swimlane diagram, and with @lanes
  const expense = fs.readFileSync(path.join(EXAMPLES, 'expense.mmd'), 'utf8');
  const swimlane = await renderer.render(expense.replace(/^flowchart TD/m, 'swimlane-beta TD'), { fit: false });
  const lanes = await renderer.render(expense, { fit: false });
  await page.setContent(`<style>${STYLE}</style><div class="figure across">${panel('Mermaid · swimlane-beta', swimlane.svg, 'elk')}${panel('Semantic Mermaid · @lanes', lanes.svg, 'ours')}</div>`);
  await page.locator('.figure').screenshot({ path: path.join(OUT, 'swimlanes.png') });
  console.log('docs/images/swimlanes.png');
} finally {
  await browser.close();
  await renderer.close();
}
