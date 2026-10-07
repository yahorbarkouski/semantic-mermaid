import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { chromium } from 'playwright';
import { createRenderer } from '../toolchain/render.js';

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { suffix: { type: 'string', default: '-compare' } },
});

const dir = path.resolve(positionals[0] ?? 'samples');
const suffix = values.suffix;

const panel = (label, svg, kind) => `<section class="${kind}"><div class="k">${label}</div>${svg}</section>`;

const STYLE = `
  body { margin: 0; background: #fff }
  .figure { display: inline-grid; gap: 28px; padding: 28px; background: #fff }
  .figure.across { grid-template-columns: auto auto; align-items: start }
  .k { font: 600 13px/1 ui-monospace, Menlo, monospace; letter-spacing: .08em; text-transform: uppercase; color: #64748B; margin: 0 0 14px }
  .ours .k { color: #35658A }
  svg { display: block }
`;

const files = fs.readdirSync(dir).filter((f) => f.endsWith('.mmd')).sort();
const renderer = await createRenderer();
const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 2, viewport: { width: 2400, height: 1200 } });
try {
  for (const file of files) {
    const name = file.replace(/\.mmd$/, '');
    const source = fs.readFileSync(path.join(dir, file), 'utf8');
    const semantic = await renderer.render(source, { fit: false });
    const elk = await renderer.render(source, { layout: 'elk', fit: false });
    const wide = (elk.width / elk.height + semantic.width / semantic.height) / 2 > 1.3;
    await page.setContent(`<style>${STYLE}</style><div class="figure ${wide ? 'stacked' : 'across'}">${panel('Mermaid · ELK layout', elk.svg, 'elk')}${panel('Semantic Mermaid', semantic.svg, 'ours')}</div>`);
    const out = path.join(dir, `${name}${suffix}.png`);
    await page.locator('.figure').screenshot({ path: out });
    console.log(`${path.relative(process.cwd(), out)}  (${wide ? 'stacked' : 'side by side'})`);
  }
} finally {
  await browser.close();
  await renderer.close();
}
