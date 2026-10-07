// Render many diagrams with the semantic layout and with plain ELK, and summarise: render errors,
// which candidate won, and the engine's measurements against ELK's.
//
//   node scripts/compare.js <dir-or-files...> [--out dir] [--pages 6] [--png]
//
// With --out, writes <id>.semantic.svg / .elk.svg (and .png with --png) and compare.json there.
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { createRenderer } from '../toolchain/render.js';

const { values, positionals } = parseArgs({ allowPositionals: true, options: { out: { type: 'string' }, pages: { type: 'string', default: '6' }, png: { type: 'boolean', default: false } } });
const files = positionals.flatMap((p) => (fs.statSync(p).isDirectory() ? fs.readdirSync(p).filter((f) => /\.(mmd|mermaid)$/.test(f)).map((f) => path.join(p, f)) : [p])).sort();
if (values.out) fs.mkdirSync(values.out, { recursive: true });

const renderer = await createRenderer({ pages: Number(values.pages) });
const rows = [];
const started = Date.now();
await Promise.all(files.map(async (file) => {
  const id = path.basename(file).replace(/\.(mmd|mermaid)$/, '');
  const source = fs.readFileSync(file, 'utf8');
  const row = { id };
  for (const layout of /** @type {const} */ (['semantic', 'elk'])) {
    try {
      const r = await renderer.render(source, { layout, png: Boolean(values.png && values.out) });
      row[`${layout}Ms`] = Math.round(r.ms);
      if (values.out) {
        fs.writeFileSync(path.join(values.out, `${id}.${layout}.svg`), r.svg);
        if (r.png) fs.writeFileSync(path.join(values.out, `${id}.${layout}.png`), r.png);
      }
      if (layout === 'semantic' && r.report) {
        row.chosen = r.report.layout?.chosen ?? null;
        row.directives = r.report.directives;
        row.problems = r.report.diagnostics.filter((d) => d.severity !== 'info').map((d) => d.message);
        row.skipped = r.report.diagnostics.filter((d) => d.message.startsWith('layout candidate')).length;
        const m = r.report.layout?.measurements, b = r.report.layout?.baseline;
        if (m && b) {
          const keep = (x) => ({ crossings: x.crossings, through: x.throughBoxes, labels: x.labelClashes, titles: x.titleCrossings, crowded: x.crowdedEnds, aspect: +x.aspect.toFixed(2), spine: x.spine === null ? null : +x.spine.toFixed(2) });
          row.semantic = keep(m);
          row.elk = keep(b);
        }
      }
    } catch (error) {
      row[`${layout}Error`] = String(/** @type {Error} */ (error).message).split('\n')[0].slice(0, 160);
    }
  }
  rows.push(row);
}));
await renderer.close();
rows.sort((a, b) => a.id.localeCompare(b.id));

const ok = rows.filter((r) => r.semantic);
const sum = (k, f) => ok.reduce((s, r) => s + (r[k][f] ?? 0), 0);
const changed = ok.filter((r) => r.chosen !== 'elk');
const chosen = {};
for (const r of ok) chosen[r.chosen] = (chosen[r.chosen] ?? 0) + 1;
const median = (xs) => xs.sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? 0;
const summary = {
  diagrams: rows.length,
  semanticErrors: rows.filter((r) => r.semanticError).map((r) => `${r.id}: ${r.semanticError}`),
  elkErrors: rows.filter((r) => r.elkError).length,
  changedFromElk: changed.length,
  chosen,
  candidatesSkipped: rows.reduce((s, r) => s + (r.skipped ?? 0), 0),
  totals: Object.fromEntries(['crossings', 'through', 'labels', 'titles', 'crowded'].map((f) => [f, { semantic: sum('semantic', f), elk: sum('elk', f) }])),
  medianMs: { semantic: median(rows.map((r) => r.semanticMs).filter(Boolean)), elk: median(rows.map((r) => r.elkMs).filter(Boolean)) },
  seconds: Math.round((Date.now() - started) / 1000),
};
if (values.out) fs.writeFileSync(path.join(values.out, 'compare.json'), JSON.stringify({ summary, rows }, null, 1));
console.log(JSON.stringify(summary, null, 1));
